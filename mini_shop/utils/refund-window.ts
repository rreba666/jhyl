/**
 * 退款窗口计算（下单/支付时间 → 能否「秒退」）。
 *
 * ## 背景（2026-09-21）
 * 姊妹项目「今华有肽」的订单页有「秒退」：**支付后 30 分钟内**可免人工审核、立即原路退款
 * （后端接口 `POST /api/order/refund/fast/{orderId}`）。LonPin 后端**同样有这个接口**
 * （`api_doc.json` 摘要「秒退（已支付未发货，免人工审核）」），但小程序此前**零调用**
 * —— 本文件就是把这个窗口判断抽出来，给订单列表与订单详情共用。
 *
 * ## ✅ 字段现状（2026-09-22 更新）
 * 判断窗口要用**支付完成时间** `payTime`：
 * - **订单详情**接口下发 `payTime`；
 * - **订单列表**接口**也已补上** `payTime`（2026-09-22 实测：列表项字段里已有该字段、与详情同值）
 *   —— 这正是我方 2026-09-21 提的需求，后端已实现。
 *
 * 因此下面 `paidAtMs()` 里的 `createTime` 兜底**已不再是必需的**，保留它只是**防御**：
 * 万一某个出口/历史数据没下发 `payTime`，窗口判断也不至于直接失效（退回用下单时间近似）。
 * 将来若确认所有出口都稳定下发，可以把兜底那两行删掉。
 */
import type { OrderSummary } from '@/api/order'

/** 秒退窗口：**支付后 30 分钟内**可秒退（立即退款、原路退回、免人工审核）。 */
export const FAST_REFUND_WINDOW_MS = 30 * 60 * 1000

/** 解析后端下发的时间串（`yyyy-MM-dd HH:mm:ss` 或 ISO），失败返回 `NaN`。 */
export function parseTimeMs(value: string | null | undefined): number {
  if (!value) return NaN
  // 后端两种格式都出现过：`2026-09-21 14:29:21` 与 `2026-09-21T14:29:21` —— 统一成 ISO 再 parse
  return Date.parse(String(value).replace(' ', 'T'))
}

/**
 * 取这笔订单的「起算时间」（毫秒）：
 * - 优先 `payTime`（**详情与列表都已下发**，语义上正是"支付后 30 分钟"）；
 * - 退回 `createTime` 只是**防御**（见文件头"字段现状"），正常情况下走不到这里。
 * 两者都拿不到时返回 `NaN`，调用方按"不可秒退"处理（保守，宁可不给入口也不要让用户点了报错）。
 */
export function paidAtMs(order: Pick<OrderSummary, 'payTime' | 'createTime'> | null | undefined): number {
  if (!order) return NaN
  const paid = parseTimeMs(order.payTime)
  if (Number.isFinite(paid)) return paid
  return parseTimeMs(order.createTime)
}

/**
 * 是否可「秒退」：订单已支付且未发货/未核销（`status === 1`），且距起算时间 ≤ 30 分钟。
 *
 * ⚠️ 这里**只判窗口**，不判其它退款前置（如"已有处理中售后单"）——
 * 那些由页面自己的状态决定（LonPin 两页都会在有处理中售后单时把按钮换成「售后中」）。
 */
export function canFastRefund(order: Pick<OrderSummary, 'status' | 'payTime' | 'createTime'> | null | undefined): boolean {
  if (!order || Number(order.status) !== 1) return false
  const start = paidAtMs(order)
  if (!Number.isFinite(start)) return false
  return Date.now() - start <= FAST_REFUND_WINDOW_MS
}

/**
 * 秒退按钮的剩余可用时间文案（如「剩余 12 分钟」），已过期返回空串。
 * 用于让用户知道"现在不点就没了"——秒退比人工退款快得多，值得提示。
 */
export function fastRefundRemainingText(order: Pick<OrderSummary, 'status' | 'payTime' | 'createTime'> | null | undefined): string {
  if (!canFastRefund(order)) return ''
  const left = FAST_REFUND_WINDOW_MS - (Date.now() - paidAtMs(order))
  const minutes = Math.max(0, Math.ceil(left / 60000))
  return minutes > 0 ? `剩余 ${minutes} 分钟` : ''
}

/**
 * 同城配送单「已过履约进度闸门」的 `deliveryStatus` 取值（秒退通道已关闭）。
 *
 * 依据《前端变更说明·秒退与退款口径》（2026-09-22）：
 * `WAIT_ASSIGN`（**= 备货完成/已出餐**）/ `ASSIGNED`（已派单）/ `PICKED_UP`（已取货）/
 * `DELIVERING`（配送中）/ `NEARBY`（即将送达）/ `EXCEPTION`（异常）⇒ 一律不可秒退，后端返回 `2013`。
 * 可秒退的只有：`WAIT_ACCEPT` / `ACCEPTED` / `PREPARING` / `CANCELLED`。
 */
export const FAST_REFUND_CLOSED_DELIVERY_STATUSES: readonly string[] = [
  'WAIT_ASSIGN',
  'ASSIGNED',
  'PICKED_UP',
  'DELIVERING',
  'NEARBY',
  'EXCEPTION',
]

/**
 * 同城单是否已过履约闸门（过了就不该再给「立即退款」入口）。
 *
 * ⚠️⚠️ **`deliveryStatus` 在两个端点里不是同一个东西**（这是本批最容易踩的坑）：
 * | 端点 | 类型 | 含义 | 同城单取值 |
 * |---|---|---|---|
 * | 订单**详情** | `String` | **同城履约进度枚举** | `WAIT_ACCEPT` / `WAIT_ASSIGN` / … |
 * | 订单**列表** | `Integer` | **物流发货状态**（0 已发货 / 1 已送达，仅物流单有值） | **恒为 `null`** |
 *
 * 所以这里**三重限定**：① `pickupType === 2`（同城才走闸门，物流/自提不受影响）；
 * ② `deliveryStatus` 必须是**非空字符串**（挡掉列表页的 Integer / null）；
 * ③ 命中关闭取值。
 * 任一条不满足 ⇒ 返回 `false`（= **未关闭**）⇒ 页面继续显示「立即退款」，
 * 真的被后端拦下时由 `2013` 分支给出提示（列表页正是靠这个降级）。
 */
export function isFastRefundGateClosed(
  order: Pick<OrderSummary, 'pickupType' | 'deliveryStatus'> | null | undefined,
): boolean {
  if (!order) return false
  if (Number(order.pickupType) !== 2) return false
  const status = order.deliveryStatus
  if (typeof status !== 'string' || !status) return false
  return FAST_REFUND_CLOSED_DELIVERY_STATUSES.includes(status)
}
