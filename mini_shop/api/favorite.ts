import { request } from '@/utils/request'

/** 收藏状态（收藏/取消收藏接口返回）。 */
export interface FavoriteStatus {
  favorite: boolean
}

/** 收藏列表项（对应后端 ProductFavoriteVO）。 */
export interface ProductFavorite {
  /** 商品 ID（int64，JSON 序列化为字符串，前端按 string 处理） */
  id: string
  name: string
  mainImage: string
  /** 商品最低价（元） */
  minPrice: number
  /** 展示价（元，当前与最低价同值） */
  price: number
  /** 划线价/原价（元），纯展示，为 null 表示无划线价。 */
  originalPrice?: number
  /** 兼容字段：部分接口返回 minOriginalPrice。 */
  minOriginalPrice?: number
  /** 已售数量 */
  soldCount: number
  /** 收藏时间（yyyy-MM-dd HH:mm:ss） */
  favoriteTime: string
}

/** 收藏列表分页结果。 */
export interface FavoritePageResult {
  total: number
  list: ProductFavorite[]
  page: number
  pageSize: number
}

/** 收藏商品（幂等）。 */
export function favoriteProduct(productId: number | string): Promise<FavoriteStatus> {
  return request<FavoriteStatus>({ url: `/api/product/favorite/${productId}`, method: 'POST' })
}

/** 取消收藏（幂等）。 */
export function unfavoriteProduct(productId: number | string): Promise<FavoriteStatus> {
  return request<FavoriteStatus>({ url: `/api/product/favorite/${productId}`, method: 'DELETE' })
}

/** 分页查询我的收藏列表（按收藏时间倒序）。 */
export async function getFavoriteList(params: { page?: number; pageSize?: number } = {}): Promise<FavoritePageResult> {
  const query = `page=${encodeURIComponent(String(params.page || 1))}&pageSize=${encodeURIComponent(String(params.pageSize || 10))}`
  const result = await request<FavoritePageResult>({ url: `/api/product/favorite/list?${query}`, method: 'GET' })
  // 后端 id 为 int64，JSON 序列化为字符串，确保前端统一按 string 处理
  return {
    ...result,
    list: (result.list || []).map((item) => ({ ...item, id: String(item.id) })),
  }
}
