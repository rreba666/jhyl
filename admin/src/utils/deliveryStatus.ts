/**
 * 同城配送「订单配送状态」中文映射（后端 `wx_order.delivery_status` 枚举）。
 *
 * 来源：《同城配送与角色体系.md》§6.5 状态机 ——
 * `WAIT_ACCEPT 待接单 → ACCEPTED 已接单 → PREPARING 备货中 → WAIT_ASSIGN 待安排配送 → ASSIGNED 已分配 →
 *  PICKED_UP 已取货 → DELIVERING 配送中 → NEARBY 已到达附近 → DELIVERED 已送达 → COMPLETED 已完成`；
 * 旁支：`CANCELLED / CANCEL_REQUESTED / EXCEPTION`。
 *
 * ⚠️ 别和**骑手任务状态**（`delivery_tasks.status`：`PENDING/ASSIGNED/ACCEPTED/PICKED_UP/DELIVERING/NEARBY/DELIVERED/EXCEPTION/CANCELLED/PAUSED`）
 * 混用：后台「同城订单」列表查的是**订单**的 `deliveryStatus`，骑手工作台才是任务状态。
 */
export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  WAIT_ACCEPT: '待接单',
  ACCEPTED: '已接单',
  PREPARING: '备货中',
  WAIT_ASSIGN: '待安排配送',
  ASSIGNED: '已分配骑手',
  PICKED_UP: '已取货',
  DELIVERING: '配送中',
  NEARBY: '已到达附近',
  DELIVERED: '已送达',
  COMPLETED: '已完成',
  CANCEL_REQUESTED: '取消待审核',
  CANCELLED: '已取消',
  EXCEPTION: '配送异常',
}

/** 下拉选项（按状态机顺序，value=后端枚举，label=中文）。 */
export const DELIVERY_STATUS_OPTIONS: Array<{ value: string; label: string }> = Object.keys(DELIVERY_STATUS_LABELS)
  .map((value) => ({ value, label: DELIVERY_STATUS_LABELS[value] }))

/** 状态 → 中文标签；未知值原样回显（便于排查后端新增枚举），空值显示「—」。 */
export function deliveryStatusLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return DELIVERY_STATUS_LABELS[key] || key
}

/** 状态标签配色（与前端其余页面口径一致：待处理橙、进行中主色、完成灰、异常红）。 */
export function deliveryStatusTagType(value?: string | null): 'primary' | 'success' | 'info' | 'warning' | 'danger' {
  const key = String(value ?? '').trim()
  if (key === 'EXCEPTION') return 'danger'
  if (key === 'CANCEL_REQUESTED' || key === 'WAIT_ACCEPT' || key === 'WAIT_ASSIGN' || key === 'PREPARING') return 'warning'
  if (key === 'DELIVERED' || key === 'COMPLETED') return 'success'
  if (key === 'CANCELLED') return 'info'
  return 'primary'
}

/**
 * **骑手任务状态**（`delivery_tasks.status`）中文映射 —— 与上面的订单配送状态是两套枚举，别混用。
 * 商户端「配送工作台 → 配送任务」表用的是这一套。
 */
export const TASK_STATUS_LABELS: Record<string, string> = {
  PENDING: '待接单',
  ASSIGNED: '已派单待接受',
  ACCEPTED: '已接单待取货',
  PICKED_UP: '已取货',
  DELIVERING: '配送中',
  NEARBY: '已到达附近',
  DELIVERED: '已送达',
  EXCEPTION: '配送异常',
  // 后端历史拼写不统一：`CANCELLED`（骑手端）与 `CANCELED`（商户端任务）都要兼容
  CANCELLED: '已取消',
  CANCELED: '已取消',
  PAUSED: '已暂停',
}

/** 任务状态 → 中文标签；未知值原样回显，空值显示「—」。 */
export function taskStatusLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return TASK_STATUS_LABELS[key] || key
}

/** 任务状态 → 标签配色。 */
export function taskStatusTagType(value?: string | null): 'primary' | 'success' | 'info' | 'warning' | 'danger' {
  const key = String(value ?? '').trim()
  if (key === 'DELIVERED') return 'success'
  if (key === 'CANCELLED' || key === 'CANCELED') return 'info'
  if (key === 'EXCEPTION') return 'danger'
  if (key === 'PAUSED' || key === 'WAIT_ASSIGN' || key === 'PENDING') return 'warning'
  return 'primary'
}

/** 指派方式（`assignment_type`）：商家自送 / 指定配送员 / 发布领取。 */
export const ASSIGNMENT_TYPE_LABELS: Record<string, string> = {
  MERCHANT_SELF: '商家自送',
  ASSIGN_TO_PERSON: '指定配送员',
  PUBLISH_CLAIM: '发布领取（骑手抢单）',
}

/** 指派方式 → 中文标签；未知值原样回显。 */
export function assignmentTypeLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return ASSIGNMENT_TYPE_LABELS[key] || key
}

