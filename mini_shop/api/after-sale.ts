import { request } from '@/utils/request'

/** 售后单记录（对应 AfterSaleVO）。 */
export interface AfterSaleRecord {
  /** 售后单 ID（Long，后端 JSON 序列化为字符串）。 */
  id: string
  /** 售后单号（AS 开头）。 */
  afterSaleNo: string
  /** 关联订单 ID（字符串）。 */
  orderId: string
  /** 关联订单号。 */
  orderNo: string
  /** 售后类型：1=仅退款，2=退货退款。 */
  type: number
  /** 售后类型描述。 */
  typeDesc: string
  /** 申请原因。 */
  reason: string
  /** 退款金额（元）。 */
  refundAmount: number
  /** 售后单状态：0=待审核,1=已驳回,2=退款中,3=已退款,4=待寄回,5=待收货。 */
  status: number
  /** 状态描述。 */
  statusDesc: string
  /** 驳回原因（审核驳回/质检不通过时返回）。 */
  rejectReason?: string | null
  /** 提交时间。 */
  createTime: string
  /** 最近更新时间。 */
  updateTime?: string | null
}

/** 售后单分页结果。 */
export interface AfterSalePageResult {
  total: number
  list: AfterSaleRecord[]
  page: number
  pageSize: number
}

/** 分页查询当前用户的售后单列表，按提交时间倒序。 */
export function getAfterSaleList(page = 1, pageSize = 10): Promise<AfterSalePageResult> {
  return request<AfterSalePageResult>({
    url: `/api/after-sale/list?page=${encodeURIComponent(String(page))}&pageSize=${encodeURIComponent(String(pageSize))}`,
    method: 'GET',
  })
}

/** 提交售后申请的入参（对应后端 `AfterSaleSubmitDTO`）。 */
export interface AfterSaleSubmitDTO {
  /** 关联订单 ID（Long，JSON 序列化为字符串 ⇒ 前端传 string）。**必填**。 */
  orderId: number | string
  /** 申请原因。**必填**。 */
  reason: string
  /** 凭证图 URL，**逗号分隔**（可空）。 */
  evidenceUrls?: string
}

/**
 * 提交售后申请（`POST /api/after-sale/submit`）。
 *
 * ⚠️⚠️ 2026-10-03 新增（按后端 P1P2 §一.2 的售后窗口新口径）：
 *
 * ## 为什么要单独封装它（而不是复用 `refundOrder`）
 * 后端把两个退款入口分了工（见契约）：
 * | 入口 | 适用状态 | 特点 |
 * |---|---|---|
 * | `POST /api/order/refund/{orderId}` | **仅 PAID**（已支付未发货） | 用户自助 |
 * | **`POST /api/after-sale/submit`**（本接口） | ✅ **已完成等"自助退不到"的状态** | 走售后单，**待审核**、**不会立即退款** |
 * | `POST /api/admin/order/{orderId}/refund` | 已发货/已收货 | **客服代退** |
 *
 * ## ⚠️ 售后窗口新口径（P1P2 §一.2）
 * | 形态 | 可申请售后窗口 |
 * |---|---|
 * | **物流** | **订单完成后 7 天内**（锚点＝确认收货时间，无则完成时间） |
 * | **同城** | **订单完成后 7 天内** |
 * | **自提** | 支付后 30 天内，且**核销后一律不可退** |
 *
 * ⇒ ⚠️ **两处变化**：① **已完成（COMPLETED）的订单现在也可以申请售后**（旧逻辑"完成即不可申请"）；
 *    ② 物流/同城的窗口从「支付后 7 天」改为「**完成后 7 天**」。
 *
 * ⚠️ **窗口由后端判定**，前端**不做**本地时间判断（避免两边口径漂移）：
 * 超期时后端返回 `8703`，⚠️ **文案已由后端更正**为「订单完成已超过7天…」⇒ 前端**直接展示后端原文**即可
 * （本项目**未**硬编码 8703 文案）。
 *
 * ⚠️ **售后类型由后端按订单内商品标签推导**，**不由用户选择**，故本接口不传 type。
 */
export function submitAfterSale(data: AfterSaleSubmitDTO): Promise<AfterSaleRecord | void> {
  return request<AfterSaleRecord | void>({ url: '/api/after-sale/submit', method: 'POST', data })
}
