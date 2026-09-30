import { request } from './request'
import type {
  AddressAuditPageResult,
  AddressAuditResponse,
  OrderAddressChangeRequest,
  AddressAuditStatus,
} from '@/types/address-audit'

function unwrap<T>(response: { data: AddressAuditResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

function normalizeStatus(value: unknown): AddressAuditStatus {
  const status = Number(value)
  return status === 1 || status === 2 ? status : 0
}

/** 将后端地址申请对象归一化，避免 BIGINT ID 在前端发生精度丢失。 */
function normalizeRequest(value: unknown): OrderAddressChangeRequest {
  const row = (value || {}) as Record<string, unknown>
  return {
    id: String(row.id ?? ''),
    orderId: String(row.orderId ?? ''),
    orderNo: String(row.orderNo ?? ''),
    userId: String(row.userId ?? ''),
    oldReceiverName: String(row.oldReceiverName ?? ''),
    oldReceiverPhone: String(row.oldReceiverPhone ?? ''),
    oldReceiverAddress: String(row.oldReceiverAddress ?? ''),
    newReceiverName: String(row.newReceiverName ?? ''),
    newReceiverPhone: String(row.newReceiverPhone ?? ''),
    newReceiverAddress: String(row.newReceiverAddress ?? ''),
    reason: String(row.reason ?? ''),
    status: normalizeStatus(row.status),
    rejectReason: String(row.rejectReason ?? ''),
    reviewedBy: String(row.reviewedBy ?? ''),
    reviewedAt: String(row.reviewedAt ?? ''),
    createTime: String(row.createTime ?? ''),
    // ⚠️ 2026-09-30 补：契约 `OrderAddressChangeRequestVO` 一直有 `pickupType` / `pickupTypeText`，
    // 但这个逐字段重建漏掉了 ⇒ 审核员**无法识别自提单 / 同城单**（两者地址含义不同，会影响审核判断）。
    // ⚠️ 只补数据、不改界面；`pickupType` 为 null 表示订单不存在或已删除。
    // ⚠️ 注意 `Number(null) === 0`（不是 NaN）⇒ 必须先判 `null`/空串 再 `Number()`。
    pickupType: normalizeNullableNumber(row.pickupType),
    pickupTypeText: row.pickupTypeText === null || row.pickupTypeText === undefined || row.pickupTypeText === ''
      ? null
      : String(row.pickupTypeText),
  }
}

/** 可空数字归一化：`null` / `undefined` / 空串 → `null`；非法数字 → `null`（不塞 0，避免把"未知"当"物流"）。 */
function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function normalizePage(value: unknown, page: number, pageSize: number): AddressAuditPageResult {
  const raw = (value || {}) as Record<string, unknown>
  const source = Array.isArray(raw.list) ? raw.list : []
  return {
    total: Number(raw.total ?? source.length) || 0,
    page: Number(raw.page ?? page) || page,
    pageSize: Number(raw.pageSize ?? pageSize) || pageSize,
    list: source.map(normalizeRequest),
  }
}

/** 分页查询订单地址修改申请。 */
export async function getAddressChangeRequests(params: {
  page: number
  pageSize: number
  status?: AddressAuditStatus
  orderNo?: string
}): Promise<AddressAuditPageResult> {
  const query: Record<string, string | number> = { page: params.page, pageSize: params.pageSize }
  if (params.status !== undefined) query.status = params.status
  if (params.orderNo?.trim()) query.orderNo = params.orderNo.trim()
  const response = await request.get<AddressAuditResponse<unknown>>('/api/admin/order/address-change-requests', { params: query })
  return normalizePage(unwrap(response, '地址审核列表查询失败'), params.page, params.pageSize)
}

/** 审核通过地址申请，并由后端更新订单收货地址快照。 */
export async function approveAddressChangeRequest(id: string): Promise<void> {
  unwrap(await request.post<AddressAuditResponse<null>>(`/api/admin/order/address-change-requests/${id}/approve`), '地址审核通过失败')
}

/** 驳回地址申请并记录管理员填写的原因。 */
export async function rejectAddressChangeRequest(id: string, rejectReason: string): Promise<void> {
  unwrap(await request.post<AddressAuditResponse<null>>(`/api/admin/order/address-change-requests/${id}/reject`, { rejectReason }), '地址审核驳回失败')
}
