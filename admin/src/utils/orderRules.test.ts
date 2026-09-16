import assert from 'node:assert/strict'
import test from 'node:test'
import { isDeletableOrderStatus } from './orderRules.ts'

test('only completed, closed, and refunded orders are deletable', () => {
  for (const status of [4, 5, 7]) assert.equal(isDeletableOrderStatus(status), true)
  for (const status of [0, 1, 2, 3, 6]) assert.equal(isDeletableOrderStatus(status), false)
})

