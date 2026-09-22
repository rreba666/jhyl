<script setup lang="ts">
/**
 * 商家端 · 提现记录页
 * ------------------------------------------------------------
 * 契约（文档 §2.6）：`GET /api/merchant/settlement/withdraw/list?status=&page=&size=`
 * - 按申请时间倒序；`status` 可选筛选
 * - 状态中文（文档 §2.6 建议）：PENDING_REVIEW=审核中 / APPROVED=待打款 /
 *   SUCCESS=已到账（展示 `payNo` + `paidAt`）/ REJECTED=已驳回（展示 `reviewRemark`）/
 *   FAILED=打款失败（展示 `reviewRemark`）
 *
 * 口径：
 * 1. 响应里的 `invoiceImages` 是 **JSON 字符串**（不是数组）—— api 层已 `JSON.parse` 并兜底空数组；
 * 2. 分页参数名是 **`size`**；
 * 3. 时间只做字符串规范化，**不用 `new Date`**；
 * 4. 点某条进详情页（详情含打款凭证与完整收款信息）。
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  MERCHANT_WITHDRAW_STATUS_TEXT,
  SETTLEMENT_CODE_NOT_MERCHANT_OWNER,
  formatSettlementAmount,
  formatSettlementTime,
  formatSettlementTimeShort,
  getSettlementWithdrawList,
  resolveSettlementErrorMessage,
  withdrawStatusText,
  type MerchantWithdrawOrderVO,
  type MerchantWithdrawStatus,
} from '@/api/settlement'
import { isApiRequestError } from '@/utils/request'

const statusBarHeight = ref(0)
const contentTop = computed(() => statusBarHeight.value + 44)

/** 状态筛选项（value 空串 = 全部；文案取文档 §2.6 的展示建议）。 */
const STATUS_FILTERS: { label: string; value: MerchantWithdrawStatus | '' }[] = [
  { label: '全部', value: '' },
  { label: MERCHANT_WITHDRAW_STATUS_TEXT.PENDING_REVIEW, value: 'PENDING_REVIEW' },
  { label: MERCHANT_WITHDRAW_STATUS_TEXT.APPROVED, value: 'APPROVED' },
  { label: MERCHANT_WITHDRAW_STATUS_TEXT.SUCCESS, value: 'SUCCESS' },
  { label: MERCHANT_WITHDRAW_STATUS_TEXT.REJECTED, value: 'REJECTED' },
  { label: MERCHANT_WITHDRAW_STATUS_TEXT.FAILED, value: 'FAILED' },
]

const records = ref<MerchantWithdrawOrderVO[]>([])
const total = ref(0)
const page = ref(1)
const size = 20
const activeStatus = ref<MerchantWithdrawStatus | ''>('')
const loading = ref(false)
const loadingMore = ref(false)
const notMerchantOwner = ref(false)

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '提现记录' })
})

// 每次进页面/返回都重新拉：提交或审核后状态会变（如「审核中」→「已到账」）
onShow(() => { void loadRecords(true) })

