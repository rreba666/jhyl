import { request } from './request'
import { resolveMediaUrl } from './media'
import type { AdminCategory, AdminCategorySaveDTO, CategoryResponse } from '@/types/category'

/** 校验分类管理接口响应。 */
function unwrapResponse<T>(response: { data: CategoryResponse<T> }, fallbackMessage: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallbackMessage)
  return result.data as T
}

/** 兼容后台分类列表直接返回数组或分页包装结构。 */
function normalizeList(value: unknown): AdminCategory[] {
  const source = Array.isArray(value)
    ? value
    : Array.isArray((value as { list?: unknown } | null)?.list)
      ? (value as { list: unknown[] }).list
      : []
  return source.map((item) => {
    const raw = item as Partial<AdminCategory> & { status?: number | string }
    return {
      id: String(raw.id ?? ''),
      parentId: String(raw.parentId ?? '0'),
      name: String(raw.name ?? ''),
      icon: resolveMediaUrl(raw.icon),
      sortOrder: Number(raw.sortOrder) || 0,
      enabled: String(raw.enabled ?? raw.status) === '1' ? 1 : 0,
      children: Array.isArray(raw.children) ? normalizeList(raw.children) : [],
    }
  })
}

/** 查询后台分类列表，包含禁用分类。 */
export async function getAdminCategories(): Promise<AdminCategory[]> {
  const response = await request.get<CategoryResponse<unknown>>('/api/admin/category/list')
  return normalizeList(unwrapResponse(response, '分类列表查询失败'))
}

/** 新增后台分类。 */
export async function createAdminCategory(payload: AdminCategorySaveDTO): Promise<void> {
  const response = await request.post<CategoryResponse<null>>('/api/admin/category', payload)
  unwrapResponse(response, '分类新增失败')
}

/** 修改后台分类。 */
export async function updateAdminCategory(id: string, payload: AdminCategorySaveDTO): Promise<void> {
  const response = await request.put<CategoryResponse<null>>(`/api/admin/category/${id}`, payload)
  unwrapResponse(response, '分类修改失败')
}

/** 软删除后台分类。 */
export async function deleteAdminCategory(id: string): Promise<void> {
  const response = await request.delete<CategoryResponse<null>>(`/api/admin/category/${id}`)
  unwrapResponse(response, '分类删除失败')
}
