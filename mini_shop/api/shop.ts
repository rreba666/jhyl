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
