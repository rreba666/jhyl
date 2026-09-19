<script setup lang="ts">
/**
 * 商家端 · 账单（对应设计稿「账单」页 + 时间筛选弹层，订单口径只读）
 * 契约（api_doc.json GET /api/merchant/bill）：
 * - 数据口径：INCOME 订单收入（pay_time）/ REFUND 订单退款（update_time），不是对账单
 * - 响应：month/startTime/endTime/incomeTotal/expenseTotal/total/records[]
 * - records[]：type/typeText/direction(1收入2支出)/amount(恒正数)/occurredAt/icon/orderNo/bizNo
 * 金额正负由 direction 决定；合计 incomeTotal 为收入合计（设计稿头部「收入 ¥…」灰色）。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getMerchantBill, type MerchantBillRecord } from '@/api/merchant'

const statusBarHeight = ref(0)
const contentTop = computed(() => statusBarHeight.value + 44)

const records = ref<MerchantBillRecord[]>([])
const incomeTotal = ref(0)
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const loadingMore = ref(false)

/** 当前生效筛选：month（yyyy-MM）或 startTime/endTime。 */
const activeMonth = ref('')
const activeStart = ref('')
const activeEnd = ref('')

/** 筛选弹层。 */
const filterVisible = ref(false)
const filterTab = ref<'month' | 'custom'>('month')
/** 弹层内临时年月（picker-view value）。 */
const years: number[] = []
const currentYear = new Date().getFullYear()
for (let i = 0; i < 4; i++) years.push(currentYear - i)
const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const pickerValue = ref([0, new Date().getMonth()])
/** 弹层内临时自定义起止。 */
const draftStart = ref('')
const draftEnd = ref('')

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '账单' })
  void loadBill(true)
})

