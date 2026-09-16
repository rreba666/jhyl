import { getPromotionRecords, type PromotionRecord } from '@/api/promotion'
import { getWithdrawRules } from '@/api/user'

/**
 * 推广金冻结（待到账）天数 = 后端「支付后锁定期」天数。
 *
 * 依据（隆平后端 api_doc.json，已核实）：
 * - `GET /api/wallet/withdraw-rules` 返回 `payLockDays`（**默认 10**）与 `nextWithdrawableAt`；
 * - 文档描述：「提现权限由实名认证、余额、10 天提现锁决定」，即后端口径是 10 天；
 * - 锁定期口径（2026-09-16 起）：**自订单支付时刻起 N×24 小时**，不再按自然日零点解锁。
 *
 * ⚠️ 历史坑：这里原先写的是 **7 天**（与后端 10 天不一致），导致第 8~10 天产生的推广金被前端
 * 误判为"已解冻"，用户在推广页看到「可转余额」里含这笔钱、点转余额却会被后端拒绝。
 * 2026-09-15 今华有肽已按后端口径从 7 天改为 10 天，LonPin 同步对齐（本次修复）。
 *
 * ★2026-09-16 起的权威口径：后端已下发「待到账」金额与明细状态字段，前端**优先**使用：
 * - `GET /api/wallet/info`、`GET /api/promotion/summary` 均返回 `unsettledPromotion`（待到账推广金，不在
 *   `pendingPromotion` 内），推广收益展示合计 = `pendingPromotion + unsettledPromotion`；
 * - `GET /api/promotion/records` 返回 `promotionStatus`（PENDING/PROCESSING=待到账，CONFIRMED=已入账）。
 * 本模块按「记录时间窗口估算」的逻辑**降级为兜底**：仅当后端字段缺失（旧版后端）时才使用，
 * 以便灰度期前后端版本不一致时页面不出现空档。
 */
export const PROMOTION_FREEZE_DAYS = 10
export const PROMOTION_FREEZE_MS = PROMOTION_FREEZE_DAYS * 24 * 60 * 60 * 1000

/**
 * 当前生效的冻结天数（默认与后端一致取 10；仅在成功拿到提现规则的 `payLockDays` 时才覆盖）。
 * 用普通模块变量而非 ref：计算属性内部会读取它，配合下面的 setter 触发页面重算即可。
 */
let activeFreezeDays = PROMOTION_FREEZE_DAYS

/** 当前生效的冻结毫秒数（默认 10×24 小时，可被提现规则覆盖）。 */
let activeFreezeMs = PROMOTION_FREEZE_MS

/** 读取当前生效的冻结天数（供页面文案展示"最近 N 天"使用）。 */
export function getPromotionFreezeDays(): number {
  return activeFreezeDays
}

/** 读取当前生效的冻结毫秒数（供页面按窗口查询推广明细使用）。 */
export function getPromotionFreezeMs(): number {
  return activeFreezeMs
}

/**
 * 用接口下发值覆盖冻结天数。
 * 只接受正整数：接口失败 / 返回 0、负数、非数字时一律保持默认 10 天 ——
 * 宁可按更长的锁定期展示，也不能把锁定期改短，否则用户还是会看到"能转却转不了"。
 * 返回是否真的被覆盖（供调用方决定是否写入缓存）。
 */
export function setPromotionFreezeDays(value: unknown): boolean {
  const days = Number(value)
  if (!Number.isInteger(days) || days <= 0) return false
  activeFreezeDays = days
  activeFreezeMs = days * 24 * 60 * 60 * 1000
  return true
}

/** 提现规则缓存键：下拉刷新/重进页面时避免重复请求，同时保证后端改配置能较快生效。 */
const WITHDRAW_RULES_CACHE_KEY = 'promotion_withdraw_rules'
/** 提现规则缓存有效期（1 小时），过期后重新拉取。 */
const WITHDRAW_RULES_CACHE_TTL_MS = 60 * 60 * 1000
/** 提现规则请求 Promise 缓存，避免同一次页面加载内并发重复请求。 */
let withdrawRulesPromise: Promise<void> | null = null

