<script setup lang="ts">
/**
 * 商家端 · 结算单（P6，2026-10-02 新增）
 * ------------------------------------------------------------
 * 契约：`docs/26/10.02/前端对接-P6结算单与导出-2026-10-02.md`
 *      +`docs/26/10.09/前端对接说明-商品级抽成与提现口径-2026-10-08.md` §1.3（行级展开）
 * - `GET /api/merchant/settlement/statements?status=&page=&pageSize=` → 分页结算单
 * - `GET /api/merchant/settlement/statements/export?status=`         → CSV（UTF-8 带 BOM）
 * - `GET /api/merchant/settlement/statements/{orderNo}/items`        → **行级**抽成明细（懒加载）
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
 *
 * 行级展开（2026-10-08 spec §1.3）三条硬规则：
 * a. **懒加载**：只有商家点开某单时才请求 `/items`（**不要**在 `loadStatements` 里逐单预取，
 *    对账页动辄几十单，预取会把接口打爆）；已加载过的按订单号缓存，重复展开不重复请求；
 * b. `goodsAmount` 是**该行**分摊后的商品额（**整单优惠已按比例摊入**）、`commissionAmount` 是该行抽成，
 *    **所有行相加 == 订单级抽成**（后端硬校验）⇒ 页面把这个口径写在明细下面，避免商家自己加着对不上；
 * c. `reversedAt` 非空 = **该行已作废**（整单退款时整批置作废）⇒ 必须渲染成「作废」（灰 + 删除线）并给出 `reversedReason`。
 */
