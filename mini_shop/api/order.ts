import { request } from '@/utils/request'

export type OrderStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
/**
 * 配送地址草稿的 storage key。
 * 「配送地址」独立页面（`subpkg-order/address/edit`）保存后写这里，确认订单页读取并清空。
 */
export const ADDRESS_DRAFT_KEY = 'payment_address_draft'
/** 配送方式：0=物流 1=线下自提 2=同城配送（占位，本期不开放下单）。 */
export type PickupType = 0 | 1 | 2
/** 地址修改申请状态：0=待审核，1=已通过，2=已拒绝。 */
export type AddressChangeRequestStatus = 0 | 1 | 2

export interface OrderItemDTO {
  skuId: number
  quantity: number
}

export interface CreateOrderDTO {
  cartIds?: number[]
  items?: OrderItemDTO[]
  receiverName?: string
  receiverPhone?: string
  receiverAddress?: string
  /** 收货地址省 / 市 / 区（地址簿或前端解析上送；同城配送下单需要完整地址）。 */
  receiverProvince?: string
  receiverCity?: string
  receiverDistrict?: string
  /** 收货地址纬度（GCJ-02）——**同城配送必填**，前端定位获取。 */
  receiverLat?: number
  /** 收货地址经度（GCJ-02）——**同城配送必填**。 */
  receiverLng?: number
  remark?: string
  pickupType: PickupType
  pickupShopId?: number
  /** 发货门店 ID（**同城配送必填**：后端 `OrderCreateDTO.merchantId` 即发货门店）。 */
  merchantId?: number
}

export interface OrderSummary {
  id: number
  orderNo: string
  status: OrderStatus
  statusDesc: string
  payAmount: number
  /** 商品总额（原价合计，元），支付页小计展示。 */
  totalAmount?: number
  /** 减免额（优惠券抵扣，元），支付页优惠券行展示。 */
  discountAmount?: number
  totalQuantity: number
  firstProductImage: string
  createTime: string
  pickupType: PickupType
  buyerName?: string
  buyerPhone?: string
  shopName?: string
  /** 收货人姓名（物流订单，待后端在列表接口补字段） */
  receiverName?: string
  /** 收货人电话（物流订单） */
  receiverPhone?: string
  /** 收货地址（物流订单） */
  receiverAddress?: string
  /** 商品明细列表（列表接口补字段后展示设计稿商品卡片） */
  items?: OrderDetailItem[]
  /**
   * 配送费（元）。
   * ⚠️ 后端在订单详情/列表里这个字段**恒为 0**，真实运费看下面的 `deliveryFee`
   * （2026-09-19 实测：同一单 `freightAmount=0.00` 而 `deliveryFee=5.00`，`payAmount` 也是含运费的）。
   */
  freightAmount?: number
  /** 配送费（元，**权威字段**）：真实运费，订单详情/列表都会下发。 */
  deliveryFee?: number
  /** 支付截止时间（格式 yyyy-MM-dd HH:mm:ss，仅待付款订单有值，前端据此倒计时） */
  payExpireTime?: string
  /**
   * **支付完成时间**（`yyyy-MM-dd HH:mm:ss`）。
   * ⚠️ 字段缺口（2026-09-21 实测）：**订单详情接口会下发，订单列表接口不返回**。
   * 前端用它判断「秒退」窗口（支付后 30 分钟内），列表页暂时退回 `createTime` 近似
   * —— 详见 `utils/refund-window.ts` 文件头，那里也记了"建议后端在列表补该字段"。
   */
  payTime?: string
  /** 第一件商品名（列表卡片标题，待后端在列表接口补字段） */
  firstProductName?: string
  /**
   * 送达状态：**物流订单是数字**（0=已发货(运输中) / 1=已送达(待确认收货)）；
   * **同城配送订单是字符串**（配送节点，如 `DELIVERED` / `COMPLETED`）。
   * 两个形态口径不同，判断前务必先看 `pickupType`（2026-09-19 全流程实测）。
   */
  deliveryStatus?: number | string
}

export interface OrderDetailItem {
  productName?: string
  productImage?: string
  skuName?: string
  price?: number
  quantity?: number
  subtotal?: number
}

