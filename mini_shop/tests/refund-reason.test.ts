import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanRefundReason,
  QUICK_REFUND_REASONS,
  REFUND_REASON_MAX_LENGTH,
  refundReasonCharCount,
  validateRefundReason,
} from '../utils/refund-reason.ts'

/**
 * 退款理由的清洗/校验单测。
 *
 * 重点覆盖三类真会踩到的坑：
 * 1. **后端正则比想象中严**：表情符号、`/`、`~`、`%` 都会被拒（用户填完才报错）；
 * 2. **多行理由不能被拼成一行**：项目通用的 `cleanText()` 会删掉 `\n`，理由专用清洗必须保留换行；
 * 3. **快捷理由标签自己必须先过关**：写错一条（例如含 `/`）会让用户一点就提交失败。
 */

test('必填时拒绝空理由，非必填时空理由合法', () => {
  const required = validateRefundReason('   ')
  assert.equal(required.ok, false)
  assert.equal(required.ok === false && required.message, '请填写退款理由')

  const optional = validateRefundReason('', { required: false })
  assert.equal(optional.ok, true)
  assert.equal(optional.ok === true && optional.value, '')
})

test('清洗：保留换行、归一全角空格、去掉零宽与控制字符', () => {
  // \u3000 全角空格 → 半角；\u200B 零宽空格被删除；首尾空白被 trim
  assert.equal(cleanRefundReason('\u3000不想要了\u200B  '), '不想要了')
  // 多行理由必须保留换行（这是 cleanText() 做不到的地方）
  assert.equal(cleanRefundReason('买错了\n\n\n要退款'), '买错了\n\n要退款')
  assert.equal(cleanRefundReason('a\r\nb'), 'a\nb')
  // 连续空格合并
  assert.equal(cleanRefundReason('不想要   了'), '不想要 了')
})

test('长度按字符计：200 通过、201 拒绝', () => {
  const ok200 = validateRefundReason('好'.repeat(REFUND_REASON_MAX_LENGTH))
  assert.equal(ok200.ok, true)
  assert.equal(ok200.ok === true && refundReasonCharCount(ok200.value), REFUND_REASON_MAX_LENGTH)

  const tooLong = validateRefundReason('好'.repeat(REFUND_REASON_MAX_LENGTH + 1))
  assert.equal(tooLong.ok, false)
})

test('后端正则：中文英文数字与常用标点通过，表情/斜杠/波浪号被拒', () => {
  const accepted = validateRefundReason('商品有质量问题，不想要了！(2026-09-22)')
  assert.equal(accepted.ok, true)
  // 表情符号不在白名单里（后端正则只收中文/字母/数字/空白/常用标点）
  assert.equal(validateRefundReason('不想要了😊').ok, false)
  assert.equal(validateRefundReason('退款/退货').ok, false)
  assert.equal(validateRefundReason('不想要了~').ok, false)
  assert.equal(validateRefundReason('折扣 50%').ok, false)
})

test('快捷理由标签必须全部能通过校验（否则用户一点就失败）', () => {
  assert.ok(QUICK_REFUND_REASONS.length > 0)
  for (const reason of QUICK_REFUND_REASONS) {
    const result = validateRefundReason(reason)
    assert.equal(result.ok, true, `快捷理由未通过校验：${reason}`)
  }
})
