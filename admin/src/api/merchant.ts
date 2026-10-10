import { request } from './request'
import type {
  MerchantCommissionRateLog,
  MerchantCreateDTO,
  MerchantFilters,
  MerchantPageResult,
  MerchantResponse,
  MerchantUpdateDTO,
  MerchantVO,
} from '@/types/merchant'

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

/**
 * 归一化一条让利比例变更记录：只把两个 long 型 ID 转成 string。
 *
 * ⚠️ **刻意不动 `beforeRate` / `afterRate` / `direction` / `operatorType`**：
 *    - `beforeRate` 契约未标可空（文档示例暗示"变更前"可能缺失）⇒ 保持原样（可能是 `null` /
 *      键被省略 = `undefined`），渲染层按缺失显示「未设置」——**任何 `?? 0` / `|| 0` 都是编造数据**；
 *    - `direction` / `operatorType` 契约**没有枚举** ⇒ 原样透传，不在 API 层做任何翻译/裁剪。
 */
function normalizeCommissionRateLog(log: MerchantCommissionRateLog): MerchantCommissionRateLog {
  return {
    ...log,
    id: log.id != null ? String(log.id) : '',
    merchantId: log.merchantId != null ? String(log.merchantId) : '',
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

/**
 * 编辑商户。
 *
 * ⚠️ 2026-09-30：payload 类型由 `MerchantCreateDTO` 更正为 **`MerchantUpdateDTO`** ——
 *    契约里 `PUT /api/admin/merchants/{id}` 的 body 本来就是后者（只含 brandName/contactName/
 *    contactPhone/remark/**commissionRate**），前者还带着注册专用字段（brandId 等）。
 *    只有改用正确类型，`commissionRate` 才在类型层面被允许传入。
 */
export async function updateMerchant(id: string, payload: MerchantUpdateDTO): Promise<void> {
  const response = await request.put<MerchantResponse<null>>(`/api/admin/merchants/${String(id)}`, payload)
  unwrapResponse(response, '商户更新失败')
}

/**
 * 查询商户**让利比例变更历史**。
 *
 * 契约（2026-10-10 复核 `api_doc.json`）：
 * - `GET /api/admin/merchants/{id}/commission-rate-history`，**无 body**；
 * - 唯一查询参数 `limit`（int32，**可选，默认 20、最大 200**）；
 * - ⚠️ **没有分页** —— 契约里不存在 `page` / `pageSize` / `total`，本函数也**不伪造**它们；
 * - 200 → `ResultListMerchantCommissionRateLogEntity`，**按时间倒序**；
 *   契约写明 `data` 无数据时为 `null`（字段始终存在）⇒ 这里按空数组处理，不当成错误。
 *
 * ⚠️ 返回条数达到 `limit` 时**不代表数据完整**（更早的记录没有分页可翻）——
 *    「是否可能被截断」由调用方按 `limit` 自行提示，本函数不做任何"这是全部"的暗示。
 */
export async function getMerchantCommissionRateHistory(
  id: string,
  limit?: number,
): Promise<MerchantCommissionRateLog[]> {
  const response = await request.get<MerchantResponse<MerchantCommissionRateLog[]>>(
    `/api/admin/merchants/${String(id)}/commission-rate-history`,
    // ⚠️ 不传 limit 时**不带该参数**（让后端用它自己的默认值 20），而不是由前端补一个猜出来的值
    { params: limit == null ? {} : { limit } },
  )
  const data = unwrapResponse(response, '让利比例变更历史查询失败')
  return (data ?? []).map(normalizeCommissionRateLog)
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
