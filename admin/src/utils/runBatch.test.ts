import assert from 'node:assert/strict'
import test from 'node:test'
import { runBatch } from './runBatch.ts'

test('runs each item once, caps concurrency, and reports independent failures', async () => {
  let active = 0
  let peak = 0

  const result = await runBatch([1, 2, 3, 4], async (item) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    active -= 1
    if (item === 2) throw new Error('item failed')
  }, 2)

  assert.equal(peak, 2)
  assert.deepEqual(result.succeeded.sort(), [1, 3, 4])
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0]?.item, 2)
  assert.equal((result.failed[0]?.error as Error).message, 'item failed')
})
