import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanText,
  normalizeEditableMobile,
  validateAmount,
  validateBankCard,
  validateEmail,
  validateIdCard,
  validateMobile,
  validatePositiveInteger,
  validateTaxNumber,
} from '../utils/input-validation.ts'

test('cleanText removes controls and surrounding whitespace but preserves normal text', () => {
  assert.equal(cleanText('  上海\u0000浦东 😊  '), '上海浦东 😊')
})

test('validateMobile accepts mainland mobile numbers and rejects malformed numbers', () => {
  assert.equal(validateMobile('13812341234').ok, true)
  assert.equal(validateMobile('12812341234').ok, false)
  assert.equal(validateMobile('1381234123').ok, false)
})

test('normalizeEditableMobile clears masked values but keeps a complete mobile number', () => {
  assert.equal(normalizeEditableMobile('188****0536'), '')
  assert.equal(normalizeEditableMobile(' 138 1234 1234 '), '13812341234')
})

test('validateIdCard rejects invalid date and checksum', () => {
  assert.equal(validateIdCard('110101199003077758').ok, true)
  assert.equal(validateIdCard('110101199002307758').ok, false)
  assert.equal(validateIdCard('110101199003077759').ok, false)
})

test('validateBankCard normalizes spaces but rejects non-digits and bad length', () => {
  assert.equal(validateBankCard('6222 0212 3456 7890 123').value, '6222021234567890123')
  assert.equal(validateBankCard('622202123456789012').ok, true)
  assert.equal(validateBankCard('abc622202123456789012').ok, false)
})

test('validateAmount rejects more than two decimals and scientific notation', () => {
  assert.equal(validateAmount('1.20', { label: '提现金额', min: 1 }).value, 1.2)
  assert.equal(validateAmount('1.234', { label: '提现金额', min: 1 }).ok, false)
  assert.equal(validateAmount('1e2', { label: '提现金额', min: 1 }).ok, false)
})

test('validatePositiveInteger rejects decimal, negative and scientific notation IDs', () => {
  assert.equal(validatePositiveInteger('90011').ok, true)
  assert.equal(validatePositiveInteger('1.2').ok, false)
  assert.equal(validatePositiveInteger('-1').ok, false)
  assert.equal(validatePositiveInteger('1e3').ok, false)
})

test('validateEmail rejects repeated dots and validateTaxNumber requires digits', () => {
  assert.equal(validateEmail('user..name@example.com').ok, false)
  assert.equal(validateTaxNumber('ABCDEFGHIJKLMNOPQ').ok, false)
})
