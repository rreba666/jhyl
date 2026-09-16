import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const apiSource = readFileSync(resolve(import.meta.dirname, '../api/user.ts'), 'utf8')
const pageSource = readFileSync(resolve(import.meta.dirname, '../subpkg-wallet/withdraw/withdraw.vue'), 'utf8')

test('withdraw API accepts both payment methods and an idempotency key', () => {
  assert.match(apiSource, /export type WithdrawMethod = 'WECHAT_BALANCE' \| 'BANK_CARD'/)
  assert.match(apiSource, /idempotencyKey: string/)
  assert.match(apiSource, /withdrawWallet\(amount: number, type: WithdrawType, withdrawMethod: WithdrawMethod, idempotencyKey: string\)/)
  assert.match(apiSource, /amount: Number\(amount\.toFixed\(2\)\)/)
  assert.match(apiSource, /idempotencyKey,/)
})

test('withdraw page reuses a key for the same active request and sends the selected method', () => {
  assert.match(pageSource, /pendingWithdrawIdempotencyKey/)
  assert.match(pageSource, /pendingWithdrawFingerprint/)
  assert.match(pageSource, /function getWithdrawIdempotencyKey\(/)
  assert.match(pageSource, /withdrawOption\.value === 'BANK_CARD' \? 'BANK_CARD' : 'WECHAT_BALANCE'/)
  assert.match(pageSource, /withdrawWallet\(amount, 'BALANCE', withdrawMethod, idempotencyKey\)/)
  assert.match(pageSource, /watch\(withdrawAmount, \(next, previous\) =>/)
  assert.match(pageSource, /if \(withdrawSubmitting\.value\) return[\s\S]*clearWithdrawRequestContext\(\)/)
  assert.match(pageSource, /class="panel-input"[^>]*:disabled="withdrawSubmitting"/)
})

test('withdraw entry exits before validation while a submission is active', () => {
  const start = pageSource.indexOf('async function handleWithdraw()')
  const body = pageSource.slice(start, start + 500)
  assert.ok(start >= 0, 'handleWithdraw should exist')
  assert.match(body, /if \(withdrawSubmitting\.value\) return/)
})
