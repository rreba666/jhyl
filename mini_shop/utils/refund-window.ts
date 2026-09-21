/**
 * 退款窗口计算（下单/支付时间 → 能否「秒退」）。
 *
 * ## 背景（2026-09-21）
 * 姊妹项目「今华有肽」的订单页有「秒退」：**支付后 30 分钟内**可免人工审核、立即原路退款
 * （后端接口 `POST /api/order/refund/fast/{orderId}`）。LonPin 后端**同样有这个接口**
 * （`api_doc.json` 摘要「秒退（已支付未发货，免人工审核）」），但小程序此前**零调用**
 * —— 本文件就是把这个窗口判断抽出来，给订单列表与订单详情共用。
 *
 * ## ⚠️ 一个已知的字段缺口（重要）
 * 判断窗口要用**支付完成时间** `payTime`：
 * - **订单详情**接口会下发 `payTime`（实测 `"payTime":"2026-09-21T14:29:21"`）；
 * - **订单列表**接口**不返回** `payTime`（2026-09-21 实测确认）。
 *
 * 所以列表页只能用 `createTime`（下单时间）**近似** —— 下单到支付通常只隔几十秒，
 * 对 30 分钟的窗口影响可忽略；但严格来说两者不完全等价。
 * **已记入待办：建议后端在订单列表接口补 `payTime` 字段**，届时把 `paidAtMs()` 的兜底去掉即可。
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
 * - 优先 `payTime`（详情接口有，语义上正是"支付后 30 分钟"）；
 * - 列表接口没有 `payTime` → 退回 `createTime` 近似（见文件头说明）。
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
