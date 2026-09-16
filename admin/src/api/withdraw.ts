import { request } from './request'
import type { WithdrawPage, WithdrawRecordPage, WithdrawRecordQuery, WithdrawResponse, Withdrawal } from '@/types/withdraw'
import { sanitizeBonusText } from '@/utils/textSafe'

/** 校验业务响应；后端错误文案统一做旧词兜底替换，避免页面出现历史遗留旧词。 */
function unwrap<T>(response: { data: WithdrawResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(sanitizeBonusText(result.message) || fallback)
  return result.data as T
}

function normalizeWithdrawal(value: unknown): Withdrawal {
  const row = (value || {}) as Partial<Withdrawal>
  const withdrawMethod = String(row.withdrawMethod ?? '')
  return {
    ...row,
    id: String(row.id ?? ''),
    withdrawNo: String(row.withdrawNo ?? ''),
    userId: String(row.userId ?? ''),
    type: String(row.type ?? ''),
    withdrawMethod,
    // 后端下发的来源/状态/方式文案统一兜底替换旧业务词，保证列表不出现历史遗留旧词
    typeDesc: sanitizeBonusText(row.typeDesc),
    withdrawMethodDesc: sanitizeBonusText(row.withdrawMethodDesc ?? (withdrawMethod === 'BANK_CARD' ? '银行卡' : withdrawMethod === 'WECHAT_BALANCE' ? '微信零钱' : '')),
    amount: Number(row.amount ?? 0),
    feeAmount: Number(row.feeAmount ?? 0),
    netAmount: Number(row.netAmount ?? 0),
    status: String(row.status ?? ''),
    statusDesc: sanitizeBonusText(row.statusDesc),
    createdAt: String(row.createdAt ?? ''),
    finishedAt: String(row.finishedAt ?? ''),
    failReason: sanitizeBonusText(row.failReason),
    // 审核/打款需要的信息（后端 AdminWithdrawVO 已返回；银行卡提现必须有卡号，财务才能人工转账）
    maskedName: row.maskedName ?? null,
    maskedCertNo: row.maskedCertNo ?? null,
    phone: String(row.phone ?? ''),
    realnameSnapshot: row.realnameSnapshot ?? null,
    bankCardSnapshot: row.bankCardSnapshot ?? null,
    wxTransferBillNo: row.wxTransferBillNo ?? null,
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt: row.reviewedAt ?? null,
  }
}

function normalizePage(value: unknown, page: number, pageSize: number): WithdrawPage {
  const raw = (value || {}) as Record<string, unknown>
  const list = Array.isArray(raw.list) ? raw.list : []
  return { total: Number(raw.total ?? list.length) || 0, page: Number(raw.page ?? page) || page, pageSize: Number(raw.pageSize ?? pageSize) || pageSize, list: list.map(normalizeWithdrawal) }
}

async function getList(path: string, params: { page: number; size: number }): Promise<WithdrawPage> { return normalizePage(unwrap(await request.get<WithdrawResponse<unknown>>(path, { params }), '提现列表查询失败'), params.page, params.size) }
export async function getPendingWithdrawals(params: { page: number; size: number }): Promise<WithdrawPage> { return getList('/api/admin/withdraw/pending', params) }
export async function getStuckWithdrawals(params: { page: number; size: number }): Promise<WithdrawPage> { return getList('/api/admin/withdraw/stuck', params) }
export async function approveWithdrawal(withdrawNo: string): Promise<void> { unwrap(await request.post<WithdrawResponse<null>>(`/api/admin/withdraw/approve/${withdrawNo}`), '提现审核通过失败') }
export async function rejectWithdrawal(withdrawNo: string, reason: string): Promise<void> { unwrap(await request.post<WithdrawResponse<null>>(`/api/admin/withdraw/reject/${withdrawNo}`, null, { params: { reason } }), '提现拒绝失败') }
export async function retryWithdrawal(withdrawNo: string): Promise<void> { unwrap(await request.post<WithdrawResponse<null>>(`/api/admin/withdraw/retry/${withdrawNo}`), '提现结果重试失败') }
export async function manualSuccessWithdrawal(withdrawNo: string): Promise<void> { unwrap(await request.post<WithdrawResponse<null>>(`/api/admin/withdraw/manual-success/${withdrawNo}`), '手动确认成功失败') }
export async function manualFailWithdrawal(withdrawNo: string, reason: string): Promise<void> { unwrap(await request.post<WithdrawResponse<null>>(`/api/admin/withdraw/manual-fail/${withdrawNo}`, null, { params: { reason } }), '手动确认失败') }

// ===== 提现交易记录（全量提现单，面向财务对账） =====

/**
 * 查询**全量提现交易记录**（`GET /api/admin/withdraw/records`，按申请时间倒序）。
 * 覆盖所有状态；筛选参数全部可选、组合生效，`status` 为英文逗号分隔的多值。
 * 归一化复用 `normalizeWithdrawal`（同一 `AdminWithdrawVO`），分页字段取后端返回的 `page` / `pageSize`。
 */
export async function getWithdrawRecords(params: WithdrawRecordQuery): Promise<WithdrawRecordPage> {
  // 只拼接有值的筛选条件，避免把空串发给后端造成误筛选
  const query: Record<string, string | number> = { page: params.page, size: params.size }
  if (params.status) query.status = params.status
  if (params.type) query.type = params.type
  if (params.withdrawMethod) query.withdrawMethod = params.withdrawMethod
  if (params.userId) query.userId = params.userId
  if (params.withdrawNo) query.withdrawNo = params.withdrawNo
  if (params.phone) query.phone = params.phone
  if (params.startTime) query.startTime = params.startTime
  if (params.endTime) query.endTime = params.endTime
  const data = unwrap(await request.get<WithdrawResponse<unknown>>('/api/admin/withdraw/records', { params: query }), '提现交易记录查询失败')
  const raw = (data || {}) as Record<string, unknown>
  const list = Array.isArray(raw.list) ? raw.list : []
  return {
    total: Number(raw.total ?? list.length) || 0,
    // 分页字段以后端返回为准，后端未返回时回退到请求参数
    page: Number(raw.page ?? params.page) || params.page,
    pageSize: Number(raw.pageSize ?? params.size) || params.size,
    list: list.map(normalizeWithdrawal),
  }
}
