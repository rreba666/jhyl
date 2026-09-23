export type ShopStatus = 0 | 1
export type ShopDeleteFlag = 0 | 1

/** 后台门店列表记录。 */
export interface Shop {
  id: string
  name: string
  address: string
  /** 门店纬度（GCJ-02 火星坐标，与小程序端一致）。后端 ShopVO / ShopCreateDTO / ShopUpdateDTO 均已提供。 */
  latitude?: number
  /** 门店经度（GCJ-02）。同城配送按门店坐标算距离。 */
  longitude?: number
  phone: string
  status: ShopStatus
  delFlag: ShopDeleteFlag
  createTime: string
  /** 所属商户（商户管理员登录时为本人商户；平台/客服可见）。 */
  merchantId?: number
  merchantName?: string
  /**
   * 经营联系人电话（`ShopVO.contactPhone`）。
   * 订单通知的**短信通道**取号顺序是 `phone` → 为空回退本字段；
   * 两个都空时后端记 outbox「商家门店无手机号」，短信发不出去。
   */
  contactPhone?: string
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
  /** 门店纬度（GCJ-02 火星坐标，与小程序端一致）。后端 ShopVO / ShopCreateDTO / ShopUpdateDTO 均已提供。 */
  latitude?: number
  /** 门店经度（GCJ-02）。同城配送按门店坐标算距离。 */
  longitude?: number
  phone: string
  /**
   * 所属品牌商家 ID（V1.17 新增）。
   * 新增门店：中控为品牌开店时必填，平台自营单店可空；
   * 编辑门店：**不传 = 不改归属**，传了 = 改到该品牌。
   * 门店 `merchant_id` 为空时，商家端商品管理会报 `7310 该门店未归属品牌商家`。
   */
  merchantId?: number | string
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
