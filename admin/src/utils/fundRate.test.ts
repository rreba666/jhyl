import assert from 'node:assert/strict'
import test from 'node:test'
import { fromDisplayFundRate, toDisplayFundRate } from './fundRate.ts'

test('fund rate helpers convert decimal storage to percentage display', () => {
  assert.equal(toDisplayFundRate(0.2), 20)
  assert.equal(toDisplayFundRate(0.26), 26)
})

test('fund rate helpers convert percentage display back to decimal storage', () => {
  assert.equal(fromDisplayFundRate(20), 0.2)
  assert.equal(fromDisplayFundRate(26), 0.26)
})
