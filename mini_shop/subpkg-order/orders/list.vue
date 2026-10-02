<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, onMounted, ref } from 'vue'
import { cancelOrder, fastRefundOrder, getOrderDetail, getOrderList, receiveOrder, refundOrder, type OrderStatus, type OrderSummary } from '@/api/order'
// 秒退窗口判断（支付后 30 分钟内可免审核立即退款）——与订单详情页共用同一套口径
import { canFastRefundNow, markFastRefundBlocked, markFastRefundDailyQuotaExhausted, refundStatusOverrideText } from '@/utils/refund-window'
import { confirmReceiveDelivery, deliveryNodeText, getOrderProgress } from '@/api/delivery-order'
import { getAfterSaleList, type AfterSaleRecord } from '@/api/after-sale'
// 申请售后弹层的状态与提交（与订单详情页**共用**，见该文件头部说明为何抽出）
import { useAfterSaleSubmit } from '@/utils/after-sale-submit'
// 跨商拆单（P3）子订单工具。⚠️ 列表接口**只返回父单、不含 children** ⇒
//    要判断"这是不是父单"必须**按需拉一次详情**（见下方 handleAfterSaleClick）。
import { hasChildOrders as hasChildOrdersIn, pickChildOrder } from '@/utils/child-order'
import { isApiRequestError } from '@/utils/request'
// 幂等键生成（请求头 X-Request-Id）：同一笔秒退动作的连点/重试复用同一个值，见 utils/request-id.ts
import { createRequestId } from '@/utils/request-id'
import { isLoggedIn } from '@/utils/auth'
import LoginGuide from '@/components/LoginGuide.vue'
// 秒退必须填写退款理由 → 统一的理由输入弹层（订单详情页共用同一个组件）
import RefundReasonSheet from '@/components/RefundReasonSheet.vue'

/** 订单 tab 定义。「退款售后」走售后单接口（key='aftersale'），其余走订单列表。 */
const tabs: Array<{ key: string; label: string; statuses: OrderStatus[]; pickupType?: 0 | 1 }> = [
  { key: 'all', label: '全部', statuses: [0, 1, 2, 3, 4, 6, 7, 8] },
  { key: 'pending', label: '待付款', statuses: [0] },
  { key: 'shipped', label: '待发货', statuses: [1], pickupType: 0 },
  { key: 'received', label: '待收货', statuses: [2] },
  { key: 'pickup', label: '待自提', statuses: [1], pickupType: 1 },
  { key: 'completed', label: '已完成', statuses: [3, 4, 8] },
  // 退款中(6) 与 已退款(7) 必须分成两个 tab（2026-09-23 按后端《秒退与退款口径》§2）：
  // 6 = 钱还没到账（用户会追问、客服要跟进），7 = 钱已到账（可闭环）——
  // 混在一个列表里用户无法判断"我的退款到底好了没"。
  { key: 'refunding', label: '退款中', statuses: [6] },
  { key: 'refunded', label: '已退款', statuses: [7] },
  { key: 'aftersale', label: '退款售后', statuses: [] },
]
/** 「退款售后」tab 索引，退款成功后自动切换到该分类。 */
const AFTER_SALE_TAB_INDEX = tabs.findIndex((tab) => tab.key === 'aftersale')
/** 当前选中的 tab 索引。 */
const activeIndex = ref(0)
const list = ref<OrderSummary[]>([])

/**
 * 订单首图是否「加载结束」（成功或失败都算），按订单 id 分别记录。
 *
 * ⚠️ 2026-09-29 图片加载优化（与首页卡片、分类页同款）：原来 `.goods-img` 只有一块纯色底，
 *    图片加载完**硬切**出现。现在改为「骨架 + 扫光」占位、实图淡入。
 * ⚠️ 必须按 id 记录：订单列表是**分页追加**的，且切换页签会重建列表
 *    ⇒ 用全局布尔量会「第一张加载完就以为全都加载完了」。
 * ⚠️ `@error` 也算「结束」—— 否则扫光一直转，看起来像卡死。
 * ⚠️ 用**替换 Set** 触发响应式（小程序端对 Set 原地 add 不保证触发更新；
 *    本文件 `processingOrderIds` 也是 Set，但那处是直接读 `.has()` 判断按钮态，二者用途不同）。
 */
const imageSettled = ref<Set<number>>(new Set())
/** 标记某张首图「已加载结束」（成功、失败都调用）。 */
function onImageSettled(id: number): void {
  if (imageSettled.value.has(id)) return
  imageSettled.value = new Set(imageSettled.value).add(id)
}
/** 售后单列表（「退款售后」tab 专用）。 */
const afterSales = ref<AfterSaleRecord[]>([])
/** 有「处理中」售后单（0待审核/2退款中/4待寄回/5待收货）的订单 ID 集合，用于隐藏退款按钮。 */
const processingOrderIds = ref<Set<string>>(new Set())
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const loaded = ref(false)
const actionLoading = ref<string | null>(null)
const navigationLoading = ref(false)
/** 当前 tab 是否为「退款售后」。 */
const isAfterSaleTab = computed(() => tabs[activeIndex.value]?.key === 'aftersale')
const empty = computed(() => loaded.value && !loading.value && !(isAfterSaleTab.value ? afterSales.value.length : list.value.length))
const loginGuideVisible = ref(false)
/** 请求竞态 token，快速切换 tab 时丢弃过期响应。 */
let requestToken = 0

