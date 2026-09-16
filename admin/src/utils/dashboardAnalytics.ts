import type { DashboardAnalytics, DashboardTimeRange, DailySales, ProductSales, SalesRecord } from '../types/dashboard.ts'

const EMPTY_PRODUCT_NAME = '未命名商品'

function toNumber(value: unknown): number {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function getSalesProductName(value: string): string {
  return value.trim() || EMPTY_PRODUCT_NAME
}

function toDateKey(value: string): string | null {
  const text = value.trim()
  if (!text) return null

  const parsed = new Date(text.includes('T') ? text : text.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return null

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getSalesDateKey(record: SalesRecord): string | null {
  return toDateKey(record.payTime || '') || toDateKey(record.createTime || '')
}

function dateToKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 按最近天数过滤记录，日期范围以当天为结束日期。 */
export function filterSalesByTimeRange(records: SalesRecord[], range: DashboardTimeRange, anchorDate = new Date()): SalesRecord[] {
  if (range === 'all') return records

  const endDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate())
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - Number(range) + 1)
  const startKey = dateToKey(startDate)
  const endKey = dateToKey(endDate)

  return records.filter((record) => {
    const dateKey = getSalesDateKey(record)
    return Boolean(dateKey && dateKey >= startKey && dateKey <= endKey)
  })
}

/** 将全量购买记录聚合为仪表盘指标、商品排行和日期趋势。 */
export function aggregateSales(records: SalesRecord[]): DashboardAnalytics {
  const productMap = new Map<string, ProductSales>()
  const dailyMap = new Map<string, DailySales>()
  let totalQuantity = 0
  let totalAmount = 0

  for (const record of records) {
    const quantity = toNumber(record.quantity)
    const amount = toNumber(record.subtotal)
    const productName = getSalesProductName(record.productName)

    totalQuantity += quantity
    totalAmount += amount

    const product = productMap.get(productName) || { name: productName, quantity: 0, amount: 0 }
    product.quantity += quantity
    product.amount += amount
    productMap.set(productName, product)

    const date = getSalesDateKey(record)
    if (!date) continue
    const daily = dailyMap.get(date) || { date, quantity: 0, amount: 0 }
    daily.quantity += quantity
    daily.amount += amount
    dailyMap.set(date, daily)
  }

  const productSales = [...productMap.values()]
    .map((item) => ({ ...item, amount: roundMoney(item.amount) }))
    .sort((a, b) => b.quantity - a.quantity || b.amount - a.amount || a.name.localeCompare(b.name))
  const dailySales = [...dailyMap.values()]
    .map((item) => ({ ...item, amount: roundMoney(item.amount) }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const normalizedAmount = roundMoney(totalAmount)

  return {
    totalRecords: records.length,
    totalQuantity,
    totalAmount: normalizedAmount,
    averagePrice: totalQuantity ? roundMoney(normalizedAmount / totalQuantity) : 0,
    productSales,
    dailySales,
  }
}
