<script setup lang="ts">
/**
 * 商家端 · 结算账户流水页
 * ------------------------------------------------------------
 * 契约（文档 §2.2）：`GET /api/merchant/settlement/flows?type=&page=&size=`
 * - `type` 筛选：ORDER_INCOME / ORDER_REVERSE / DEBT_OFFSET / WITHDRAW_FREEZE /
 *   WITHDRAW_SUCCESS / WITHDRAW_UNFREEZE / ADJUST（不传 = 全部）
 * - `direction`：**1 = 收入 2 = 支出**；`amount` **恒为正数**，正负号与颜色由 direction 决定
 * - `balanceAfter` / `debtAfter` 是变动后快照；`shopId` 是来源门店（**提现/调账类为 null**）；
 *   `remark` 与 `createTime` 直接展示
 *
 * 口径：
 * 1. 分页参数名是 **`size`**（不是 pageSize）—— 已在 api 层处理；
 * 2. 时间只做字符串规范化（api 层 `formatSettlementTimeShort`），**不用 `new Date`**；
 * 3. 品牌主体（MERCHANT_OWNER）才能看；店长/店员返回 `13016` → 页面只显示提示。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  SETTLEMENT_CODE_NOT_MERCHANT_OWNER,
  SETTLEMENT_FLOW_TYPE_OPTIONS,
  formatSettlementAmount,
  formatSettlementFlowAmount,
  formatSettlementTime,
  formatSettlementTimeShort,
  getSettlementFlows,
  isSettlementFlowIncome,
  resolveSettlementErrorMessage,
  type SettlementFlowType,
  type SettlementFlowVO,
} from '@/api/settlement'
import { isApiRequestError } from '@/utils/request'

const statusBarHeight = ref(0)
const contentTop = computed(() => statusBarHeight.value + 44)

const flows = ref<SettlementFlowVO[]>([])
const total = ref(0)
const page = ref(1)
const size = 20
const loading = ref(false)
const loadingMore = ref(false)
/** 当前筛选的流水类型（空串 = 全部）。 */
const activeType = ref<SettlementFlowType | ''>('')
/** 非品牌主体（13016）：不渲染流水列表。 */
const notMerchantOwner = ref(false)
/** 展开查看备注全文的流水 id 集合（备注较长时默认截断）。 */
const expanded = ref<number[]>([])

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '账户流水' })
  void loadFlows(true)
})

