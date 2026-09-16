/** 将前端展示值和后端存储值互相转换。 */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** 将后端的小数比例转换为百分比展示值。 */
export function toDisplayFundRate(rate: unknown): number {
  const value = Number(rate)
  if (!Number.isFinite(value) || value < 0) return 0
  return roundMoney(value <= 1 ? value * 100 : value)
}

/** 将百分比展示值转换为后端存储的小数比例。 */
export function fromDisplayFundRate(rate: unknown): number {
  const value = Number(rate)
  if (!Number.isFinite(value) || value < 0) return 0
  return roundMoney(value / 100)
}
