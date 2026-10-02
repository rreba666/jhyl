<script setup lang="ts">
/**
 * 商家端 · 结算单（P6，2026-10-03 新增）
 * ------------------------------------------------------------
 * 契约：`docs/26/10.2/前端对接-P6结算单与导出-2026-10-03.md`
 * - `GET /api/merchant/settlement/statements?status=&page=&pageSize=` → 分页结算单
 * - `GET /api/merchant/settlement/statements/export?status=`         → CSV（UTF-8 带 BOM）
 *
 * 口径（P6 §三，**改动前先读**）：
 * 1. **一子单一条**：跨商物流单拆成父单 + 子单，**父单不产生结算** ⇒
 *    同一用户的一次下单可能对应**多条**结算单（每个商家一条）；
 * 2. 金额**直接用后端字段**（`merchantIncome` = 商品金额 − 抽成 + 配送费），
 *    ⚠️ **不要前端自算**（容易与后端口径漂移）；
 * 3. `sumMerchantIncome` / `sumCommissionAmount` 是**本页**合计 ⇒ 文案必须标明"本页"，
 *    **不能**当全量合计展示；
 * 4. `fulfillShopId` 物流单为 `null` ⇒ **展示门店必须判空**；
 * 5. `commissionRate` 是**下单时快照** ⇒ 后台改比例**不影响历史单据**。
 */
import { computed, ref } from 'vue'
import { onLoad, onReachBottom } from '@dcloudio/uni-app'
import {
  SETTLEMENT_CODE_NOT_MERCHANT_OWNER,
  buildSettlementStatementsExportUrl,
  formatSettlementAmount,
  formatSettlementTime,
  getSettlementStatements,
  resolveSettlementErrorMessage,
  type SettlementStatementStatus,
  type StatementVO,
} from '@/api/settlement'
import { downloadFile, isApiRequestError } from '@/utils/request'

/** 状态筛选项（`value` 为空串 = 全部）。 */
const STATUS_OPTIONS: { label: string; value: SettlementStatementStatus | '' }[] = [
  { label: '全部', value: '' },
  { label: '待入账', value: 'PENDING' },
  { label: '已入账', value: 'CREDITED' },
  { label: '已作废', value: 'REVERSED' },
]

const statusBarHeight = ref(0)
/** 内容区顶部留白 = 状态栏 + 自定义导航栏高度（与结算主页同口径）。 */
const contentTop = computed(() => statusBarHeight.value + 44)

const items = ref<StatementVO[]>([])
const total = ref(0)
const page = ref(1)
const size = 20
const loading = ref(false)
const loadingMore = ref(false)
/** 当前筛选的状态（空串 = 全部）。 */
const activeStatus = ref<SettlementStatementStatus | ''>('')
/** 非品牌主体（13016）：不渲染列表。 */
const notMerchantOwner = ref(false)
/** 导出中（禁用按钮，避免重复下载）。 */
const exporting = ref(false)
/**
 * ⚠️ 后端下发的**本页**合计（**不是全量**，模板文案已明示"本页"）。
 * 直接存 ref、模板里过 `formatSettlementAmount` 展示 —— 这里**没有派生逻辑**，故不加 computed。
 */
const sumMerchantIncome = ref<number>()
const sumCommissionAmount = ref<number>()

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '结算单' })
  void loadStatements(true)
})

