import { request } from './request'
import type { TransferPageResult, TransferRecord, TransferResponse } from '@/types/transfer'

function unwrap<T>(response: { data: TransferResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

function normalizeRecord(value: unknown): TransferRecord {
  const row = (value || {}) as Partial<TransferRecord>
  return {
    id: String(row.id ?? ''),
    transferNo: String(row.transferNo ?? ''),
    fromUserId: String(row.fromUserId ?? ''),
    fromNickname: String(row.fromNickname ?? ''),
    toUserId: String(row.toUserId ?? ''),
    toNickname: String(row.toNickname ?? ''),
    amount: Number(row.amount ?? 0),
    createTime: String(row.createTime ?? ''),
  }
}

function normalizePage(value: unknown, page: number, pageSize: number): TransferPageResult {
  const raw = (value || {}) as Record<string, unknown>
  const list = Array.isArray(raw.list) ? raw.list : []
  return {
    total: Number(raw.total ?? list.length) || 0,
    page: Number(raw.page ?? page) || page,
    pageSize: Number(raw.pageSize ?? pageSize) || pageSize,
    list: list.map(normalizeRecord),
  }
}

export async function getTransferList(page: number, pageSize: number): Promise<TransferPageResult> {
  const response = await request.get<TransferResponse<unknown>>('/api/admin/transfer/list', { params: { page, size: pageSize } })
  return normalizePage(unwrap(response, '余额转账记录查询失败'), page, pageSize)
}
