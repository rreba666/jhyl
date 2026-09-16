/**
 * 推广金「转余额后结算中」兜底（移植自今华有肽 C 端，纯前端逻辑）
 *
 * 背景（2026-09，LonPin 用户反馈的真实纠纷点）：
 * 后端 `POST /api/wallet/convert?type=PROMOTION` 会把钱包里的 `pendingPromotion` **直接清零**，
 * 而「尚未转出、仍在冻结/待到账的推广金」要等后端定时任务（约 1 小时）重新累计回
 * `pendingPromotion`。这段窗口期内，前端按「pendingPromotion + 冻结中金额」算出的推广金合计会变成 0：
 * 用户明明还有一笔在冻结，个人页与推广页却显示 0，只能等后端轮询才恢复 → 极易起纠纷。
 *
 * ⚠️ LonPin 与今华有肽的差异：LonPin 的 `/api/wallet/info`、`/api/promotion/summary` **都没有**
 * `unsettledPromotion` 字段，推广明细也**没有** `promotionStatus`，因此只能靠本地快照兜底，
 * 不能像今华有肽那样优先读后端"待到账"金额。
 *
 * 兜底口径（纯前端可精确计算，不依赖后端轮询）：
 *   转账后应有推广金 = 转账前页面展示合计 − 本次实际转入余额的金额
 * 其中「本次实际转入余额的金额」用**钱包余额增量**（转账前后 balance 之差）计算 ——
 * 后端 pending 的中间态不可信，但余额是实打实到账的，用户也能自己核对。
 *
 * 使用方式：
 *   1. 转余额成功后：`savePromotionSettlement(userId, 应有金额)`；
 *   2. 页面算展示金额时：`resolvePromotionSettlement(实时合计, userId)`
 *      —— 实时合计 ≥ 兜底值 → 用实时值（并清掉兜底）；否则用兜底值并标记「结算中」；
 *   3. 数据加载完成后调用 `syncPromotionSettlement(实时合计, userId)` 做一次校准清理；
 *   4. 兜底值有效期 3 小时（覆盖后端约 1 小时的入账任务），过期自动失效，避免长期显示偏大。
 */

/** 兜底快照存储键（全局仅保留一份，按 userId 区分归属）。 */
const STORAGE_KEY = 'promotion_settlement_snapshot'

/** 兜底有效期：3 小时。 */
const SETTLEMENT_TTL_MS = 3 * 60 * 60 * 1000

/** 金额比较容差（元），避免浮点误差导致兜底与实时值反复切换。 */
const AMOUNT_EPSILON = 0.01

/** 本地兜底快照。 */
export interface PromotionSettlementSnapshot {
  /** 所属用户 ID（换账号登录时旧快照自动失效）。 */
  userId: string
  /** 兜底展示金额（元）。 */
  amount: number
  /** 写入时间戳（用于过期判断）。 */
  at: number
}

/** 展示结果：最终金额 + 是否处于「结算中」（后端数据尚未追平）。 */
export interface PromotionDisplayResult {
  amount: number
  settling: boolean
}

/** 金额归一化：非法值、负数一律按 0 处理。 */
function normalizeAmount(value: unknown): number {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

/** 用户 ID 归一化，空值返回空串（视为未登录，不参与兜底）。 */
function normalizeUserId(userId: string | number | null | undefined): string {
  if (userId === null || userId === undefined || userId === '') return ''
  return String(userId)
}

/** 读取兜底快照：非本人、已过期、金额非法时一律返回 null。 */
export function readPromotionSettlement(userId: string | number | null | undefined): PromotionSettlementSnapshot | null {
  const owner = normalizeUserId(userId)
  if (!owner) return null
  try {
    const raw = uni.getStorageSync(STORAGE_KEY)
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const amount = normalizeAmount(parsed?.amount)
    const at = Number(parsed?.at)
    if (amount <= 0 || !Number.isFinite(at)) return null
    if (normalizeUserId(parsed?.userId) !== owner) return null
    if (Date.now() - at > SETTLEMENT_TTL_MS) return null
    return { userId: owner, amount, at }
  } catch {
    return null
  }
}

/** 写入兜底快照（转余额成功后调用；金额 ≤ 0 视为无需兜底）。 */
export function savePromotionSettlement(userId: string | number | null | undefined, amount: unknown): void {
  const owner = normalizeUserId(userId)
  const value = normalizeAmount(amount)
  if (!owner || value <= 0) return
  try {
    uni.setStorageSync(STORAGE_KEY, JSON.stringify({ userId: owner, amount: value, at: Date.now() }))
  } catch {
    // 本地缓存失败不影响主流程，仅失去兜底能力
  }
}

/** 清除兜底快照（后端数据已追平、换账号、退出登录时调用）。 */
export function clearPromotionSettlement(): void {
  try {
    uni.removeStorageSync(STORAGE_KEY)
  } catch {
    // 忽略清理失败
  }
}

/**
 * 计算推广金展示值（纯函数，不产生副作用）：
 * - 兜底值存在且实时值明显更小 → 用兜底值，标记「结算中」；
 * - 否则用实时值。
 */
export function resolvePromotionSettlement(liveAmount: unknown, userId: string | number | null | undefined): PromotionDisplayResult {
  const live = normalizeAmount(liveAmount)
  const snapshot = readPromotionSettlement(userId)
  if (!snapshot) return { amount: live, settling: false }
  if (live + AMOUNT_EPSILON >= snapshot.amount) return { amount: live, settling: false }
  return { amount: snapshot.amount, settling: true }
}

/**
 * 数据加载完成后调用：实时值已追平兜底值、或快照已过期/换人时清理快照。
 * 返回值与 `resolvePromotionSettlement` 一致，便于页面直接使用。
 */
export function syncPromotionSettlement(liveAmount: unknown, userId: string | number | null | undefined): PromotionDisplayResult {
  const result = resolvePromotionSettlement(liveAmount, userId)
  if (!result.settling) clearPromotionSettlement()
  return result
}
