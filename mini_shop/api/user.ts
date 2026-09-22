import { request } from '@/utils/request'

/** 后端用户身份值，兼容 OpenAPI 枚举的数字和字符串序列化。 */
export type UserIdentity = 0 | 1 | '0' | '1'

/** 用户信息（对应 UserProfileVO） */
export interface UserProfile {
  id: number
  nickname: string
  avatarUrl: string
  phone: string
  identity: UserIdentity
  banStatus: number
}

/** 钱包信息（对应 WalletVO） */
export interface WalletInfo {
  balance: number
  /** 待提现推广金（元）：已入账、可一键转余额或提现的部分。 */
  pendingPromotion: number
  /**
   * 待到账推广金（元，2026-09-16 后端新增）：已产生但未过退款窗口、尚未入账的部分，**不在 `pendingPromotion` 内**。
   * 推广收益展示合计 = `pendingPromotion + unsettledPromotion`，前端不必再自行按明细汇总。
   */
  unsettledPromotion?: number
  pendingBonus: number
  totalIncome: number
}

/**
 * 提现规则（对应 LonPin 的 `WithdrawRuleVO`，接口 `GET /api/wallet/withdraw-rules`）。
 * 提现页的金额下限、每日额度与手续费率都由后端配置下发，前端不再写死，避免后台调参后页面文案过期。
 */
export interface WithdrawRules {
  /** 最低提现金额（元），后端已按当前登录用户身份计算。 */
  minAmount: number
  /** 手续费率（0~1 小数，如 0.05 = 5%），展示百分比时需自行 ×100。 */
  feeRate: number
  /** 每日累计提现金额上限（元）；0/缺失表示未配置（页面不展示该限制）。 */
  dailyAmountLimit: number
  /** 每日提现次数上限；0/缺失表示未配置（页面不展示该限制）。 */
  dailyCountLimit: number
  /** 同时处理中的提现笔数上限（页面暂不展示）。 */
  maxConcurrent: number
  /** 当前提现冻结总额上限（元，页面暂不展示）。 */
  frozenLimit: number
  /**
   * 支付后锁定期天数：**自订单支付时刻起算 N×24 小时**内不可提现。
   * 注意口径已更新（2026-09-16）：不再按自然日零点解锁，具体可提现时刻看 `nextWithdrawableAt`。
   */
  payLockDays: number
  /**
   * 下次可提现时刻（`yyyy-MM-dd HH:mm:ss`，2026-09-16 后端新增）。
   * **null / 缺失 = 当前不在锁定期，可立即提现**；有值时取锁定中订单最晚支付时间 + `payLockDays × 24 小时`。
   */
  nextWithdrawableAt?: string | null
}

export type WithdrawType = 'PROMOTION' | 'BONUS' | 'BALANCE'

/** 提现收款方式，两种方式均由后台按提现记录人工打款。 */
export type WithdrawMethod = 'WECHAT_BALANCE' | 'BANK_CARD'

/** 提现请求入参；`bankCardId` 可选（见 `withdrawWalletWithCard`）。 */
export interface WithdrawDTO {
  amount: number
  type: WithdrawType
  withdrawMethod: WithdrawMethod
  idempotencyKey: string
  /** 已绑定银行卡 ID：银行卡提现时指定用哪张卡；不传则后端使用实名资料里的卡号。 */
  bankCardId?: number
}

export interface BalanceTransferDTO {
  toUserId: number
  amount: number
}

export interface UserSearchVO {
  id: number
  nickname: string
  avatarUrl: string
}

/** 提现记录（对应 WithdrawRecordVO）。 */
export interface WithdrawRecord {
  withdrawNo: string
  type: WithdrawType
  withdrawMethod: WithdrawMethod
  typeDesc: string
  amount: number
  status: string
  statusDesc: string
  createdAt: string
  finishedAt?: string | null
  failReason?: string | null
}

/** 提现记录分页结果。 */
export interface WithdrawPageResult {
  total: number
  list: WithdrawRecord[]
  page: number
  pageSize: number
}

/** 获取当前登录用户信息 */
export function getUserProfile(): Promise<UserProfile> {
  return request<UserProfile>({ url: '/api/user/profile', method: 'GET' })
}

/** 获取用户钱包信息 */
export function getWalletInfo(): Promise<WalletInfo> {
  return request<WalletInfo>({ url: '/api/wallet/info', method: 'GET' })
}

/**
 * 查询提现规则（后台配置驱动提现页的最低额/每日限额/手续费率，避免前端写死）。
 * 说明：文档里该接口的 schema 引用写成了 `ResultWithdrawRuleVO`（疑似笔误），但 200 示例的响应体是
 * `{ code, message, data: { minAmount, feeRate, ... } }`，与其它接口一致；request 层已统一拆出 `data`，
 * 所以这里直接按 `WithdrawRules` 接收规则对象本身。
 */
export function getWithdrawRules(): Promise<WithdrawRules> {
  return request<WithdrawRules>({ url: '/api/wallet/withdraw-rules', method: 'GET' })
}

/** 一键转余额，默认可由推广金或红包发起。 */
export function convertWallet(type: Exclude<WithdrawType, 'BALANCE'>): Promise<void> {
  return request<void>({
    url: `/api/wallet/convert?type=${encodeURIComponent(type)}`,
    method: 'POST',
  })
}

