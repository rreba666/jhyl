import { request } from './request'

/** 运营配送域统一响应包装。 */
interface DeliveryResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

/** 校验业务响应并取 data。 */
function unwrap<T>(response: { data: DeliveryResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 履约报表（`GET /api/admin/delivery/report`）。 */
export interface DeliveryReportVO {
  totalTasks?: number
  deliveredTasks?: number
  exceptionTasks?: number
  /** 送达率（0~1 或百分比，按后端返回原样展示）。 */
  deliveryRate?: number
  /** 异常率。 */
  exceptionRate?: number
  /** 平均接单时长（分钟）。 */
  avgAcceptMinutes?: number
  /** 平均备货时长（分钟）。 */
  avgPrepareMinutes?: number
  /** 平均配送时长（分钟）。 */
  avgDeliveryMinutes?: number
}

/** 同城订单视图（`GET /api/admin/delivery/orders`）。 */
export interface DeliveryOrderView {
  id?: number
  orderNo?: string
  userId?: number
  status?: number
  /** 配送状态（如 PENDING/ASSIGNED/ACCEPTED/DELIVERING/DELIVERED/EXCEPTION…）。 */
  deliveryStatus?: string
  receiverName?: string
  receiverPhone?: string
  receiverAddress?: string
  goodsAmount?: number
  deliveryFee?: number
  payAmount?: number
  createTime?: string
  payTime?: string
}

/** 配送费配置实体（`DeliveryFeeConfigEntity`）。 */
export interface DeliveryFeeConfig {
  id?: number
  merchantId?: number
  /** FIXED（固定） / DISTANCE_STEP（阶梯）。 */
  feeType?: string
  /** JSON 字符串，如 {"fixedFee":5.0} 或 {"fixedFee":3.0,"distanceStep":{"freeKm":3,"perKmFee":1.0}}。 */
  feeConfig?: string
  enabled?: number
  remark?: string
  operatorId?: number
  createTime?: string
  updateTime?: string
}

/** 退款单视图（`RefundOrderView`）。 */
export interface DeliveryRefundView {
  refundNo?: string
  orderNo?: string
  userId?: number
  merchantId?: number
  refundType?: string
  applyAmount?: number
  goodsRefundAmount?: number
  deliveryFeeRefundAmount?: number
  deductAmount?: number
  approvedAmount?: number
  status?: string
  reason?: string
  paymentRefundNo?: string
  retryCount?: number
  failureReason?: string
  createTime?: string
}

/** 配送事件（节点时间轴 `DeliveryEventEntity`）。 */
export interface DeliveryEvent {
  id?: number
  orderNo?: string
  taskNo?: string
  eventType?: string
  operatorType?: string
  operatorId?: number
  latitude?: number
  longitude?: number
  accuracy?: number
  locationText?: string
  remark?: string
  proofId?: number
  occurredAt?: string
  createTime?: string
  requestId?: string
}

/** 骑手业绩（后端返回动态结构：传 riderId=单人明细，不传=全平台排行）。 */
export type RiderStats = Record<string, unknown> | Array<Record<string, unknown>>

// ===== 1. 配送总开关 =====

/** 查询配送总开关（true=允许新订单配送）。 */
export async function getMasterSwitch(): Promise<boolean> {
  return Boolean(unwrap(await request.get<DeliveryResponse<boolean>>('/api/admin/delivery/master-switch'), '配送总开关查询失败'))
}

/** 设置配送总开关：关闭后新下单同城配送直接拒绝（在途订单不受影响）。 */
export async function setMasterSwitch(enabled: boolean): Promise<void> {
  unwrap(await request.post<DeliveryResponse<null>>('/api/admin/delivery/master-switch', { enabled }), '配送总开关保存失败')
}

// ===== 2. 配送费配置 =====

/** 查询配送费配置：merchantId 传 0/不传=全局默认；传门店ID=额外返回覆盖与最终生效 effective。 */
export async function getFeeConfig(merchantId?: number | string): Promise<Record<string, unknown>> {
  const params = merchantId === undefined || merchantId === '' ? undefined : { merchantId }
  return unwrap(await request.get<DeliveryResponse<Record<string, unknown>>>('/api/admin/delivery/fee-config', { params }), '配送费配置查询失败')
}

/** 保存配送费配置（唯一写入口）；merchantId>0 表示给该门店设置覆盖价。 */
export async function saveFeeConfig(payload: {
  merchantId?: number
  feeType: string
  feeConfig: string
  enabled?: number
  remark?: string
}): Promise<DeliveryFeeConfig> {
  return unwrap(await request.post<DeliveryResponse<DeliveryFeeConfig>>('/api/admin/delivery/fee-config', payload), '配送费配置保存失败')
}

// ===== 3. 履约报表 =====

/** 查询履约报表（可按商家与时间范围）。 */
export async function getDeliveryReport(params: { merchantId?: number | string; startTime?: string; endTime?: string } = {}): Promise<DeliveryReportVO> {
  const query: Record<string, string | number> = {}
  if (params.merchantId !== undefined && params.merchantId !== '') query.merchantId = params.merchantId
  if (params.startTime) query.startTime = params.startTime
  if (params.endTime) query.endTime = params.endTime
  return unwrap(await request.get<DeliveryResponse<DeliveryReportVO>>('/api/admin/delivery/report', { params: query }), '履约报表查询失败')
}

// ===== 4. 同城订单 =====

/** 查询同城订单（可按商家、配送状态筛选）。 */
export async function getDeliveryOrders(params: { merchantId?: number | string; deliveryStatus?: string } = {}): Promise<DeliveryOrderView[]> {
  const query: Record<string, string | number> = {}
  if (params.merchantId !== undefined && params.merchantId !== '') query.merchantId = params.merchantId
  if (params.deliveryStatus) query.deliveryStatus = params.deliveryStatus
  const data = unwrap(await request.get<DeliveryResponse<DeliveryOrderView[]>>('/api/admin/delivery/orders', { params: query }), '同城订单查询失败')
  return Array.isArray(data) ? data : []
}

/**
 * 运营/客服**代商家审核**用户取消申请（`CANCEL_REQUESTED` 订单的兜底通道）。
 * - `approve=true`：同意取消 → 订单转 CANCELLED + 按快照 `cancel_fee_policy` 扣费后退款 + 停止配送任务；
 * - `approve=false`：驳回 → 恢复申请前的配送状态、任务回到原节点继续履约（**reason 必填**，会写入配送事件给用户看）。
 * 门店由订单自动带出，无需 `shopId`；仅认处于 `CANCEL_REQUESTED` 的订单。
 */
export async function auditDeliveryCancel(orderNo: string, approve: boolean, reason?: string): Promise<void> {
  unwrap(
    await request.post<DeliveryResponse<null>>(`/api/admin/delivery/orders/${encodeURIComponent(orderNo)}/cancel-audit`, { approve, reason: reason || undefined }),
    '取消申请审核失败',
  )
}

// ===== 5. 骑手业绩 =====

/** 查询骑手业绩：range=DAY|WEEK|MONTH|ALL；传 riderId=单人明细，不传=全平台排行。 */
export async function getRiderStats(params: { riderId?: number | string; range?: string } = {}): Promise<RiderStats> {
  const query: Record<string, string | number> = {}
  if (params.riderId !== undefined && params.riderId !== '') query.riderId = params.riderId
  if (params.range) query.range = params.range
  return unwrap(await request.get<DeliveryResponse<RiderStats>>('/api/admin/delivery/rider-stats', { params: query }), '骑手业绩查询失败')
}

// ===== 6. 退款单 =====

/** 查询退款单（可按订单号、状态）。 */
export async function getDeliveryRefunds(params: { orderNo?: string; status?: string } = {}): Promise<DeliveryRefundView[]> {
  const query: Record<string, string> = {}
  if (params.orderNo && params.orderNo.trim()) query.orderNo = params.orderNo.trim()
  if (params.status) query.status = params.status
  const data = unwrap(await request.get<DeliveryResponse<DeliveryRefundView[]>>('/api/admin/delivery/refunds', { params: query }), '退款单查询失败')
  return Array.isArray(data) ? data : []
}

// ===== 7. 任务干预 + 时间轴 =====

/** 运营强制改派骑手（ASSIGNED/ACCEPTED/配送中均可）。 */
export async function reassignTask(taskId: number | string, payload: { newPersonId: number | string; requestId?: string }): Promise<void> {
  unwrap(await request.post<DeliveryResponse<null>>(`/api/admin/delivery/tasks/${taskId}/reassign`, payload), '改派失败')
}

/** 人工回退任务节点（每次只回退最近一步，需填原因）。 */
export async function rollbackTask(taskId: number | string, reason: string): Promise<void> {
  unwrap(await request.post<DeliveryResponse<null>>(`/api/admin/delivery/tasks/${taskId}/rollback`, { reason }), '回退失败')
}

/** 解锁收货码（错 5 次锁定 10 分钟后由客服解锁）。 */
export async function unlockTaskCode(taskId: number | string): Promise<void> {
  unwrap(await request.post<DeliveryResponse<null>>(`/api/admin/delivery/tasks/${taskId}/unlock-code`, null), '解锁收货码失败')
}

/** 查询任务节点时间轴（按 taskNo）。 */
export async function getTaskTimeline(taskNo: string): Promise<DeliveryEvent[]> {
  const data = unwrap(await request.get<DeliveryResponse<DeliveryEvent[]>>(`/api/admin/delivery/tasks/${encodeURIComponent(taskNo)}/timeline`), '节点时间轴查询失败')
  return Array.isArray(data) ? data : []
}
