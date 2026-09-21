import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLedgerDiff,
  buildCategoryLabelMap,
  formatCoverageRate,
  formatLedgerTime,
  isLedgerChangeRecord,
  isSkippedLedger,
  ledgerCategoryLabel,
  ledgerOperatorText,
  ledgerResultMeta,
  ledgerTargetText,
} from './ledgerLabels.ts'

/**
 * 留痕台账展示层单测（`node --test src/utils/ledgerLabels.test.ts`，无需测试框架）。
 * 重点覆盖文档里点名的坑：SKIPPED 前值不可信、快照是 JSON 字符串可能为 null、
 * 状态码要翻译、金额 null 显示 "—"（不是 0.00）。
 */

test('变更类：订单状态码翻译成中文的「前 → 后」', () => {
  const rows = buildLedgerDiff('{"status":"0"}', '{"status":"1"}')
  assert.deepEqual(rows, [{ key: 'status', label: '状态', before: '待支付', after: '已支付' }])
})

test('变更类：配送状态码翻译成中文', () => {
  const rows = buildLedgerDiff('{"delivery_status":"WAIT_ACCEPT"}', '{"delivery_status":"DELIVERING"}')
  assert.equal(rows[0].before, '待商家接单')
  assert.equal(rows[0].after, '配送中')
})

test('变更类：库存快照按可售/锁定/合计展示', () => {
  const rows = buildLedgerDiff('{"skuId":801031,"available":48,"locked":0,"total":48}', '{"skuId":801031,"available":49,"locked":0,"total":49}')
  assert.deepEqual(
    rows.map((row) => `${row.label}:${row.before}→${row.after}`),
    ['SKU ID:801031→801031', '可售:48→49', '锁定:0→0', '合计（可售+锁定）:48→49'],
  )
})

test('变更类：金额方向翻译，渠道支付 null 显示 "—" 而不是 0.00', () => {
  const rows = buildLedgerDiff('{"amount":6.0000,"direction":2}', '{"balanceAfter":null,"beforeAmount":null}')
  assert.deepEqual(
    rows.map((row) => `${row.label}:${row.before}→${row.after}`),
    ['金额:6.00→—', '方向:支出→—', '变动后余额:—→—', '变动前余额:—→—'],
  )
})

test('动作类：前后快照都是 null 时没有对比行（不要渲染空对比框）', () => {
  assert.deepEqual(buildLedgerDiff(null, null), [])
  assert.equal(isLedgerChangeRecord({ beforeJson: null, afterJson: null }), false)
  assert.equal(isLedgerChangeRecord({ beforeJson: '{"status":"0"}', afterJson: null }), true)
})

test('脏 JSON：解析失败返回空数组而不是抛错', () => {
  assert.deepEqual(buildLedgerDiff('not-json', '{oops'), [])
  assert.deepEqual(buildLedgerDiff('[1,2,3]', null), [])
})

test('result 展示与 SKIPPED 识别', () => {
  assert.deepEqual(ledgerResultMeta('SUCCESS'), { label: '成功', tag: 'success' })
  assert.deepEqual(ledgerResultMeta('FAILURE'), { label: '失败', tag: 'danger' })
  assert.deepEqual(ledgerResultMeta('INCONSISTENT'), { label: '不一致', tag: 'warning' })
  assert.deepEqual(ledgerResultMeta('SKIPPED'), { label: '未改成', tag: 'info' })
  assert.deepEqual(ledgerResultMeta(null), { label: '—', tag: 'info' })
  assert.equal(isSkippedLedger({ result: 'SKIPPED' }), true)
  assert.equal(isSkippedLedger({ result: 'SUCCESS' }), false)
})

test('分类标签：null 显示 "(历史数据)"，未知枚举原样回显，命中字典用中文', () => {
  const map = buildCategoryLabelMap([{ value: 'ORDER_STATUS', label: '订单状态' }])
  assert.equal(ledgerCategoryLabel(null, map), '(历史数据)')
  assert.equal(ledgerCategoryLabel('ORDER_STATUS', map), '订单状态')
  assert.equal(ledgerCategoryLabel('NEW_CATEGORY', map), 'NEW_CATEGORY')
})

test('操作人展示：operatorName 为空时回退 类型#ID', () => {
  assert.equal(ledgerOperatorText({ operatorName: '张三', operatorType: 'ADMIN', operatorId: '12' }), '张三')
  assert.equal(ledgerOperatorText({ operatorName: null, operatorType: 'SYSTEM', operatorId: '0' }), 'SYSTEM#0')
  assert.equal(ledgerOperatorText({ operatorName: null, operatorType: '', operatorId: '' }), '—')
})

test('目标展示：类型中文化 + 目标 ID', () => {
  assert.equal(ledgerTargetText({ targetType: 'ORDER', targetId: 'ORD123' }), '订单 ORD123')
  assert.equal(ledgerTargetText({ targetType: 'PRODUCT_SKU', targetId: '801022' }), '商品 SKU 801022')
  assert.equal(ledgerTargetText({ targetType: null, targetId: null }), '—')
})

test('时间展示：ISO 本地时间转可读格式（不做时区换算）', () => {
  assert.equal(formatLedgerTime('2026-09-19T22:59:57'), '2026-09-19 22:59:57')
  assert.equal(formatLedgerTime('2026-09-19T22:59:57.123'), '2026-09-19 22:59:57')
  assert.equal(formatLedgerTime(null), '—')
})

test('覆盖率展示：0.142 → 14.2%', () => {
  assert.equal(formatCoverageRate(0.142), '14.2%')
  assert.equal(formatCoverageRate(null), '—')
})
