/** 后端订单状态码：0-7 常规状态，8 已核销。 */
export type OrderStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export type OrderDeleteFlag = 0 | 1
/** 配送方式：0=物流配送 / 1=线下自提 / 2=同城配送（LonPin 同城上线后会出现 2）。 */
export type OrderPickupType = 0 | 1 | 2

export interface OrderItem {
  id: string
  productName: string
  skuName: string
  skuSpecs: string
  price: number
  quantity: number
  subtotal: number
  productImage?: string
}

/** 后台订单列表返回的数据结构。 */
export interface Order {
  id: string
  orderNo: string
  status: OrderStatus
  statusDesc: string
  payAmount: number
  totalQuantity: number
  firstProductImage: string
  /** 第一件商品名称（下单时快照；后端 2026-09-15 新增，列表商品列直接展示）。 */
  firstProductName?: string
  /**
   * 按 `pickupType` 派生的状态展示名（后端 2026-09-15 新增，**推荐直接使用**）：
   * 物流 1→待发货 / 自提 1→待核销 / 同城 1→履约中；`0/5/7` 三类一致。
   */
  statusTextByType?: string
  createTime: string
  delFlag: OrderDeleteFlag
  pickupType: OrderPickupType
  /** 自提门店名称（pickup_type=1 时有值，物流订单为 null）。 */
  shopName?: string
  /** 买家微信昵称。 */
  buyerName?: string
  /** 买家手机号（B 端后台明文）。 */
  buyerPhone?: string
  /** 微信发货信息上报状态：0 未上报 / 1 已上报 / 2 失败 / 3 无需上报（超 7 天或退款关闭）。 */
  wxShippingStatus?: number
  /** 上报失败/豁免原因（`status=2/3` 时有值）。 */
  wxShippingErrmsg?: string
  /** 最近一次上报成功时间。 */
  wxShippingUploadTime?: string
}

/** 后台订单详情返回的数据结构。 */
export interface OrderDetail extends Order {
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  totalAmount: number
  discountAmount: number
  freightAmount: number
  items: OrderItem[]
  expressCompany?: string
  expressNo?: string
  payTime?: string
  shipTime?: string
  completeTime?: string
  /** 自提码（自提订单支付后生成，用于到店核销）。 */
  pickupCode?: string
  /** 自提门店 ID。 */
  pickupShopId?: string
}

export interface OrderPageResult {
  total: number
  list: Order[]
  page: number
  pageSize: number
}

export interface OrderQueryParams {
  page: number
  pageSize: number
  /** 后端支持重复的 statuses 查询参数，可同时筛选多个订单状态。 */
  statuses?: OrderStatus[]
  pickupType?: OrderPickupType
  startTime?: string
  endTime?: string
  /** 订单号筛选（精确匹配，后端 /api/admin/order/list 支持）。 */
  orderNo?: string
  /** 微信发货上报状态筛选（2026-09-15 新增）：0 未上报 / 1 已上报 / 2 失败 / 3 无需上报；不传=全部。 */
  wxShippingStatus?: number
}

export interface OrderAddressUpdateDTO {
  receiverName: string
  receiverPhone: string
  receiverAddress: string
}

export interface OrderShipDTO {
  expressCompany: string
  expressCompanyCode: string
  expressNo: string
}

/** 客服人工退款请求参数，原因允许为空但最长 200 个字符。 */
export interface OrderRefundDTO {
  reason?: string | null
}

/** 物流轨迹节点，后端返回顺序即为展示顺序。 */
export interface TraceItem {
  time: string
  context: string
}

/** 快递查询结果；无物流数据时接口 data 为 null。 */
export interface ExpressTrace {
  com: string
  nu: string
  state: string
  stateDesc: string
  isCheck: 0 | 1
  traces: TraceItem[]
}

/** 自提码核销请求参数。 */
export interface ManualVerifyDTO {
  code: string
}

/** 手动重试微信发货上报的返回（《微信发货信息与服务通知直达》§3.2）。 */
export interface WxShippingRetryResult {
  orderId?: number
  /** 是否真的调用了微信（已上报过则为 false）。 */
  called?: boolean
  success?: boolean
  /** 结果说明：已上报微信 / 该订单已上报过，未重复调用微信 / 失败原因 / 跳过原因。 */
  message?: string
  wxShippingStatus?: number
  wxShippingStatusDesc?: string
  wxShippingErrmsg?: string
  wxShippingUploadTime?: string
}

export interface OrderResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
