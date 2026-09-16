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
}

/** 查询 C 端可选的启用门店。 */
export function getEnabledShops(): Promise<EnabledShop[]> {
  return request<EnabledShop[]>({ url: '/api/shop/all', method: 'GET' })
}
