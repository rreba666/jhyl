import { request } from '@/utils/request'

/**
 * 商城域（用户 token）同城配送查询。
 * 依据《同城配送前端接口文档》§2.3（v1.4）：均只能查**自己的**订单（归属校验由后端做）。
 */

/** 配送进度（`progress` 接口已附带骑手信息与承诺送达时间，一次请求即可渲染骑手卡片）。 */
export interface DeliveryProgress {
  /** 0~1 的伪进度；未进配送中为 null。**前端只做展示与平滑动画，禁止本地伪造**。 */
  progress?: number | null
  /** 阶段文案（如「配送中」）。 */
  stage?: string
  /** 节点枚举：WAIT_ACCEPT/ACCEPTED/PREPARING/WAIT_ASSIGN/ASSIGNED/PICKED_UP/DELIVERING/NEARBY/DELIVERED/COMPLETED。 */
  node?: string
  /** 预计剩余分钟。 */
  estimatedRemainingMinutes?: number | null
  /** 骑手 staffId（未分配为 null）。 */
  riderId?: number | null
  /** 骑手姓名（未分配为 null）。 */
  riderName?: string | null
  /** 骑手手机号【明文】，可直接 `wx.makePhoneCall`。 */
  riderPhone?: string | null
  /** 承诺送达时间。 */
  expectedDeliverAt?: string
  /** 距承诺送达的剩余秒数（服务端基准）。 */
  remainingSeconds?: number | null
}

/** 订单当前骑手（`GET /api/delivery/orders/{orderNo}/rider`）。 */
export interface DeliveryRider {
  taskId?: number
  taskNo?: string
  taskStatus?: string
  riderId?: number | null
  riderName?: string | null
  riderPhone?: string | null
  expectedDeliverAt?: string
  remainingSeconds?: number | null
  serverTime?: string
}

/** 查询配送进度（含骑手）。非配送单或未进配送中时后端返回 progress=null。 */
export function getOrderProgress(orderNo: string): Promise<DeliveryProgress> {
  return request<DeliveryProgress>({ url: `/api/delivery/orders/${encodeURIComponent(orderNo)}/progress`, method: 'GET' })
}

/** 查询订单当前骑手（未分配骑手时 riderId/riderName/riderPhone 为 null）。 */
export function getOrderRider(orderNo: string): Promise<DeliveryRider> {
  return request<DeliveryRider>({ url: `/api/delivery/orders/${encodeURIComponent(orderNo)}/rider`, method: 'GET' })
}

/**
 * 确认收货（同城配送 §5.1 第 9 步）。
 * ⚠️ 同城订单**不会**在骑手送达时自动完成：任务 `DELIVERED` 后订单主状态仍是「履约中」，
 * 必须由用户调这个接口才收口为「已完成」（2026-09-19 全流程实测）。
 * 物流订单用的是另一个接口 `POST /api/order/receive/{orderId}`，两者不可互换。
 */
export function confirmReceiveDelivery(orderNo: string): Promise<void> {
  return request<void>({ url: `/api/delivery/orders/${encodeURIComponent(orderNo)}/confirm-receive`, method: 'POST' })
}

/**
 * 同城配送节点 → 中文文案（用户端订单列表/详情展示用）。
 * ⚠️ 同城订单的订单状态很长一段时间都是「已支付/履约中」，**看不出配送进度** ——
 * 用户端列表因此直接改用这里的配送节点文案（与商家端口径一致）。
 * ⚠️ 2026-09-21 补充：`GET /api/order/list`（**列表**接口）在履约中**不返回**同城的
 * `deliveryStatus`，只有详情接口才返回字符串节点 —— 列表页必须先 `getOrderProgress()`
 * 拿 `node` 再翻译（见 `subpkg-order/orders/list.vue` 的 `progressNodeMap`）。
 */
export const DELIVERY_NODE_TEXT: Record<string, string> = {
  WAIT_ACCEPT: '待接单',
  ACCEPTED: '待取货',
  PREPARING: '备货中',
  WAIT_ASSIGN: '待派单',
  ASSIGNED: '骑手待取货',
  PICKED_UP: '配送中',
  DELIVERING: '配送中',
  NEARBY: '即将送达',
  PAUSED: '配送暂停',
  DELIVERED: '已送达',
  COMPLETED: '已完成',
  EXCEPTION: '配送异常',
  CANCELLED: '配送已取消',
}

