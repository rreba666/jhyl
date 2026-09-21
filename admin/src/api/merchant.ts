import { request } from './request'
import type { MerchantCreateDTO, MerchantFilters, MerchantPageResult, MerchantResponse, MerchantVO } from '@/types/merchant'

/** 校验商户接口响应，返回业务数据。 */
function unwrapResponse<T>(response: { data: MerchantResponse<T> }, fallbackMessage: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallbackMessage)
  return result.data as T
}

/** 归一化商户：id 转 string、status 数字兜底。 */
function normalizeMerchant(m: MerchantVO): MerchantVO {
  return {
    ...m,
    id: String(m.id),
    brandId: m.brandId != null ? String(m.brandId) : '',
    brandName: m.brandName || '',
    contactName: m.contactName || '',
    contactPhone: m.contactPhone || '',
    status: Number(m.status) === 2 ? 2 : Number(m.status) === 1 ? 1 : 0,
    shopCount: Number(m.shopCount) || 0,
  }
}

function normalizePage(data: MerchantPageResult): MerchantPageResult {
  return {
    ...data,
    total: Number(data.total) || 0,
    list: (data.list || []).map(normalizeMerchant),
  }
}

/** 查询商户分页列表（keyword 按品牌名模糊，status 过滤）。 */
export async function getMerchants(page: number, pageSize: number, filters?: MerchantFilters): Promise<MerchantPageResult> {
  const params: Record<string, string | number> = { page, pageSize }
  if (filters?.keyword?.trim()) params.keyword = filters.keyword.trim()
  if (filters?.status !== undefined && filters.status !== '') params.status = filters.status
  const response = await request.get<MerchantResponse<MerchantPageResult>>('/api/admin/merchants/list', { params })
  return normalizePage(unwrapResponse(response, '商户列表查询失败'))
}

/** 查询商户详情。 */
export async function getMerchantDetail(id: string): Promise<MerchantVO> {
  const response = await request.get<MerchantResponse<MerchantVO>>(`/api/admin/merchants/${String(id)}`)
  return normalizeMerchant(unwrapResponse(response, '商户详情查询失败'))
}

/** 查询商户下门店列表。 */
export async function getMerchantShops(id: string): Promise<unknown[]> {
  const response = await request.get<MerchantResponse<unknown[]>>(`/api/admin/merchants/${String(id)}/shops`)
  return unwrapResponse(response, '商户门店查询失败')
}

/** 新增商户（品牌商家）。 */
export async function createMerchant(payload: MerchantCreateDTO): Promise<void> {
  const response = await request.post<MerchantResponse<null>>('/api/admin/merchants', payload)
  unwrapResponse(response, '商户创建失败')
}

/** 编辑商户。 */
export async function updateMerchant(id: string, payload: MerchantCreateDTO): Promise<void> {
  const response = await request.put<MerchantResponse<null>>(`/api/admin/merchants/${String(id)}`, payload)
  unwrapResponse(response, '商户更新失败')
}

/**
 * 启用/停用商户（/status）。
 *
 * ⚠️ 后端契约（2026-09-21 实测确证）：`status=2`（停用品牌，入驻场景即「驳回申请」）时
 * **`remark` 必填**，不传直接报 `code=1001 驳回/停用品牌必须填写审核意见（remark）`；
 * 该 remark 会写回申请单，商家在小程序「我的入驻申请」里以 `auditRemark` 看到驳回原因。
 * `status=1`（启用）不需要 remark。
 * 老实现只发 `status`，导致后台「驳回」按钮**点了必然报错**、商家也永远看不到原因。
 */
export async function toggleMerchantStatus(id: string, status: 1 | 2, remark?: string): Promise<void> {
  const response = await request.put<MerchantResponse<null>>(`/api/admin/merchants/${String(id)}/status`, null, {
    params: remark ? { status, remark } : { status },
  })
  unwrapResponse(response, '商户状态更新失败')
}