import { computed, ref } from 'vue'
import { onLoad, onReachBottom } from '@dcloudio/uni-app'
import {
  SETTLEMENT_CODE_NOT_MERCHANT_OWNER,
  SETTLEMENT_CODE_STATEMENT_ITEMS_NOT_IN_BRAND,
  SETTLEMENT_STATEMENT_ITEMS_BRAND_TEXT,
  buildSettlementStatementsExportUrl,
  formatSettlementAmount,
  formatSettlementTime,
  getSettlementStatementItems,
  getSettlementStatements,
  isReversedStatementItem,
  resolveSettlementErrorMessage,
  type SettlementStatementStatus,
  type StatementItemVO,
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

// ===== 行级明细（2026-10-08 spec §1.3）：懒加载 + 按订单号缓存 =====

/** 当前展开行级明细的订单号（空串 = 全部收起；同一时间只展开一单，手机上更好读）。 */
const expandedOrderNo = ref('')
/** 已加载的行级明细：`orderNo → rows`（**只有展开过且成功**的订单才有键 ⇒ 天然实现"首次展开才请求"）。 */
const statementItems = ref<Record<string, StatementItemVO[]>>({})
/** 行级明细的加载失败文案：`orderNo → 文案`（含 1004 的"不属于当前品牌"）。 */
const statementItemsError = ref<Record<string, string>>({})
/** 正在加载行级明细的订单号（空串 = 无）。 */
const itemsLoadingOrderNo = ref('')

/** 某单的行级明细（没加载过 → 空数组）。 */
function statementRowsOf(orderNo: string): StatementItemVO[] {
  return statementItems.value[orderNo] || []
}

/** 某单的行级明细失败文案（没失败过 → 空串）。 */
function statementItemsErrorOf(orderNo: string): string {
  return statementItemsError.value[orderNo] || ''
}

/** 某单是否已展开。 */
function isStatementExpanded(orderNo: string): boolean {
  return expandedOrderNo.value === orderNo
}

/**
 * 点击「查看商品明细」：收起已展开的单；首次展开时**才**拉接口（懒加载）。
 *
 * ⚠️ 不要把这里的请求挪进 `loadStatements()` —— 那会让每次翻页都对整页订单发一次 `/items`。
 */
async function toggleStatementRows(orderNo: string): Promise<void> {
  if (expandedOrderNo.value === orderNo) {
    expandedOrderNo.value = ''
    return
  }
  expandedOrderNo.value = orderNo
  // 已成功加载过 / 正在加载 ⇒ 直接用缓存（不重复请求，失败的不缓存、允许重试）
  if (statementItems.value[orderNo] || itemsLoadingOrderNo.value === orderNo) return
  await loadStatementItems(orderNo)
}

/** 拉取某单的行级抽成明细（仅由 {@link toggleStatementRows} 首次展开时调用）。 */
async function loadStatementItems(orderNo: string): Promise<void> {
  itemsLoadingOrderNo.value = orderNo
  // 重试前先清掉上一次的失败文案
  statementItemsError.value = { ...statementItemsError.value, [orderNo]: '' }
  try {
    const rows = await getSettlementStatementItems(orderNo)
    statementItems.value = { ...statementItems.value, [orderNo]: Array.isArray(rows) ? rows : [] }
  } catch (error) {
    // 1004：订单不属于当前品牌（后端业务码，HTTP 200）⇒ 必须说清是哪一类问题
    const message =
      isApiRequestError(error) && Number(error.code) === SETTLEMENT_CODE_STATEMENT_ITEMS_NOT_IN_BRAND
        ? SETTLEMENT_STATEMENT_ITEMS_BRAND_TEXT
        : resolveSettlementErrorMessage(error, '行级明细加载失败')
    statementItemsError.value = { ...statementItemsError.value, [orderNo]: message }
    uni.showToast({ title: message, icon: 'none' })
  } finally {
    itemsLoadingOrderNo.value = ''
  }
}

/** 行让利比例文案（与该单「让利比例」行同风格；`null` → 「—」）。 */
function statementRowRateText(row: StatementItemVO): string {
  return row?.commissionRate == null ? '—' : `${row.commissionRate}%`
}

/** 行是否已作废（`reversedAt` 非空 ⇒ 整单退款时整批置作废）。 */
function isReversedRow(row: StatementItemVO): boolean {
  return isReversedStatementItem(row)
}

/** 作废行的一行说明（时间 + 原因；原因可能为空）。 */
function reversedRowText(row: StatementItemVO): string {
  const time = formatSettlementTime(row?.reversedAt)
  const reason = String(row?.reversedReason || '').trim()
  return reason ? `作废时间：${time}；作废原因：${reason}` : `作废时间：${time}`
}

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
    // ⚠️ 切筛选/重载时**必须**连行级明细缓存一起清：否则同一订单号在换筛选后仍显示旧明细，
    //    而它可能已经变成"不属于当前品牌"（1004）或已作废。
    expandedOrderNo.value = ''
    statementItems.value = {}
    statementItemsError.value = {}
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
 *
 * ⚠️ `withItems`（2026-10-09 spec §5.3）：**默认 `false`** —— 此时请求**与旧版一字不差**
 * （不出现 `detail` 参数，导出内容与列序保持旧版），老脚本因此不受影响；
 * 只有商家**显式**点「导出含行级明细」才传 `true`，让后端在订单级明细后追加行级明细段。
 * ⚠️ 模板必须显式写 `exportCsv(false)` / `exportCsv(true)`：若只写**裸函数名**（不带括号传参），
 * Vue 会把事件对象作为第一个参数传进来（"truthy"）⇒ 默认导出会**被静默升级成带明细**。
 * 契约里有反向断言钉住这一点（本文件因此**不得**出现那种裸写法，注释里也不写）。
 */
async function exportCsv(withItems = false): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  uni.showLoading({ title: '导出中…' })
  try {
    const { tempFilePath } = await downloadFile(buildSettlementStatementsExportUrl(activeStatus.value, withItems))
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
          <!-- ⚠️ 默认导出：`false` 必须**显式**写（裸 `exportCsv` 会把事件对象当参数传进来） -->
          <text class="export-btn" :class="{ disabled: exporting }" @click="exportCsv(false)">
            {{ exporting ? '导出中…' : '导出 CSV' }}
          </text>
        </view>

        <!-- 可选：带行级明细的导出（2026-10-09 spec §5.3）。
             ⚠️ 这是**opt-in**：不点它时上面那个按钮发出的请求与旧版完全一致（不带 detail 参数）。 -->
        <view class="export-extra">
          <text class="export-detail-btn" :class="{ disabled: exporting }" @click="exportCsv(true)">导出 CSV（含行级明细）</text>
          <text class="export-detail-note">行级明细段（追加在订单级明细之后）含：订单号 / 行ID / SKU / 让利比例 / 行商品金额 / 行抽成 / 作废时间 / 作废原因。默认导出（上方按钮）不含该段，列序与旧版完全一致。</text>
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

            <!-- 行级明细：懒加载（首次展开才请求 /items，已加载过的按订单号缓存） -->
            <view class="rows-toggle" @click="toggleStatementRows(item.orderNo)">
              <text class="rows-toggle-text">{{ isStatementExpanded(item.orderNo) ? '收起商品明细' : '查看商品明细（行级抽成）' }}</text>
            </view>
            <view v-if="isStatementExpanded(item.orderNo)" class="rows">
              <view v-if="itemsLoadingOrderNo === item.orderNo" class="rows-state">明细加载中…</view>
              <view v-else-if="statementItemsErrorOf(item.orderNo)" class="rows-state rows-error">{{ statementItemsErrorOf(item.orderNo) }}</view>
              <template v-else-if="statementRowsOf(item.orderNo).length">
                <view
                  v-for="row in statementRowsOf(item.orderNo)"
                  :key="row.orderItemId"
                  class="item-row"
                  :class="{ 'is-reversed': isReversedRow(row) }"
                >
                  <view class="item-head">
                    <text class="item-sku">SKU {{ row.skuId == null ? '—' : row.skuId }}</text>
                    <!-- 作废行必须显式标注（灰 + 删除线），否则商家会把它当有效抽成 -->
                    <text v-if="isReversedRow(row)" class="item-void">作废</text>
                  </view>
                  <view class="row"><text class="label">让利比例</text><text class="value">{{ statementRowRateText(row) }}</text></view>
                  <view class="row"><text class="label">商品金额（含分摊优惠）</text><text class="value">¥{{ formatSettlementAmount(row.goodsAmount) }}</text></view>
                  <view class="row"><text class="label">平台抽成</text><text class="value">-¥{{ formatSettlementAmount(row.commissionAmount) }}</text></view>
                  <view v-if="isReversedRow(row)" class="item-void-reason">{{ reversedRowText(row) }}</view>
                </view>
              </template>
              <view v-else class="rows-state">该订单暂无行级明细</view>
              <!-- 口径说明：商家一定会自己加，先把"为什么加起来对得上"讲清楚 -->
              <view class="rows-note">· 行商品金额 = 订单级商品额按行分摊（整单优惠已按比例摊入）</view>
              <view class="rows-note">· 各行抽成相加 = 订单级平台抽成（后端硬校验）</view>
            </view>
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
/* 可选导出（含行级明细）：工具栏下方的次级入口 + 内容说明（opt-in，不影响默认导出） */
.export-extra { margin-top: 12rpx; }
.export-detail-btn { display: inline-block; padding: 6rpx 20rpx; border-radius: 999rpx; border: 1rpx solid #ffb27a; color: #d2691e; font-size: 22rpx; }
.export-detail-btn.disabled { opacity: 0.5; }
.export-detail-note { display: block; margin-top: 10rpx; color: #86909c; font-size: 22rpx; line-height: 32rpx; }
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
/* 行级明细（2026-10-08 spec §1.3）：展开入口 + 行卡片 + 作废态 */
.rows-toggle { margin-top: 18rpx; padding-top: 16rpx; border-top: 1rpx solid #f2f3f7; }
.rows-toggle-text { color: #ff5500; font-size: 24rpx; }
.rows { margin-top: 12rpx; }
.rows-state { padding: 16rpx 0; color: #999; font-size: 24rpx; }
.rows-error { color: #d40000; }
.item-row { margin-top: 12rpx; padding: 16rpx; border-radius: 12rpx; background: #f7f8fa; }
/* ⚠️ 作废行：灰 + 删除线（整单退款时整批置作废，商家不能把它当有效抽成） */
.item-row.is-reversed { opacity: .6; }
.item-row.is-reversed .value { text-decoration: line-through; }
.item-head { display: flex; align-items: center; justify-content: space-between; }
.item-sku { color: #4e5969; font-size: 24rpx; }
.item-void { padding: 2rpx 12rpx; border-radius: 6rpx; background: #e5e6eb; color: #86909c; font-size: 22rpx; }
.item-void-reason { margin-top: 12rpx; color: #86909c; font-size: 22rpx; line-height: 32rpx; }
.rows-note { margin-top: 8rpx; color: #86909c; font-size: 22rpx; line-height: 32rpx; }
.more { padding: 28rpx 0; color: #999; text-align: center; font-size: 24rpx; }
</style>
