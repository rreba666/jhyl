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

/**
 * 锁定期明细项（按「解锁日」聚合，对应后端 `FrozenBreakdownItem`）。
 *
 * 依据：`docs/前端对接说明-提现按金额锁正式生效-2026-09-30.md`（2026-09-30 正式生效）。
 */
export interface FrozenBreakdownItem {
  /** 解锁日（`yyyy-MM-dd`）。 */
  unlockAt: string
  /** 该日解锁的金额（元）。 */
  amount: number
  /** 该日解锁的笔数。 */
  count: number
}

/** 钱包信息（对应 WalletVO） */
export interface WalletInfo {
  balance: number
  /**
   * ⚠️ **当前实际可提现的金额**（元）—— 后端 2026-09-29 新增（第十批）。
   *
   * 与 `balance` 的区别：`balance` 是**账面总额**，`availableBalance` 已扣掉**仍在提现锁定期内**的部分。
   * 后端提现校验（`POST /api/wallet/withdraw`）用的就是它
   * ⇒ **提现金额上限必须按它算**，否则会出现"页面允许输入、提交却被拒"
   *   （用户感知就是"余额明明有钱却提不出来"）。
   *
   * ⚠️ 后端未部署该字段时为 `undefined` ⇒ 调用方**需回退到 `balance`**（见 `withdraw.vue` 的取值逻辑）。
   */
  availableBalance?: number
  /**
   * 当前**处于锁定期、暂不可提现**的金额（元）—— 后端 2026-09-29 新增（第十批）。
   *
   * 用于把「有多少钱 / 其中多少锁着 / 最早何时解锁」讲清楚，避免用户以为平台吞了钱。不在锁定期时为 0。
   */
  frozenBalance?: number
  /**
   * 锁定期明细（**按「解锁日」聚合**）—— 后端 2026-09-30 正式生效。
   *
   * 依据：`docs/前端对接说明-提现按金额锁正式生效-2026-09-30.md`。
   * 提现锁定期口径由「**看人**」（用户级整体锁：近 N 天有订单支付就整笔拒绝）
   * 正式切换为「**看钱**」：**每一笔钱各自从入账那天起算 N 天**，满期的部分随时可提，
   * **用户下单不再影响提现**。
   *
   * ⚠️ **无锁定时返回空数组，不是 `null`** —— 判空请用 `?.length`，不要用 `== null`。
   * ⚠️ 恒等式：`availableBalance + frozenBalance` 等于 `balance`（冻结不会被算成大于余额）。
   * ⚠️ 本次口径修正后，**退款 / 转账 / 平台补偿 / 运维注入**进来的余额**直接计入 `availableBalance`**
   *    （此前这些用户的可提现额恒为 0，一分钱都提不出来）。
   */
  frozenBreakdown?: FrozenBreakdownItem[]
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
   * 锁定期天数（**每笔收益各自**、自其**入账时刻**起算 N×24 小时内不可提现）。
   *
   * ⚠️ **2026-09-30 正式生效**（后端《前端对接说明-提现按金额锁正式生效-2026-09-30.md》）：
   *    口径由「用户级整体锁」**正式切换**为「**按金额 / 按笔锁**」，**且已默认生效、没有任何开关**
   *    ⇒ 锚点就此确定为**入账时刻**（草案 §十-2 关于「入账时刻 vs 订单支付时刻」的评审已定论）。
   * ⚠️ 前端**不依赖该锚点做计算**，只用后端下发的金额与时刻做展示。
   */
  payLockDays: number
  /**
   * 下次可提现时刻（`yyyy-MM-dd HH:mm:ss`）。
   * **null / 缺失 = 当前不在锁定期，可立即提现**。
   *
   * ⚠️ **语义已于 2026-09-30 反转为「最早」**（此前是「最晚」，那段注释已作废）：
   *    = **最早一笔未解锁资金的解锁时刻**。
   *    旧口径是「锁定中订单的**最晚**支付时间 + `payLockDays × 24h`」，属于「用户级整体锁」，
   *    其行为是「命中任一近 N 天内的已支付订单 ⇒ **整笔拒绝**，且每来一笔新订单解锁时刻继续顺延」——
   *    **这正是用户反馈「只要有新订单就全冻住了」的成因，现已修复。**
   *    新口径下**下单不再影响提现**。
   *
   * ⚠️ 因此文案**必须中性化**：不要再出现「因为最近下单」「有新订单会顺延」这类描述。
   *    后端明确建议**只展示、不自己计算**，例如「预计 10-01 后可提现」。
   *    前端**只用它做展示、不参与校验**，所以口径切换不影响除文案外的任何逻辑。
   */
  nextWithdrawableAt?: string | null
  /**
   * **微信零菜单笔提现上限**（元，2026-09-28 后端新增）。
   *
   * ⚠️ **`0` 或缺失 = 该通道「不限」** —— 绝不能当成"最多只能提 0 元"而禁用提交。
   * 判据是 `>`（后端 `≤` 放行 ⇒ **正好等于限额放行**）。默认 200（微信「商家转账」的微信侧额度）。
   */
  wechatSingleLimit?: number
  /**
   * **银行卡单笔提现上限**（元，2026-09-28 后端新增）。
   * ⚠️ 同样 **`0` = 不限**（银行卡为线下人工打款，不适用微信额度，默认就是 0）。
   */
  bankCardSingleLimit?: number
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
