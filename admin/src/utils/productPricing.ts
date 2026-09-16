/** 将金额转换为前端展示和提交使用的两位小数。 */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** 默认资金比例；后端提供配置接口后可由系统设置传入覆盖。 */
export const DEFAULT_PROMOTION_RATE = 0.2
export const DEFAULT_DIVIDEND_RATE = 0.26

let promotionRate = DEFAULT_PROMOTION_RATE
let dividendRate = DEFAULT_DIVIDEND_RATE

function normalizeRate(value: unknown, fallback: number): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : fallback
}

/** 同步系统设置里的两项默认比例到前端计算逻辑。 */
export function setFundRates(payload: { promotionRate?: unknown; dividendRate?: unknown }): void {
  if (payload.promotionRate !== undefined) promotionRate = normalizeRate(payload.promotionRate, DEFAULT_PROMOTION_RATE)
  if (payload.dividendRate !== undefined) dividendRate = normalizeRate(payload.dividendRate, DEFAULT_DIVIDEND_RATE)
}

/** 恢复商品资金比例的默认兜底值。 */
export function resetFundRates(): void {
  promotionRate = DEFAULT_PROMOTION_RATE
  dividendRate = DEFAULT_DIVIDEND_RATE
}

function getNonNegativeNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return undefined
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined
}

/** 计算商品最低价对应的默认推广资金。 */
export function getDefaultPromotionFund(minPrice: unknown, rate = promotionRate): number {
  const price = Number(minPrice)
  return Number.isFinite(price) && price > 0 && Number.isFinite(rate) && rate >= 0
    ? roundMoney(price * rate)
    : 0
}

/** 保留已设置的推广资金；只有空值才按最低价计算默认值。 */
export function resolvePromotionFund(promotionFund: unknown, minPrice: unknown, rate = promotionRate): number {
  const value = getNonNegativeNumber(promotionFund)
  return value === undefined ? getDefaultPromotionFund(minPrice, rate) : roundMoney(value)
}

/** 计算商品最低价对应的默认平台红包。 */
export function getDefaultDividendFund(minPrice: unknown, rate = dividendRate): number {
  const price = Number(minPrice)
  return Number.isFinite(price) && price > 0 && Number.isFinite(rate) && rate >= 0
    ? roundMoney(price * rate)
    : 0
}

/** 保留已设置的平台红包；只有空值才按最低价计算默认值。 */
export function resolveDividendFund(dividendFund: unknown, minPrice: unknown, rate = dividendRate): number {
  const value = getNonNegativeNumber(dividendFund)
  return value === undefined ? getDefaultDividendFund(minPrice, rate) : roundMoney(value)
}

/** 判断已保存金额是否仍对应当前默认比例，供编辑页恢复开关状态。 */
export function isDefaultFundAmount(
  amount: unknown,
  minPrice: unknown,
  getDefault: (minPrice: unknown) => number,
): boolean {
  const value = getNonNegativeNumber(amount)
  if (value === undefined) return false
  return Math.abs(roundMoney(value) - getDefault(minPrice)) < 0.005
}
