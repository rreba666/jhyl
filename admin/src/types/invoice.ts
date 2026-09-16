export type InvoiceType = 1 | 2
export type InvoiceStatus = 0 | 1 | 2 | 4

/** 后台发票申请列表记录。 */
export interface AdminInvoice {
  id: string
  userId: string
  userNickname: string
  userPhone: string
  type: InvoiceType
  personalName?: string
  companyName?: string
  taxNo?: string
  email: string
  amount: number
  orderIds: string
  status: InvoiceStatus
  statusDesc: string
  invoiceNo?: string
  adminRemark?: string
  createTime: string
  updateTime: string
}

/** 后台发票详情中的商品明细。 */
export interface AdminInvoiceOrderItem {
  orderNo: string
  productName: string
  specs?: string
  price: number
  quantity: number
  subtotal: number
}

export interface AdminInvoiceDetail extends AdminInvoice {
  orderItems: AdminInvoiceOrderItem[]
}

export interface AdminInvoiceFilters {
  status: '' | InvoiceStatus
}

export interface AdminInvoicePageResult {
  total: number
  list: AdminInvoice[]
  page: number
  pageSize: number
}

export interface AdminInvoiceProcessDTO {
  invoiceNo: string
  adminRemark?: string
}

export interface InvoiceResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
