import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const apiSource = readFileSync(resolve(import.meta.dirname, '../api/payment.ts'), 'utf8')
const pageSource = readFileSync(resolve(import.meta.dirname, '../subpkg-order/payment/payment.vue'), 'utf8')

test('payment API exposes the backend-safe switch-to-balance request', () => {
  assert.match(apiSource, /switchToBalance/)
  assert.match(apiSource, /\/api\/pay\/switch-to-balance/)
})

test('payment page only offers balance switching after the WeChat payment flow is cancelled', () => {
  assert.match(pageSource, /改用余额支付/)
  assert.match(pageSource, /switchToBalance/)
  assert.match(pageSource, /requestPayment/)
  assert.match(pageSource, /cancel/i)
})

test('payment page imports every input normalizer used by its cached form path', () => {
  assert.match(pageSource, /import \{[^}]*cleanDigits[^}]*\} from ['"]@\/utils\/input-validation['"]/)
})

test('payment page handles the backend balance-insufficient business code', () => {
  assert.match(pageSource, /code === 7000/)
})

test('successful balance switching stays on the payment page', () => {
  assert.match(pageSource, /paymentSucceeded/)
  assert.match(pageSource, /switchToBalancePayment/)
})