export interface OrderDetail extends OrderSummary {
  remark?: string
  pickupShopId?: number
  pickupStatus?: number
  /** 自提码（12 位，自提订单支付后生成，用于到店核销）。 */
  pickupCode?: string
  /** 自提二维码内容（形如 {PICKUP_BASE_URL}?c=自提码），前端据此生成二维码。 */
  pickupUrl?: string
}

/** C 端提交订单地址修改申请的请求体。 */
export interface AddressChangeRequestDTO {
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  reason?: string
}

/** 订单地址修改申请详情，兼容后端 BIGINT 字段的字符串序列化。 */
export interface OrderAddressChangeRequest {
  id: string
  orderId: string
  orderNo: string
  userId: string
  oldReceiverName: string
  oldReceiverPhone: string
  oldReceiverAddress: string
  newReceiverName: string
  newReceiverPhone: string
  newReceiverAddress: string
  reason: string
  status: AddressChangeRequestStatus
  rejectReason: string
  reviewedBy: string
  reviewedAt: string
  createTime: string
}

/** 自提二维码信息（独立接口 GET /api/order/pickup-code/{orderId} 返回）。 */
export interface PickupCodeVO {
  pickupType: PickupType
  status: OrderStatus
  pickupCode: string | null
  pickupUrl: string | null
  pickupTime: string | null
}

