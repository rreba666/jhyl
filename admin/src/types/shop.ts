export type ShopStatus = 0 | 1
export type ShopDeleteFlag = 0 | 1

/** 后台门店列表记录。 */
export interface Shop {
  id: string
  name: string
  address: string
  phone: string
  status: ShopStatus
  delFlag: ShopDeleteFlag
  createTime: string
  /** 所属商户（商户管理员登录时为本人商户；平台/客服可见）。 */
  merchantId?: number
  merchantName?: string
  /** 门店状态（0 待启用 / 1 启用 / 2 停用）——来自商家端 C1（门店 + 统计）口径。 */
  shopStatus?: number
  /** 店长数 / 骑手数 / 已绑定微信用户数（v8 §6.1 C1 统计；需后端在门店列表返回）。 */
  managerCount?: number
  riderCount?: number
  boundUserCount?: number
}

export interface ShopCreateDTO {
  name: string
  address: string
  phone: string
}

export type ShopUpdateDTO = ShopCreateDTO

export interface ShopPageResult {
  total: number
  list: Shop[]
  page: number
  pageSize: number
}

export interface ShopResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
