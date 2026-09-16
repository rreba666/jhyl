import { request } from './request'
import type { AuditLog, AuditLogQueryParams, LogPageResult, LogResponse, VerifyLog, VerifyLogQueryParams } from '@/types/log'

function unwrap<T>(response: { data: LogResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 归一化日志分页结构，并保护 BIGINT 标识。 */
function normalizePage<T extends { id: string }>(value: unknown, page: number, pageSize: number, mapItem: (item: unknown) => T): LogPageResult<T> {
  const raw = (value || {}) as Record<string, unknown>
  const records = Array.isArray(raw.records) ? raw.records : Array.isArray(raw.list) ? raw.list : []
  return {
    total: Number(raw.total ?? records.length) || 0,
    page: Number(raw.current ?? raw.page ?? page) || page,
    pageSize: Number(raw.size ?? raw.pageSize ?? pageSize) || pageSize,
    list: records.map(mapItem),
  }
}

/** 查询核销日志。 */
export async function getVerifyLogs(params: VerifyLogQueryParams): Promise<LogPageResult<VerifyLog>> {
  const response = await request.get<LogResponse<unknown>>('/api/admin/verify-log/list', { params })
  return normalizePage(unwrap(response, '核销日志查询失败'), params.page, params.pageSize, (item) => {
    const raw = item as Partial<VerifyLog>
    return { ...raw, id: String(raw.id ?? ''), orderId: String(raw.orderId ?? ''), staffId: String(raw.staffId ?? ''), shopId: String(raw.shopId ?? '') } as VerifyLog
  })
}

/** 查询操作追溯日志。 */
export async function getAuditLogs(params: AuditLogQueryParams): Promise<LogPageResult<AuditLog>> {
  const response = await request.get<LogResponse<unknown>>('/api/admin/audit-log/list', { params })
  return normalizePage(unwrap(response, '操作日志查询失败'), params.page, params.pageSize, (item) => {
    const raw = item as Partial<AuditLog>
    return { ...raw, id: String(raw.id ?? ''), operatorId: String(raw.operatorId ?? ''), targetId: String(raw.targetId ?? '') } as AuditLog
  })
}