/** 加载提现记录；reset=true 回到第一页。 */
async function loadRecords(reset = false): Promise<void> {
  if (reset) {
    page.value = 1
    records.value = []
  }
  if (page.value === 1) loading.value = true
  else loadingMore.value = true
  try {
    const result = await getSettlementWithdrawList({ status: activeStatus.value, page: page.value, size })
    const list = Array.isArray(result?.list) ? result.list : []
    records.value = page.value === 1 ? list : [...records.value, ...list]
    total.value = Number(result?.total || 0)
    notMerchantOwner.value = false
  } catch (error) {
    if (page.value === 1) records.value = []
    // 13016：店长/店员误入 → 只显示提示
    if (isApiRequestError(error) && Number(error.code) === SETTLEMENT_CODE_NOT_MERCHANT_OWNER) {
      notMerchantOwner.value = true
      return
    }
    uni.showToast({ title: resolveSettlementErrorMessage(error, '提现记录加载失败'), icon: 'none' })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

/** 切换状态筛选。 */
function selectStatus(value: MerchantWithdrawStatus | ''): void {
  if (loading.value || activeStatus.value === value) return
  activeStatus.value = value
  void loadRecords(true)
}

function loadMore(): void {
  if (loading.value || loadingMore.value) return
  if (records.value.length >= total.value) return
  page.value += 1
  void loadRecords()
}

/** 状态样式类（颜色区分审核各阶段）。 */
function statusClass(status?: string): string {
  switch (String(status || '')) {
    case 'PENDING_REVIEW': return 'is-pending'
    case 'APPROVED': return 'is-approved'
    case 'SUCCESS': return 'is-success'
    case 'REJECTED': return 'is-rejected'
    case 'FAILED': return 'is-failed'
    default: return ''
  }
}

/** 是否展示财务意见（驳回/打款失败才有）。 */
function hasReviewRemark(record: MerchantWithdrawOrderVO): boolean {
  return Boolean(String(record?.reviewRemark || '').trim())
}

/** 是否已到账（展示打款流水号与打款时间）。 */
function isPaid(record: MerchantWithdrawOrderVO): boolean {
  return String(record?.status || '') === 'SUCCESS'
}

/** 进详情页（含打款凭证 / 财务意见 / 完整收款信息）。 */
function goDetail(record: MerchantWithdrawOrderVO): void {
  const withdrawNo = String(record?.withdrawNo || '').trim()
  if (!withdrawNo) return
  uni.navigateTo({ url: `/subpkg-merchant/settlement/withdraw-detail?withdrawNo=${encodeURIComponent(withdrawNo)}` })
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
      <text class="nav-title">提现记录</text>
    </view>

    <!-- 状态筛选 -->
    <scroll-view v-if="!notMerchantOwner" class="filter-bar" scroll-x :style="{ top: contentTop + 'px' }">
      <view class="filter-row">
        <view
          v-for="option in STATUS_FILTERS"
          :key="option.value || 'ALL'"
          class="filter-chip"
          :class="{ 'is-active': activeStatus === option.value }"
          @click="selectStatus(option.value)"
        >
          {{ option.label }}
        </view>
      </view>
    </scroll-view>

    <scroll-view class="content" scroll-y @scrolltolower="loadMore">
      <!-- 13016：仅品牌主体 -->
      <view v-if="notMerchantOwner" class="state">
        <text class="state-title">仅商户品牌主体可查看结算账户与提现</text>
        <text class="state-text">当前身份为店长/店员，请在「账单」查看本门店订单口径营业额。</text>
      </view>

      <template v-else>
        <view v-if="loading" class="state">加载中…</view>
        <view v-else-if="!records.length" class="state">暂无提现记录</view>
        <template v-else>
          <view v-for="record in records" :key="record.withdrawNo" class="card" @click="goDetail(record)">
            <view class="card-head">
              <text class="card-no">单号 {{ record.withdrawNo }}</text>
              <text class="card-status" :class="statusClass(record.status)">{{ withdrawStatusText(record.status) }}</text>
            </view>
            <view class="card-amount-line">
              <text class="card-amount">¥{{ formatSettlementAmount(record.amount) }}</text>
              <text class="card-time">{{ formatSettlementTimeShort(record.createTime) }}</text>
            </view>
            <!-- 已到账：展示打款流水号与打款时间（文档 §2.6） -->
            <view v-if="isPaid(record)" class="card-extra">
              <text class="extra-line">打款流水号：{{ record.payNo || '—' }}</text>
              <text class="extra-line">到账时间：{{ formatSettlementTime(record.paidAt) }}</text>
            </view>
            <!-- 已驳回 / 打款失败：展示财务意见（后端原文） -->
            <view v-if="hasReviewRemark(record)" class="card-remark">
              <text class="remark-text">财务意见：{{ record.reviewRemark }}</text>
            </view>
            <view class="card-foot">
              <text class="foot-text">发票金额 ¥{{ formatSettlementAmount(record.invoiceAmount) }}</text>
              <text class="foot-arrow">查看详情 ›</text>
            </view>
          </view>
          <view class="list-footer">
            {{ loadingMore ? '加载中…' : (records.length >= total ? '没有更多了' : '上拉加载更多') }}
          </view>
        </template>
      </template>
    </scroll-view>
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
  background: #f2f3f7;
}
.nav-back {
  position: absolute;
  left: 23rpx;
  color: #1d2129;
  font-size: 46rpx;
  line-height: 1;
  top: auto;
  bottom: 0;
  display: flex;
  height: 88rpx;
  align-items: center;
}
.nav-title {
  color: #1d2129;
  font-size: 33rpx;
  font-weight: 600;
}
.filter-bar {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 9;
  white-space: nowrap;
  background: #f2f3f7;
}
.filter-row {
  display: inline-flex;
  align-items: center;
  gap: 15rpx;
  padding: 8rpx 31rpx 19rpx;
}
.filter-chip {
  flex: none;
  padding: 0 27rpx;
  height: 61rpx;
  display: flex;
  align-items: center;
  border-radius: 31rpx;
  background: #ffffff;
  color: #4e5969;
  font-size: 24rpx;
}
.filter-chip.is-active {
  background: #fff4e8;
  color: #ff5500;
  font-weight: 600;
}
.content {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 100rpx 31rpx 40rpx;
}
.card {
  margin-bottom: 19rpx;
  padding: 27rpx 31rpx;
  border-radius: 23rpx;
  background: #ffffff;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-no {
  flex: 1;
  min-width: 0;
  color: #86909c;
  font-size: 22rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-status {
  flex: none;
  margin-left: 15rpx;
  font-size: 24rpx;
  font-weight: 600;
}
.card-status.is-pending { color: #d97706; }
.card-status.is-approved { color: #2563eb; }
.card-status.is-success { color: #00b42a; }
.card-status.is-rejected { color: #86909c; }
.card-status.is-failed { color: #f53f3f; }
.card-amount-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 14rpx;
}
.card-amount {
  color: #1d2129;
  font-size: 40rpx;
  font-weight: 700;
}
.card-time {
  color: #86909c;
  font-size: 22rpx;
}
.card-extra {
  margin-top: 14rpx;
  padding-top: 14rpx;
  border-top: 2rpx solid #f2f3f7;
}
.extra-line {
  display: block;
  color: #4e5969;
  font-size: 23rpx;
  line-height: 36rpx;
}
.card-remark {
  margin-top: 14rpx;
  padding: 15rpx 19rpx;
  border-radius: 12rpx;
  background: #fff7ed;
}
.remark-text {
  color: #9a3412;
  font-size: 23rpx;
  line-height: 36rpx;
}
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16rpx;
  padding-top: 14rpx;
  border-top: 2rpx solid #f2f3f7;
}
.foot-text {
  color: #86909c;
  font-size: 22rpx;
}
.foot-arrow {
  color: #ff5500;
  font-size: 22rpx;
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 150rpx 46rpx;
  text-align: center;
  color: #86909c;
  font-size: 28rpx;
}
.state-title {
  color: #1d2129;
  font-size: 29rpx;
  font-weight: 600;
}
.state-text {
  margin-top: 16rpx;
  color: #86909c;
  font-size: 24rpx;
  line-height: 36rpx;
}
.list-footer {
  padding: 24rpx 0;
  text-align: center;
  color: #86909c;
  font-size: 24rpx;
}
</style>