/** 加载结算单；reset=true 时回到第一页并清空列表。 */
async function loadStatements(reset = false): Promise<void> {
  if (reset) {
    page.value = 1
    items.value = []
  }
  if (page.value === 1) loading.value = true
  else loadingMore.value = true
  try {
    const result = await getSettlementStatements({ status: activeStatus.value, page: page.value, pageSize: size })
    const list = Array.isArray(result?.items) ? result.items : []
    items.value = page.value === 1 ? list : [...items.value, ...list]
    total.value = Number(result?.total || 0)
    // ⚠️ 后端给的是**本页**合计 ⇒ 每页覆盖（不是累加）
    sumMerchantIncome.value = result?.sumMerchantIncome
    sumCommissionAmount.value = result?.sumCommissionAmount
    notMerchantOwner.value = false
  } catch (error) {
    if (page.value === 1) items.value = []
    // 13016：当前品牌下没有商家主体身份 ⇒ 整页只显示提示
    if (isApiRequestError(error) && Number(error.code) === SETTLEMENT_CODE_NOT_MERCHANT_OWNER) {
      notMerchantOwner.value = true
      return
    }
    uni.showToast({ title: resolveSettlementErrorMessage(error, '结算单加载失败'), icon: 'none' })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

/** 切换状态筛选：重置到第一页重新加载。 */
function selectStatus(value: SettlementStatementStatus | ''): void {
  if (loading.value || activeStatus.value === value) return
  activeStatus.value = value
  void loadStatements(true)
}

/** 触底加载下一页（已加载数 ≥ total 时不再请求）。 */
function loadMore(): void {
  if (loading.value || loadingMore.value) return
  if (items.value.length >= total.value) return
  page.value += 1
  void loadStatements()
}
onReachBottom(() => loadMore())

/**
 * 导出当前筛选结果为 CSV。
 *
 * ⚠️ 三个要点（P6 §二.2）：
 *  1. **必须带当前筛选的 status**（"与列表所见一致"）；
 *  2. URL 由 `api` 层拼（鉴权头与 base URL 在 request 模块私有）⇒ 走 `downloadFile()`；
 *  3. 返回的是 **CSV**（不是 xlsx）⇒ 用 `openDocument` 打开；⚠️ 部分环境对 csv 支持有限，
 *     失败时**降级提示**（不谎报成功）。
 */
async function exportCsv(): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  uni.showLoading({ title: '导出中…' })
  try {
    const { tempFilePath } = await downloadFile(buildSettlementStatementsExportUrl(activeStatus.value))
    uni.hideLoading()
    // ⚠️ 打开文档让用户能"转发/用其他应用打开"；失败则退回提示，不假装成功
    uni.openDocument({
      filePath: tempFilePath,
      fileType: 'csv',
      showMenu: true,
      fail: () => {
        uni.showToast({ title: '已导出，请用「文件」应用打开', icon: 'none', duration: 3000 })
      },
    })
  } catch (error) {
    uni.hideLoading()
    uni.showToast({ title: error instanceof Error ? error.message : '导出失败', icon: 'none' })
  } finally {
    exporting.value = false
  }
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
      <text class="nav-title">结算单</text>
    </view>

    <scroll-view class="content" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false">
      <!-- 13016：当前品牌下没有商家主体身份 -->
      <view v-if="notMerchantOwner" class="state">
        <text class="state-title">仅商户品牌主体可查看结算账户与提现</text>
        <text class="state-text">当前账号在该品牌下没有商家主体身份，请在「账单」查看所属品牌（结算归属）的订单口径营业额。</text>
      </view>

      <template v-else>
        <!-- 状态筛选 + 导出 -->
        <view class="toolbar">
          <view class="chips">
            <text
              v-for="option in STATUS_OPTIONS"
              :key="option.value"
              class="chip"
              :class="{ active: activeStatus === option.value }"
              @click="selectStatus(option.value)"
            >{{ option.label }}</text>
          </view>
          <text class="export-btn" :class="{ disabled: exporting }" @click="exportCsv">
            {{ exporting ? '导出中…' : '导出 CSV' }}
          </text>
        </view>

        <!-- ⚠️ 本页合计：明示"本页"，避免被当成全量 -->
        <view class="summary">
          <text class="summary-text">本页商家应得合计 ¥{{ formatSettlementAmount(sumMerchantIncome) }}；本页平台抽成 ¥{{ formatSettlementAmount(sumCommissionAmount) }}</text>
        </view>

        <view v-if="loading" class="state">加载中…</view>
        <view v-else-if="!items.length" class="state">暂无结算单：订单完成并过释放期后，钱会入账到这里</view>

        <template v-else>
          <view v-for="item in items" :key="item.orderNo" class="card">
            <view class="card-head">
              <text class="order-no">{{ item.orderNo }}</text>
              <text class="status" :class="'status-' + String(item.status || '').toLowerCase()">{{ item.statusDesc || item.status }}</text>
            </view>
            <view class="row"><text class="label">配送方式</text><text class="value">{{ item.pickupTypeDesc || '—' }}</text></view>
            <!-- ⚠️ 物流单没有履约门店（fulfillShopId 为 null）⇒ 必须判空 -->
            <view class="row"><text class="label">履约门店</text><text class="value">{{ item.fulfillShopId == null ? '—' : item.fulfillShopId }}</text></view>
            <view class="row"><text class="label">商品金额</text><text class="value">¥{{ formatSettlementAmount(item.goodsAmount) }}</text></view>
            <view class="row"><text class="label">让利比例</text><text class="value">{{ item.commissionRate == null ? '—' : item.commissionRate + '%' }}</text></view>
            <view class="row"><text class="label">平台抽成</text><text class="value">-¥{{ formatSettlementAmount(item.commissionAmount) }}</text></view>
            <view class="row"><text class="label">配送费</text><text class="value">¥{{ formatSettlementAmount(item.deliveryFee) }}</text></view>
            <!-- ⚠️ 商家应得直接用后端值（不要前端算） -->
            <view class="row row-strong"><text class="label">商家应得</text><text class="value">¥{{ formatSettlementAmount(item.merchantIncome) }}</text></view>
            <view class="row"><text class="label">快照时间</text><text class="value">{{ formatSettlementTime(item.createTime) }}</text></view>
            <view v-if="item.creditedAt" class="row"><text class="label">入账时间</text><text class="value">{{ formatSettlementTime(item.creditedAt) }}</text></view>
            <view v-if="item.reversedAt" class="row"><text class="label">作废时间</text><text class="value">{{ formatSettlementTime(item.reversedAt) }}</text></view>
            <!-- ⚠️ 作废单必须能一眼看到作废原因 -->
            <view v-if="item.reversedReason" class="reason">作废原因：{{ item.reversedReason }}</view>
          </view>
          <view v-show="loadingMore" class="more">加载中…</view>
          <view v-show="!loadingMore && items.length >= total" class="more">没有更多了</view>
        </template>
      </template>
    </scroll-view>
  </view>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; background: #f6f8fc; color: #172033; }
.header { position: fixed; top: 0; right: 0; left: 0; z-index: 20; display: flex; align-items: center; justify-content: center; height: 44px; background: #fff; }
.nav-back { position: absolute; left: 24rpx; color: #172033; font-size: 46rpx; line-height: 1; }
.nav-title { font-size: 32rpx; font-weight: 700; }
.content { flex: 1; padding: 0 24rpx 40rpx; box-sizing: border-box; }
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-top: 20rpx; }
.chips { display: flex; gap: 12rpx; }
.chip { padding: 8rpx 22rpx; border-radius: 999rpx; background: #fff; color: #4e5969; font-size: 24rpx; }
.chip.active { background: #ff5500; color: #fff; }
.export-btn { padding: 8rpx 22rpx; border-radius: 999rpx; border: 1rpx solid #ff5500; color: #ff5500; font-size: 24rpx; }
.export-btn.disabled { opacity: 0.5; }
.summary { margin-top: 18rpx; padding: 16rpx 20rpx; border-radius: 12rpx; background: #fff7f2; }
.summary-text { color: #916448; font-size: 23rpx; line-height: 34rpx; }
.state { padding: 120rpx 40rpx; color: #999; text-align: center; font-size: 26rpx; }
.state-title { display: block; margin-bottom: 16rpx; color: #172033; font-size: 30rpx; font-weight: 700; }
.state-text { display: block; color: #4e5969; font-size: 24rpx; line-height: 38rpx; }
.card { margin-top: 20rpx; padding: 24rpx; border-radius: 16rpx; background: #fff; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.order-no { color: #172033; font-size: 26rpx; font-weight: 600; }
.status { font-size: 24rpx; }
.status-pending { color: #ff8f1f; }
.status-credited { color: #00b42a; }
.status-reversed { color: #86909c; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 14rpx; }
.label { color: #86909c; font-size: 24rpx; }
.value { color: #172033; font-size: 24rpx; }
.row-strong .label, .row-strong .value { color: #172033; font-size: 26rpx; font-weight: 700; }
.reason { margin-top: 16rpx; color: #d40000; font-size: 23rpx; line-height: 34rpx; }
.more { padding: 28rpx 0; color: #999; text-align: center; font-size: 24rpx; }
</style>