/** 加载账单。reset=true 重置第一页。 */
async function loadBill(reset = false): Promise<void> {
  if (reset) {
    page.value = 1
    records.value = []
  }
  if (page.value === 1) loading.value = true
  else loadingMore.value = true
  try {
    const result = await getMerchantBill({
      month: activeMonth.value || undefined,
      startTime: activeStart.value || undefined,
      endTime: activeEnd.value || undefined,
      page: page.value,
      pageSize,
    })
    const list = Array.isArray(result?.records) ? result.records : []
    records.value = page.value === 1 ? list : [...records.value, ...list]
    total.value = Number(result?.total || 0)
    incomeTotal.value = Number(result?.incomeTotal || 0)
  } catch (error) {
    if (page.value === 1) records.value = []
    uni.showToast({ title: error instanceof Error ? error.message : '加载失败', icon: 'none' })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function loadMore(): void {
  if (loading.value || loadingMore.value) return
  if (records.value.length >= total.value) return
  page.value += 1
  void loadBill()
}

/** 当前显示的月份/区间文案（头部）。 */
const monthLabel = computed(() => {
  if (activeStart.value || activeEnd.value) {
    return `${activeStart.value || '…'} ~ ${activeEnd.value || '…'}`
  }
  const m = activeMonth.value
  if (m) {
    const [y, mo] = m.split('-')
    return `${y}年${Number(mo)}月`
  }
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
})

/** 金额格式化：流水固定两位小数 + 正负号。 */
function recordAmount(r: MerchantBillRecord): string {
  const sign = r.direction === 2 ? '-' : '+'
  return `${sign}${Number(r.amount || 0).toFixed(2)}`
}

/** 合计金额：千分位 + 两位小数。 */
function totalText(value: number): string {
  const num = Number(value) || 0
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 时间 → `M月D日 HH:mm`（月日不补零，时分补零）。 */
function occurredText(value?: string): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(value || ''))
  if (!matched) return value || '—'
  return `${Number(matched[2])}月${Number(matched[3])}日 ${matched[4]}:${matched[5]}`
}

/** 流水类型文案。 */
function typeText(r: MerchantBillRecord): string {
  return r.typeText || (r.direction === 2 ? '订单退款' : '商城商品交易')
}

/** 流水图标（方向）。 */
function isIncome(r: MerchantBillRecord): boolean {
  return r.direction !== 2
}

// ===== 时间筛选弹层 =====
function openFilter(): void {
  // 回填 picker value
  const m = activeMonth.value || `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const [y, mo] = m.split('-').map(Number)
  const yi = years.indexOf(y)
  pickerValue.value = [yi >= 0 ? yi : 0, (mo || 1) - 1]
  draftStart.value = activeStart.value
  draftEnd.value = activeEnd.value
  filterTab.value = activeStart.value || activeEnd.value ? 'custom' : 'month'
  filterVisible.value = true
}

function closeFilter(): void {
  filterVisible.value = false
}

function onPickerChange(e: { detail: { value: number[] } }): void {
  pickerValue.value = e.detail.value
}

function onStartChange(e: { detail: { value: string } }): void {
  draftStart.value = e.detail.value
}
function onEndChange(e: { detail: { value: string } }): void {
  draftEnd.value = e.detail.value
}

function applyFilter(): void {
  if (filterTab.value === 'month') {
    const [yi, mi] = pickerValue.value
    activeMonth.value = `${years[yi] || currentYear}-${String((months[mi] || 1)).padStart(2, '0')}`
    activeStart.value = ''
    activeEnd.value = ''
  } else {
    activeMonth.value = ''
    activeStart.value = draftStart.value
    activeEnd.value = draftEnd.value
  }
  filterVisible.value = false
  void loadBill(true)
}

function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <text class="nav-back" @click="goBack">‹</text>
      <text class="nav-title">账单</text>
    </view>

    <scroll-view class="content" scroll-y @scrolltolower="loadMore">
      <!-- 头部：月份 + 收入合计 -->
      <view class="summary">
        <view class="month" @click="openFilter">
          <text class="month-text">{{ monthLabel }}</text>
          <text class="month-arrow">▾</text>
        </view>
        <view class="income">
          <text class="income-label">收入</text>
          <view class="income-amount"><text class="income-yen">¥</text><text class="income-num">{{ totalText(incomeTotal) }}</text></view>
        </view>
      </view>

      <!-- 流水列表 -->
      <view class="bill-list">
        <view v-if="loading" class="state">加载中…</view>
        <view v-else-if="!records.length" class="state">暂无账单流水</view>
        <template v-else>
          <view v-for="(r, index) in records" :key="index" class="row">
            <view class="avatar" :class="isIncome(r) ? 'is-income' : 'is-refund'">
              <text class="avatar-text">{{ isIncome(r) ? '收' : '退' }}</text>
            </view>
            <view class="row-info">
              <text class="row-type">{{ typeText(r) }}</text>
              <text class="row-time">{{ occurredText(r.occurredAt) }}</text>
            </view>
            <text class="row-amount">{{ recordAmount(r) }}</text>
          </view>
          <view class="list-footer">{{ loadingMore ? '加载中…' : (records.length >= total ? '没有更多了' : '上拉加载更多') }}</view>
        </template>
      </view>
    </scroll-view>

    <!-- 时间筛选弹层 -->
    <view v-if="filterVisible" class="mask mask-bottom" @click="closeFilter">
      <view class="sheet" @click.stop>
        <view class="sheet-head">
          <view class="sheet-tabs">
            <view class="sheet-tab" :class="{ 'is-active': filterTab === 'month' }" @click="filterTab = 'month'">
              <text class="tab-text">选择月份</text>
              <view class="tab-line" />
            </view>
            <view class="sheet-tab" :class="{ 'is-active': filterTab === 'custom' }" @click="filterTab = 'custom'">
              <text class="tab-text">自定义</text>
              <view class="tab-line" />
            </view>
          </view>
          <text class="sheet-close" @click="closeFilter">×</text>
        </view>

        <!-- 选择月份：年 + 月滚轮 -->
        <view v-if="filterTab === 'month'" class="picker-wrap">
          <picker-view
            class="picker-view"
            :value="pickerValue"
            indicator-style="height: 77rpx;"
            @change="onPickerChange"
          >
            <picker-view-column>
              <view v-for="y in years" :key="y" class="picker-item">{{ y }}年</view>
            </picker-view-column>
            <picker-view-column>
              <view v-for="m in months" :key="m" class="picker-item">{{ m }}月</view>
            </picker-view-column>
          </picker-view>
        </view>

        <!-- 自定义：起止时间 -->
        <view v-else class="custom-wrap">
          <view class="range-row">
            <picker mode="date" :value="draftStart" @change="onStartChange">
              <view class="range-box" :class="{ 'has-value': draftStart }">{{ draftStart || '起始时间' }}</view>
            </picker>
            <text class="range-line" />
            <picker mode="date" :value="draftEnd" @change="onEndChange">
              <view class="range-box" :class="{ 'has-value': draftEnd }">{{ draftEnd || '终止时间' }}</view>
            </picker>
          </view>
        </view>

        <button class="confirm-btn" @click="applyFilter">确定</button>
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
  display: flex;
  align-items: center;
  justify-content: center;
  height: 85rpx;
}
.nav-back {
  position: absolute;
  left: 23rpx;
  top: 50%;
  transform: translateY(-50%);
  color: #1d2129;
  font-size: 46rpx;
  line-height: 1;
}
.nav-title {
  color: #1d2129;
  font-size: 33rpx;
  font-weight: 600;
}
.content {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 0 31rpx 40rpx;
}

/* 头部 */
.summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 23rpx 0;
}
.month {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.month-text {
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
}
.month-arrow {
  color: #000000;
  font-size: 27rpx;
}
.income {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.income-label {
  color: #86909c;
  font-size: 31rpx;
}
.income-amount {
  display: flex;
  align-items: baseline;
  color: #86909c;
}
.income-yen {
  font-size: 27rpx;
  line-height: 1;
}
.income-num {
  font-size: 31rpx;
  font-weight: 500;
  line-height: 1;
}

/* 流水列表 */
.bill-list {
  border-radius: 12rpx;
  background: #ffffff;
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  min-height: 148rpx; /* 77px */
  padding: 0 23rpx;
  border-bottom: 2rpx solid #f2f3f7;
}
.row:last-child {
  border-bottom: 0;
}
.avatar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 90rpx;
  height: 90rpx;
  border-radius: 50%;
}
.avatar.is-income {
  background: #e8f7ee;
}
.avatar.is-refund {
  background: #fff4e8;
}
.avatar-text {
  font-size: 31rpx;
  font-weight: 600;
}
.avatar.is-income .avatar-text {
  color: #00b42a;
}
.avatar.is-refund .avatar-text {
  color: #ff7d00;
}
.row-info {
  flex: 1;
  min-width: 0;
  margin-left: 23rpx;
}
.row-type {
  display: block;
  color: #1d2129;
  font-size: 31rpx;
}
.row-time {
  display: block;
  margin-top: 8rpx;
  color: #86909c;
  font-size: 27rpx;
}
.row-amount {
  flex: none;
  margin-left: 15rpx;
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 500;
}
.state {
  padding: 150rpx 0;
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

/* 筛选弹层 */
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
.sheet-head {
  position: relative;
  display: flex;
  align-items: center;
  height: 88rpx;
}
.sheet-tabs {
  display: flex;
  align-items: center;
  gap: 31rpx;
}
.sheet-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx;
}
.tab-text {
  color: #1d2129;
  font-size: 27rpx;
}
.sheet-tab.is-active .tab-text {
  color: #ff5500;
  font-weight: 500;
}
.tab-line {
  width: 100%;
  height: 4rpx;
  border-radius: 2rpx;
  background: transparent;
}
.sheet-tab.is-active .tab-line {
  background: #ff5500;
}
.sheet-close {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  color: #1d2129;
  font-size: 40rpx;
  line-height: 1;
  padding: 0 4rpx;
}
.picker-wrap {
  height: 385rpx; /* 200px */
  overflow: hidden;
}
.picker-view {
  width: 100%;
  height: 385rpx;
}
.picker-item {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 77rpx;
  color: #1d2129;
  font-size: 31rpx;
}
.custom-wrap {
  padding: 31rpx 0;
}
.range-row {
  display: flex;
  align-items: center;
  gap: 15rpx;
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
.confirm-btn {
  margin: 0;
  padding: 0;
  height: 92rpx;
  border-radius: 24rpx;
  background: linear-gradient(90deg, #ff9301 0%, #ff6a01 50%, #ff4202 100%);
  color: #ffffff;
  font-size: 31rpx;
  font-weight: 600;
  line-height: 92rpx;
}
.confirm-btn::after {
  border: 0;
}
</style>