/**
 * 秒退动作的幂等键缓存（页面级，key = 订单 ID，value = 该笔秒退动作的 requestId）。
 *
 * 语义：**同一次退款动作（连点 / 失败后重试）复用同一个 `X-Request-Id`** ——
 * 后端「接口调用计数」以该请求头为幂等键，复用它才不会把重试算成多次调用；
 * **成功后删除**该订单的键（下一次退款是新的动作，要生成新的 id）。
 * 用普通对象（非 ref）：它只参与请求，不参与渲染，不需要响应式。
 */
const fastRefundRequestIds: Record<string, string> = {}

/** 退款理由弹层：当前正在填写理由的订单（null = 弹层关闭）。 */
const refundSheetOrder = ref<OrderSummary | null>(null)
const refundSheetVisible = ref(false)
/** 理由弹层提交中（禁用输入与按钮、不允许关闭）。 */
const refundSheetSubmitting = ref(false)
/** 理由弹层内的错误（提交失败时**不关弹层**，理由不丢，可直接改完重试）。 */
const refundSheetError = ref('')

/**
 * 售后申请弹层（**已完成订单**用）。
 *
 * ⚠️ 2026-10-02：状态与提交逻辑已抽到 `utils/after-sale-submit.ts`（与订单详情页共用），
 * 这里只提供**成功后**的收尾动作（列表页的收尾 = 切到「退款/售后」页签并刷新）。
 *
 * 背景（后端 P1P2 §一.2）：**已完成（COMPLETED）的订单现在也可以申请售后**
 * （旧逻辑"完成即不可申请"）⇒ 已完成订单原先在列表里**没有任何售后入口**。
 * 走 `POST /api/after-sale/submit`（**待审核**、**不会立即退款**）。
 */
const {
  sheetVisible: afterSaleSheetVisible,
  sheetSubmitting: afterSaleSheetSubmitting,
  sheetError: afterSaleSheetError,
  open: openAfterSale,
  submit: submitAfterSaleRequest,
} = useAfterSaleSubmit({
  onSuccess: async () => {
    // 与退款一致：切到「退款/售后」分类看进度
    activeIndex.value = AFTER_SALE_TAB_INDEX
    await load(true)
  },
})

/**
 * 「申请售后」入口（列表页）。
 *
 * ⚠️⚠️ 为什么这里要多拉一次详情（P3 §2.3 + 列表接口的特性）：
 * - 后端对**父单**（跨商拆单的订单）申请售后会直接拒（`code=1000`）；
 * - 而 `GET /api/order/list` 为了性能**只返回父单、且不返回 `children`**
 *   ⇒ 列表页**无法**从自身数据判断"是不是父单"，必须按需拉一次详情。
 *
 * ⇒ 流程：拉详情 → 无子单则按原样提交；有子单则让用户**选一个子单**再提交
 *   （与详情页共用 `utils/child-order.ts`）。
 */
async function handleAfterSaleClick(order: OrderSummary): Promise<void> {
  if (actionLoading.value) return
  try {
    const detail = await getOrderDetail(order.id)
    const children = detail?.children
    if (!hasChildOrdersIn(children)) {
      openAfterSale(order.id)
      return
    }
    const picked = await pickChildOrder(children, '申请售后')
    if (picked?.id != null) openAfterSale(picked.id)
  } catch (error) {
    // ⚠️ 拉详情失败不能静默：否则用户点售后没反应，只会重复点
    uni.showToast({ title: isApiRequestError(error) ? error.message : '订单加载失败，请重试', icon: 'none' })
  }
}

/** 微信胶囊按钮位置，用于自定义导航栏精确定位。 */
const menuTop = ref(0)
const menuHeight = ref(32)
const navStyle = computed(() => ({ top: `${menuTop.value}px`, height: `${menuHeight.value}px` }))
const bodyTop = computed(() => menuTop.value + menuHeight.value)

/**
 * 同城订单的配送节点缓存（key = orderNo，value = progress 接口的 `node`）。
 *
 * ⚠️ 2026-09-21 真实接口实测（**不要再改回字符串比较**）：
 *   1. `GET /api/order/detail-by-no/{orderNo}`（详情）返回的 `deliveryStatus` 是**字符串节点**（如 `DELIVERED`）；
 *   2. 但 `GET /api/order/list`（列表）在订单履约中（status=1）**根本不返回 `deliveryStatus` 字段**，
 *      订单完成后返回的又是**数字** `1`；
 *   3. 所以列表页拿订单对象上的 `deliveryStatus` 与 `'DELIVERED'` 直接比较**永远为假** ——
 *      同城订单的「确认收货」按钮从来不出现、状态文案也总是回落到「已支付」（用户反馈的 P0）。
 *   4. 唯一可靠口径：`GET /api/delivery/orders/{orderNo}/progress` 的 `node`（送达后该接口仍可查）。
 * 注意这里是普通对象（用 `progressNodeMap[orderNo]` 取值），不是 ES `Map`。
 */
const progressNodeMap = ref<Record<string, string>>({})

