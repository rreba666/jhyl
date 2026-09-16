import type { PaginationResult } from './common'

/** 售后单状态码 → 中文名。 */
export const AFTER_SALE_STATUS: Record<number, string> = {
  0: '待审核',
  1: '已驳回',
  2: '退款中',
  3: '已退款',
  4: '待寄回',
  5: '待收货',
}

/** 售后类型码 → 中文名。 */
export const AFTER_SALE_TYPE: Record<number, string> = {
  1: '仅退款',
  2: '退货退款',
}

/** 门店核实状态码 → 中文名（0 未转核实 / 1 待门店核实 / 2 已核实）。 */
export const MERCHANT_VERIFY_STATUS: Record<number, string> = {
  0: '未转核实',
  1: '待门店核实',
  2: '已核实',
}

/** 售后单（对应 AdminAfterSaleVO）。 */
export interface AdminAfterSale {
  id: string
  afterSaleNo: string
  userId: string
  userNickname: string
  userPhone: string
  orderId: string
  orderNo: string
  type: number
  typeDesc: string
  reason: string
  evidenceUrls: string
  refundAmount: number
  status: number
  statusDesc: string
  rejectReason: string
  refundNo: string
  returnExpressCompany: string
  returnExpressNo: string
  shipTime: string
  receiveTime: string
  createTime: string
  updateTime: string
  /** 门店核实状态：0 未转核实 / 1 待门店核实（此时可回填意见）/ 2 已核实。 */
  merchantVerifyStatus?: number
  /** 门店核实意见（已核实时展示）。 */
  merchantVerifyOpinion?: string
  /** 门店核实时间。 */
  merchantVerifyTime?: string
}

/** 售后单分页结果。 */
export type AfterSalePage = PaginationResult<AdminAfterSale> & { page: number; pageSize: number }

/** 售后单接口响应包装。 */
export interface AfterSaleResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
