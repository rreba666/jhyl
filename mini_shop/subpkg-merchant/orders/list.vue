<script setup lang="ts">
/**
 * 商家端 · 订单列表（对应设计稿「订单管理」页，6 个页签 + 筛选弹层，只读）
 * 契约（api_doc.json GET /api/merchant/orders，2026-09-18 已到位）：
 * - tab：ALL / WAIT_ACCEPT / WAIT_PICKUP / DELIVERING / DONE / EXCEPTION（同城履约视角）
 * - keyword：订单号 / 收货人手机号（模糊）
 * - startTime / endTime：下单时间范围（yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss）
 * 范围结论：订单只读，无任何操作按钮；卡片点进详情。
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  finishPreparation,
  getMerchantOrders,
  type MerchantOrderCardVO,
  type MerchantOrderTab,
} from '@/api/merchant'
import OrderCard from '@/components/merchant/OrderCard.vue'
// 空状态（设计稿 2026-09-22）：普通空态与「搜索无结果」是**两张不同插画**；插画放本分包 static
import EmptyState from '@/components/EmptyState.vue'

const TABS = [
  { key: 'all', api: 'ALL', label: '全部' },
  { key: 'waitAccept', api: 'WAIT_ACCEPT', label: '待接单' },
  { key: 'waitPickup', api: 'WAIT_PICKUP', label: '待取货' },
  { key: 'delivering', api: 'DELIVERING', label: '配送中' },
  { key: 'done', api: 'DONE', label: '已完成' },
  { key: 'exception', api: 'EXCEPTION', label: '异常单' },
] as const
type TabKey = (typeof TABS)[number]['key']

/**
 * 空状态（设计稿 2026-09-22）：
 * - 普通空态：插画 `orders.png` + 「暂无订单」；
 * - 搜索无结果：插画 `orders-search.png` + 「暂无搜索订单」（**两张插画不同**，见下方 emptyImage / emptyText）。
 * ⚠️ 口径变化：原来按 Tab 分文案（暂无待接单订单 …），设计稿统一为「暂无订单」。
 */

const statusBarHeight = ref(0)
/** 页头高度 = 状态栏 + 44px 标题栏 + 54px Tab 栏（px）。 */
const contentTop = computed(() => statusBarHeight.value + 44 + 54)

const activeTab = ref<TabKey>('all')
const keyword = ref('')

/** 是否处于「搜索无结果」：有关键词时用搜索专用插画与文案（设计稿里那是**另一张插画**）。 */
const isSearchEmpty = computed(() => Boolean(keyword.value.trim()))
const emptyImage = computed(() => (isSearchEmpty.value ? '/subpkg-merchant/static/empty/orders-search.png' : '/subpkg-merchant/static/empty/orders.png'))
const emptyText = computed(() => (isSearchEmpty.value ? '暂无搜索订单' : '暂无订单'))
const orders = ref<MerchantOrderCardVO[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const loadingMore = ref(false)

/** 已生效的筛选时间（空 = 未筛选）。 */
const activeStartTime = ref('')
const activeEndTime = ref('')
/** 是否有生效的时间筛选（用于「筛选」按钮角标）。 */
const hasFilter = computed(() => Boolean(activeStartTime.value || activeEndTime.value))

// ===== 筛选弹层状态 =====
const filterVisible = ref(false)
/** 快捷项：week / month / threeMonths / custom。 */
const quickRange = ref<'week' | 'month' | 'threeMonths' | 'custom' | ''>('')
const draftStart = ref('')
const draftEnd = ref('')

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '订单管理' })
})

onShow(() => {
  void loadList(true)
})