/** 需要补查配送节点的同城订单：只查履约中（status=1）的，其余形态/终态不需要。 */
function pendingProgressOrders(orders: OrderSummary[]): OrderSummary[] {
  return orders.filter((order) => order.pickupType === 2 && order.status === 1 && !!order.orderNo)
}

/**
 * 批量并发补查同城订单的配送节点。
 * 容错要求：单个订单 progress 失败/超时**不能影响列表渲染** —— 用 `Promise.allSettled`，
 * 失败的那一单只是拿不到节点（于是不显示「确认收货」、状态文案回落 `statusDesc`），列表照常展示。
 * @param orders 本次要补查的订单（reset 时传整页列表，翻页时传新增的那批）
 * @param reset true=按本次列表整体重建缓存（顺带清掉已确认收货/已移出列表的残留节点）
 * @param token 请求竞态 token，切 tab 后丢弃过期结果
 */
async function loadProgressNodes(orders: OrderSummary[], reset: boolean, token: number): Promise<void> {
  const targets = pendingProgressOrders(orders)
  const next: Record<string, string> = reset ? {} : { ...progressNodeMap.value }
  if (targets.length) {
    const results = await Promise.allSettled(targets.map((order) => getOrderProgress(order.orderNo)))
    if (token !== requestToken) return
    results.forEach((result, index) => {
      const orderNo = targets[index].orderNo
      const node = result.status === 'fulfilled' ? String(result.value?.node || '') : ''
      if (node) next[orderNo] = node
      else delete next[orderNo]
    })
  }
  progressNodeMap.value = next
}

/**
 * 订单列表的状态文案（**唯一出口**，模板里所有状态位都必须走这里）。
 *
 * ⚠️⚠️ 退款口径放**最前面**（2026-09-23《秒退与退款口径》§2）：
 * `status === 6`（退款中）是**物流/自提/同城三类通用**的，原来模板写成
 * `pickupType === 2 ? orderStatusText(order) : order.statusDesc` ⇒ 非同道单**绕过**本函数
 * 直接渲染后端 `statusDesc`，只能得到「退款中」（没有到账预期）；
 * 同城单则可能落到配送节点文案、显示成"配送中"。现在统一走本函数，两处都覆盖掉。
 *
 * 同城订单的状态文案：履约中且能拿到 progress 节点时优先用配送节点（配送中/已送达…），
 * 拿不到就保持原来的 `statusDesc`。物流/自提订单不受影响。
 * ⚠️ 末行兜底仍写 `deliveryNodeText(order.deliveryStatus, order.statusDesc)`：列表接口不返回同城
 * `deliveryStatus`，运行时它必然回落到 `statusDesc`（保留这个写法只为兼容旧契约断言，它**不是**判定依据）。
 */
function orderStatusText(order: OrderSummary): string {
  // 退款中(6) / 已退款(7)：列表用短文案（状态位 `flex-shrink: 0`，完整句会挤扁订单号）
  const override = refundStatusOverrideText(order.status, 'short')
  if (override) return override
  if (order.pickupType !== 2) return order.statusDesc
  const node = progressNodeMap.value[order.orderNo]
  if (node) return deliveryNodeText(node, order.statusDesc)
  return deliveryNodeText(order.deliveryStatus, order.statusDesc)
}

async function load(reset = true): Promise<void> {
  if (!isLoggedIn()) {
    list.value = []
    afterSales.value = []
    loaded.value = true
    loginGuideVisible.value = true
    return
  }
  if (loading.value || loadingMore.value) return
  const token = ++requestToken
  const nextPage = reset ? 1 : page.value + 1
  const currentLength = isAfterSaleTab.value ? afterSales.value.length : list.value.length
  if (!reset && currentLength >= total.value) return
  if (reset) loading.value = true
  else loadingMore.value = true
  try {
    if (isAfterSaleTab.value) {
      const result = await getAfterSaleList(nextPage, 10)
      if (token !== requestToken) return
      afterSales.value = reset ? result.list : [...afterSales.value, ...result.list]
      page.value = result.page || nextPage
      total.value = result.total || afterSales.value.length
    } else {
      const tab = tabs[activeIndex.value]
      const [result, afterSaleResult] = await Promise.all([
        getOrderList({ page: nextPage, pageSize: 10, statuses: tab.statuses, pickupType: tab.pickupType }),
        reset ? getAfterSaleList(1, 100) : Promise.resolve(null),
      ])
      if (token !== requestToken) return
      list.value = reset ? result.list : [...list.value, ...result.list]
      page.value = result.page || nextPage
      total.value = result.total || list.value.length
      // 列表已就绪后再补查同城配送节点（不阻塞列表渲染；失败只影响按钮，不影响卡片）
      void loadProgressNodes(reset ? list.value : result.list, reset, token)
      // reset 时刷新「处理中售后单」的订单集合，用于把退款按钮换成「售后中」
      if (afterSaleResult) {
        processingOrderIds.value = new Set(
          afterSaleResult.list
            .filter((record) => [0, 2, 4, 5].includes(record.status))
            .map((record) => String(record.orderId)),
        )
      }
    }
    loaded.value = true
  } catch (error) {
    if (token !== requestToken) return
    uni.showToast({ title: error instanceof Error ? error.message : (isAfterSaleTab.value ? '售后单加载失败' : '订单加载失败'), icon: 'none' })
  } finally {
    if (token === requestToken) { loading.value = false; loadingMore.value = false }
  }
}