/** 从本地缓存恢复上次拿到的锁定期天数（缓存过期或非法时忽略，保持默认 10 天）。 */
function restoreFreezeDaysFromCache(): void {
  try {
    const raw = uni.getStorageSync(WITHDRAW_RULES_CACHE_KEY)
    if (!raw) return
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const at = Number(parsed?.at)
    if (!Number.isFinite(at) || Date.now() - at > WITHDRAW_RULES_CACHE_TTL_MS) return
    setPromotionFreezeDays(parsed?.payLockDays)
  } catch {
    // 缓存损坏时保持默认值，不影响主流程
  }
}

/** 提取规则对象里的锁定期天数并写入缓存（接口成功时调用）。 */
function applyRulesAndCache(rules: { payLockDays?: number } | null | undefined): void {
  if (!setPromotionFreezeDays(rules?.payLockDays)) return
  try {
    uni.setStorageSync(WITHDRAW_RULES_CACHE_KEY, JSON.stringify({ payLockDays: getPromotionFreezeDays(), at: Date.now() }))
  } catch {
    // 缓存写入失败只影响下次的兜底来源，不影响本次展示
  }
}

/**
 * 用页面已经拉到的提现规则校准冻结天数（避免重复请求）。
 * 页面自身需要用提现规则做金额校验时，直接把手上的规则对象传进来即可。
 */
export function applyWithdrawPayLockDays(rules: { payLockDays?: number } | null | undefined): void {
  applyRulesAndCache(rules)
}

/**
 * 加载提现规则，把后端 `payLockDays` 同步成前端冻结天数。
 *
 * 兜底策略（三层，保证"拿不到就用 10 天"）：
 *   1. 接口成功且返回正整数 → 用接口值（并写入 1 小时缓存）；
 *   2. 接口失败 / 字段缺失 / 非法 → 用本地缓存（未过期时）或默认 10 天；
 *   3. 任何情况下都不会把锁定期改短成 0，避免展示口径比后端更宽松。
 * 页面调用后需自行触发一次冻结金额重算（页面的冻结金额计算属性依赖本模块状态）。
 */
export function loadWithdrawPayLockDays(): Promise<void> {
  if (withdrawRulesPromise) return withdrawRulesPromise
  const pending = (async () => {
    restoreFreezeDaysFromCache()
    try {
      applyRulesAndCache(await getWithdrawRules())
    } catch {
      // 提现规则属于展示型接口，失败时保持默认/缓存值即可，不打断推广页与个人页
    }
  })()
  withdrawRulesPromise = pending
  pending.then(
    () => { if (withdrawRulesPromise === pending) withdrawRulesPromise = null },
    () => { if (withdrawRulesPromise === pending) withdrawRulesPromise = null },
  )
  return pending
}

/**
 * 「尚未结算到账」的查询窗口：60 天。
 *
 * 后端会在支付后锁定期（payLockDays，默认 10 天）结束的那次定时任务里把推广金入账到钱包
 * `pendingPromotion`；但实测存在**超过 10 天仍未入账**的记录 —— 用户反馈：转余额后那笔推广金
 * 直接不显示了，要等后端约 1 小时的定时任务才恢复。因此这里用 60 天窗口兜住这类延迟，避免漏算。
 */
export const PROMOTION_SETTLEMENT_QUERY_DAYS = 60
export const PROMOTION_SETTLEMENT_QUERY_MS = PROMOTION_SETTLEMENT_QUERY_DAYS * 24 * 60 * 60 * 1000

/** 冻结/待到账明细分页拉取的每页条数与最大页数（防止异常数据量拖慢页面）。 */
export const PROMOTION_FREEZE_PAGE_SIZE = 100
export const PROMOTION_FREEZE_MAX_PAGES = 5

/** 将本地时间格式化为推广记录接口要求的查询格式。 */
export function formatPromotionQueryDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 只有有效订单产生的推广金才进入冻结展示。 */
export function isActivePromotionRecord(record: PromotionRecord): boolean {
  return [1, 2, 3, 4, 8].includes(Number(record.status))
}

/** 后端「待到账」状态值：PENDING=未过退款窗口、PROCESSING=入账占坑中间态（同样算待到账）。 */
const UNSETTLED_PROMOTION_STATUSES = ['PENDING', 'PROCESSING']

/**
 * 判断后端是否真的下发了「待到账推广金」字段。
 *
 * 只在拿到**合法数字**时才算下发：旧版后端不返回该字段（undefined）、或返回 null / 非数字时，
 * 调用方必须回退到按记录时间估算的兜底口径，不能把「字段缺失」当成「待到账为 0」。
 */
