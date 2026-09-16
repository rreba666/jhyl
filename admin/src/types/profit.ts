import type { PaginationResult } from './common'

export interface PendingPromotionRecord {
  id: string
  orderId: string
  orderNo: string
  promoterUserId: string
  buyerUserId: string
  amount: number
  status: string
  confirmedBy: string
  confirmedAt: string
  remark: string
  createdAt: string
  updateTime: string
}

export type PromotionBindingSource = 'SCAN' | 'MANUAL' | 'UNKNOWN'

export interface PromotionBinding {
  buyerUserId: string
  buyerName: string
  buyerAvatar: string
  promoterUserId: string
  promoterName: string
  promoterAvatar: string
  bindTime: string
  source: PromotionBindingSource
  sourceDesc: string
  status: 'BOUND'
  statusDesc: string
}

export interface PromotionBindingQuery {
  keyword?: string
  source?: PromotionBindingSource
  page: number
  size: number
}

export interface SevenDayBonusPool {
  id: string
  startDate: string
  endDate: string
  totalAmount: number
  settledUserCount: number
  settleTime: string
  createTime: string
  updateTime: string
}

export interface SevenDayBonusDetail {
  id: string
  poolId: string
  poolDate: string
  dailyAmount: number
  dailyUserCount: number
  createTime: string
  updateTime: string
}

export interface DividendContribution {
  id: string
  orderNo: string
  userId: string
  userName: string
  amount: number
  paidAt: string
  matureAt: string
  status: string
  statusDesc: string
  confirmedAt: string
  poolId: string
}

export interface UserDividendLimit {
  id: string
  userId: string
  /** 当前可用购买机会数（初始 3，槽位锁死返还 1）。 */
  availablePurchase: number
  /** 累计购买红包商品件数。 */
  totalPurchases: number
  createTime: string
  updateTime: string
}

export interface ProfitResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

export type PromotionPage = PaginationResult<PendingPromotionRecord> & { page: number; pageSize: number }
export type PromotionBindingPage = PaginationResult<PromotionBinding> & { page: number; pageSize: number }
export type DividendContributionPage = PaginationResult<DividendContribution> & { page: number; pageSize: number }

export interface ProfitAdjustPoolDTO {
  totalAmount: number
  userCount: number
}

export interface ProfitAdjustDailyDTO {
  dailyAmount: number
  dailyUserCount: number
}

export interface BonusInjectDTO {
  poolDate?: string
  amount: number
}

export interface WalletTestResult {
  balance: number
  pendingPromotion: number
  pendingBonus: number
  totalIncome: number
}

export interface DividendSlotTestItem {
  id: string
  productName: string
  productPrice: number
  capAmount: number
  totalReceived: number
  locked: number
  lockedAt: string
  createTime: string
}

export interface DividendSlotTestResult {
  availablePurchase: number
  totalPurchases: number
  slots: DividendSlotTestItem[]
}

export interface DividendRecordTestItem {
  id: string
  productName: string
  amount: number
  createTime: string
}

export interface DividendRecordTestResult {
  total: number
  page: number
  pageSize: number
  list: DividendRecordTestItem[]
}