/** 加载订单列表。reset=true 重置到第一页。 */
async function loadList(reset = false): Promise<void> {
  if (reset) {
    page.value = 1
    orders.value = []
  }
  if (page.value === 1) loading.value = true
  else loadingMore.value = true
  try {
    const tab = TABS.find((t) => t.key === activeTab.value)!
    const result = await getMerchantOrders({
      tab: tab.api as MerchantOrderTab,
      keyword: keyword.value || undefined,
      startTime: activeStartTime.value || undefined,
      endTime: activeEndTime.value || undefined,
      page: page.value,
      pageSize,
    })
    const list = Array.isArray(result?.list) ? result.list : []
    orders.value = page.value === 1 ? list : [...orders.value, ...list]
    total.value = Number(result?.total || 0)
  } catch (error) {
    if (page.value === 1) orders.value = []
    uni.showToast({ title: error instanceof Error ? error.message : '加载失败', icon: 'none' })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function loadMore(): void {
  if (loading.value || loadingMore.value) return
  if (orders.value.length >= total.value) return
  page.value += 1
  void loadList()
}

function switchTab(key: TabKey): void {
  if (activeTab.value === key) return
  activeTab.value = key
  void loadList(true)
}

function onSearchConfirm(): void {
  void loadList(true)
}

function onClearSearch(): void {
  keyword.value = ''
  void loadList(true)
}

function goDetail(order: MerchantOrderCardVO): void {
  if (!order.orderNo) return
  uni.navigateTo({ url: `/subpkg-merchant/orders/detail?orderNo=${encodeURIComponent(order.orderNo)}` })
}

function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/index/index' })
}

// ===== 筛选 =====
function openFilter(): void {
  // 回填草稿：已有生效筛选则视为「自定义」
  draftStart.value = activeStartTime.value
  draftEnd.value = activeEndTime.value
  quickRange.value = activeStartTime.value || activeEndTime.value ? 'custom' : ''
  filterVisible.value = true
}

function closeFilter(): void {
  filterVisible.value = false
}

function pickQuick(key: 'week' | 'month' | 'threeMonths'): void {
  quickRange.value = key
  draftStart.value = ''
  draftEnd.value = ''
}

function onPickStart(e: { detail: { value: string } }): void {
  draftStart.value = e.detail.value
  quickRange.value = 'custom'
}
function onPickEnd(e: { detail: { value: string } }): void {
  draftEnd.value = e.detail.value
  quickRange.value = 'custom'
}

/** 今天 yyyy-MM-dd。 */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 往前推 n 天（含今天）。 */
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - (n - 1))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function resetFilter(): void {
  quickRange.value = ''
  draftStart.value = ''
  draftEnd.value = ''
}

function applyFilter(): void {
  if (quickRange.value === 'week' || quickRange.value === 'month' || quickRange.value === 'threeMonths') {
    const days = quickRange.value === 'week' ? 7 : quickRange.value === 'month' ? 30 : 90
    activeStartTime.value = daysAgo(days)
    activeEndTime.value = todayStr()
  } else if (quickRange.value === 'custom') {
    activeStartTime.value = draftStart.value
    activeEndTime.value = draftEnd.value
  } else {
    activeStartTime.value = ''
    activeEndTime.value = ''
  }
  filterVisible.value = false
  void loadList(true)
}

// ===== 批量备货（2026-09-19 新增）=====
// 用户反馈：订单多的时候不可能一单一单点「接单 → 备货完成 → 安排配送」。
// 列表页因此支持批量：勾选若干单 → 一次「备货完成」→ 自动发布到本店待领取池（骑手抢单）。

/** 是否处于批量模式。 */
const batchMode = ref(false)
/** 已选订单号集合。 */
const selectedNos = ref<Set<string>>(new Set())
/** 批量执行中（防重复点击）。 */
const batchRunning = ref(false)
/** 批量进度文案（如「正在处理 3/8」）。 */
const batchProgress = ref('')

/** 该单是否可批量备货：同城配送、且处于「备货完成」之前的任一阶段。 */
function selectable(order: MerchantOrderCardVO): boolean {
  if (order.pickupType !== 2) return false
  return ['WAIT_ACCEPT', 'ACCEPTED', 'PREPARING'].includes(String(order.deliveryStatus || ''))
}

