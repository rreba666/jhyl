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
  getMerchantOrders,
  type MerchantOrderCardVO,
  type MerchantOrderTab,
} from '@/api/merchant'
import OrderCard from '@/components/merchant/OrderCard.vue'

const TABS = [
  { key: 'all', api: 'ALL', label: '全部' },
  { key: 'waitAccept', api: 'WAIT_ACCEPT', label: '待接单' },
  { key: 'waitPickup', api: 'WAIT_PICKUP', label: '待取货' },
  { key: 'delivering', api: 'DELIVERING', label: '配送中' },
  { key: 'done', api: 'DONE', label: '已完成' },
  { key: 'exception', api: 'EXCEPTION', label: '异常单' },
] as const
type TabKey = (typeof TABS)[number]['key']

const EMPTY_TEXT: Record<TabKey, string> = {
  all: '暂无订单',
  waitAccept: '暂无待接单订单',
  waitPickup: '暂无待取货订单',
  delivering: '暂无配送中订单',
  done: '暂无已完成订单',
  exception: '暂无异常订单',
}

const statusBarHeight = ref(0)
/** 页头高度 = 状态栏 + 44px 标题栏 + 54px Tab 栏（px）。 */
const contentTop = computed(() => statusBarHeight.value + 44 + 54)

const activeTab = ref<TabKey>('all')
const keyword = ref('')
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
      <view v-else-if="!orders.length" class="state">{{ EMPTY_TEXT[activeTab] }}</view>
      <template v-else>
        <OrderCard
          v-for="order in orders"
          :key="order.orderNo"
          class="list-card"
          :order="order"
          @click="goDetail"
        />
        <view class="list-footer">{{ loadingMore ? '加载中…' : (orders.length >= total ? '没有更多了' : '上拉加载更多') }}</view>
      </template>
    </scroll-view>

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
/* 卡片间距 12px（原 15rpx≈7.8px 太小，多张卡片会糊成一片，看不清是一张还是两张） */
.list-card {
  margin-bottom: 23rpx;
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
</style>