/** 按用户 ID 搜索转账接收方。 */
export function searchUser(targetUserId: number): Promise<UserSearchVO> {
  return request<UserSearchVO>({
    url: `/api/user/search?targetUserId=${encodeURIComponent(targetUserId)}`,
    method: 'GET',
  })
}

/** 提交余额转账。 */
export function transferWallet(data: BalanceTransferDTO): Promise<void> {
  return request<void>({ url: '/api/wallet/transfer', method: 'POST', data })
}

/** 修改用户信息 */
export function updateUserProfile(data: Partial<UserProfile>): Promise<UserProfile> {
  return request<UserProfile>({ url: '/api/user/profile', method: 'PUT', data })
}

/** 提交指定类型的钱包提现申请，后端要求金额最低 1，且每次申请必须携带幂等键。 */
export function withdrawWallet(amount: number, type: WithdrawType, withdrawMethod: WithdrawMethod, idempotencyKey: string): Promise<void> {
  const data: WithdrawDTO = buildWithdrawData(amount, type, withdrawMethod, idempotencyKey)
  return request<void>({ url: '/api/wallet/withdraw', method: 'POST', data })
}

/** 回传银行卡提现入参（指定已绑定的银行卡 ID）。 */
function buildWithdrawData(amount: number, type: WithdrawType, withdrawMethod: WithdrawMethod, idempotencyKey: string, bankCardId?: number): WithdrawDTO {
  return {
    amount: Number(amount.toFixed(2)),
    type,
    withdrawMethod,
    idempotencyKey,
    // 不传就把字段整体去掉：后端把 `bankCardId` 当可选，传 null 反而可能被判非法
    ...(bankCardId != null && bankCardId > 0 ? { bankCardId } : {}),
  }
}

/**
 * 银行卡提现（指定已绑定的银行卡）。
 *
 * 为什么单独开一个函数而不是给 `withdrawWallet` 加第 5 个参数：
 * 后端 `WithdrawDTO.bankCardId` 是可选字段，不传时用「实名认证资料里记录的卡号」——
 * 那是历史链路，必须保持原样不动；指定绑卡是新增能力，单独一个出口语义更清楚，
 * 也避免改动既有函数签名影响 `tests/bank-card-withdraw.contract.ps1` 的既有断言。
 */
export function withdrawWalletWithCard(
  amount: number,
  type: WithdrawType,
  withdrawMethod: WithdrawMethod,
  idempotencyKey: string,
  bankCardId: number,
): Promise<void> {
  return request<void>({ url: '/api/wallet/withdraw', method: 'POST', data: buildWithdrawData(amount, type, withdrawMethod, idempotencyKey, bankCardId) })
}

/** 分页查询当前用户的提现记录。 */
export function getWithdrawals(page = 1, pageSize = 20): Promise<WithdrawPageResult> {
  return request<WithdrawPageResult>({
    url: `/api/wallet/withdrawals?page=${page}&pageSize=${pageSize}`,
    method: 'GET',
  })
}

/** 红包槽位（对应 DividendSlotVO，用于红包来源列表）。 */
export interface DividendSlot {
  /** 槽位 ID（int64，序列化为字符串） */
  id: string
  /** 商品名称（红包来源） */
  productName: string
  /** 商品价格（槽位基准价） */
  productPrice: number
  /** 红包上限（=价格×1.5） */
  capAmount: number
  /** 本槽位累计已领红包 */
  totalReceived: number
  /** 是否锁死：0=活跃, 1=已锁死 */
  locked: number
  /** 锁死时间（未锁死为 null） */
  lockedAt: string | null
  /** 开槽位时间 */
  createTime: string
}

/** 红包槽位列表。 */
export interface DividendSlotList {
  availablePurchase: number
  totalPurchases: number
  slots: DividendSlot[]
}

/** 查询红包槽位列表（红包来源）。 */
export async function getDividendSlots(): Promise<DividendSlotList> {
  const result = await request<DividendSlotList>({ url: '/api/wallet/dividend-slots', method: 'GET' })
  return {
    ...result,
    slots: (result.slots || []).map((slot) => ({ ...slot, id: String(slot.id) })),
  }
}

/** 红包流水（逐笔，对应 DividendRecordVO，红包页来源列表用）。 */
export interface DividendRecord {
  /** 红包流水 ID（int64，序列化为字符串） */
  id: string
  /** 红包来源（商品名） */
  productName: string
  /** 本笔红包金额（积分，纯数值） */
  amount: number
  /** 红包到账时间（yyyy-MM-dd HH:mm:ss） */
  createTime: string
}

/** 红包流水分页结果。 */
export interface DividendRecordPage {
  total: number
  list: DividendRecord[]
  page: number
  pageSize: number
}

/** 分页查询红包明细流水（按到账时间倒序）。 */
export async function getDividendRecords(params: { page?: number; pageSize?: number } = {}): Promise<DividendRecordPage> {
  const query = `page=${encodeURIComponent(String(params.page || 1))}&pageSize=${encodeURIComponent(String(params.pageSize || 10))}`
  const result = await request<DividendRecordPage>({ url: `/api/wallet/dividend-records?${query}`, method: 'GET' })
  return { ...result, list: (result.list || []).map((record) => ({ ...record, id: String(record.id) })) }
}
