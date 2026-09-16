import { request } from './request'
import type { DashboardResponse, SalesRecord, SalesRecordQueryParams } from '@/types/dashboard'

/** 校验仪表盘接口响应并返回业务数据。 */
function unwrap<T>(response: { data: DashboardResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 归一化全量记录，避免后端空列表或数字字符串影响仪表盘指标。 */
function normalizeRecords(value: unknown): SalesRecord[] {
  const source = Array.isArray(value) ? value : []
  return source.map((item) => {
    const row = (item || {}) as Partial<SalesRecord>
    return {
      orderNo: String(row.orderNo ?? ''),
      productName: String(row.productName ?? ''),
      nickname: String(row.nickname ?? ''),
      quantity: Number(row.quantity ?? 0) || 0,
      price: Number(row.price ?? 0) || 0,
      subtotal: Number(row.subtotal ?? 0) || 0,
      createTime: String(row.createTime ?? ''),
      payTime: row.payTime ? String(row.payTime) : '',
      status: Number(row.status ?? 0) || 0,
      statusDesc: String(row.statusDesc ?? ''),
    }
  })
}

/** 查询后台有效商品购买记录。 */
export async function getSalesRecords(params: SalesRecordQueryParams = {}): Promise<SalesRecord[]> {
  const response = await request.get<DashboardResponse<unknown>>('/api/admin/order/sales-records', {
    params: params.productName?.trim() ? { productName: params.productName.trim() } : undefined,
  })
  return normalizeRecords(unwrap(response, '购买记录查询失败'))
}