/** 同城订单的状态文案：按配送节点取，取不到时回退到订单自身的状态文案。 */
export function deliveryNodeText(node?: string | number | null, fallback = ''): string {
  return DELIVERY_NODE_TEXT[String(node || '')] || fallback
}

/** 同城收货码的原始返回形态（见下方 `normalizeDeliveryPickupCode` 的兼容说明）。 */
export type DeliveryPickupCodePayload = string | number | { code?: string | number; pickupCode?: string | number } | null

/**
 * 归一化同城收货码。
 * ⚠️ 2026-09-21 实测：`GET /api/delivery/orders/{orderNo}/pickup-code` 的 `data` **直接就是字符串码**
 * （如 `"163843"`），不是对象；但后端历史上同类接口给过 `{ code: "163843" }` 这种包装，
 * 为了不让展示层因为形态变化整块消失，这里两种都兼容（取不到一律返回空串，由页面静默隐藏）。
 */
export function normalizeDeliveryPickupCode(data: unknown): string {
  if (data == null) return ''
  if (typeof data === 'string') return data.trim()
  if (typeof data === 'number') return String(data)
  if (typeof data === 'object') {
    const record = data as Record<string, unknown>
    const value = record.code ?? record.pickupCode ?? ''
    return value == null ? '' : String(value).trim()
  }
  return ''
}

/**
 * 查询同城收货码（`GET /api/delivery/orders/{orderNo}/pickup-code`）。
 * ⚠️ **仅下单人可查**（骑手调会 403）；门店开启收货码时，骑手必须先用该码核销才能送达 ——
 * 此前 C 端**零入口**，用户看不到码 → 订单永远卡在配送中（2026-09-21 实测确认）。
 * 门店未开启收货码 / 已完成后失效时返回空，页面按「静默隐藏」处理。
 */
export function getDeliveryPickupCode(orderNo: string): Promise<string> {
  return request<DeliveryPickupCodePayload>({
    url: `/api/delivery/orders/${encodeURIComponent(orderNo)}/pickup-code`,
    method: 'GET',
  }).then((data) => normalizeDeliveryPickupCode(data))
}

/** 送达凭证（照片）行。 */
export interface DeliveryProofVO {
  /** 图片 objectKey / URL（拼 URL 用 `resolveImageUrl`）。 */
  objectKey?: string
  /** 凭证类型，如 `PHOTO`。 */
  proofType?: string
  /** 上传时间。 */
  createTime?: string
}

/**
 * 查看本单的送达凭证（`GET /api/delivery/orders/{orderNo}/proofs`）。
 * ⚠️ 这是 **C 端**接口（按下单人校验）：用户本人可查、骑手调用会 403
 * （骑手端要用 `/api/delivery/tasks/{taskId}/proofs`）。
 */
export function getOrderProofs(orderNo: string): Promise<DeliveryProofVO[]> {
  return request<DeliveryProofVO[]>({ url: `/api/delivery/orders/${encodeURIComponent(orderNo)}/proofs`, method: 'GET' })
}

/** 配送试算结果（`POST /api/delivery/quote`）。 */export interface DeliveryQuote {
  merchantId?: number
  /** 是否可配送；false 时看 `reason`。 */
  canDelivery?: boolean
  /** 不可配送的原因（可配送时为 'ok'）。 */
  reason?: string
  /** 配送费（元）。 */
  deliveryFee?: number
  /** 起送金额（元）。 */
  minOrderAmount?: number
  /** 预计备货分钟。 */
  estimatedPrepareMinutes?: number
  /** 预计配送分钟。 */
  estimatedDeliveryMinutes?: number
  /** 距离（km）。 */
  distanceKm?: number
}

/**
 * 同城配送试算：确认订单页选好「发货门店 + 收货地址」后调用，
 * 用于展示真实配送费、距离、预计送达时间，并判断该地址是否在配送范围内。
 */
export function quoteDelivery(payload: {
  merchantId: number
  goodsAmount: number
  receiverLat?: number
  receiverLng?: number
  address?: string
}): Promise<DeliveryQuote> {
  return request<DeliveryQuote>({ url: '/api/delivery/quote', method: 'POST', data: payload })
}
