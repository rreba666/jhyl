<script setup lang="ts">
/**
 * 商家端 · 商品管理（对应设计稿「商品管理」页，30 画板中的在售中 / 库存预警 / 仓库中 + 批量操作收敛为一页）
 * 契约（api_doc.json /api/merchant/products/**，2026-09-18 已到位）：
 * - 列表：GET /api/merchant/products?keyword=&status=&page=&pageSize=（status: 1=已上架, 0=未上架, 空=全部）
 * - 单条上下架：PUT /api/merchant/products/{id}/status?status=0|1
 * - 单条改库存 / 改价：PUT /{id}/stock?stock= 、/{id}/price?price=
 * - 批量上下架：POST /api/merchant/products/batch  body { productIds: [], status: 0|1 }
 *
 * 范围结论（设计疑问清单）：商品核心是**上下架**；批量只做上/下架；订单只读不做。
 * 库存预警：后端无专用接口，取「已上架」商品在前端按阈值过滤（阈值待产品确认，暂 100）。
 */
import { computed, reactive, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  batchUpdateProducts,
  getMerchantProducts,
  updateProductPrice,
  updateProductStatus,
  updateProductStock,
  type MerchantProductVO,
} from '@/api/merchant'
import ProductCard from '@/components/merchant/ProductCard.vue'

/** 库存预警阈值（设计稿示例 100；阈值来源待产品/后端确认）。 */
const LOW_STOCK_THRESHOLD = 100

const TABS = [
  { key: 'onSale', label: '在售中', status: 1 as 0 | 1 | '' },
  { key: 'warning', label: '库存预警', status: 1 as 0 | 1 | '' },
  { key: 'offSale', label: '仓库中', status: 0 as 0 | 1 | '' },
] as const
type TabKey = (typeof TABS)[number]['key']

const EMPTY_TEXT: Record<TabKey, string> = {
  onSale: '暂无在售商品',
  warning: '暂无库存预警商品',
  offSale: '仓库中暂无商品',
}

/** 状态栏高度（自定义导航需避开状态栏）。 */
const statusBarHeight = ref(0)
/** 页头高度 = 状态栏 + 44px 标题栏 + 46px Tab 栏（px）。 */
const HEADER_TITLE_H = 44
const HEADER_TAB_H = 46
const contentTop = computed(() => statusBarHeight.value + HEADER_TITLE_H + HEADER_TAB_H)

const activeTab = ref<TabKey>('onSale')
const keyword = ref('')
const products = ref<MerchantProductVO[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const loadingMore = ref(false)
const acting = ref(false)

/** 各 Tab 商品数（在售中/仓库中取接口 total；库存预警取本地过滤计数）。 */
const tabCounts = reactive<Record<TabKey, number>>({ onSale: 0, warning: 0, offSale: 0 })

/** 批量模式：勾选集合（productId）。 */
const batchMode = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const selectedCount = computed(() => selectedIds.value.size)
const allSelected = computed(() => products.value.length > 0 && products.value.every((p) => selectedIds.value.has(p.productId as number)))

/** 当前 Tab 是否为「库存预警」（本地过滤低库存）。 */
const isWarningTab = computed(() => activeTab.value === 'warning')

/** 当前列表渲染数据（预警 Tab 额外过滤低库存）。 */
const renderList = computed<MerchantProductVO[]>(() => {
  if (!isWarningTab.value) return products.value
  return products.value.filter((p) => effectiveStock(p) <= LOW_STOCK_THRESHOLD)
})

/** 当前 Tab 左侧按钮文案：在售中/预警=「更多」（下架），仓库中=「上架商品」。 */
const leftBtnText = computed(() => (activeTab.value === 'offSale' ? '上架商品' : '更多'))

/** 批量操作方向：在售中/预警 → 下架(0)，仓库中 → 上架(1)。 */
const batchTargetStatus = computed<0 | 1>(() => (activeTab.value === 'offSale' ? 1 : 0))
const batchActionLabel = computed(() => (batchTargetStatus.value === 1 ? '上架' : '下架'))

/** 有效库存（门店库存优先，否则品牌总库存）。 */
function effectiveStock(p: MerchantProductVO): number {
  const v = p.shopStock ?? p.totalStock
  return v == null ? 0 : Number(v)
}

// ===== 弹层状态 =====
/** 改价目标商品。 */
const priceTarget = ref<MerchantProductVO | null>(null)
const priceInput = ref('')
/** 改库存目标商品。 */
const stockTarget = ref<MerchantProductVO | null>(null)
const stockInput = ref('')
/** 上/下架确认（单条或批量）。 */
const confirmVisible = ref(false)
const confirmText = ref('')
const confirmFn = ref<null | (() => Promise<void>)>(null)

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '商品管理' })
})

