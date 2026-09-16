import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const apiSource = readFileSync(resolve(import.meta.dirname, '../api/realname.ts'), 'utf8')
const sheetSource = readFileSync(resolve(import.meta.dirname, '../components/RealnameVerifySheet.vue'), 'utf8')
const withdrawSource = readFileSync(resolve(import.meta.dirname, '../subpkg-wallet/withdraw/withdraw.vue'), 'utf8')

test('realname API exposes upload-backed OCR and image URL fields', () => {
  assert.match(apiSource, /ocrRealname/)
  assert.match(apiSource, /\/api\/realname\/ocr/)
  assert.match(apiSource, /idCardFrontUrl\?: string/)
  assert.match(apiSource, /idCardBackUrl\?: string/)
})

test('realname sheet supports front/back photo upload and OCR autofill', () => {
  assert.match(sheetSource, /chooseImage/)
  assert.match(sheetSource, /uploadFile/)
  assert.match(sheetSource, /ocrRealname/)
  assert.match(sheetSource, /身份证正面/)
  assert.match(sheetSource, /身份证反面/)
  assert.match(sheetSource, /idCardFrontUrl/)
  assert.match(sheetSource, /idCardBackUrl/)
})

test('bank-card withdrawal requires bank details while other actions keep them optional', () => {
  assert.match(sheetSource, /requiredBankInfo/)
  assert.match(sheetSource, /银行卡号为必填项/)
  assert.match(sheetSource, /银行预留手机号为必填项/)
  assert.match(withdrawSource, /:required-bank-info="withdrawOption === 'BANK_CARD'"/)
})

test('withdraw flow trusts the verified result returned by the backend', () => {
  assert.match(withdrawSource, /async function handleRealnameVerified\(status: RealnameStatus\)/)
  assert.match(withdrawSource, /realnameVerified\.value = status\.verified/)
})
