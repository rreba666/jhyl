import { request } from './request'
import { resolveMediaUrl } from './media'
import type {
  Order,
  OrderDetail,
  OrderDeleteFlag,
  OrderPickupType,
  OrderPageResult,
  OrderQueryParams,
  OrderResponse,
  OrderShipDTO,
  ManualVerifyDTO,
  OrderAddressUpdateDTO,
  OrderRefundDTO,
  ExpressTrace,
  WxShippingRetryResult,
} from '@/types/order'

/** 校验订单接口响应，并将业务数据交给 Store。 */
function unwrapResponse<T>(response: { data: OrderResponse<T> }, fallbackMessage: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallbackMessage)
  return result.data as T
}

/**
 * 归一化配送方式：0=物流 / 1=自提 / 2=同城。
 * ⚠️ 旧实现写的是 `Number(x) === 1 ? 1 : 0`，会把**同城订单（pickupType=2）误判成物流单**，
 * 导致后台列表/详情把同城订单当物流单展示。
 */
function normalizePickupType(value: unknown): OrderPickupType {
  const num = Number(value)
  if (num === 1) return 1
  if (num === 2) return 2
  return 0
}

/** 将后端 BIGINT 订单 ID 转为字符串，避免 JavaScript 数字精度丢失。 */
function normalizeOrderList(data: OrderPageResult): OrderPageResult {
  return {
    ...data,
    total: Number(data.total) || 0,
    page: Number(data.page) || 1,
    pageSize: Number(data.pageSize) || 10,
    list: (data.list || []).map((item) => ({
      ...item,
      id: String(item.id),
      delFlag: Number(item.delFlag) === 1 ? 1 : 0 as OrderDeleteFlag,
      pickupType: normalizePickupType(item.pickupType),
      firstProductImage: resolveMediaUrl(item.firstProductImage),
    })),
  }
}

/** 查询后台订单分页列表，状态筛选使用后端要求的重复 statuses 参数。 */
export async function getOrders(params: OrderQueryParams): Promise<OrderPageResult> {
  const response = await request.get<OrderResponse<OrderPageResult>>('/api/admin/order/list', { params })
  return normalizeOrderList(unwrapResponse(response, '订单列表查询失败'))
}

/** 查询后台订单详情。 */
export async function getOrderDetail(orderId: string): Promise<OrderDetail> {
  const response = await request.get<OrderResponse<OrderDetail>>(`/api/admin/order/detail/${orderId}`)
  const detail = unwrapResponse(response, '订单详情查询失败')
  return {
    ...detail,
    id: String(detail.id),
    delFlag: Number(detail.delFlag) === 1 ? 1 : 0,
    pickupType: normalizePickupType(detail.pickupType),
    pickupShopId: detail.pickupShopId != null ? String(detail.pickupShopId) : undefined,
    firstProductImage: resolveMediaUrl(detail.firstProductImage),
    items: (detail.items || []).map((item) => ({ ...item, productImage: resolveMediaUrl(item.productImage) })),
  }
}

/** 修改已支付物流订单的收货地址。 */
export async function updateOrderAddress(orderId: string, payload: OrderAddressUpdateDTO): Promise<void> {
  const response = await request.put<OrderResponse<null>>(`/api/admin/order/${orderId}/address`, payload)
  unwrapResponse(response, '订单地址修改失败')
}

/** 提交后台发货信息。 */
export async function shipOrder(orderId: string, payload: OrderShipDTO): Promise<void> {
  const response = await request.post<OrderResponse<null>>(`/api/admin/order/ship/${orderId}`, payload)
  unwrapResponse(response, '订单发货失败')
}

/** 提交客服人工全额退款申请。 */
export async function refundOrder(orderId: string, payload: OrderRefundDTO): Promise<void> {
  const response = await request.post<OrderResponse<null>>(`/api/admin/order/${orderId}/refund`, payload)
  unwrapResponse(response, '订单退款失败')
}

/** 查询物流轨迹；后端没有轨迹时返回 null，不在前端补造节点。 */
export async function getOrderTrace(orderId: string): Promise<ExpressTrace | null> {
  const response = await request.get<OrderResponse<ExpressTrace | null>>(`/api/admin/order/trace/${orderId}`)
  const data = unwrapResponse(response, '物流轨迹查询失败')
  if (!data) return null
  return {
    ...data,
    com: String(data.com || ''),
    nu: String(data.nu || ''),
    state: String(data.state || ''),
    stateDesc: String(data.stateDesc || ''),
    isCheck: Number(data.isCheck) === 1 ? 1 : 0,
    // 保持后端倒序，避免前端改变物流时间线语义。
    traces: (data.traces || []).map((item) => ({
      time: String(item.time || ''),
      context: String(item.context || ''),
    })),
  }
}

/** 删除后台订单；后端已放宽为所有状态订单均可软删除（前端负责二次确认）。 */
export async function deleteOrder(orderId: string): Promise<void> {
  const response = await request.delete<OrderResponse<null>>(`/api/admin/order/${orderId}`)
  unwrapResponse(response, '订单删除失败')
}

/** 恢复后台订单列表中的软删除订单。 */
export async function restoreOrder(orderId: string): Promise<void> {
  const response = await request.put<OrderResponse<null>>(`/api/admin/order/${orderId}/restore`)
  unwrapResponse(response, '订单恢复失败')
}

/** 通过自提码调用后台手工核销接口。 */
export async function manualVerifyOrder(orderId: string, payload: ManualVerifyDTO): Promise<void> {
  const response = await request.post<OrderResponse<null>>(`/api/admin/order/${orderId}/manual-verify`, payload)
  unwrapResponse(response, '订单核销失败')
}

/**
 * 手动重试微信「发货信息管理」上报（自动上报失败时用；接口幂等，已上报成功不会重复调微信）。
 * 文档：《微信发货信息与服务通知直达》§3.2。
 */
export async function retryWxShipping(orderId: string): Promise<WxShippingRetryResult> {
  const response = await request.post<OrderResponse<WxShippingRetryResult>>(`/api/admin/order/${orderId}/wx-shipping-retry`)
  return unwrapResponse(response, '微信发货信息重试失败')
}
