import { request } from './request'
import type { AdminAfterSale, AfterSalePage, AfterSaleResponse } from '@/types/after-sale'

function unwrap<T>(response: { data: AfterSaleResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 把后端可能序列化为字符串的 Long 字段统一转成字符串，金额转数字。 */
function normalizeAfterSale(value: unknown): AdminAfterSale {
  const row = (value || {}) as Record<string, unknown>
  return {
    ...(row as unknown as AdminAfterSale),
    id: String(row.id ?? ''),
    userId: String(row.userId ?? ''),
    orderId: String(row.orderId ?? ''),
    type: Number(row.type ?? 0),
    status: Number(row.status ?? 0),
    refundAmount: Number(row.refundAmount ?? 0),
    afterSaleNo: String(row.afterSaleNo ?? ''),
    orderNo: String(row.orderNo ?? ''),
    typeDesc: String(row.typeDesc ?? ''),
    statusDesc: String(row.statusDesc ?? ''),
    createTime: String(row.createTime ?? ''),
  }
}

function normalizePage(value: unknown, page: number, pageSize: number): AfterSalePage {
  const raw = (value || {}) as Record<string, unknown>
  const list = Array.isArray(raw.list) ? raw.list : []
  return { total: Number(raw.total ?? list.length) || 0, page: Number(raw.page ?? page) || page, pageSize: Number(raw.pageSize ?? pageSize) || pageSize, list: list.map(normalizeAfterSale) }
}

export interface AfterSaleListParams {
  page: number
  size: number
  status?: number
  type?: number
}

/** 分页查询售后单列表，支持状态/类型筛选。 */
export async function getAfterSaleList(params: AfterSaleListParams): Promise<AfterSalePage> {
  const query: Record<string, string | number> = { page: params.page, pageSize: params.size }
  if (params.status !== undefined) query.status = params.status
  if (params.type !== undefined) query.type = params.type
  const data = unwrap(await request.get<AfterSaleResponse<unknown>>('/api/admin/after-sale/list', { params: query }), '售后单列表查询失败')
  return normalizePage(data, params.page, params.size)
}

/** 审核通过：仅退款触发退款，退货退款进入待寄回。 */
export async function approveAfterSale(id: string, type?: number): Promise<void> {
  const body = type !== undefined ? { type } : {}
  unwrap(await request.post<AfterSaleResponse<null>>(`/api/admin/after-sale/${id}/approve`, body), '售后审核通过失败')
}

/** 审核驳回：待审核(0)→已驳回(1)。 */
export async function rejectAfterSale(id: string, rejectReason?: string): Promise<void> {
  const params: Record<string, string> = {}
  if (rejectReason) params.rejectReason = rejectReason
  unwrap(await request.post<AfterSaleResponse<null>>(`/api/admin/after-sale/${id}/reject`, null, { params }), '售后驳回失败')
}

/** 收货质检（仅退货退款）：PASS→回补库存+退款，FAIL→驳回。 */
export async function receiveAfterSale(id: string, result: 'PASS' | 'FAIL', rejectReason?: string): Promise<void> {
  const body: Record<string, string> = { result }
  if (result === 'FAIL' && rejectReason) body.rejectReason = rejectReason
  unwrap(await request.post<AfterSaleResponse<null>>(`/api/admin/after-sale/${id}/receive`, body), '收货质检失败')
}

/** 售后单详情（含门店核实信息）。 */
export async function getAfterSaleDetail(id: string): Promise<AdminAfterSale> {
  const data = unwrap(await request.get<AfterSaleResponse<unknown>>(`/api/admin/after-sale/detail/${id}`), '售后详情查询失败')
  return normalizeAfterSale(data)
}

/** 中控「转门店核实」：merchant_verify_status 0→1，由门店回填核实意见。 */
export async function requestShopVerify(id: string): Promise<void> {
  unwrap(await request.post<AfterSaleResponse<null>>(`/api/admin/after-sale/${id}/request-shop-verify`, null), '转门店核实失败')
}

/**
 * 门店/商户管理员回填核实意见（本次新增接口，与商家端同名）。
 * 仅当 `merchantVerifyStatus=1`（待门店核实）时可提交；意见必填、最长 500 字。
 */
export async function verifyAfterSale(id: string, opinion: string): Promise<void> {
  unwrap(await request.post<AfterSaleResponse<null>>(`/api/admin/after-sale/${id}/verify`, { opinion }), '门店核实意见提交失败')
}