onShow(() => {
  void refreshTabCounts()
  void loadList(true)
})

/**
 * 按接口返回推算 Tab 数字。
 * ⚠️ 后端 `status` 过滤的 `total` 有 bug（2026-09-19 实测：门店只有 1 个**上架**商品，
 * `status=0` 仍返回 `total=1` 但 `list=[]` —— `total` 没有跟随 status 过滤，恒等于门店商品总数），
 * 直接信 `total` 会让 Tab 显示「仓库中 1」而点进去是空的。
 * 所以：**一条都拿不到 ⇒ 该 Tab 确实没有数据，计 0**；拿得到才用 total（后端修好后自动精确）。
 */
function countOf(res: { list?: MerchantProductVO[]; total?: number } | undefined): number {
  const list = Array.isArray(res?.list) ? res.list : []
  if (!list.length) return 0
  return Number(res?.total || 0)
}

/** 拉取在售中 / 仓库中的数量（用于 Tab 数字），失败静默置 0。 */
async function refreshTabCounts(): Promise<void> {
  try {
    const [onSale, offSale] = await Promise.all([
      getMerchantProducts({ status: 1, page: 1, pageSize: 1 }),
      getMerchantProducts({ status: 0, page: 1, pageSize: 1 }),
    ])
    tabCounts.onSale = countOf(onSale)
    tabCounts.offSale = countOf(offSale)
  } catch {
    // 忽略：Tab 数字不影响主流程
  }
}

