import { request } from './request'
import type { BonusInjectDTO, DividendContribution, DividendContributionPage, DividendRecordTestItem, DividendRecordTestResult, DividendSlotTestItem, DividendSlotTestResult, ProfitAdjustDailyDTO, ProfitAdjustPoolDTO, ProfitResponse, PromotionBinding, PromotionBindingPage, PromotionBindingQuery, PromotionPage, PendingPromotionRecord, SevenDayBonusDetail, SevenDayBonusPool, UserDividendLimit, WalletTestResult } from '@/types/profit'
import { sanitizeBonusText } from '@/utils/textSafe'

/** 校验业务响应；后端错误文案统一做旧词兜底替换，避免页面出现历史遗留旧词。 */
function unwrap<T>(response: { data: ProfitResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(sanitizeBonusText(result.message) || fallback)
  return result.data as T
}

function normalizePendingRecord(value: unknown): PendingPromotionRecord {
  const row = (value || {}) as Partial<PendingPromotionRecord>
  return { ...row, id: String(row.id ?? ''), orderId: String(row.orderId ?? ''), orderNo: String(row.orderNo ?? ''), promoterUserId: String(row.promoterUserId ?? ''), buyerUserId: String(row.buyerUserId ?? ''), amount: Number(row.amount ?? 0), status: String(row.status ?? ''), confirmedBy: String(row.confirmedBy ?? ''), confirmedAt: String(row.confirmedAt ?? ''), remark: String(row.remark ?? ''), createdAt: String(row.createdAt ?? ''), updateTime: String(row.updateTime ?? '') }
}

function normalizeBinding(value: unknown): PromotionBinding {
  const row = (value || {}) as Partial<PromotionBinding>
  const source = row.source === 'SCAN' || row.source === 'MANUAL' ? row.source : 'UNKNOWN'
  return { ...row, buyerUserId: String(row.buyerUserId ?? ''), buyerName: String(row.buyerName ?? ''), buyerAvatar: String(row.buyerAvatar ?? ''), promoterUserId: String(row.promoterUserId ?? ''), promoterName: String(row.promoterName ?? ''), promoterAvatar: String(row.promoterAvatar ?? ''), bindTime: String(row.bindTime ?? ''), source, sourceDesc: sanitizeBonusText(row.sourceDesc), status: 'BOUND', statusDesc: sanitizeBonusText(row.statusDesc) }
}

function normalizePage(value: unknown, page: number, pageSize: number): PromotionPage {
  const raw = (value || {}) as Record<string, unknown>
  const list = Array.isArray(raw.list) ? raw.list : []
  return { total: Number(raw.total ?? list.length) || 0, page: Number(raw.page ?? page) || page, pageSize: Number(raw.pageSize ?? pageSize) || pageSize, list: list.map(normalizePendingRecord) }
}

function normalizeBindingPage(value: unknown, page: number, pageSize: number): PromotionBindingPage {
  const raw = (value || {}) as Record<string, unknown>
  const list = Array.isArray(raw.list) ? raw.list : []
  return { total: Number(raw.total ?? list.length) || 0, page: Number(raw.page ?? page) || page, pageSize: Number(raw.pageSize ?? pageSize) || pageSize, list: list.map(normalizeBinding) }
}

function normalizePool(value: unknown): SevenDayBonusPool {
  const row = (value || {}) as Partial<SevenDayBonusPool>
  return { ...row, id: String(row.id ?? ''), totalAmount: Number(row.totalAmount ?? 0), settledUserCount: Number(row.settledUserCount ?? 0), startDate: String(row.startDate ?? ''), endDate: String(row.endDate ?? ''), settleTime: String(row.settleTime ?? ''), createTime: String(row.createTime ?? ''), updateTime: String(row.updateTime ?? '') }
}

function normalizeDetail(value: unknown): SevenDayBonusDetail {
  const row = (value || {}) as Partial<SevenDayBonusDetail>
  return { ...row, id: String(row.id ?? ''), poolId: String(row.poolId ?? ''), poolDate: String(row.poolDate ?? ''), dailyAmount: Number(row.dailyAmount ?? 0), dailyUserCount: Number(row.dailyUserCount ?? 0), createTime: String(row.createTime ?? ''), updateTime: String(row.updateTime ?? '') }
}

function normalizeContribution(value: unknown): DividendContribution {
  const row = (value || {}) as Record<string, unknown>
  const user = (row.user || {}) as Record<string, unknown>
  return {
    id: String(row.id ?? row.contributionId ?? ''),
    orderNo: String(row.orderNo ?? row.orderNumber ?? ''),
    userId: String(row.userId ?? row.buyerUserId ?? user.id ?? ''),
    userName: String(row.userName ?? row.buyerName ?? row.nickname ?? user.nickname ?? ''),
    amount: Number(row.amount ?? row.contributionAmount ?? 0),
    paidAt: String(row.paidAt ?? row.paymentTime ?? row.payTime ?? ''),
    matureAt: String(row.matureAt ?? row.expectedMatureTime ?? row.maturityTime ?? ''),
    status: String(row.status ?? ''),
    statusDesc: sanitizeBonusText(String(row.statusDesc ?? row.statusName ?? '')),
    confirmedAt: String(row.confirmedAt ?? row.confirmTime ?? ''),
    poolId: String(row.poolId ?? row.bonusPoolId ?? ''),
  }
}

function normalizeContributionPage(value: unknown, page: number, size: number): DividendContributionPage {
  const raw = (value || {}) as Record<string, unknown>
  const list = Array.isArray(raw.list) ? raw.list : []
  return {
    total: Number(raw.total ?? list.length) || 0,
    page: Number(raw.page ?? page) || page,
    pageSize: Number(raw.pageSize ?? raw.size ?? size) || size,
    list: list.map(normalizeContribution),
  }
}

function normalizeLimit(value: unknown): UserDividendLimit {
  const row = (value || {}) as Partial<UserDividendLimit>
  return { ...row, id: String(row.id ?? ''), userId: String(row.userId ?? ''), availablePurchase: Number(row.availablePurchase ?? 0), totalPurchases: Number(row.totalPurchases ?? 0), createTime: String(row.createTime ?? ''), updateTime: String(row.updateTime ?? '') }
}

function normalizeWalletTest(value: unknown): WalletTestResult {
  const row = (value || {}) as Partial<WalletTestResult>
  return {
    balance: Number(row.balance ?? 0),
    pendingPromotion: Number(row.pendingPromotion ?? 0),
    pendingBonus: Number(row.pendingBonus ?? 0),
    totalIncome: Number(row.totalIncome ?? 0),
  }
}

function normalizeSlotTest(value: unknown): DividendSlotTestResult {
  const row = (value || {}) as Partial<DividendSlotTestResult>
  const slots = Array.isArray(row.slots) ? row.slots : []
  return {
    availablePurchase: Number(row.availablePurchase ?? 0),
    totalPurchases: Number(row.totalPurchases ?? 0),
    slots: slots.map((item) => {
      const slot = (item || {}) as Partial<DividendSlotTestItem>
      return {
        id: String(slot.id ?? ''),
        productName: String(slot.productName ?? ''),
        productPrice: Number(slot.productPrice ?? 0),
        capAmount: Number(slot.capAmount ?? 0),
        totalReceived: Number(slot.totalReceived ?? 0),
        locked: Number(slot.locked ?? 0),
        lockedAt: String(slot.lockedAt ?? ''),
        createTime: String(slot.createTime ?? ''),
      }
    }),
  }
}

function normalizeRecordTest(value: unknown): DividendRecordTestResult {
  const row = (value || {}) as Partial<DividendRecordTestResult>
  const list = Array.isArray(row.list) ? row.list : []
  return {
    total: Number(row.total ?? list.length) || 0,
    page: Number(row.page ?? 1) || 1,
    pageSize: Number(row.pageSize ?? 20) || 20,
    list: list.map((item) => {
      const record = (item || {}) as Partial<DividendRecordTestItem>
      return {
        id: String(record.id ?? ''),
        productName: String(record.productName ?? ''),
        amount: Number(record.amount ?? 0),
        createTime: String(record.createTime ?? ''),
      }
    }),
  }
}

function getUserTestToken(token: string): string {
  const normalized = token.trim()
  if (!normalized) throw new Error('请输入 C 端用户 Token')
  return normalized
}

async function getUserTestData<T>(token: string, url: string, params?: Record<string, string | number>): Promise<T> {
  const response = await request.get<ProfitResponse<T>>(url, {
    params,
    headers: { Authorization: `Bearer ${getUserTestToken(token)}` },
    skipAuthRedirect: true,
  })
  return unwrap(response, 'C 端结果查询失败')
}

const relationDetailPath = '/api/admin/profit/relations/{buyerUserId}'
function getRelationDetailPath(buyerUserId: string): string { return relationDetailPath.replace('{buyerUserId}', buyerUserId) }

export async function getPendingPromotion(params: { page: number; size: number }): Promise<PromotionPage> {
  return normalizePage(unwrap(await request.get<ProfitResponse<unknown>>('/api/admin/profit/pending', { params }), '待确认推广金查询失败'), params.page, params.size)
}

export async function getPromotionRelations(query: PromotionBindingQuery): Promise<PromotionBindingPage> {
  return normalizeBindingPage(unwrap(await request.get<ProfitResponse<unknown>>('/api/admin/profit/relations', { params: query }), '推广关系查询失败'), query.page, query.size)
}

export async function rebindPromotionRelation(buyerUserId: string, promoterId: string): Promise<void> {
  unwrap(await request.put<ProfitResponse<null>>(getRelationDetailPath(buyerUserId), null, { params: { promoterId } }), '推广关系重绑失败')
}

export async function unbindPromotionRelation(buyerUserId: string): Promise<void> {
  unwrap(await request.delete<ProfitResponse<null>>(getRelationDetailPath(buyerUserId)), '推广关系解绑失败')
}

export async function getBonusPools(): Promise<SevenDayBonusPool[]> {
  const data = unwrap(await request.get<ProfitResponse<unknown>>('/api/admin/profit/pools'), '奖池查询失败')
  return Array.isArray(data) ? data.map(normalizePool) : []
}

export async function getBonusDetails(poolId: string): Promise<SevenDayBonusDetail[]> {
  const data = unwrap(await request.get<ProfitResponse<unknown>>(`/api/admin/profit/detail/${poolId}`), '奖池明细查询失败')
  return Array.isArray(data) ? data.map(normalizeDetail) : []
}

export async function getUnsettledDailyDetails(): Promise<SevenDayBonusDetail[]> {
  const data = unwrap(await request.get<ProfitResponse<unknown>>('/api/admin/profit/daily/unsettled'), '未结算奖池查询失败')
  return Array.isArray(data) ? data.map(normalizeDetail) : []
}

export async function getProfitContributions(query: { status?: string; page: number; size: number }): Promise<DividendContributionPage> {
  return normalizeContributionPage(unwrap(await request.get<ProfitResponse<unknown>>('/api/admin/profit/contributions', { params: query }), '红包贡献查询失败'), query.page, query.size)
}

export async function getDividendLimits(): Promise<UserDividendLimit[]> {
  const data = unwrap(await request.get<ProfitResponse<unknown>>('/api/admin/profit/limits'), '用户红包额度查询失败')
  return Array.isArray(data) ? data.map(normalizeLimit) : []
}

export async function injectBonusPool(payload: BonusInjectDTO): Promise<void> {
  const amount = Number(payload.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('注入金额必须大于 0')
  unwrap(await request.post<ProfitResponse<null>>('/api/admin/profit/inject', { ...payload, amount }), '奖池注入失败')
}

export async function settleProfit(startDate: string, endDate: string): Promise<void> { unwrap(await request.post<ProfitResponse<null>>('/api/admin/profit/settle', null, { params: { startDate, endDate } }), '奖池结算失败') }
export async function confirmPool(poolId: string): Promise<void> { unwrap(await request.post<ProfitResponse<null>>(`/api/admin/profit/pool/${poolId}/confirm`), '奖池确认失败') }
export async function adjustPool(poolId: string, payload: ProfitAdjustPoolDTO): Promise<void> { unwrap(await request.put<ProfitResponse<null>>(`/api/admin/profit/pool/${poolId}/adjust`, payload), '奖池调整失败') }
export async function adjustDaily(detailId: string, payload: ProfitAdjustDailyDTO): Promise<void> { unwrap(await request.put<ProfitResponse<null>>(`/api/admin/profit/daily/${detailId}/adjust`, payload), '每日奖池调整失败') }
export async function resetDividendLimit(userId: string): Promise<void> { unwrap(await request.put<ProfitResponse<null>>(`/api/admin/profit/limit/${userId}/reset`), '红包额度重置失败') }

export async function getWalletTestResult(token: string): Promise<WalletTestResult> {
  return normalizeWalletTest(await getUserTestData<unknown>(token, '/api/wallet/info'))
}

export async function getDividendSlotTestResult(token: string): Promise<DividendSlotTestResult> {
  return normalizeSlotTest(await getUserTestData<unknown>(token, '/api/wallet/dividend-slots'))
}

export async function getDividendRecordTestResult(token: string): Promise<DividendRecordTestResult> {
  return normalizeRecordTest(await getUserTestData<unknown>(token, '/api/wallet/dividend-records', { page: 1, pageSize: 20 }))
}