export function hasUnsettledPromotionAmount(source: { unsettledPromotion?: number } | null | undefined): boolean {
  return typeof source?.unsettledPromotion === 'number' && Number.isFinite(source.unsettledPromotion)
}

/**
 * 读取后端下发的待到账推广金（元）。
 * 字段缺失 / 非数字时返回 null，交由调用方决定是否走本地估算兜底。
 */
export function readUnsettledPromotionAmount(source: { unsettledPromotion?: number } | null | undefined): number | null {
  return hasUnsettledPromotionAmount(source) ? Number(source?.unsettledPromotion) : null
}

/**
 * 判断一条推广明细当前是否「待到账」（对应原「冻结」展示口径）。
 *
 * ★优先使用后端权威字段 `promotionStatus`：PENDING / PROCESSING → 待到账，CONFIRMED → 已入账；
 * 字段缺失（旧版后端）时才回退到原先的时间口径 —— 记录仍在支付后锁定期内即视为待到账。
 */
export function isUnsettledPromotion(record: PromotionRecord, now = Date.now()): boolean {
  const status = typeof record.promotionStatus === 'string' ? record.promotionStatus.trim().toUpperCase() : ''
  if (status) return UNSETTLED_PROMOTION_STATUSES.includes(status)
  // 兜底：后端未下发 promotionStatus，按记录时间与锁定期窗口判断（口径与后端提现锁一致）
  return isFrozenPromotion(record, now)
}

/**
 * 判断推广记录在指定时间是否仍处于冻结期内（**兜底口径**，后端 `promotionStatus` 缺失时使用）。
 * 默认按当前生效的锁定期（payLockDays，默认 10 天）判断，口径与后端提现锁一致。
 */
export function isFrozenPromotion(record: PromotionRecord, now = Date.now()): boolean {
  if (!isActivePromotionRecord(record)) return false
  const createdAt = Date.parse(String(record.createTime || '').replace(' ', 'T'))
  if (!Number.isFinite(createdAt)) return false
  const age = now - createdAt
  return age >= 0 && age < activeFreezeMs
}

/** 汇总指定推广记录中的待到账（原「冻结」）金额。优先按后端 `promotionStatus`，字段缺失时按时间口径。 */
export function getFrozenPromotionAmount(records: PromotionRecord[], now = Date.now()): number {
  return records
    .filter((record) => isUnsettledPromotion(record, now))
    .reduce((total, record) => {
      const amount = Number(record.amount)
      return total + (Number.isFinite(amount) && amount > 0 ? amount : 0)
    }, 0)
}

/**
 * 查询推广明细并汇总待到账金额（**兜底口径**：个人页与推广页统一使用）。
 *
 * ⚠️ 仅在确认后端未下发 `unsettledPromotion` 时才调用（用 hasUnsettledPromotionAmount 判断）：
 * 后端已下发时页面直接使用后端金额，再拉一次 60 天明细纯属浪费请求。
 *
 * 查询窗口用 60 天而非锁定期本身：冻结内的记录一定落在窗口内，窗口更大还能顺带覆盖
 * 「已过锁定期但后端尚未入账」的延迟记录；金额是否算待到账仍由 isUnsettledPromotion 判断。
 */
export async function loadFrozenPromotionAmount(now = Date.now()): Promise<number> {
  return getFrozenPromotionAmount(await loadRecentPromotionRecords(now), now)
}

/**
 * 分页拉取近 60 天的推广明细（供页面自行按锁定期/结算兜底口径汇总）。
 * 查询失败返回空数组：冻结金额属于增强展示，不能影响后端已确认金额的展示与转余额。
 */
export async function loadRecentPromotionRecords(now = Date.now()): Promise<PromotionRecord[]> {
  const startTime = formatPromotionQueryDate(now - PROMOTION_SETTLEMENT_QUERY_MS)
  const endTime = formatPromotionQueryDate(now)
  const recentRecords: PromotionRecord[] = []
  let page = 1
  let total = 0
  try {
    do {
      const result = await getPromotionRecords({ startTime, endTime, page, pageSize: PROMOTION_FREEZE_PAGE_SIZE })
      recentRecords.push(...(result.list || []))
      total = Number(result.total) || recentRecords.length
      page += 1
      if (!result.list?.length) break
    } while (recentRecords.length < total && page <= PROMOTION_FREEZE_MAX_PAGES)
    return recentRecords
  } catch {
    return []
  }
}