/** 加载当前 Tab 列表。reset=true 重置到第一页。 */
async function loadList(reset = false): Promise<void> {
  if (reset) {
    page.value = 1
    products.value = []
  }
  const isFirst = page.value === 1
  if (isFirst) loading.value = true
  else loadingMore.value = true

  try {
    const tab = TABS.find((t) => t.key === activeTab.value)!
    const result = await getMerchantProducts({
      keyword: keyword.value || undefined,
      status: tab.status,
      page: page.value,
      pageSize,
    })
    const list = Array.isArray(result?.list) ? result.list : []
    products.value = isFirst ? list : [...products.value, ...list]
    total.value = Number(result?.total || 0)
    // 第一页为空 ⇒ 当前 Tab 确实没有商品：把 total 与 Tab 数字一起归零
    // （后端 total 未按 status 过滤，见 countOf 注释；列表数据本身是正确的）
    if (isFirst && list.length === 0) {
      total.value = 0
      tabCounts[activeTab.value] = 0
    }
    if (isWarningTab.value) tabCounts.warning = products.value.filter((p) => effectiveStock(p) <= LOW_STOCK_THRESHOLD).length
  } catch (error) {
    if (isFirst) products.value = []
    uni.showToast({ title: error instanceof Error ? error.message : '加载失败', icon: 'none' })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

/** 上拉加载更多。 */
function loadMore(): void {
  if (loading.value || loadingMore.value) return
  if (products.value.length >= total.value) return
  page.value += 1
  void loadList()
}

/** 切换 Tab（退出批量模式并重新加载）。 */
function switchTab(key: TabKey): void {
  if (activeTab.value === key) return
  activeTab.value = key
  exitBatchMode()
  void loadList(true)
}

/** 搜索（输入确认后按关键词过滤当前 Tab）。 */
function onSearchConfirm(): void {
  exitBatchMode()
  void loadList(true)
}

/** 清空搜索词。 */
function onClearSearch(): void {
  keyword.value = ''
  void loadList(true)
}

// ===== 批量模式 =====
function enterBatchMode(): void {
  batchMode.value = true
  selectedIds.value = new Set()
}

function exitBatchMode(): void {
  batchMode.value = false
  selectedIds.value = new Set()
}

function toggleSelect(product: MerchantProductVO): void {
  const id = product.productId as number
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function toggleAll(): void {
  if (allSelected.value) {
    selectedIds.value = new Set()
    return
  }
  selectedIds.value = new Set(renderList.value.map((p) => p.productId as number))
}

/** 批量上/下架：弹确认后调用批量接口。 */
function onBatchAction(): void {
  if (selectedCount.value === 0) {
    uni.showToast({ title: '请先选择商品', icon: 'none' })
    return
  }
  openConfirm(`即将${batchActionLabel.value} ${selectedCount.value} 件商品，${batchActionLabel.value === '下架' ? '下架后用户无法购买，历史订单正常保留' : '上架后用户即可购买'}`, async () => {
    await batchUpdateProducts([...selectedIds.value], batchTargetStatus.value)
    exitBatchMode()
    await refreshTabCounts()
    await loadList(true)
  })
}

// ===== 单条操作 =====
function onCardAction(payload: { type: 'left' | 'price' | 'stock' | 'edit'; product: MerchantProductVO }): void {
  if (payload.type === 'price') openPrice(payload.product)
  else if (payload.type === 'stock') openStock(payload.product)
  else if (payload.type === 'edit') openEdit(payload.product)
  else onLeftAction(payload.product)
}

/** 左侧按钮：在售中/预警=下架，仓库中=上架。 */
function onLeftAction(product: MerchantProductVO): void {
  const target: 0 | 1 = activeTab.value === 'offSale' ? 1 : 0
  const label = target === 1 ? '上架' : '下架'
  openConfirm(`确定${label}「${product.name || ''}」吗？`, async () => {
    await updateProductStatus(product.productId as number, target)
    await refreshTabCounts()
    await loadList(true)
  })
}

/** 编辑商品：把列表项暂存到 storage（无单商品详情接口，用列表项回填），跳编辑页。 */
function openEdit(product: MerchantProductVO): void {
  uni.setStorageSync('merchant_product_edit', product)
  uni.navigateTo({ url: `/subpkg-merchant/products/edit?productId=${product.productId}` })
}

/** 新增商品：跳编辑页（无 productId）。 */
function onAddProduct(): void {
  uni.navigateTo({ url: '/subpkg-merchant/products/edit' })
}

// ===== 改价 / 改库存弹层 =====
function openPrice(product: MerchantProductVO): void {
  priceTarget.value = product
  priceInput.value = ''
  // 已有门店价则回填，否则用品牌最低价
  const cur = product.shopPrice ?? product.minPrice
  if (cur != null) priceInput.value = String(cur)
}

function submitPrice(): void {
  const target = priceTarget.value
  if (!target) return
  const value = Number(priceInput.value)
  if (!Number.isFinite(value) || value <= 0) {
    uni.showToast({ title: '请输入正确的价格', icon: 'none' })
    return
  }
  void doSubmit(async () => {
    await updateProductPrice(target.productId as number, value)
    priceTarget.value = null
    await loadList(true)
  })
}

function openStock(product: MerchantProductVO): void {
  stockTarget.value = product
  stockInput.value = ''
  const cur = product.shopStock ?? product.totalStock
  if (cur != null) stockInput.value = String(cur)
}

function submitStock(): void {
  const target = stockTarget.value
  if (!target) return
  const value = Number(stockInput.value)
  if (!Number.isInteger(value) || value < 0) {
    uni.showToast({ title: '请输入正确的库存', icon: 'none' })
    return
  }
  void doSubmit(async () => {
    await updateProductStock(target.productId as number, value)
    stockTarget.value = null
    await loadList(true)
  })
}

// ===== 确认弹层 =====
function openConfirm(text: string, fn: () => Promise<void>): void {
  confirmText.value = text
  confirmFn.value = fn
  confirmVisible.value = true
}

function closeConfirm(): void {
  confirmVisible.value = false
  confirmFn.value = null
}

/** 提交动作统一包装：loading 态 + 错误 toast。 */
async function doSubmit(fn: () => Promise<void>): Promise<void> {
  if (acting.value) return
  acting.value = true
  try {
    await fn()
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
  } finally {
    acting.value = false
  }
}

async function onConfirm(): Promise<void> {
  const fn = confirmFn.value
  closeConfirm()
  if (!fn) return
  await doSubmit(fn)
}

function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <!-- 页头（白底）：返回 + 搜索框 + Tab -->
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-row">
        <text class="nav-back" @click="goBack">‹</text>
        <view class="search-box">
          <text class="rider-icon rider-icon-sousuo search-icon" />
          <input
            class="search-input"
            v-model="keyword"
            placeholder="搜索商品"
            placeholder-class="search-ph"
            confirm-type="search"
            @confirm="onSearchConfirm"
          />
          <text v-if="keyword" class="search-clear" @click="onClearSearch">×</text>
        </view>
      </view>
      <view class="tabs">
        <view v-for="tab in TABS" :key="tab.key" class="tab" @click="switchTab(tab.key)">
          <text class="tab-text" :class="{ 'is-active': activeTab === tab.key }">{{ tab.label }}<text v-if="tabCounts[tab.key] > 0"> {{ tabCounts[tab.key] }}</text></text>
          <view class="tab-line" :class="{ 'is-active': activeTab === tab.key }" />
        </view>
      </view>
    </view>

    <!-- 列表 -->
    <scroll-view class="list" scroll-y @scrolltolower="loadMore">
      <view v-if="loading" class="state">加载中…</view>
      <view v-else-if="!renderList.length" class="state">{{ EMPTY_TEXT[activeTab] }}</view>
      <template v-else>
        <view v-for="product in renderList" :key="product.productId" class="list-card">
          <ProductCard
            :product="product"
            :mode="batchMode ? 'batch' : 'normal'"
            :selected="selectedIds.has(product.productId as number)"
            :left-btn="leftBtnText"
            @select="toggleSelect"
            @action="onCardAction"
          />
        </view>
        <view class="list-footer">{{ loadingMore ? '加载中…' : (products.length >= total ? '没有更多了' : '上拉加载更多') }}</view>
      </template>
    </scroll-view>

    <!-- 底部操作栏 -->
    <view class="footer">
      <!-- 普通模式 -->
      <view v-if="!batchMode" class="footer-row">
        <button class="footer-btn footer-btn-ghost" @click="enterBatchMode">批量管理</button>
        <button class="footer-btn footer-btn-primary" @click="onAddProduct">新增商品</button>
      </view>
      <!-- 批量模式 -->
      <view v-else class="footer-row footer-row-batch">
        <view class="select-all" @click="toggleAll">
          <view class="check" :class="{ 'is-checked': allSelected }">
            <text v-if="allSelected" class="rider-icon rider-icon-gouxuan_tianchong check-icon" />
          </view>
          <text class="select-all-text">全选</text>
          <text class="selected-count">已选 {{ selectedCount }} 个商品</text>
        </view>
        <button
          class="footer-btn footer-btn-ghost footer-btn-batch"
          :class="{ 'is-disabled': selectedCount === 0 }"
          :disabled="selectedCount === 0 || acting"
          @click="onBatchAction"
        >{{ batchActionLabel === '上架' ? '上架商品' : '下架商品' }}</button>
      </view>
    </view>

    <!-- 改价弹层 -->
    <view v-if="priceTarget" class="mask mask-bottom" @click="priceTarget = null">
      <view class="sheet" @click.stop>
        <view class="sheet-title">
          <text class="sheet-title-text">修改价格</text>
          <text class="sheet-close" @click="priceTarget = null">×</text>
        </view>
        <view class="sheet-body">
          <text class="sheet-label">价格</text>
          <input class="sheet-input" v-model="priceInput" type="digit" placeholder="请输入价格" placeholder-class="sheet-ph" />
          <text class="sheet-unit">元</text>
        </view>
        <view class="sheet-actions">
          <button class="sheet-btn sheet-btn-cancel" @click="priceTarget = null">取消</button>
          <button class="sheet-btn sheet-btn-confirm" :disabled="acting" @click="submitPrice">确定</button>
        </view>
      </view>
    </view>

    <!-- 改库存弹层 -->
    <view v-if="stockTarget" class="mask mask-bottom" @click="stockTarget = null">
      <view class="sheet" @click.stop>
        <view class="sheet-title">
          <text class="sheet-title-text">修改库存</text>
          <text class="sheet-close" @click="stockTarget = null">×</text>
        </view>
        <view class="sheet-body">
          <text class="sheet-label">库存</text>
          <input class="sheet-input" v-model="stockInput" type="number" placeholder="请输入库存" placeholder-class="sheet-ph" />
          <text class="sheet-unit">件</text>
        </view>
        <view class="sheet-actions">
          <button class="sheet-btn sheet-btn-cancel" @click="stockTarget = null">取消</button>
          <button class="sheet-btn sheet-btn-confirm" :disabled="acting" @click="submitStock">确定</button>
        </view>
      </view>
    </view>

    <!-- 上/下架确认对话框 -->
    <view v-if="confirmVisible" class="mask mask-center" @click="closeConfirm">
      <view class="dialog" @click.stop>
        <text class="dialog-title">{{ batchActionLabel === '上架' ? '上架商品' : '下架商品' }}</text>
        <text class="dialog-body">{{ confirmText }}</text>
        <view class="dialog-actions">
          <button class="dialog-btn" @click="closeConfirm">取消</button>
          <button class="dialog-btn dialog-btn-confirm" :disabled="acting" @click="onConfirm">确定</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  background: #f2f3f7;
}

/* 页头（白底，含状态栏 + 标题栏 + Tab） */
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  background: #ffffff;
}
.nav-row {
  display: flex;
  align-items: center;
  gap: 23rpx;
  height: 85rpx; /* 44px */
  padding: 0 23rpx;
}
.nav-back {
  flex: none;
  color: #1d2129;
  font-size: 46rpx;
  line-height: 1;
}
.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 69rpx; /* 36px */
  padding: 0 23rpx;
  border-radius: 9999rpx;
  background: #f1f2f4;
}
.search-icon {
  flex: none;
  color: #86909c;
  font-size: 30rpx;
}
.search-input {
  flex: 1;
  min-width: 0;
  color: #1d2129;
  font-size: 28rpx;
}
.search-ph {
  color: #86909c;
}
.search-clear {
  flex: none;
  color: #86909c;
  font-size: 36rpx;
  line-height: 1;
  padding: 0 4rpx;
}

