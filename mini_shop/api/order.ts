import { request } from '@/utils/request'

export type OrderStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
/**
 * 配送地址草稿的 storage key（**已升版到 `_v2`**）。
 * 「配送地址」独立页面（`subpkg-order/address/edit`）保存后写这里，确认订单页读取并清空。
 *
 * ⚠️ **为什么必须升版（2026-10-08，P1 履约事故第三层）**：
 * 同城配送的坐标曾由前端**伪造** —— 地址编辑页的 `locate()` 会把「当前位置」写进地址表单的
 * `latitude/longitude`，用户**只手动打字**、从没在地图上选点，地址也带着一个与他所填内容无关的坐标。
 * 修好写入侧（layer 1/2）**并不够**：**修复前写进 storage 的旧草稿仍然带着那个伪造坐标**，
 * 升级后的用户只要本地还留着旧草稿，同城配送「地址没有坐标就拦住」的门禁就会被旧数据满足
 * ⇒ 超出配送范围仍然可以下单。所以把 key 改名 ⇒ **旧草稿自然失效**（读不到 ⇒ 用户重新填一次地址）。
 *
 * 接受的代价：正在填写、还没提交的地址草稿会丢一次（**安全优先**，宁可让用户重填，也不放行超范围订单）。
 *
 * ⚠️ **2026-10-08 追补（后端 coordinateSource 闸门）**：坐标还必须带**可信来源**才可用
 * （见 `utils/coordinate-source.ts`）。`_v2` 草稿是在"只有坐标、还没有来源"的那版前端写入的
 * ⇒ 里面即便有坐标**也没有来源**。这**不需要**再升版：读取侧（`address/edit.vue` 与
 * `payment.vue`）对"有坐标没来源"一律按「**没有坐标**」处理 ⇒ 用户被如实要求重新地图选点。
 */
export const ADDRESS_DRAFT_KEY = 'payment_address_draft_v2'
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
  /**
   * 收货地址纬度（GCJ-02）—— **同城配送必填**。
   * ⛔ 只能来自收货地址自身的**地图选点**（自动定位拿到的是"用户当前在哪"，与收货地址无关，
   *    不得当作收货坐标 —— 2026-10-08 P1 履约事故根因）。
   */
  receiverLat?: number
  /** 收货地址经度（GCJ-02）—— **同城配送必填**（来源要求同 `receiverLat`）。 */
  receiverLng?: number
  /**
   * 收货坐标的**来源**（后端白名单 `MAP_PICK` / `WECHAT_ADDRESS`，大小写/空白不敏感）。
   *
   * ⛔ 2026-10-08 起**同城配送必填**：后端只认白名单，缺失或任何其它值（`MANUAL_INPUT` /
   *   `AUTO_LOCATE` / 未知）一律 fail-closed（试算 `failCode=NO_COORDINATE`；下单 **`13026`**
   *   `DELIVERY_RECEIVER_COORDINATE_REQUIRED`「收货地址未定位，请在地图上选点后再下单」）。
   * ⛔ 与 `receiverLat/receiverLng` **同生同灭**（all-or-nothing）：绝不发"有来源没坐标"
   *   或"有坐标没来源"的请求（后者后端会拒，前者是伪造）。
   * 取值见 `utils/coordinate-source.ts`。
   */
  coordinateSource?: string
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
   *
   * ⚠️⚠️ **同城节点的字符串枚举只在**`订单详情`**接口下发**：`GET /api/order/list`
   * （**列表**）给的是 `Integer` 且仅物流单有值，同城单**恒为 `null`**
   * ⇒ 「取消申请中」这类履约态**只能由详情接口驱动**（详见 `utils/refund-window.ts` 的端点差异表）。
   *
   * 完整取值（契约 `OrderDetailVO.deliveryStatus`，2026-10-08 已补 `CANCEL_REQUESTED` 并逐字核对）：
   * `WAIT_ACCEPT / ACCEPTED / PREPARING / WAIT_ASSIGN / ASSIGNED / PICKED_UP / DELIVERING /
   *  NEARBY / DELIVERED / COMPLETED / CANCELLED / CANCEL_REQUESTED / EXCEPTION`。
   */
  deliveryStatus?: number | string
  /**
   * 取消申请**提交时刻**（ISO，如 `2026-10-08T15:40:14`）。
   *
   * ⚠️ **仅 `deliveryStatus === 'CANCEL_REQUESTED'` 时非空**；申请被同意/驳回后后端会把它
   * 变回 `null`（按状态收敛）⇒ 前端**不需要**清理本地缓存，也不要拿它当"曾经申请过"的历史判据。
   * 依据：W8 文档 §2.2（迁移 `shop/V8038`）。
   */
  cancelRequestedAt?: string | null
  /**
   * **系统自动同意**的截止时刻（ISO）。仅 `CANCEL_REQUESTED` 时非空，与 {@link cancelRequestedAt} 同生同灭。
   *
   * ⛔ **展示它、不要自己算**：阈值（未备货 30 分钟 / 已备货·配送中 180 分钟）由后端在**申请那一刻**
   * 按当时的履约态定档落库，与自动同意任务同源同刻 —— 前端若写死天数/分钟数，运维调档后必然漂。
   * 依据：W8 文档 §2.2 第 1 条「不要写死阈值」。
   */
  cancelAutoApproveAt?: string | null
}