/** 配送事件节点（`delivery_events.eventType`，V1.18 落库枚举）。 */
export const DELIVERY_EVENT_LABELS: Record<string, string> = {
  // 订单 / 商家侧
  ORDER_CREATED: '下单',
  MERCHANT_ACCEPTED: '商家接单',
  MERCHANT_REJECTED: '商家拒单',
  PREPARING: '开始备货',
  READY_FOR_DELIVERY: '备货完成',
  ORDER_CANCELLED: '订单取消',
  CANCEL_REQUESTED: '用户申请取消',
  CANCEL_APPROVED: '同意取消',
  CANCEL_REJECTED: '驳回取消',
  REFUND_SUCCESS: '退款成功',
  // 任务 / 骑手侧
  TASK_CREATED: '创建配送任务',
  TASK_ASSIGNED: '派单（指定骑手）',
  TASK_ACCEPTED: '骑手接受指派',
  TASK_REJECTED: '骑手拒绝指派',
  TASK_CLAIMED: '骑手抢单',
  TASK_REASSIGNED: '改派骑手',
  TASK_PAUSED: '任务暂停',
  TASK_RESUMED: '任务恢复',
  TASK_CANCELLED: '任务取消',
  TASK_ADDRESS_SYNCED: '收货地址同步到任务',
  RECEIPT_REJECTED: '用户拒收',
  // 节点 / 位置侧
  PICKED_UP: '已取货',
  DELIVERY_STARTED: '开始配送',
  ARRIVED_NEARBY: '到达附近',
  DELIVERED: '已送达',
  DELIVERY_EXCEPTION: '配送异常上报',
  PICKUP_CODE_VERIFIED: '收货码校验通过',
  NODE_ROLLED_BACK: '人工回退节点',
  DELIVERY_RESUMED: '异常恢复',
  // 用户 / 其它
  PROOF_UPLOADED: '上传送达凭证',
  ADDRESS_CHANGED: '修改收货地址',
  DELIVERY_FEE_ADJUSTED: '配送费调整',
  USER_CONFIRMED: '用户确认收货',
}

/** 配送事件 → 中文标签；未知值原样回显（便于发现后端新增事件）。 */
export function deliveryEventLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return DELIVERY_EVENT_LABELS[key] || key
}

/** 配送费计费方式（`feeType`）。 */
export const FEE_TYPE_LABELS: Record<string, string> = {
  FIXED: '固定运费',
  DISTANCE_STEP: '阶梯运费（按距离）',
}

/** 计费方式 → 中文；未知值原样回显。 */
export function feeTypeLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return FEE_TYPE_LABELS[key] || key
}

/**
 * 退款单类型（`RefundOrderView.refundType`）。
 * ⚠️ 后端 OpenAPI **未给枚举**，这里只收录已见过/约定俗成的值，其余原样回显（已列入后端需求）。
 */
export const REFUND_TYPE_LABELS: Record<string, string> = {
  MERCHANT_REJECT: '商家拒单',
  USER_CANCEL: '用户取消',
  CANCEL_APPROVED: '取消申请通过',
  TIMEOUT: '超时未接单',
  EXCEPTION: '配送异常',
  AFTER_SALE: '售后',
}

/** 退款单类型 → 中文；未知值原样回显。 */
export function refundTypeLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return REFUND_TYPE_LABELS[key] || key
}

/**
 * 退款单状态（`RefundOrderView.status`）。
 * ⚠️ 后端 OpenAPI **未给枚举**，仅实测见过 `SUCCESS`；其余为常见值兜底，未知原样回显（已列入后端需求）。
 */
export const REFUND_STATUS_LABELS: Record<string, string> = {
  PENDING: '待处理',
  PROCESSING: '退款中',
  REFUNDING: '退款中',
  SUCCESS: '退款成功',
  FAILED: '退款失败',
  RETRYING: '重试中',
}

/** 退款单状态 → 中文；未知值原样回显。 */
export function refundStatusLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return REFUND_STATUS_LABELS[key] || key
}

/** 退款单状态 → 标签配色（未知按 info）。 */
export function refundStatusTagType(value?: string | null): 'success' | 'warning' | 'danger' | 'info' {
  const key = String(value ?? '').trim()
  if (key === 'SUCCESS') return 'success'
  if (key === 'FAILED') return 'danger'
  if (key === 'PENDING' || key === 'PROCESSING' || key === 'REFUNDING' || key === 'RETRYING') return 'warning'
  return 'info'
}

/** 骑手业绩接口返回的动态字段名 → 中文表头（未收录的字段回退原 key）。 */
export const RIDER_STATS_COLUMN_LABELS: Record<string, string> = {
  riderId: '骑手 ID',
  riderName: '骑手',
  staffId: '骑手 ID',
  name: '骑手',
  deliveredCount: '送达单量',
  deliveryCount: '送达单量',
  totalDelivered: '送达单量',
  distanceKm: '累计里程(km)',
  totalDistanceKm: '累计里程(km)',
  activeDays: '活跃天数',
  avgPerActiveDay: '日均单量',
  cancelledCount: '取消单量',
  exceptionCount: '异常单量',
  lastDeliveredAt: '最近送达时间',
  firstStatDate: '首次统计日期',
}

/** 骑手业绩列名 → 中文（未知回退原字段名）。 */
export function riderStatsColumnLabel(key: string): string {
  return RIDER_STATS_COLUMN_LABELS[key] || key
}
