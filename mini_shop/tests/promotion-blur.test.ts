import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pageSource = readFileSync(resolve(import.meta.dirname, '../subpkg-wallet/dividend/dividend.vue'), 'utf8')
const configSource = readFileSync(resolve(import.meta.dirname, '../project.config.json'), 'utf8')
const loginSource = readFileSync(resolve(import.meta.dirname, '../pages/login/login.vue'), 'utf8')

test('promotion balance card uses the high-resolution background slice', () => {
  // ⚠️ 2026-09-22 修正：项目早前做过「全量转 WebP」，`dividend.vue` 里这张背景图已经是
  // `推广背景@2x.webp`，而断言还停留在 `.png` → 这条测试已红了很久（与海报换图无关，顺手修）。
  assert.match(pageSource, /src="\/static\/Promotion\/推广背景_slices\/推广背景@2x\.webp"/)
})

test('publish config keeps the active high-resolution background and excludes the duplicate poster', () => {
  assert.doesNotMatch(configSource, /"value":\s*"static\/Promotion\/推广背景_slices\/推广背景@2x\.png"/)
  assert.match(configSource, /"value":\s*"static\/bg\/推广码背景\.png"/)
  assert.match(configSource, /"value":\s*"static\/Promotion\/推广背景_slices\/推广背景\.png"/)
})

test('production login source does not print authentication secrets', () => {
  assert.doesNotMatch(loginSource, /console\.log\([^\n]*(?:token|authData|Bearer)/i)
})