/** 将后端历史配置生成的 API 域名改为店员核销 H5 域名。 */
export function normalizePickupUrl(pickupUrl: string | null): string | null {
  if (!pickupUrl) return pickupUrl
  return pickupUrl.replace(
    /^https?:\/\/api\.jinhuayou365\.com(?=\/pickup(?:[/?#]|$))/i,
    'https://cqcode.jinhuayou365.com',
  )
}

export interface OrderPageResult {
  total: number
  list: OrderSummary[]
  page: number
  pageSize: number
}

export interface CreateOrderResult {
  id?: number | string
  orderId?: number | string
  orderNo?: string
}

/** 创建订单，购物车结算时传 cartIds，直接购买时传 items。 */
export function createOrder(data: CreateOrderDTO): Promise<CreateOrderResult> {
  return request<CreateOrderResult>({ url: '/api/order/create', method: 'POST', data })
}

/** 查询当前用户订单列表，支持多状态筛选（后端 statuses 数组参数）与配送方式筛选。 */
export function getOrderList(params: { page?: number; pageSize?: number; statuses?: OrderStatus[]; pickupType?: PickupType } = {}): Promise<OrderPageResult> {
  const query = [
    `page=${encodeURIComponent(String(params.page || 1))}`,
    `pageSize=${encodeURIComponent(String(params.pageSize || 10))}`,
  ]
  if (params.statuses && params.statuses.length) {
    for (const status of params.statuses) query.push(`statuses=${encodeURIComponent(String(status))}`)
  }
  if (params.pickupType !== undefined) query.push(`pickupType=${encodeURIComponent(String(params.pickupType))}`)
  return request<OrderPageResult>({ url: `/api/order/list?${query.join('&')}`, method: 'GET' })
}

/** 查询订单详情。 */
export function getOrderDetail(orderId: number | string): Promise<OrderDetail> {
  return request<OrderDetail>({ url: `/api/order/detail/${orderId}`, method: 'GET' })
}

/** 获取自提二维码信息（独立接口，核销/退款/超期关闭后 pickupCode 置 null）。 */
export function getPickupCode(orderId: number | string): Promise<PickupCodeVO> {
  return request<PickupCodeVO>({ url: `/api/order/pickup-code/${orderId}`, method: 'GET' }).then((data) => ({
    ...data,
    pickupUrl: normalizePickupUrl(data.pickupUrl),
  }))
}

/** 将后端返回的地址申请字段归一化，避免 BIGINT 和可空文本影响页面渲染。 */
function normalizeAddressChangeRequest(data: OrderAddressChangeRequest): OrderAddressChangeRequest {
  const text = (value: unknown): string => value == null ? '' : String(value)
  const status = Number(data.status)
  return {
    ...data,
    id: text(data.id),
    orderId: text(data.orderId),
    orderNo: text(data.orderNo),
    userId: text(data.userId),
    oldReceiverName: text(data.oldReceiverName),
    oldReceiverPhone: text(data.oldReceiverPhone),
    oldReceiverAddress: text(data.oldReceiverAddress),
    newReceiverName: text(data.newReceiverName),
    newReceiverPhone: text(data.newReceiverPhone),
    newReceiverAddress: text(data.newReceiverAddress),
    reason: text(data.reason),
    status: (status === 1 || status === 2 ? status : 0) as AddressChangeRequestStatus,
    rejectReason: text(data.rejectReason),
    reviewedBy: text(data.reviewedBy),
    reviewedAt: text(data.reviewedAt),
    createTime: text(data.createTime),
  }
}

/** 查询当前用户指定订单最新的一条地址修改申请。 */
export function getAddressChangeRequest(orderId: number | string): Promise<OrderAddressChangeRequest | null> {
  return request<OrderAddressChangeRequest | null>({
    url: `/api/order/${orderId}/address-change-request`,
    method: 'GET',
  }).then((data) => data ? normalizeAddressChangeRequest(data) : null)
}

/** 提交订单地址修改申请，审核通过前不会改变订单地址。 */
export function submitAddressChangeRequest(orderId: number | string, data: AddressChangeRequestDTO): Promise<void> {
  return request<void>({
    url: `/api/order/${orderId}/address-change-request`,
    method: 'POST',
    data,
  })
}

/** 取消待支付订单。 */
export function cancelOrder(orderId: number | string): Promise<void> {
  return request<void>({ url: `/api/order/cancel/${orderId}`, method: 'POST' })
}

/** 确认收货，仅物流订单使用。 */
export function receiveOrder(orderId: number | string): Promise<void> {
  return request<void>({ url: `/api/order/receive/${orderId}`, method: 'POST' })
}

/** 申请订单退款（**人工审核**：提交后进入售后单流程，客服审核通过才到账）。 */
export function refundOrder(orderId: number | string, reason?: string): Promise<void> {
  return request<void>({ url: `/api/order/refund/${orderId}`, method: 'POST', data: reason ? { reason } : {} })
}

/**
 * **秒退**：已支付且未发货/未核销的订单**免人工审核**，提交后立即触发退款（原路退回）。
 *
 * 契约：`POST /api/order/refund/fast/{orderId}`（`api_doc.json` 摘要「秒退（已支付未发货，免人工审核）」，
 * 请求体与 `refundOrder` 同为 `OrderRefundDTO`，**该 DTO 只有 `reason` 一个字段**）。
 *
 * ⚠️ 前端**只在「支付后 30 分钟内」显示秒退入口**（见 `utils/refund-window.ts` 的 `canFastRefund`）——
 * 这是产品规则；接口本身的窗口以后端为准（若后端拒绝，提示用户改走「申请退款」）。
 *
 * 📌 **秒退必须填写退款理由**（2026-09-22 起的产品规则）：入口不再是"弹个确认框就提交"，
 * 而是先开 `components/RefundReasonSheet.vue` 收集理由（必填）→ 校验通过后才调本函数。
 * 理由的清洗与字符白名单见 `utils/refund-reason.ts`（与后端 `@Pattern` 对齐，前端先拦住避免"填完才报错"）。
 *
 * @param orderId 订单 ID
 * @param payload.reason 退款理由（清洗后的值；为空则不传该字段，与历史 `{}` 请求体一致）
 * @param payload.requestId 可选幂等键：作为请求头 `X-Request-Id` 上送（见 `utils/request-id.ts`）。
 *   **同一笔秒退动作的失败重试 / 连点必须复用同一个值**，否则后端「接口调用计数」会重复计数；不传则无幂等。
 */
export function fastRefundOrder(
  orderId: number | string,
  payload: { reason?: string; requestId?: string } = {},
): Promise<void> {
  return request<void>({
    url: `/api/order/refund/fast/${orderId}`,
    method: 'POST',
    // 理由为空 → 不传该键（请求体仍是 `{}`）；传了就按 OrderRefundDTO 的 reason 上送
    data: payload.reason ? { reason: payload.reason } : {},
    requestId: payload.requestId,
  })
}