/** 当前列表里可备货的订单。 */
const selectableOrders = computed(() => orders.value.filter((order) => selectable(order)))
const selectedCount = computed(() => selectedNos.value.size)
const allSelected = computed(
  () => selectableOrders.value.length > 0 && selectableOrders.value.every((order) => selectedNos.value.has(order.orderNo)),
)

/** 进入 / 退出批量模式。 */
function toggleBatchMode(): void {
  batchMode.value = !batchMode.value
  selectedNos.value = new Set()
}

/** 勾选 / 取消某一单。 */
function toggleSelect(orderNo: string): void {
  const next = new Set(selectedNos.value)
  if (next.has(orderNo)) next.delete(orderNo)
  else next.add(orderNo)
  selectedNos.value = next
}

/** 全选 / 取消全选（只作用于可备货的订单）。 */
function toggleSelectAll(): void {
  selectedNos.value = allSelected.value ? new Set() : new Set(selectableOrders.value.map((order) => order.orderNo))
}

/** 卡片点击：批量模式勾选，普通模式进详情。 */
function onCardTap(order: MerchantOrderCardVO): void {
  if (!batchMode.value) {
    goDetail(order)
    return
  }
  if (selectable(order)) toggleSelect(order.orderNo)
}

/**
 * 批量备货完成：逐单跑「补齐前置状态 → 备货完成 → 建配送任务（发布领取）」。
 * 后端没有批量接口，所以**顺序**调用（避免并发打爆），带进度显示；
 * 每单独立捕获错误，最后汇总成功 / 失败数量并刷新列表。
 */