export interface OrderDetailItem {
  productName?: string
  productImage?: string
  skuName?: string
  price?: number
  quantity?: number
  subtotal?: number
}

/**
 * 子订单（对应后端 `ChildOrderVO`，2026-10-02 P3 跨商拆单新增）。
 *
 * ⚠️ 背景（P3 §一）：物流单允许「一个购物车混装多个商家的商品、一次支付、一个收货地址」，
 * 后端在下单时按商**拆成父单 + N 个子单**：
 * - **父单**：用户可见的那一笔订单，承载支付与收货信息，**不发货、不结算、不受理售后**；
 * - **子单**：每个商一条，承载该商的商品、金额、发货、物流、售后、结算；
 * - 单商订单 / 自提 / 同城 **不拆**（`children` 为 `null`）。
 */
export interface ChildOrderVO {
  /**
   * 子订单主键 ID（**售后/秒退接口按此 id 操作，不接受订单号**）。
   *
   * ⚠️⚠️ 2026-10-02 后端反馈已修正此前的判断（《给前端的反馈-契约缺口补充》§二）：
   * - 曾以为「`Long` ⇒ JSON 序列化为**字符串**，与 `MerchantVO.id` 同约定」—— **实测不成立**：
   *   原始 JSON 就是 `{"id":100235}`、`"settlementMerchantId":911`，**都是数字**，
   *   项目里**没有** Long→String 的全局序列化配置；
   * - ⇒ 现按后端口径声明为 **`number`**（自增小整数，不存在 JS 精度问题；
   *   将来若改用雪花 ID 再统一评估）；
   * - ⚠️ 后端已于 **jar `870f9d98…`** 补齐该字段，**列表与详情都会返回、非 null**。
   */
  id: number
  /** 子订单号。 */
  orderNo: string
  /** 结算归属商家 ID（`wx_merchant.id`）⇒ 前端据此映射商家名。 */
  settlementMerchantId?: number
  /** 子单状态（0待支付/1已支付/2已发货/3已收货/4已完成/5已关闭/6退款中/7已退款/8已核销）。 */
  status?: number
  /** 子单应付（已按原价占比分摊，含尾差）。⚠️ 各子单之和恒等于父单 `payAmount`（后端 INV-6）。 */
  payAmount?: number
  /** 该子单**分摊到的整单优惠**（P3 决策 2：子单上要显示「本单分摊优惠 ¥X」）。 */
  discountAmount?: number
  /** 该子单商品原价小计。 */
  totalAmount?: number
  /** 该子单各自的物流公司。 */
  expressCompany?: string | null
  /** 该子单各自的运单号。 */
  expressNo?: string | null
}

export interface OrderDetail extends OrderSummary {
  remark?: string
  pickupShopId?: number
  pickupStatus?: number
  /** 自提码（12 位，自提订单支付后生成，用于到店核销）。 */
  pickupCode?: string
  /** 自提二维码内容（形如 {PICKUP_BASE_URL}?c=自提码），前端据此生成二维码。 */
  pickupUrl?: string
  /**
   * 子订单列表（**跨商拆单的父单才有**；每商一条，含各自金额与物流）。
   *
   * ⚠️ 子单自身详情 / 单商订单 ⇒ **`null`** ⇒ 展示前**必须判空**。
   * ⚠️ 对**父单**（有子单的订单）申请售后会被后端拒（`code=1000`）⇒
   * 前端**必须**从 `children[]` 里让用户**选具体子单**再提交（秒退/自助退款同理）。
   */
  children?: ChildOrderVO[] | null
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

/**
 * 查询订单详情（**按订单号**，`GET /api/order/detail-by-no/{orderNo}`）。
 *
 * ⚠️ 与 {@link getOrderDetail} **同构**（`OrderDetailVO`），差别只在入参：
 * 一个按订单 ID、一个按订单号。**推荐在提交取消申请之后用它** ——
 * 那条调用（`POST /api/delivery/orders/{orderNo}/cancel-request`）手里正好是 `orderNo`，
 * 用本函数可以省掉「orderNo → orderId」的额外一跳（W8 文档 §2.1 明确推荐）。
 *
 * ⚠️ `orderNo` 必须是**子单号**：跨商拆单的父单会落到 `4000 订单不存在或不属于当前用户`
 *    （子单号取详情的 `children[].orderNo`）。
 */
export function getOrderDetailByNo(orderNo: string): Promise<OrderDetail> {
  return request<OrderDetail>({ url: `/api/order/detail-by-no/${encodeURIComponent(orderNo)}`, method: 'GET' })
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