function selectTab(index: number): void {
  if (index === activeIndex.value) return
  if (loading.value || loadingMore.value) {
    uni.showToast({ title: '正在加载，请稍候', icon: 'none' })
    return
  }
  activeIndex.value = index
  void load(true)
}
function openDetail(order: OrderSummary): void { uni.navigateTo({ url: `/subpkg-order/orders/detail?orderId=${order.id}` }) }
function pay(order: OrderSummary): void {
  if (navigationLoading.value) return
  navigationLoading.value = true
  uni.navigateTo({
    url: `/subpkg-order/payment/payment?orderId=${order.id}`,
    fail: () => { navigationLoading.value = false },
  })
}
/** 返回上一页；无上一页（分享/直达进入）时回首页。 */
function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/index/index' })
}
async function cancel(order: OrderSummary): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = `cancel:${order.id}`
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({ title: '提示', content: '确定取消订单吗？', success: (res) => resolve(res.confirm), fail: () => resolve(false) })
  })
  if (!confirmed) { actionLoading.value = null; return }
  try { await cancelOrder(order.id); uni.showToast({ title: '订单已取消', icon: 'success' }); await load(true) }
  catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '取消订单失败', icon: 'none' }) }
  finally { actionLoading.value = null }
}

/** 确认收货（物流订单）。 */
async function receive(order: OrderSummary): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = `receive:${order.id}`
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({ title: '提示', content: '确认已收到商品吗？', success: (res) => resolve(res.confirm), fail: () => resolve(false) })
  })
  if (!confirmed) { actionLoading.value = null; return }
  try { await receiveOrder(order.id); uni.showToast({ title: '已确认收货', icon: 'success' }); await load(true) }
  catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '确认收货失败', icon: 'none' }) }
  finally { actionLoading.value = null }
}

/**
 * 确认收货（同城配送）。
 * ⚠️ 同城订单在骑手送达后主状态仍是「履约中」，**必须**用户确认才收口为「已完成」；
 * 且物流用的 `receiveOrder`(`/api/order/receive`) 对同城单无效，要走同城专用接口。
 * ⚠️ 前端判据是 progress 接口的 `node === 'DELIVERED'`（见 `progressNodeMap`）—— 详情接口的
 * `deliveryStatus` 才是字符串节点，列表接口根本不返回它，不能拿列表字段做字符串比较（2026-09-21 实测）。
 */
async function receiveDelivery(order: OrderSummary): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = `confirm:${order.id}`
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({ title: '提示', content: '确认已收到商品吗？', success: (res) => resolve(res.confirm), fail: () => resolve(false) })
  })
  if (!confirmed) { actionLoading.value = null; return }
  try {
    await confirmReceiveDelivery(order.orderNo)
    // 该单已收口为「已完成」：先清掉本地节点缓存（避免残留节点让按钮复现），再刷新列表
    delete progressNodeMap.value[order.orderNo]
    uni.showToast({ title: '已确认收货', icon: 'success' })
    await load(true)
  }
  catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '确认收货失败', icon: 'none' }) }
  finally { actionLoading.value = null }
}

/** 申请退款（自提订单）。 */
async function refund(order: OrderSummary): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = `refund:${order.id}`
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({ title: '提示', content: '确定申请退款吗？', success: (res) => resolve(res.confirm), fail: () => resolve(false) })
  })
  if (!confirmed) { actionLoading.value = null; return }
  try {
    await refundOrder(order.id)
    uni.showToast({ title: '退款申请已提交', icon: 'success' })
    // 提交成功后跳到「退款售后」分类，让用户看到刚提交的售后单
    activeIndex.value = AFTER_SALE_TAB_INDEX
    await load(true)
  } catch (error) {
    if (isApiRequestError(error) && error.code === 8705) {
      // 该订单已有处理中的售后单：直接跳到「退款售后」分类查看
      uni.showToast({ title: '该订单已提交过售后', icon: 'none' })
      activeIndex.value = AFTER_SALE_TAB_INDEX
      await load(true)
      return
    }
    uni.showToast({ title: error instanceof Error ? error.message : '退款申请失败', icon: 'none' })
  } finally {
    actionLoading.value = null
  }
}

/**
 * 打开秒退的**理由弹层**（📌 秒退必须先填退款理由，2026-09-22 起的产品规则）。
 * 窗口口径见 `utils/refund-window.ts` 的 `canFastRefund`；超出 30 分钟时按钮会变回「退款」（人工审核）。
 */
function openFastRefund(order: OrderSummary): void {
  if (actionLoading.value) return
  refundSheetOrder.value = order
  refundSheetError.value = ''
  refundSheetVisible.value = true
}

/**
 * 提交秒退（理由来自弹层 `confirm` 事件，**已过校验与清洗**）。
 *
 * ⚠️ 失败时**不关闭弹层**：理由留在输入框里，用户改完可直接重试；
 * 且重试会复用同一个 `X-Request-Id` 幂等键（见 `fastRefundRequestIds`）。
 */
