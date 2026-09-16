import { request } from '@/utils/request'

export type InvoiceType = 1 | 2
export type InvoiceStatus = 0 | 1 | 2 | 4

export interface InvoiceSubmitDTO {
  type: InvoiceType
  personalName?: string
  companyName?: string
  taxNo?: string
  email: string
  orderIds: string
}

export interface InvoiceRequest {
  id: number | string
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
  createTime: string
  updateTime: string
}

export interface InvoicePageResult {
  total: number
  list: InvoiceRequest[]
  page: number
  pageSize: number
}

/** 提交发票申请，金额由后端根据订单实付金额计算。 */
export function submitInvoice(data: InvoiceSubmitDTO): Promise<InvoiceRequest> {
  return request<InvoiceRequest>({ url: '/api/invoice/submit', method: 'POST', data })
}

/** 查询当前用户的发票申请记录。 */
export function getInvoiceList(page = 1, pageSize = 10): Promise<InvoicePageResult> {
  return request<InvoicePageResult>({ url: `/api/invoice/list?page=${page}&pageSize=${pageSize}`, method: 'GET' })
}

/** 查询当前用户的发票申请详情。 */
export function getInvoiceDetail(id: number | string): Promise<InvoiceRequest> {
  return request<InvoiceRequest>({ url: `/api/invoice/detail/${id}`, method: 'GET' })
}