/* Tab 栏 */
.tabs {
  display: flex;
  align-items: center;
  height: 88rpx; /* 46px */
  padding: 0 8rpx;
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 31rpx;
}
.tab-text {
  color: #1d2129;
  font-size: 27rpx;
  font-weight: 400;
  line-height: 42rpx;
}
.tab-text.is-active {
  color: #ff5500;
  font-weight: 500;
}
.tab-line {
  width: 100%;
  height: 4rpx;
  margin-top: 10rpx;
  border-radius: 2rpx;
  background: transparent;
}
.tab-line.is-active {
  background: #ff5500;
}

/* 列表（flex:1 占据页头与底部栏之间的空间，底部留 padding 避免被固定栏遮挡） */
.list {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 15rpx 15rpx 204rpx;
}
.list-card {
  margin-bottom: 15rpx;
}
.state {
  padding: 200rpx 0;
  text-align: center;
  color: #86909c;
  font-size: 28rpx;
}
.list-footer {
  padding: 24rpx 0;
  text-align: center;
  color: #86909c;
  font-size: 24rpx;
}

/* 底部操作栏 */
.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  background: #ffffff;
  padding-bottom: env(safe-area-inset-bottom);
}
.footer-row {
  display: flex;
  align-items: center;
  gap: 15rpx;
  height: 138rpx; /* 72px */
  padding: 23rpx;
  box-sizing: border-box;
}
.footer-btn {
  margin: 0;
  padding: 0;
  height: 92rpx; /* 48px */
  border-radius: 24rpx;
  font-size: 31rpx;
  font-weight: 600;
  line-height: 92rpx;
}
.footer-btn::after {
  border: 0;
}
.footer-btn-ghost {
  flex: 112;
  background: #f6f7f9;
  color: #1d2129;
}
.footer-btn-primary {
  flex: 246;
  background: linear-gradient(90deg, #ff9301 0%, #ff6a01 50%, #ff4202 100%);
  color: #ffffff;
}
.footer-row-batch {
  justify-content: space-between;
}
.select-all {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38rpx;
  height: 38rpx;
  border-radius: 50%;
  border: 3rpx solid #d7dbe0;
  background: #ffffff;
}
.check.is-checked {
  border-color: transparent;
}
.check-icon {
  color: #ff5500;
  font-size: 34rpx;
}
.select-all-text {
  color: #1d2129;
  font-size: 27rpx;
}
.selected-count {
  color: #86909c;
  font-size: 27rpx;
}
.footer-btn-batch {
  flex: none;
  width: 216rpx;
}
.footer-btn-batch.is-disabled {
  opacity: 0.5;
}

/* 遮罩（底部弹层贴底、对话框居中） */
.mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
}
.mask-bottom {
  align-items: flex-end;
}
.mask-center {
  align-items: center;
  justify-content: center;
}
.sheet {
  width: 100%;
  padding: 31rpx 23rpx calc(31rpx + env(safe-area-inset-bottom));
  border-radius: 24rpx 24rpx 0 0;
  background: #ffffff;
}
.sheet-title {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  height: 46rpx;
}
.sheet-title-text {
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
}
.sheet-close {
  position: absolute;
  right: 0;
  top: 0;
  color: #1d2129;
  font-size: 40rpx;
  line-height: 1;
  padding: 0 4rpx;
}
.sheet-body {
  display: flex;
  align-items: center;
  gap: 23rpx;
  margin-top: 23rpx;
}
.sheet-label {
  flex: none;
  color: #1d2129;
  font-size: 27rpx;
}
.sheet-input {
  flex: 1;
  min-width: 0;
  height: 77rpx;
  padding: 0 23rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
  color: #1d2129;
  font-size: 27rpx;
}
.sheet-ph {
  color: #c1c5cc;
}
.sheet-unit {
  flex: none;
  color: #1d2129;
  font-size: 27rpx;
}
.sheet-actions {
  display: flex;
  gap: 15rpx;
  margin-top: 38rpx;
}
.sheet-btn {
  margin: 0;
  padding: 0;
  flex: 1;
  height: 77rpx;
  border-radius: 15rpx;
  font-size: 27rpx;
  font-weight: 500;
  line-height: 77rpx;
}
.sheet-btn::after {
  border: 0;
}
.sheet-btn-cancel {
  background: #f6f7f9;
  color: #1d2129;
}
.sheet-btn-confirm {
  background: #fff4e8;
  color: #ff5500;
}

/* 居中对话框 */
.dialog {
  width: 577rpx; /* 300px */
  border-radius: 24rpx;
  background: #ffffff;
  overflow: hidden;
}
.dialog-title {
  display: block;
  padding: 46rpx 38rpx 0;
  text-align: center;
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
}
.dialog-body {
  display: block;
  padding: 31rpx 38rpx;
  color: #1d2129;
  font-size: 27rpx;
  line-height: 46rpx;
}
.dialog-actions {
  display: flex;
  border-top: 2rpx solid #e5e6eb;
}
.dialog-btn {
  margin: 0;
  padding: 0;
  flex: 1;
  height: 108rpx; /* 56px */
  border-radius: 0;
  background: #ffffff;
  color: #1d2129;
  font-size: 31rpx;
  line-height: 108rpx;
}
.dialog-btn::after {
  border: 0;
}
.dialog-btn + .dialog-btn {
  border-left: 2rpx solid #e5e6eb;
}
.dialog-btn-confirm {
  color: #ff5500;
  font-weight: 600;
}
</style>