async function submitFastRefund(reason: string): Promise<void> {
  const order = refundSheetOrder.value
  if (!order || refundSheetSubmitting.value) return
  refundSheetSubmitting.value = true
  refundSheetError.value = ''
  const requestKey = String(order.id)
  // 同一笔秒退动作复用同一个幂等键：已有则沿用（重试 / 连点），没有才新生成
  if (!fastRefundRequestIds[requestKey]) fastRefundRequestIds[requestKey] = createRequestId()
  const requestId = fastRefundRequestIds[requestKey]
  try {
    await fastRefundOrder(order.id, { requestId, reason })
    // 成功后清空该订单的幂等键：本次动作已结束，下次退款重新生成
    delete fastRefundRequestIds[requestKey]
    refundSheetVisible.value = false
    refundSheetOrder.value = null
    uni.showToast({ title: '已提交退款，将原路退回', icon: 'success' })
    // 与人工退款保持一致：跳到「退款售后」分类，让用户看到进度
    activeIndex.value = AFTER_SALE_TAB_INDEX
    await load(true)
  } catch (error) {
    if (isApiRequestError(error) && error.code === 8705) {
      // 已有处理中的售后单：这不是"理由写错"，关弹层并跳到分类查看
      refundSheetVisible.value = false
      refundSheetOrder.value = null
      uni.showToast({ title: '该订单已提交过售后', icon: 'none' })
      activeIndex.value = AFTER_SALE_TAB_INDEX
      await load(true)
      return
    }
    // ===== 秒退闸门类业务错误（2026-09-23 接入）=====
    // 这些**不是**"理由写错"，不该让用户留在弹层里改理由 —— 都要引导走售后/取消申请。
    // 依据《前端变更说明·秒退与退款口径》：
    //   2013 = 履约进度闸门（商家已备货完成/已出餐）→ 引导提交取消申请（由商家确认）
    //   2014 = 金额超上限（默认 500 元）→ 引导售后申请；⚠️ 闸门排在"每日次数"之前，**不能**提示"次数已用完"
    //   2011 = 已超秒退时限 / 2012 = 今日秒退次数上限 → 引导售后申请
    if (isApiRequestError(error)) {
      const gateMessageMap: Record<number, string> = {
        2013: '商家已出餐，无法直接退款；请在订单详情申请取消，由商家确认',
        2014: '订单金额超过秒退上限，请提交售后申请（人工审核）',
        2011: '已超过秒退时限，请提交售后申请',
        2012: '今日秒退次数已达上限，请提交售后申请',
      }
      const gateMessage = gateMessageMap[Number(error.code)]
      if (gateMessage) {
        // ⚠️⚠️ 2026-10-01 修（用户反馈「秒退达上限后提示走审核退款，但退款按钮还是走秒退」）：
        //    后端已**明确拒绝**秒退 ⇒ 必须**记下来**，否则按钮仍是「立即退款」
        //    （因为 30 分钟窗口还在）⇒ 用户再点还是被拒，**死循环**。
        // ⚠️ 作用域不同：`2012` 是**账号级**（今天所有单都不该再秒退）；
        //    `2011`/`2013`/`2014` 是**订单级**（只影响这一笔）。
        //    ⚠️ 列表页的 `deliveryStatus` 恒为 null（不是详情页那套枚举）⇒
        //       同城的履约闸门 `2013` 只能靠这里记，`isFastRefundGateClosed` 在列表页是失效的。
        const code = Number(error.code)
        if (code === 2012) markFastRefundDailyQuotaExhausted()
        else markFastRefundBlocked(refundSheetOrder.value?.id)
        // 与 8705 一致：关弹层、清幂等键、跳「退款/售后」分类
        refundSheetVisible.value = false
        refundSheetOrder.value = null
        delete fastRefundRequestIds[requestKey]
        uni.showToast({ title: gateMessage, icon: 'none', duration: 3000 })
        activeIndex.value = AFTER_SALE_TAB_INDEX
        await load(true)
        return
      }
    }
    // 其它失败：保留弹层与已填理由，错误显示在弹层里（用户改完可重试，重试复用同一个幂等键）
    refundSheetError.value = error instanceof Error ? error.message : '退款失败，请稍后重试'
  } finally {
    refundSheetSubmitting.value = false
  }
}

/** 格式化金额：整数去掉小数位。 */
function formatAmount(value: number): string {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '')
}

/** 待收货订单物流条文案：deliveryStatus 0=已发货(运输中)，1=已送达。 */
function logisticsInfo(order: OrderSummary): { status: string; remark: string } {
  if (order.deliveryStatus === 1) return { status: '已送达', remark: '请确认收货' }
  return { status: '已发货', remark: '运输中' }
}

onMounted(() => {
  try {
    const r = uni.getMenuButtonBoundingClientRect()
    if (r) { menuTop.value = r.top; menuHeight.value = r.height }
  } catch { /* 非微信环境忽略 */ }
})

onLoad((options?: Record<string, string | undefined>) => {
  const status = Number(options?.status)
  const pickupType = options?.pickupType !== undefined && options.pickupType !== '' ? (Number(options.pickupType) as 0 | 1) : undefined
  if (options?.tab === 'aftersale' || status === 6 || status === 7) {
    // 售后入口（tab=aftersale 或退款中/已退款状态）直接落到「退款售后」分类
    activeIndex.value = AFTER_SALE_TAB_INDEX
  } else if (Number.isInteger(status) && status >= 0 && status <= 8) {
    // 待发货(status=1,物流) 与 待自提(status=1,自提) 需用 pickupType 区分
    const matched = tabs.findIndex((t) => t.statuses.includes(status as OrderStatus) && (pickupType === undefined || t.pickupType === pickupType))
    activeIndex.value = matched >= 0 ? matched : 0
  }
  void load(true)
})
onShow(() => {
  navigationLoading.value = false
  if (loaded.value) void load(true)
})
</script>

