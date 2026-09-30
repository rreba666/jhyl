import { request } from './request'
import type { WalletPageResult, WalletRecord, WalletResponse } from '@/types/wallet'

function unwrap<T>(response: { data: WalletResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

function normalizeRecord(value: unknown): WalletRecord {
  const row = (value || {}) as Record<string, unknown>
  // 「可转账余额」对应后端 balance 字段（余额）；availableBalance 是累计到账收入，勿混用。
  // ⚠️ 2026-09-30 加固：`?? 0` 会把「字段缺失 / 为 null」与「真的是 0」混为一谈，
  // 运营会看到**假的 ¥0.00** 并据此核对账务（与 emergencyPool `|| 0` 事故同型）。
  // 这里保留 0 兜底（避免 NaN 上屏），但**字段确实缺失时打一条告警**，便于发现契约漂移。
  if (row.balance === null || row.balance === undefined) {
    console.warn('[admin/wallet] 记录缺少 balance 字段，已按 0 兜底（请核对契约/后端）:', row.id ?? '(无 id)')
  }
  const balance = Number(row.balance ?? 0)
  return {
    id: String(row.id ?? ''),
    userId: String(row.userId ?? ''),
    balance,
    version: Number(row.version ?? 0),
    createTime: String(row.createTime ?? ''),
    updateTime: String(row.updateTime ?? ''),
  }
}

function normalizePage(value: unknown, page: number, pageSize: number): WalletPageResult {
  const raw = (value || {}) as Record<string, unknown>
  const list = Array.isArray(raw.list) ? raw.list : []
  return {
    total: Number(raw.total ?? list.length) || 0,
    page: Number(raw.page ?? page) || page,
    pageSize: Number(raw.pageSize ?? pageSize) || pageSize,
    list: list.map(normalizeRecord),
  }
}

export async function getWalletList(page: number, pageSize: number): Promise<WalletPageResult> {
  const response = await request.get<WalletResponse<unknown>>('/api/admin/wallet/list', { params: { page, pageSize } })
  return normalizePage(unwrap(response, '钱包列表查询失败'), page, pageSize)
}

export async function saveWalletBalance(userId: string, balance: number): Promise<void> {
  const value = Number(balance)
  if (!Number.isFinite(value) || value < 0) throw new Error('余额必须是有限非负数字')
  userId = String(userId)
  // 「可转账余额」对应后端 balance 字段（余额）。
  unwrap(await request.post<WalletResponse<unknown>>(`/api/admin/wallet/${userId}`, { balance: value }), '钱包余额保存失败')
}

export async function deleteWallet(walletId: string): Promise<void> {
  unwrap(await request.delete<WalletResponse<null>>(`/api/admin/wallet/${walletId}`), '钱包删除失败')
}
