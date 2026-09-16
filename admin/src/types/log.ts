export interface VerifyLog {
  id: string
  orderId: string
  orderNo: string
  pickupCode: string
  /** 操作人类型：STAFF=店员核销，ADMIN=管理员手工核销。 */
  operatorType: string
  staffId: string
  staffName: string
  shopId: string
  shopName: string
  verifyType: number
  verifyTime: string
}

export interface AuditLog {
  id: string
  operatorType: string
  operatorId: string
  operatorName: string
  operation: string
  targetType: string
  targetId: string
  detail: string
  ipAddress: string
  userAgent: string
  createTime: string
}

export interface LogPageResult<T> {
  total: number
  list: T[]
  page: number
  pageSize: number
}

export interface VerifyLogQueryParams {
  startTime?: string
  endTime?: string
  staffId?: string
  orderNo?: string
  page: number
  pageSize: number
}

export interface AuditLogQueryParams {
  operation?: string
  operatorType?: string
  startTime?: string
  endTime?: string
  page: number
  pageSize: number
}

export interface LogResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