/** 加载流水；reset=true 时回到第一页并清空列表。 */
async function loadFlows(reset = false): Promise<void> {
  if (reset) {
    page.value = 1
    flows.value = []
    expanded.value = []
  }
  if (page.value === 1) loading.value = true
  else loadingMore.value = true
  try {
    const result = await getSettlementFlows({ type: activeType.value, page: page.value, size })
    const list = Array.isArray(result?.list) ? result.list : []
    flows.value = page.value === 1 ? list : [...flows.value, ...list]
    total.value = Number(result?.total || 0)
    notMerchantOwner.value = false
  } catch (error) {
    if (page.value === 1) flows.value = []
    // 13016：店长/店员误入 → 整页只显示提示
    if (isApiRequestError(error) && Number(error.code) === SETTLEMENT_CODE_NOT_MERCHANT_OWNER) {
      notMerchantOwner.value = true
      return
    }
    uni.showToast({ title: resolveSettlementErrorMessage(error, '流水加载失败'), icon: 'none' })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

/** 切换类型筛选：重置到第一页重新加载。 */
function selectType(value: SettlementFlowType | ''): void {
  if (loading.value || activeType.value === value) return
  activeType.value = value
  void loadFlows(true)
}

/** 触底加载下一页（已加载数 ≥ total 时不再请求）。 */
function loadMore(): void {
  if (loading.value || loadingMore.value) return
  if (flows.value.length >= total.value) return
  page.value += 1
  void loadFlows()
}

/** 是否为收入（1=收入 2=支出）——决定符号与颜色。 */
function isIncome(flow: SettlementFlowVO): boolean {
  return isSettlementFlowIncome(flow)
}

/** 来源门店文案：`shopId` 可为 null（提现/调账类没有门店）。 */
function shopText(flow: SettlementFlowVO): string {
  return flow?.shopId == null ? '无来源门店' : `门店 #${flow.shopId}`
}

/** 备注是否已展开。 */
function isExpanded(flow: SettlementFlowVO): boolean {
  return flow?.id != null && expanded.value.includes(Number(flow.id))
}

/** 展开/收起备注（长备注默认只显示一行）。 */
function toggleRemark(flow: SettlementFlowVO): void {
  if (flow?.id == null) return
  const id = Number(flow.id)
  expanded.value = isExpanded(flow) ? expanded.value.filter((item) => item !== id) : [...expanded.value, id]
}

/** 复制业务单号（订单号 / 提现单号），便于与财务对账。 */
function copyBizNo(flow: SettlementFlowVO): void {
  const value = String(flow?.bizNo || '').trim()
  if (!value) return
  uni.setClipboardData({ data: value, success: () => uni.showToast({ title: '单号已复制', icon: 'none' }) })
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
      <text class="nav-title">账户流水</text>
    </view>

    <!-- 类型筛选（横向滚动 chips） -->
    <scroll-view v-if="!notMerchantOwner" class="filter-bar" scroll-x :style="{ top: contentTop + 'px' }">
      <view class="filter-row">
        <view
          v-for="option in SETTLEMENT_FLOW_TYPE_OPTIONS"
          :key="option.value || 'ALL'"
          class="filter-chip"
          :class="{ 'is-active': activeType === option.value }"
          @click="selectType(option.value)"
        >
          {{ option.label }}
        </view>
      </view>
    </scroll-view>

    <scroll-view class="content" scroll-y @scrolltolower="loadMore">
      <!-- 13016：仅品牌主体可看结算账户 -->
      <view v-if="notMerchantOwner" class="state">
        <text class="state-title">仅商户品牌主体可查看结算账户与提现</text>
        <text class="state-text">当前身份为店长/店员，请在「账单」查看本门店订单口径营业额。</text>
      </view>

      <template v-else>
        <view v-if="loading" class="state">加载中…</view>
        <view v-else-if="!flows.length" class="state">暂无账户流水</view>
        <template v-else>
          <view v-for="flow in flows" :key="`${flow.id}-${flow.type}`" class="row">
            <view class="row-head">
              <text class="row-type">{{ flow.typeText || flow.type || '—' }}</text>
              <!-- amount 恒正数：正负号由 direction 决定（1 收入 + 绿 / 2 支出 - 红） -->
              <text class="row-amount" :class="isIncome(flow) ? 'is-income' : 'is-expense'">
                {{ formatSettlementFlowAmount(flow) }}
              </text>
            </view>
            <text v-if="flow.remark" class="row-remark" :class="{ 'is-expanded': isExpanded(flow) }" @click="toggleRemark(flow)">
              {{ flow.remark }}
            </text>
            <view class="row-meta-line">
              <text class="row-meta">{{ formatSettlementTimeShort(flow.createTime) }}</text>
              <text class="row-meta">{{ shopText(flow) }}</text>
            </view>
            <view class="row-meta-line">
              <text class="row-meta">变动后余额 ¥{{ formatSettlementAmount(flow.balanceAfter) }}</text>
              <text class="row-meta">欠款 ¥{{ formatSettlementAmount(flow.debtAfter) }}</text>
            </view>
            <view v-if="flow.bizNo" class="row-biz" @click="copyBizNo(flow)">
              <text class="row-biz-text">单号 {{ flow.bizNo }}</text>
              <text class="row-biz-copy">复制</text>
            </view>
            <text v-if="isExpanded(flow)" class="row-time">发生时间 {{ formatSettlementTime(flow.createTime) }}</text>
          </view>
          <view class="list-footer">
            {{ loadingMore ? '加载中…' : (flows.length >= total ? '没有更多了' : '上拉加载更多') }}
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

/* 类型筛选条：吸在自定义导航栏下方 */
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
  /* 顶部留出筛选条高度（导航栏之外的额外 100rpx） */
  padding: 100rpx 31rpx 40rpx;
}
.row {
  margin-bottom: 19rpx;
  padding: 27rpx 31rpx;
  border-radius: 23rpx;
  background: #ffffff;
}
.row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.row-type {
  color: #1d2129;
  font-size: 29rpx;
  font-weight: 600;
}
.row-amount {
  font-size: 31rpx;
  font-weight: 600;
}
.row-amount.is-income {
  color: #00b42a;
}
.row-amount.is-expense {
  color: #f53f3f;
}
.row-remark {
  display: block;
  margin-top: 12rpx;
  color: #4e5969;
  font-size: 24rpx;
  line-height: 36rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-remark.is-expanded {
  white-space: normal;
}
.row-meta-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10rpx;
}
.row-meta {
  color: #86909c;
  font-size: 22rpx;
}
.row-time {
  display: block;
  margin-top: 10rpx;
  color: #86909c;
  font-size: 22rpx;
}
.row-biz {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14rpx;
  padding-top: 14rpx;
  border-top: 2rpx solid #f2f3f7;
}
.row-biz-text {
  flex: 1;
  min-width: 0;
  color: #4e5969;
  font-size: 22rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-biz-copy {
  flex: none;
  margin-left: 15rpx;
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
