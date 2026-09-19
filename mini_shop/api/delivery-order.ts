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