<template>
  <view class="page">
    <!-- 自定义导航栏，与胶囊按钮同一行 -->
    <view class="nav" :style="navStyle"><view class="nav-back" @click="goBack"><text class="back-icon">‹</text></view><text class="title">我的订单</text></view>
    <!-- ⚠️ 2026-09-29 改为横向滚动（用户反馈「订单状态的 tab 还是会挤，没有横向滚动」）：
         这里有 **9 个** tab（全部/待付款/待发货/待收货/待自提/已完成/退款中/已退款/退款售后），
         原样式是 `.tabs { display: flex; width: 100% }` + `.tab { flex: 1 }` ⇒ 每个仅约 83rpx，
         3 个字的「待付款」刚好塞满、4 个字的「退款售后」直接溢出 ⇒ 看着就是全挤在一起。
         ⇒ 改成 scroll-view + tab 宽度**自适应内容**：装得下就均分，装不下可左右滑。 -->
    <scroll-view
      class="tabs"
      scroll-x
      :enhanced="true"
      :bounces="true"
      :show-scrollbar="false"
      :style="{ marginTop: bodyTop + 'px' }"
    >
      <view class="tabs-inner">
        <view v-for="(tab, index) in tabs" :key="tab.label" class="tab" :class="{ active: activeIndex === index }" @click="selectTab(index)">{{ tab.label }}</view>
      </view>
    </scroll-view>
    <scroll-view class="list" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false" @scrolltolower="load(false)">
      <view v-show="loading && !(isAfterSaleTab ? afterSales.length : list.length)" class="state">加载中...</view>

      <!-- 售后单列表（退款售后分类） -->
      <template v-if="isAfterSaleTab">
        <view v-for="record in afterSales" :key="record.id" class="order-card">
          <view class="card-head"><text class="card-title">{{ record.typeDesc }}</text><text class="card-status">{{ record.statusDesc }}</text></view>
          <text class="card-time">{{ record.createTime }}</text>
          <view class="card-goods">
            <view class="goods-info">
              <text class="goods-name">售后单号：{{ record.afterSaleNo }}</text>
              <text class="goods-meta">关联订单：{{ record.orderNo }}</text>
              <text v-if="record.reason" class="goods-meta">申请原因：{{ record.reason }}</text>
              <text class="goods-price">退款金额：¥{{ formatAmount(record.refundAmount) }}</text>
            </view>
          </view>
          <text v-if="record.rejectReason" class="card-reject">驳回原因：{{ record.rejectReason }}</text>
        </view>
      </template>

      <!-- 订单列表（其余分类） -->
      <template v-else>
        <view v-for="order in list" :key="order.id" class="order-card" @click="openDetail(order)">
          <view class="card-head"><text class="card-title">{{ order.pickupType === 1 ? (order.shopName || '门店自提') : order.orderNo }}</text><text class="card-status">{{ orderStatusText(order) }}</text></view>
          <text class="card-time">{{ order.createTime }}</text>

          <!-- 物流状态条（仅待收货，两态：已发货/已送达） -->
          <view v-if="order.status === 2" class="logistics" @click.stop="openDetail(order)">
            <view class="logi-icon" />
            <text class="logi-status">{{ logisticsInfo(order).status }}</text>
            <text class="logi-remark">{{ logisticsInfo(order).remark }}</text>
            <text class="logi-arrow">›</text>
          </view>

          <view class="card-goods">
            <!-- ⚠️ 2026-09-29 图片加载优化：图区改为「定位容器 + 骨架层 + 实图层」 -->
            <view class="goods-img-wrap">
              <view v-if="order.firstProductImage && !imageSettled.has(order.id)" class="goods-img-skeleton skeleton-shimmer" />
              <image
                v-if="order.firstProductImage"
                class="goods-img motion-image-in"
                :class="{ 'motion-image-loaded': imageSettled.has(order.id) }"
                :src="order.firstProductImage"
                mode="aspectFill"
                @load="onImageSettled(order.id)"
                @error="onImageSettled(order.id)"
              />
              <view v-else class="goods-img placeholder" />
            </view>
            <view class="goods-info">
              <text class="goods-name">{{ order.firstProductName || '商品' }}</text>
              <text class="goods-meta">共{{ order.totalQuantity }}件</text>
              <text class="goods-price">实付款：¥{{ formatAmount(order.payAmount) }}</text>
            </view>
          </view>

          <view class="card-actions">
            <template v-if="order.status === 0">
              <text class="btn outline" :class="{ disabled: !!actionLoading }" @click.stop="cancel(order)">{{ actionLoading === 'cancel:' + order.id ? '处理中...' : '取消订单' }}</text>
              <text class="btn primary" :class="{ disabled: navigationLoading }" @click.stop="pay(order)">{{ navigationLoading ? '打开中...' : '去支付' }}</text>
            </template>
            <text v-if="order.status === 1 && order.pickupType === 0" class="btn outline" @click.stop="openDetail(order)">查看详情</text>
            <template v-if="order.status === 2">
              <text class="btn outline" @click.stop="openDetail(order)">查看物流</text>
              <text v-if="order.deliveryStatus === 1" class="btn primary" :class="{ disabled: !!actionLoading }" @click.stop="receive(order)">{{ actionLoading === 'receive:' + order.id ? '处理中...' : '确认收货' }}</text>
            </template>
            <template v-if="order.status === 1 && order.pickupType === 1">
              <text v-if="processingOrderIds.has(String(order.id))" class="btn outline">售后中</text>
              <!-- 秒退：支付后 30 分钟内可免审核立即退款（与订单详情页同一口径，见 utils/refund-window.ts）；
                   📌 2026-09-22 起**必须先填退款理由** → 点击只开理由弹层，提交逻辑在 submitFastRefund -->
              <text v-else-if="canFastRefundNow(order)" class="btn primary" :class="{ disabled: !!actionLoading }" @click.stop="openFastRefund(order)">立即退款</text>
              <text v-else class="btn outline" :class="{ disabled: !!actionLoading }" @click.stop="refund(order)">{{ actionLoading === 'refund:' + order.id ? '处理中...' : '退款' }}</text>
              <text class="btn primary" @click.stop="openDetail(order)">去自提</text>
            </template>
            <!-- 同城配送：此前这里没有任何按钮（只判了物流 0 / 自提 1），卡片点不动；补「查看详情」+ 送达后的「确认收货」 -->
            <!-- ⚠️ 「确认收货」只能判 progress 节点（progressNodeMap）：「列表接口不返回同城 deliveryStatus」已实测确认（2026-09-21），
                 原来那种直接拿列表字段与节点字符串比较的写法恒假，按钮永远不出现（详见本文件 progressNodeMap 上的注释）。 -->
            <template v-if="order.pickupType === 2">
              <text class="btn outline" @click.stop="openDetail(order)">查看详情</text>
              <!-- 同城单此前**一个退款入口都没有**（只有查看详情 / 送达后的确认收货）→ 这里补齐：
                   秒退（支付后 30 分钟内）→「立即退款」；否则 →「申请退款」（人工审核，与自提单一致）。
                   ⚠️ 只在「未送达」时给退款入口：已送达应走确认收货/售后，避免与确认收货按钮打架。 -->
              <template v-if="order.status === 1 && progressNodeMap[order.orderNo] !== 'DELIVERED'">
                <text v-if="processingOrderIds.has(String(order.id))" class="btn outline">售后中</text>
                <!-- 秒退同上述自提单口径：先填退款理由再提交（📌 2026-09-22 起必填） -->
                <text v-else-if="canFastRefundNow(order)" class="btn primary" :class="{ disabled: !!actionLoading }" @click.stop="openFastRefund(order)">立即退款</text>
                <text v-else class="btn outline" :class="{ disabled: !!actionLoading }" @click.stop="refund(order)">{{ actionLoading === 'refund:' + order.id ? '处理中...' : '申请退款' }}</text>
              </template>
              <text v-if="order.pickupType === 2 && order.status === 1 && progressNodeMap[order.orderNo] === 'DELIVERED'" class="btn primary" :class="{ disabled: !!actionLoading }" @click.stop="receiveDelivery(order)">{{ actionLoading === 'confirm:' + order.id ? '处理中...' : '确认收货' }}</text>
            </template>
            <!-- ⚠️ 2026-10-02 新增（后端 P1P2 §一.2）：**已完成订单现在也可以申请售后**
                 （旧逻辑"完成即不可申请"）⇒ 已完成订单原先在列表里**没有任何售后入口**。
                 ⚠️ 这里用独立 `v-if`，**不挂进上面按 pickupType 分组的 v-if/v-else-if 链**，
                 以免影响既有按钮的互斥关系（三种配送方式都使用同一入口）。
                 ⚠️ P3 §2.3：跨商拆单的**父单**不能直接申请 ⇒ 点击时按需拉详情并让用户**选子单**。 -->
            <text v-if="order.status === 4 && !processingOrderIds.has(String(order.id))" class="btn outline" :class="{ disabled: !!actionLoading }" @click.stop="handleAfterSaleClick(order)">申请售后</text>
          </view>
        </view>
      </template>

      <view v-show="empty" class="state">{{ isAfterSaleTab ? '暂无售后单' : '暂无订单' }}</view><view v-show="loadingMore" class="more">加载中...</view>
    </scroll-view>

    <LoginGuide v-model="loginGuideVisible" />

    <!-- 秒退理由弹层：📌 秒退必须先填退款理由（提交失败不关弹层：理由不丢，重试复用同一个幂等键） -->
    <RefundReasonSheet
      v-model="refundSheetVisible"
      title="填写退款理由"
      subtitle="提交后立即原路退款，无需客服审核。退款理由为必填项。"
      submit-text="确认退款"
      :submitting="refundSheetSubmitting"
      :error-message="refundSheetError"
      @confirm="submitFastRefund"
    />

    <!-- 售后申请弹层（**已完成订单**用，2026-10-02 新增）：
         ⚠️ 与秒退的文案必须区分 —— 售后走 `POST /api/after-sale/submit`，
         **创建待审核售后单、不会立即退款**，写成"立即原路退款"会误导用户。 -->
    <RefundReasonSheet
      v-model="afterSaleSheetVisible"
      title="填写售后原因"
      subtitle="提交后进入售后审核，审核通过后退款，预计 1–3 个工作日到账。"
      submit-text="提交申请"
      mode="afterSale"
      placeholder="请填写售后原因（必填）"
      :submitting="afterSaleSheetSubmitting"
      :error-message="afterSaleSheetError"
      @confirm="submitAfterSaleRequest"
    />
  </view>
