import assert from 'node:assert/strict'
import { aggregateSales, filterSalesByTimeRange } from '../src/utils/dashboardAnalytics.ts'
import type { SalesRecord } from '../src/types/dashboard.ts'

const records: SalesRecord[] = [
  {
    orderNo: 'ORD-001',
    productName: '苹果',
    nickname: '用户一',
    quantity: 2,
    price: 29.9,
    subtotal: 59.8,
    createTime: '2026-08-01 12:34:56',
    payTime: '2026-08-01 12:35:30',
    status: 1,
    statusDesc: '已支付',
  },
  {
    orderNo: 'ORD-002',
    productName: '苹果',
    nickname: '用户二',
    quantity: 1,
    price: 29.9,
    subtotal: 29.9,
    createTime: '2026-08-02 10:00:00',
    payTime: '',
    status: 1,
    statusDesc: '已支付',
  },
  {
    orderNo: 'ORD-003',
    productName: '',
    nickname: '用户三',
    quantity: 0,
    price: 0,
    subtotal: 0,
    createTime: 'invalid-date',
    payTime: '',
    status: 1,
    statusDesc: '已支付',
  },
]

const result = aggregateSales(records)
assert.equal(result.totalRecords, 3)
assert.equal(result.totalQuantity, 3)
assert.equal(result.totalAmount, 89.7)
assert.equal(result.averagePrice, 29.9)
assert.equal(result.productSales[0]?.name, '苹果')
assert.equal(result.productSales[0]?.quantity, 3)
assert.equal(result.productSales.at(-1)?.name, '未命名商品')
assert.equal(result.dailySales.length, 2)
assert.equal(result.dailySales[1]?.date, '2026-08-02')
assert.equal(filterSalesByTimeRange(records, '7', new Date('2026-08-02T12:00:00')).length, 2)
assert.equal(filterSalesByTimeRange(records, 'all', new Date('2026-08-02T12:00:00')).length, 3)
assert.deepEqual(records.map((record) => record.orderNo), ['ORD-001', 'ORD-002', 'ORD-003'])
console.log('dashboard analytics contract passed')
