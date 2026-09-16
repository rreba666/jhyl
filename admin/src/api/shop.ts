import { request } from './request'
import type { Shop, ShopCreateDTO, ShopDeleteFlag, ShopPageResult, ShopResponse, ShopStatus, ShopUpdateDTO } from '@/types/shop'

function unwrap<T>(response: { data: ShopResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 兼容 MyBatis-Plus records 分页和后台统一 list 分页结构。 */
function normalizePage(value: unknown, page: number, pageSize: number): ShopPageResult {
  const raw = (value || {}) as Record<string, unknown>
  const records = Array.isArray(raw.records) ? raw.records : Array.isArray(raw.list) ? raw.list : Array.isArray(value) ? value : []
  return {
    total: Number(raw.total ?? records.length) || 0,
    page: Number(raw.current ?? raw.page ?? page) || page,
    pageSize: Number(raw.size ?? raw.pageSize ?? pageSize) || pageSize,
    list: records.map((item) => {
      const shop = item as Partial<Shop>
      const delFlag: ShopDeleteFlag = Number(shop.delFlag) === 1 ? 1 : 0
      return { ...shop, id: String(shop.id ?? ''), status: Number(shop.status) === 1 ? 1 : 0, delFlag } as Shop
    }),
  }
}

/** 查询门店分页列表。keyword 纯数字按门店 ID 精确匹配，否则按门店名称模糊匹配。 */
export async function getShops(page: number, pageSize: number, keyword?: string): Promise<ShopPageResult> {
  const params: Record<string, string | number> = { page, pageSize }
  if (keyword && keyword.trim()) params.keyword = keyword.trim()
  const response = await request.get<ShopResponse<unknown>>('/api/admin/shop/list', { params })
  return normalizePage(unwrap(response, '门店列表查询失败'), page, pageSize)
}

/**
 * 查询门店下拉数据。
 * - `includeDisabled=false`（默认）：仅启用门店；商户管理员登录时后端只返回本商户门店；
 * - `includeDisabled=true`：含**禁用**门店（给禁用门店配置营业时间/门店商品时用；`all` 系列永不含软删除）。
 */
export async function getEnabledShops(includeDisabled = false): Promise<Shop[]> {
  const response = await request.get<ShopResponse<unknown>>('/api/admin/shop/all', {
    params: includeDisabled ? { includeDisabled: 'true' } : undefined,
  })
  const value = unwrap(response, '启用门店查询失败')
  const list = Array.isArray(value) ? value : ((value as { list?: unknown[] })?.list || [])
  return list.map((item) => {
    const shop = item as Partial<Shop>
    const delFlag: ShopDeleteFlag = Number(shop.delFlag) === 1 ? 1 : 0
    return { ...shop, id: String(shop.id ?? ''), status: Number(shop.status) === 1 ? 1 : 0, delFlag } as Shop
  })
}

/** 新增门店。 */
export async function createShop(payload: ShopCreateDTO): Promise<void> {
  unwrap(await request.post<ShopResponse<null>>('/api/admin/shop', payload), '门店新增失败')
}

/** 修改门店。 */
export async function updateShop(id: string, payload: ShopUpdateDTO): Promise<void> {
  unwrap(await request.put<ShopResponse<null>>(`/api/admin/shop/${id}`, payload), '门店修改失败')
}

/** 切换门店启用状态。 */
export async function updateShopStatus(id: string, status: ShopStatus): Promise<void> {
  unwrap(await request.put<ShopResponse<null>>(`/api/admin/shop/${id}/status`, null, { params: { status } }), '门店状态更新失败')
}

/** 软删除门店。 */
export async function deleteShop(id: string): Promise<void> {
  unwrap(await request.delete<ShopResponse<null>>(`/api/admin/shop/${id}`), '门店删除失败')
}

/** 恢复已删除门店。 */
export async function restoreShop(id: string): Promise<void> {
  unwrap(await request.put<ShopResponse<null>>(`/api/admin/shop/${id}/restore`), '门店恢复失败')
}
