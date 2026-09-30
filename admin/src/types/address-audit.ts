/** 地址修改申请状态：0=待审核，1=已通过，2=已拒绝。 */
export type AddressAuditStatus = 0 | 1 | 2

/** 订单地址修改申请（对应 OrderAddressChangeRequestVO）。 */
export interface OrderAddressChangeRequest {
  id: string
  orderId: string
  orderNo: string
  userId: string
  oldReceiverName: string
  oldReceiverPhone: string
  oldReceiverAddress: string
  newReceiverName: string
  newReceiverPhone: string
  newReceiverAddress: string
  reason: string
  status: AddressAuditStatus
  rejectReason: string
  reviewedBy: string
  reviewedAt: string
  createTime: string
  /**
   * 配送形态：0=物流 / 1=自提 / 2=同城配送。
   * ⚠️ 2026-09-30 补录：契约 `OrderAddressChangeRequestVO` 一直有该字段，但前端归一化漏掉了
   * ⇒ 审核员**无法识别这是自提单还是同城单**（两者的地址含义不同，审核判断会失准）。
   * ⚠️ 订单不存在或已删时为 `null`。本次**只补类型与归一化**，未改界面。
   */
  pickupType: number | null
  /** 配送形态文案（物流/自提/同城配送）；未知为 `null`。 */
  pickupTypeText: string | null
}

/** 地址修改申请分页结果。 */
export interface AddressAuditPageResult {
  total: number
  list: OrderAddressChangeRequest[]
  page: number
  pageSize: number
}

/** 地址审核列表筛选条件。 */
export interface AddressAuditFilters {
  status: AddressAuditStatus | ''
  orderNo: string
}

/** 地址审核接口响应包装。 */
export interface AddressAuditResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
