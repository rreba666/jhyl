import assert from 'node:assert/strict'
import { resolvePromotionFund } from '../src/utils/productPricing.ts'

assert.equal(resolvePromotionFund(0, 999), 299.7)
assert.equal(resolvePromotionFund(null, 29.9), 8.97)
assert.equal(resolvePromotionFund(123.456, 999), 123.46)
assert.equal(resolvePromotionFund(0, 0), 0)
console.log('product promotion fund contract passed')
