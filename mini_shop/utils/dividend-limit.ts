/** 红包商品的购买限制由后端规则决定；当前后端默认门槛为 1970 元。 */
export const DIVIDEND_PRICE_THRESHOLD = 1970
export const DIVIDEND_PURCHASE_LIMIT = 3
export const PURCHASE_LIMIT_ERROR_CODE = 3002
export const PURCHASE_LIMIT_MESSAGE = '一个账号一个补贴周期内最多同时存在三件商品哦'

export type EnabledFlag = 0 | 1 | '0' | '1' | boolean | null | undefined

export function isEnabledFlag(value: EnabledFlag): boolean {
  return value === 1 || value === '1' || value === true
}

/** 只有开启红包且 SKU 实际成交价达到门槛时，才占用补贴周期名额。 */
export function isDividendEligible(input: { dividendEnabled?: EnabledFlag; price?: number | string | null }): boolean {
  const price = Number(input.price)
  return isEnabledFlag(input.dividendEnabled) && Number.isFinite(price) && price >= DIVIDEND_PRICE_THRESHOLD
}

/** 汇总购物车中已经识别为红包商品的数量。 */
export function getDividendQuantity(items: Array<{ quantity?: number | string; dividendEligible?: boolean }>): number {
  return items.reduce((total, item) => {
    if (!item.dividendEligible) return total
    const quantity = Number(item.quantity)
    return total + (Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0)
  }, 0)
}
