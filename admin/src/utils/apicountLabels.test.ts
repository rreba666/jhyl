import assert from 'node:assert/strict'
import test from 'node:test'
import {
  API_CALL_API_KEY_LABELS,
  apiCallApiKeyLabel,
  apiCallSharePercent,
  apiCallSubjectLabel,
  averageApiCallPerDay,
  buildApiCallTrendSeries,
  countApiCallDays,
  enumerateDays,
  formatApiCallCount,
  formatApiCallShare,
  formatApiCallTime,
  isKnownApiCallKey,
} from './apicountLabels.ts'

/**
 * 接口调用计数展示层单测（`node --test src/utils/apicountLabels.test.ts`，无需测试框架）。
 * 重点覆盖说明稿点名的坑：**trend 不补零**、日期只按 UTC 解析（不受本地时区影响）、
 * 未知 `apiKey` 不猜中文名、分母为 0 的占比不是 0.0%。
 */

test('主体类型：五类都有中文名，未知类型原样返回', () => {
  assert.equal(apiCallSubjectLabel('USER'), 'C 端用户')
  assert.equal(apiCallSubjectLabel('DELIVERY_PERSON'), '门店骑手')
  assert.equal(apiCallSubjectLabel('ANON'), '未登录（公开接口）')
  // 后端新增类型时不能显示空白，必须原样透出
  assert.equal(apiCallSubjectLabel('SOMETHING_NEW'), 'SOMETHING_NEW')
  assert.equal(apiCallSubjectLabel(null), '—')
})

test('接口 key：试点接口有中文名，未收录的原样返回并标记未知', () => {
  assert.equal(apiCallApiKeyLabel('delivery.quote'), '同城配送试算')
  assert.equal(apiCallApiKeyLabel('order.accept'), 'order.accept')
  assert.equal(isKnownApiCallKey('audit.ledger.query'), true)
  assert.equal(isKnownApiCallKey('order.accept'), false)
  // 兜底表必须与后端说明稿的 6 个试点接口一致
  assert.equal(Object.keys(API_CALL_API_KEY_LABELS).length, 6)
})

test('时间展示：只做字符串规范化，不经过 Date（不会因时区偏移一天）', () => {
  assert.equal(formatApiCallTime('2026-09-22T09:21:31'), '2026-09-22 09:21:31')
  assert.equal(formatApiCallTime('2026-09-22T09:21:31.123'), '2026-09-22 09:21:31')
  assert.equal(formatApiCallTime(null), '—')
})

test('次数千分位与占比', () => {
  assert.equal(formatApiCallCount(12345), '12,345')
  assert.equal(formatApiCallShare(1, 4), '25.0%')
  // 分母为 0 = "没有数据"，不能显示成 0.0%（那是"统计到了但为 0"）
  assert.equal(formatApiCallShare(0, 0), '—')
  assert.equal(apiCallSharePercent(50, 200), 25)
  assert.equal(apiCallSharePercent(5, 0), 0)
})

test('枚举自然日：闭区间、跨月、非法区间返回空', () => {
  assert.deepEqual(enumerateDays('2026-09-20', '2026-09-22'), ['2026-09-20', '2026-09-21', '2026-09-22'])
  assert.deepEqual(enumerateDays('2026-02-27', '2026-03-01'), ['2026-02-27', '2026-02-28', '2026-03-01'])
  assert.deepEqual(enumerateDays('2026-09-22', '2026-09-16'), [])
  assert.deepEqual(enumerateDays('not-a-date', '2026-09-22'), [])
  assert.equal(countApiCallDays('2026-09-16', '2026-09-22'), 7)
})

test('趋势补零：缺哪天就是那天为 0（后端 trend 不返回没有调用的日期）', () => {
  const { series, filledDays } = buildApiCallTrendSeries(
    [
      { statDate: '2026-09-16', cnt: 3 },
      { statDate: '2026-09-19', cnt: 5 },
    ],
    '2026-09-16',
    '2026-09-19',
  )
  assert.deepEqual(
    series.map((item) => `${item.statDate}:${item.cnt}`),
    ['2026-09-16:3', '2026-09-17:0', '2026-09-18:0', '2026-09-19:5'],
  )
  assert.equal(filledDays, 2)
})

test('趋势补零：区间外的点被丢弃且计入 missingKeys，区间非法时返回空', () => {
  const outside = buildApiCallTrendSeries([{ statDate: '2026-09-01', cnt: 9 }], '2026-09-20', '2026-09-21')
  assert.deepEqual(outside.series.map((item) => item.cnt), [0, 0])
  assert.equal(outside.missingKeys, 1)
  assert.deepEqual(buildApiCallTrendSeries([{ statDate: '2026-09-20', cnt: 1 }], 'bad', 'bad'), {
    series: [],
    filledDays: 0,
    missingKeys: 0,
  })
})

test('日均：分母是区间自然日数（含没有调用的日子），不是有调用的天数', () => {
  // 29 次 / 7 天 = 4.14…
  assert.equal(averageApiCallPerDay(29, '2026-09-16', '2026-09-22'), '4.1')
  assert.equal(averageApiCallPerDay(10, 'bad', 'bad'), '—')
})
