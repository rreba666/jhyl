import { request } from '@/utils/request'

export interface EnabledShop {
  id: number
  name: string
  address: string
  phone?: string
  status?: number
  createTime?: string
  /** 营业时间（如 06:00-23:00） */
  openTime?: string
  /** 纬度（点地图时调 uni.openLocation 导航） */
  latitude?: number
  /** 经度 */
  longitude?: number
  /**
   * 该门店是否开通同城配送（`/api/shop/all` 实际会返回，用于「同城配送」时过滤可发货门店）。
   * 注意可空：老接口/未配置时按「不排除」处理（`!== false` 才展示）。
   */
  deliveryEnabled?: boolean
}

/** 查询 C 端可选的启用门店。 */
export function getEnabledShops(): Promise<EnabledShop[]> {
  return request<EnabledShop[]>({ url: '/api/shop/all', method: 'GET' })
}

/**
 * 按商品筛选**可配送门店**（C 端公开）。
 *
 * 后端摘要原文：「按商品筛选可配送门店（C端公开）」—— 依据是**门店-SKU 关联**，
 * 所以入参是 `skuIds` 而不是 `productId`（门店商品按 SKU 维护）。
 *
 * ⚠️ **同城配送必须用这个接口**，不能用 `getEnabledShops()`：后者是「全部启用门店」，
 * 会把没有该商品的门店也列出来，用户选完到下单才被后端拒。
 * 自提（`pickupType=1`）仍然用 `getEnabledShops()` —— 门店级 `deliveryEnabled`
 * 只影响同城，不影响自提。
 *
 * @param skuIds 订单里商品的 SKU 集合；为空时不带该参数（退化为后端默认口径）。
 *   传参用逗号分隔：Spring 的 `@RequestParam List<Long>` 对
 *   `?skuIds=1,2` 与 `?skuIds=1&skuIds=2` 都收，逗号能让请求行更短。
 */
export function getDeliverableShops(skuIds?: Array<number | string>): Promise<EnabledShop[]> {
  const ids = (skuIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
  const query = ids.length ? `?skuIds=${ids.join(',')}` : ''
  return request<EnabledShop[]>({ url: `/api/shop/deliverable${query}`, method: 'GET' })
}
