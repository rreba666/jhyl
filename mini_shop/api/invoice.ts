import { request } from '@/utils/request'

export type InvoiceType = 1 | 2
/**
 * 发票处理状态（对齐后端：0 待处理 / 1 已发送 / 2 待红冲 / **3 已驳回** / 4 已作废）。
 *
 * ⚠️ 2026-09-30：补上 **`3`（已驳回）** —— 后端本次新增该状态，`admin` 侧已同步
 * （见 `admin/src/types/invoice.ts`），C 端此前漏改 ⇒ 状态标签配色会走错分支
 * （文案本身靠 `statusDesc` 尚正确，故此前未被发现）。
 */
export type InvoiceStatus = 0 | 1 | 2 | 3 | 4

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
