import { request } from './request'

/** 商品品牌（后台）。 */
export interface AdminGoodsBrand {
  id: number
  name: string
  logo?: string
  categoryId?: number
  sortOrder?: number
  enabled?: number
  description?: string
  remark?: string
  createTime?: string
  updateTime?: string
}

/** 商品品牌分页。 */
export interface AdminGoodsBrandPage {
  total: number
  list: AdminGoodsBrand[]
  page: number
  pageSize: number
}

/** 商品品牌保存入参。 */
export interface AdminGoodsBrandSaveDTO {
  name: string
  logo?: string
  categoryId?: number | null
  sortOrder?: number
  enabled?: number
  description?: string
  remark?: string
}

/** 品牌查询参数。 */
export interface AdminGoodsBrandQuery {
  keyword?: string
  categoryId?: number | string
  enabled?: number | string
  page?: number
  pageSize?: number
}

interface BrandResponse<T> {
  code: number
  message: string
  data?: T
  success?: boolean
}

/** 统一校验品牌接口的业务响应，失败抛错。 */
function ensureSuccess<T>(result: BrandResponse<T>, fallbackMessage: string): T {
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallbackMessage)
  return result.data as T
}

/** 查询品牌分页列表（含禁用品牌）。 */
export async function getAdminGoodsBrands(params: AdminGoodsBrandQuery = {}): Promise<AdminGoodsBrandPage> {
  const response = await request.get<BrandResponse<AdminGoodsBrandPage>>('/api/admin/goods-brand/list', { params })
  return ensureSuccess(response.data, '品牌列表查询失败')
}

/** 查询品牌详情（编辑回显）。 */
export async function getAdminGoodsBrandDetail(id: number | string): Promise<AdminGoodsBrand> {
  const response = await request.get<BrandResponse<AdminGoodsBrand>>(`/api/admin/goods-brand/detail/${id}`)
  return ensureSuccess(response.data, '品牌详情查询失败')
}

/** 新增品牌。 */
export async function createAdminGoodsBrand(payload: AdminGoodsBrandSaveDTO): Promise<void> {
  const response = await request.post<BrandResponse<null>>('/api/admin/goods-brand', payload)
  ensureSuccess(response.data, '品牌新增失败')
}

/** 修改品牌（只更新传入字段）。 */
export async function updateAdminGoodsBrand(id: number | string, payload: Partial<AdminGoodsBrandSaveDTO>): Promise<void> {
  const response = await request.put<BrandResponse<null>>(`/api/admin/goods-brand/${id}`, payload)
  ensureSuccess(response.data, '品牌修改失败')
}

/** 品牌启用 / 禁用。 */
export async function toggleAdminGoodsBrand(id: number | string, enabled: number): Promise<void> {
  const response = await request.put<BrandResponse<null>>(`/api/admin/goods-brand/${id}/enabled`, null, { params: { enabled } })
  ensureSuccess(response.data, '品牌状态修改失败')
}

/** 软删除品牌。 */
export async function deleteAdminGoodsBrand(id: number | string): Promise<void> {
  const response = await request.delete<BrandResponse<null>>(`/api/admin/goods-brand/${id}`)
  ensureSuccess(response.data, '品牌删除失败')
}

/** 上传品牌 logo（复用主页文件上传接口，返回 OSS 地址）。 */
export async function uploadGoodsBrandLogo(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await request.post<BrandResponse<string>>('/api/admin/homepage/upload', formData)
  const url = ensureSuccess(response.data, '品牌 logo 上传失败')
  if (!url) throw new Error('品牌 logo 上传未返回地址')
  return url
}
