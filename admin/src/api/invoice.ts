import { request } from './request'
import type { AdminInvoice, AdminInvoiceDetail, AdminInvoiceFilters, AdminInvoicePageResult, AdminInvoiceProcessDTO, InvoiceResponse } from '@/types/invoice'

function unwrap<T>(response: { data: InvoiceResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 只接受后端文档定义的发票状态，避免未知值被误显示为待处理。 */
function normalizeStatus(value: unknown): AdminInvoice['status'] {
  const status = Number(value)
  return status === 1 || status === 2 || status === 4 ? status : 0
}

/** 兼容后端分页返回 list/records 两种字段，并保护 BIGINT 标识。 */
function normalizePage(value: unknown, page: number, pageSize: number): AdminInvoicePageResult {
  const raw = (value || {}) as Record<string, unknown>
  const source = Array.isArray(raw.list) ? raw.list : Array.isArray(raw.records) ? raw.records : []
  return {
    total: Number(raw.total ?? source.length) || 0,
    page: Number(raw.page ?? raw.current ?? page) || page,
    pageSize: Number(raw.pageSize ?? raw.size ?? pageSize) || pageSize,
    list: source.map((item) => {
      const row = item as Partial<AdminInvoice>
      return {
        ...row,
        id: String(row.id ?? ''),
        userId: String(row.userId ?? ''),
        userNickname: String(row.userNickname ?? ''),
        userPhone: String(row.userPhone ?? ''),
        type: Number(row.type) === 2 ? 2 : 1,
        amount: Number(row.amount ?? 0),
        orderIds: String(row.orderIds ?? ''),
        status: normalizeStatus(row.status),
        statusDesc: String(row.statusDesc ?? ''),
        createTime: String(row.createTime ?? ''),
        updateTime: String(row.updateTime ?? ''),
      } as AdminInvoice
    }),
  }
}

/** 查询后台发票申请列表。 */
export async function getAdminInvoices(params: { page: number; pageSize: number } & AdminInvoiceFilters): Promise<AdminInvoicePageResult> {
  const response = await request.get<InvoiceResponse<unknown>>('/api/admin/invoice/list', {
    params: { page: params.page, pageSize: params.pageSize, ...(params.status === '' ? {} : { status: params.status }) },
  })
  return normalizePage(unwrap(response, '发票列表查询失败'), params.page, params.pageSize)
}

/** 查询后台发票申请详情及商品明细。 */
export async function getAdminInvoiceDetail(id: string): Promise<AdminInvoiceDetail> {
  const response = await request.get<InvoiceResponse<AdminInvoiceDetail>>(`/api/admin/invoice/detail/${id}`)
  const detail = unwrap(response, '发票详情查询失败')
  return { ...detail, id: String(detail.id), userId: String(detail.userId), orderItems: detail.orderItems || [] }
}

/** 标记发票已发送。 */
export async function processAdminInvoice(id: string, payload: AdminInvoiceProcessDTO): Promise<void> {
  unwrap(await request.put<InvoiceResponse<null>>(`/api/admin/invoice/${id}/process`, payload), '发票处理失败')
}

/** 确认待红冲发票已完成红冲，将状态更新为已作废。 */
export async function confirmRedFlushAdminInvoice(id: string): Promise<void> {
  unwrap(await request.put<InvoiceResponse<null>>(`/api/admin/invoice/${id}/confirm-red-flush`), '确认红冲失败')
}
