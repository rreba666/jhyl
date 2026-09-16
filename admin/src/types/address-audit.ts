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
