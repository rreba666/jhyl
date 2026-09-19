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
