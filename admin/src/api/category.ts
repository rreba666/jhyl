import { request } from './request'
import { resolveMediaUrl } from './media'
import type { AdminCategory, AdminCategorySaveDTO, CategoryResponse } from '@/types/category'

/** 校验分类管理接口响应。 */
function unwrapResponse<T>(response: { data: CategoryResponse<T> }, fallbackMessage: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallbackMessage)
  return result.data as T
}

/**
 * 兼容后台分类列表直接返回数组或分页包装结构。
 *
 * ⚠️ **2026-09-30 扁平化**：不再重建 `parentId` / `children` ——
 *    后端「分类是扁平一层、实测无 `parent_id`」，那两个字段是前端臆造的（填了也不生效）。
 */
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
      name: String(raw.name ?? ''),
      icon: resolveMediaUrl(raw.icon),
      sortOrder: Number(raw.sortOrder) || 0,
      enabled: String(raw.enabled ?? raw.status) === '1' ? 1 : 0,
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

// ============================================================================
// 「默认分类」（系统分类）—— 2026-10-03 新增
// ============================================================================

/**
 * 系统分类（「默认分类」）的 ID。
 *
 * 来源：后端《前端对接-商家端商品默认分类-2026-10-03.md》——
 * 商家端保存商品时，若该商品**当前完全没有分类**，后端自动归入 `id = 99901` 的「默认分类」。
 *
 * ⚠️ 该分类是**禁用态**（`status = 0`）⇒ **C 端不展示**、中控「含禁用」**能看到能选**。
 * ⚠️ **不要删除它**：删了商家上架的商品就无法自动归类（后端每日自检报 `INV-11`）。
 */
export const SYSTEM_CATEGORY_ID = '99901'

/** 系统分类的名称（ID 判不出来时按它兜底）。 */
export const SYSTEM_CATEGORY_NAME = '默认分类'

/**
 * 是否「系统分类」（即默认分类）。
 *
 * ⚠️ 判定顺序很关键：
 * 1. **先按 ID**（后端约定 `99901`）—— 最准；
 * 2. **再按名称兜底** —— 万一后端调整了 ID，页面上的「（系统）」标识与防误删**不会同时失效**。
 *
 * 用途：① 分类管理页标「（系统）」并**禁用删除/编辑**；② 商品编辑的分类下拉里加同样标识，
 * 避免运营误以为这是自己建的分类。
 */
export function isSystemCategory(
  category?: { id?: string | number | null; name?: string | null } | null,
): boolean {
  if (!category) return false
  const id = category.id == null ? '' : String(category.id)
  if (id && id === SYSTEM_CATEGORY_ID) return true
  return String(category.name ?? '').trim() === SYSTEM_CATEGORY_NAME
}