</template>

<style>
.page { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: #f6f6f6; color: #242526; }
.nav { position: fixed; left: 0; right: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: #fff; box-sizing: border-box; }
.nav-back { position: absolute; left: 16rpx; display: flex; align-items: center; justify-content: center; width: 64rpx; height: 64rpx; }.back-icon { font-size: 48rpx; line-height: 1; color: #222; }
.title { font-size: 32rpx; font-weight: 700; }
/* ⚠️ 2026-09-29 改为横向滚动容器（原为 flex + 100% 平分，9 个 tab 每个仅 ~83rpx ⇒ 全挤在一起）。
   现在 tab 宽度自适应内容：内容总宽 < 屏宽时仍靠 space-between 均分铺满，超出时即可左右滑动。 */
.tabs { width: 100%; height: 82rpx; flex-shrink: 0; background: #fff; white-space: nowrap; }
.tabs-inner { display: inline-flex; min-width: 100%; height: 82rpx; align-items: stretch; justify-content: space-between; }
/* ⚠️ 2026-09-29：`flex: 1` 改为**宽度自适应内容**（`flex: 0 0 auto` + 左右内边距）。
   原来 9 个 tab 平分屏宽，每个仅约 83rpx，3 个字勉强放下、4 个字必然溢出 ⇒ 挤成一团。
   现在每个 tab 按自身文案宽度撑开，配合外层 scroll-view 可横向滑动。 */
.tab { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; height: 82rpx; padding: 0 22rpx; color: #888; font-size: 26rpx; border-bottom: 4rpx solid transparent; box-sizing: border-box; white-space: nowrap; }
.tab.active { color: #222; border-color: #222; font-weight: 700; }
.list { flex: 1; min-height: 0; padding: 20rpx 24rpx; box-sizing: border-box; }
.order-card { margin-bottom: 20rpx; padding: 26rpx 30rpx; background: #fff; border-radius: 16rpx; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.card-title { color: #303030; font-size: 30rpx; font-weight: 600; max-width: 420rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-status { color: #916448; font-size: 28rpx; flex-shrink: 0; }
.card-time { display: block; margin-top: 8rpx; color: #959595; font-size: 26rpx; }
.logistics { display: flex; align-items: center; margin-top: 20rpx; padding: 14rpx 20rpx; background: rgba(224, 215, 206, 0.27); border-radius: 8rpx; }
.logi-icon { width: 40rpx; height: 40rpx; margin-right: 12rpx; border: 2rpx solid #c9b8a8; border-radius: 50%; flex-shrink: 0; }
.logi-status { color: #000; font-size: 26rpx; font-weight: 600; flex-shrink: 0; }
.logi-remark { flex: 1; min-width: 0; margin-left: 14rpx; color: #959595; font-size: 26rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.logi-arrow { margin-left: 8rpx; color: #959595; font-size: 36rpx; line-height: 1; }
.card-goods { display: flex; margin-top: 24rpx; }
/* ⚠️ 2026-09-29：图区改为「定位容器 + 骨架层 + 实图层」，骨架才叠得上去。
   尺寸与原来的 `.goods-img` 一致，只是从图本身挪到了外层容器上。 */
.goods-img-wrap { position: relative; width: 196rpx; height: 264rpx; flex-shrink: 0; }
.goods-img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: #d8d8d8; border-radius: 8rpx; }
/* 骨架层铺满图区（底色与扫光由全局 `skeleton-shimmer` 提供，见 styles/motion.wxss） */
.goods-img-skeleton { position: absolute; top: 0; left: 0; z-index: 1; width: 100%; height: 100%; border-radius: 8rpx; }
.goods-img.placeholder { background: #d8d8d8; }
.goods-info { display: flex; flex: 1; min-width: 0; flex-direction: column; margin-left: 24rpx; }
.goods-name { color: #0a0a0a; font-size: 28rpx; line-height: 1.4; }
.goods-meta { margin-top: 18rpx; color: #8e8e8e; font-size: 26rpx; }
.goods-price { margin-top: auto; color: #8e8e8e; font-size: 26rpx; }
.card-reject { display: block; margin-top: 16rpx; color: #d40000; font-size: 24rpx; }
.card-actions { display: flex; justify-content: flex-end; gap: 16rpx; margin-top: 24rpx; }
.btn { display: flex; align-items: center; justify-content: center; min-width: 160rpx; height: 52rpx; padding: 0 24rpx; border-radius: 8rpx; font-size: 26rpx; box-sizing: border-box; }
.btn.disabled { opacity: .5; }
.btn.outline { color: #000; border: 2rpx solid #222; }
.btn.primary { color: #916448; background: rgba(192, 172, 155, 0.49); }
.state, .more { padding: 120rpx 0; color: #999; text-align: center; font-size: 26rpx; }.more { padding: 28rpx 0; }
</style>
