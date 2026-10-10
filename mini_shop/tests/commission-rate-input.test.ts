import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MERCHANT_COMMISSION_RATE_EDIT_PLACEHOLDER,
  normalizeCommissionRateInput,
  parseMerchantCommissionRateInput,
  parseProductCommissionRateInput,
  validateMerchantCommissionRate,
} from '../utils/product-commission.ts'

/**
 * 让利比例输入解析（3~20）的**边界 + 归一化**单测。
 *
 * 起因（2026-10-10 商家真机反馈）：「输入 3% 不生效，只有纯数字才行」——
 * 根因是 `Number('3%')` 是 `NaN`，于是把**表达了合法意图**的输入判成越界
 * （弹「让利比例必须在 3%~20% 之间」），看起来像"根本改不了"。
 *
 * ⚠️ 本文件只钉两件事（都是**口径**，不是文案）：
 * 1. **区间是闭区间**：`3` 与 `20` 必须收（用户报的 `3` 正是下限），`2.99` / `20.01` 必须拒；
 * 2. **归一化只解决"写法"**：`3%` / `３` / 零宽字符 ⇒ 3，但 `0.5` / `21` 归一化后照样拒。
 */
test('区间边界：3 与 20 收（闭区间），2.99 与 20.01 拒', () => {
  assert.deepEqual(parseProductCommissionRateInput('3'), { kind: 'value', value: 3 })
  assert.deepEqual(parseProductCommissionRateInput('20'), { kind: 'value', value: 20 })
  assert.equal(parseProductCommissionRateInput('2.99').kind, 'invalid')
  assert.equal(parseProductCommissionRateInput('20.01').kind, 'invalid')
  // 下限边界再确认一次校验入口：3 **不**报错（这正是用户报「3 不生效」的那条路径）
  assert.equal(validateMerchantCommissionRate('3'), null)
  assert.equal(validateMerchantCommissionRate('2.99'), '让利比例必须在 3%~20% 之间')
})

test('小数合法：5.5 / 5.5% / ３．５ 都算 5.5 档（比例是百分数，允许两位小数）', () => {
  assert.deepEqual(parseProductCommissionRateInput('5.5'), { kind: 'value', value: 5.5 })
  assert.deepEqual(parseProductCommissionRateInput('5.5%'), { kind: 'value', value: 5.5 })
  assert.deepEqual(parseProductCommissionRateInput('３．５'), { kind: 'value', value: 3.5 })
})

test('百分号与首尾空白都归一：3% / ３％ / " 3 % " / "3　" ⇒ 3', () => {
  for (const input of ['3%', '3％', ' 3% ', ' 3％ ', '3 %', '3\u3000']) {
    assert.deepEqual(parseProductCommissionRateInput(input), { kind: 'value', value: 3 }, `input=${JSON.stringify(input)}`)
  }
})

test('中文输入法全角数字与零宽字符都算噪音：３ ⇒ 3、3<ZWSP> ⇒ 3', () => {
  assert.deepEqual(parseProductCommissionRateInput('３'), { kind: 'value', value: 3 })
  assert.deepEqual(parseProductCommissionRateInput('３%'), { kind: 'value', value: 3 })
  assert.deepEqual(parseProductCommissionRateInput('3\u200b'), { kind: 'value', value: 3 })
  assert.deepEqual(parseProductCommissionRateInput('\u200b3'), { kind: 'value', value: 3 })
})

test('归一化后的写法可见：normalizeCommissionRateInput 是纯函数且只去写法噪音', () => {
  assert.equal(normalizeCommissionRateInput(' ３％ '), '3')
  assert.equal(normalizeCommissionRateInput('5.5%'), '5.5')
  assert.equal(normalizeCommissionRateInput(''), '')
  assert.equal(normalizeCommissionRateInput(null), '')
})

test('只输了一个 %（归一化后什么都不剩）判 invalid，不是 unset —— 不能静默吞掉用户输入', () => {
  // `unset` 的语义是"留空 ⇒ 不提交这个字段"；把 `%` 判成 unset，用户敲的东西就静默消失了。
  assert.equal(parseProductCommissionRateInput('%').kind, 'invalid')
  assert.equal(parseProductCommissionRateInput('  %  ').kind, 'invalid')
  assert.equal(parseProductCommissionRateInput('3%%').kind, 'invalid')
})

test('留空仍旧是 unset（= 不提交该字段，既不是 0 也不是平台默认）', () => {
  assert.deepEqual(parseProductCommissionRateInput(''), { kind: 'unset' })
  assert.deepEqual(parseProductCommissionRateInput('   '), { kind: 'unset' })
  assert.deepEqual(parseProductCommissionRateInput(null), { kind: 'unset' })
  assert.deepEqual(parseProductCommissionRateInput(undefined), { kind: 'unset' })
})

test('归一化不放宽口径：越界与非法写法照样拒', () => {
  for (const input of ['0.5', '2.99', '2.99%', '21', '20.01%', 'abc', '3,5', '3。', '%3', '-3', '3-5']) {
    assert.equal(parseProductCommissionRateInput(input).kind, 'invalid', `input=${JSON.stringify(input)}`)
  }
})

test('商户级与商品级共用同一份解析（同输入同结论，不会两级漂移）', () => {
  for (const input of ['3', '3%', '２５', '5.5', '', '%', '20.01']) {
    assert.deepEqual(
      parseMerchantCommissionRateInput(input),
      parseProductCommissionRateInput(input),
      `input=${JSON.stringify(input)}`,
    )
  }
})

test('自助调整弹层的占位就是区间「3~20」（用户唯一能看到的区间提示）', () => {
  assert.equal(MERCHANT_COMMISSION_RATE_EDIT_PLACEHOLDER, '3~20')
})