async function runBatchPrepare(): Promise<void> {
  if (batchRunning.value || !selectedCount.value) return
  const targets = orders.value.filter((order) => selectedNos.value.has(order.orderNo))
  batchRunning.value = true
  let done = 0
  const failures: string[] = []
  try {
    for (const order of targets) {
      batchProgress.value = `正在处理 ${done + 1}/${targets.length}`
      try {
        await finishPreparation(order.orderNo, order.deliveryStatus)
        done += 1
      } catch {
        failures.push(order.orderNo)
      }
    }
  } finally {
    batchRunning.value = false
    batchProgress.value = ''
  }
  if (failures.length) {
    uni.showModal({
      title: '部分订单未完成',
      content: `成功 ${done} 单，失败 ${failures.length} 单。可稍后重试，或进详情手动处理。`,
      showCancel: false,
    })
  } else {
    uni.showToast({ title: `已完成 ${done} 单备货`, icon: 'success' })
  }
  selectedNos.value = new Set()
  batchMode.value = false
  await loadList(true)
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <!-- 页头（白底）：返回 + 搜索框 + Tab 栏 + 筛选 -->
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-row">
        <text class="nav-back" @click="goBack">‹</text>
        <view class="search-box">
          <text class="rider-icon rider-icon-sousuo search-icon" />
          <input
            class="search-input"
            v-model="keyword"
            placeholder="搜索订单"
            placeholder-class="search-ph"
            confirm-type="search"
            @confirm="onSearchConfirm"
          />
          <text v-if="keyword" class="search-clear" @click="onClearSearch">×</text>
        </view>
        <text class="batch-entry" @click="toggleBatchMode">{{ batchMode ? '取消' : '批量' }}</text>
      </view>
      <view class="tab-bar">
        <scroll-view class="tabs-scroll" scroll-x :show-scrollbar="false">
          <view class="tabs">
            <view
              v-for="tab in TABS"
              :key="tab.key"
              class="tab"
              :class="{ 'is-active': activeTab === tab.key }"
              @click="switchTab(tab.key)"
            >{{ tab.label }}</view>
          </view>
        </scroll-view>
        <view class="filter-btn" :class="{ 'has-dot': hasFilter }" @click="openFilter">
          <text class="filter-icon">⏳</text>
          <text class="filter-text">筛选</text>
        </view>
      </view>
    </view>

    <!-- 列表 -->
    <scroll-view class="list" scroll-y @scrolltolower="loadMore">
      <view v-if="loading" class="state">加载中…</view>
      <EmptyState v-else-if="!orders.length" :image="emptyImage" :text="emptyText" />
      <template v-else>
        <!--
          卡片间距必须**包一层普通 view**：
          小程序里自定义组件标签本身没有盒模型 —— 给组件加 class（父组件样式被 styleIsolation 隔离）
          或 :style（不会透传到组件根节点）都产生不了外边距。
          2026-09-19 因此改了两轮都没生效，最终用包裹层解决。
        -->
        <view v-for="order in orders" :key="order.orderNo" class="list-item" @click="onCardTap(order)">
          <OrderCard :order="order" />
          <!-- 批量模式：勾选圈（绝对定位在卡片上，不改动 OrderCard 组件本身） -->
          <view
            v-if="batchMode && selectable(order)"
            class="select-dot"
            :class="{ 'is-checked': selectedNos.has(order.orderNo) }"
          >
            <text v-if="selectedNos.has(order.orderNo)" class="select-check">✓</text>
          </view>
        </view>
        <view class="list-footer">{{ loadingMore ? '加载中…' : (orders.length >= total ? '没有更多了' : '上拉加载更多') }}</view>
      </template>
    </scroll-view>

    <!-- 批量操作栏（批量模式才出现） -->
    <view v-if="batchMode" class="batch-bar">
      <view class="batch-all" @click="toggleSelectAll">
        <view class="select-dot" :class="{ 'is-checked': allSelected }">
          <text v-if="allSelected" class="select-check">✓</text>
        </view>
        <text class="batch-all-text">全选（{{ selectableOrders.length }} 单可备货）</text>
      </view>
      <view class="batch-run" :class="{ disabled: batchRunning || !selectedCount }" @click="runBatchPrepare">
        {{ batchRunning ? batchProgress : `备货完成（${selectedCount}）` }}
      </view>
    </view>

    <!-- 筛选弹层 -->
    <view v-if="filterVisible" class="mask mask-bottom" @click="closeFilter">
      <view class="sheet" @click.stop>
        <view class="sheet-title">
          <text class="sheet-title-text">订单筛选</text>
          <text class="sheet-close" @click="closeFilter">×</text>
        </view>

        <view class="filter-block">
          <view class="quick-row">
            <view
              v-for="q in [{ key: 'week', label: '一周' }, { key: 'month', label: '一个月' }, { key: 'threeMonths', label: '三个月' }]"
              :key="q.key"
              class="quick-item"
              :class="{ 'is-active': quickRange === q.key }"
              @click="pickQuick(q.key as 'week' | 'month' | 'threeMonths')"
            >{{ q.label }}</view>
          </view>
          <view class="range-row">
            <picker mode="date" :value="draftStart" @change="onPickStart">
              <view class="range-box" :class="{ 'has-value': draftStart }">{{ draftStart || '起始时间' }}</view>
            </picker>
            <text class="range-line" />
            <picker mode="date" :value="draftEnd" @change="onPickEnd">
              <view class="range-box" :class="{ 'has-value': draftEnd }">{{ draftEnd || '终止时间' }}</view>
            </picker>
          </view>
        </view>

        <view class="sheet-actions">
          <button class="sheet-btn sheet-btn-cancel" @click="resetFilter">重置</button>
          <button class="sheet-btn sheet-btn-confirm" @click="applyFilter">确定</button>
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
  background: #f6f7f9;
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

/* Tab 栏 + 筛选 */
.tab-bar {
  position: relative;
  display: flex;
  align-items: center;
  height: 104rpx; /* 54px */
}
.tabs-scroll {
  flex: 1;
  min-width: 0;
}
.tabs {
  display: flex;
  align-items: center;
  gap: 15rpx;
  padding: 0 23rpx;
}
.tab {
  flex: none;
  padding: 8rpx 23rpx;
  border-radius: 12rpx;
  background: #f6f7f9;
  color: #1d2129;
  font-size: 27rpx;
}
.tab.is-active {
  background: #fff4e8;
  color: #ff5500;
  font-weight: 500;
}
.filter-btn {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-left: 15rpx;
  padding: 8rpx 23rpx;
  border-radius: 12rpx;
  background: #f6f7f9;
  color: #1d2129;
  font-size: 27rpx;
}
.filter-btn.has-dot {
  position: relative;
}
.filter-btn.has-dot::after {
  content: '';
  position: absolute;
  top: 4rpx;
  right: 8rpx;
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: #ff5500;
}
.filter-icon {
  font-size: 27rpx;
}
.filter-text {
  font-size: 27rpx;
}

/* 列表 */
.list {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 23rpx 23rpx 40rpx;
}
/* 卡片间距：包一层普通 view（组件标签本身没有盒模型，父组件样式/内联 style 都加不出外边距） */
.list-item {
  margin-bottom: 24rpx;
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

/* 遮罩 + 弹层 */
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
.filter-block {
  margin-top: 31rpx;
}
.quick-row {
  display: flex;
  gap: 15rpx;
}
.quick-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 77rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
  color: #1d2129;
  font-size: 27rpx;
}
.quick-item.is-active {
  background: #fff4e8;
  color: #ff5500;
  font-weight: 600;
}
.range-row {
  display: flex;
  align-items: center;
  gap: 15rpx;
  margin-top: 15rpx;
}
.range-box {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 77rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
  color: #86909c;
  font-size: 27rpx;
}
.range-box.has-value {
  color: #1d2129;
}
.range-line {
  flex: none;
  width: 15rpx;
  height: 4rpx;
  border-radius: 2rpx;
  background: #e6e7eb;
}
.sheet-actions {
  display: flex;
  gap: 15rpx;
  margin-top: 38rpx;
}
.sheet-btn {
  margin: 0;
  padding: 0;
  height: 92rpx;
  border-radius: 24rpx;
  font-size: 31rpx;
  font-weight: 600;
  line-height: 92rpx;
}
.sheet-btn::after {
  border: 0;
}
.sheet-btn-cancel {
  flex: 112;
  background: #f6f7f9;
  color: #1d2129;
}
.sheet-btn-confirm {
  flex: 246;
  background: linear-gradient(90deg, #ff9301 0%, #ff6a01 50%, #ff4202 100%);
  color: #ffffff;
}
/* ===== 批量备货（2026-09-19：订单一多就不可能一单一单点）===== */
.batch-entry { flex: none; margin-left: 18rpx; padding: 0 20rpx; height: 56rpx; line-height: 56rpx; border-radius: 28rpx; color: #ff5500; background: #fff4e8; font-size: 25rpx; }
/* 勾选圈绝对定位在卡片上（组件标签没有盒模型，所以定位放在包裹层） */
.list-item { position: relative; }
.select-dot { position: absolute; top: 18rpx; right: 18rpx; z-index: 2; display: flex; align-items: center; justify-content: center; width: 40rpx; height: 40rpx; border: 2rpx solid #d7dbe0; border-radius: 50%; background: #ffffff; box-sizing: border-box; }
.select-dot.is-checked { border-color: #ff5500; background: #ff5500; }
.select-check { color: #ffffff; font-size: 24rpx; line-height: 1; }
.batch-bar { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 16rpx 23rpx calc(16rpx + env(safe-area-inset-bottom)); background: #ffffff; box-shadow: 0 -2rpx 12rpx rgba(29, 33, 41, 0.06); }
.batch-all { display: flex; align-items: center; }
.batch-all .select-dot { position: static; margin-right: 12rpx; }
.batch-all-text { color: #1d2129; font-size: 25rpx; }
.batch-run { display: flex; align-items: center; justify-content: center; min-width: 300rpx; height: 80rpx; border-radius: 16rpx; color: #ffffff; background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%); font-size: 29rpx; font-weight: 600; }
.batch-run.disabled { opacity: 0.5; }
</style>
