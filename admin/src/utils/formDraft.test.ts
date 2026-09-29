import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearFormDraft,
  draftStorageKey,
  formatDraftAge,
  hasDraftContent,
  loadFormDraft,
  saveFormDraft,
} from './formDraft.ts'

/**
 * `formDraft` 单元测试（Node 内置 test runner，与项目其他 `*.test.ts` 同风格）。
 *
 * 重点覆盖三类**容易出错且后果严重**的行为：
 * 1. **按用户隔离** —— 后台多人共用电脑，隔离失效会让 A 的草稿被 B 看到；
 * 2. **坏数据兜底** —— 存储内容被改坏时不能抛错打断表单（并顺手清掉）；
 * 3. **存储不可用降级** —— 无痕模式 / 配额满时 `localStorage` 抛异常，草稿必须静默失败。
 *
 * ⚠️ Node 里没有 `localStorage`，所以这里替换 `globalThis.localStorage` 为内存实现；
 * 需要模拟"存储抛异常"时再换成会抛的实现。每个用例结束后还原。
 */

/** 内存版 Storage，行为对齐浏览器 `localStorage` 的四个方法。 */
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null { return this.map.has(key) ? (this.map.get(key) as string) : null }
  setItem(key: string, value: string): void { this.map.set(key, value) }
  removeItem(key: string): void { this.map.delete(key) }
  clear(): void { this.map.clear() }
}

/** 会抛异常的 Storage，模拟 Safari 无痕模式 / 配额超限。 */
class ThrowingStorage {
  getItem(): string | null { throw new Error('storage denied') }
  setItem(): void { throw new Error('quota exceeded') }
  removeItem(): void { throw new Error('storage denied') }
  clear(): void { throw new Error('storage denied') }
}

const globalRef = globalThis as unknown as { localStorage: unknown }
const originalStorage = globalRef.localStorage

/** 每个用例前装上内存存储。 */
function useMemoryStorage(): MemoryStorage {
  const storage = new MemoryStorage()
  globalRef.localStorage = storage
  return storage
}

/** 用例收尾：还原原始的 localStorage。 */
function restoreStorage(): void {
  globalRef.localStorage = originalStorage
}

/** 静音 `console.warn`（降级路径会打日志，测试输出不必被它刷屏），返回还原函数。 */
function silenceWarn(): () => void {
  const original = console.warn
  console.warn = () => {}
  return () => { console.warn = original }
}

/* ===================== draftStorageKey ===================== */

test('draftStorageKey: 按用户隔离，不同用户/不同表单互不覆盖', () => {
  assert.notEqual(draftStorageKey('shop', 'u1'), draftStorageKey('shop', 'u2'))
  assert.notEqual(draftStorageKey('shop', 'u1'), draftStorageKey('product', 'u1'))
})

test('draftStorageKey: userId 为空时退化为 anonymous 而不是抛错', () => {
  assert.ok(draftStorageKey('shop', null).includes('anonymous'))
  assert.ok(draftStorageKey('shop', undefined).includes('anonymous'))
  assert.ok(draftStorageKey('shop', '').includes('anonymous'))
})

test('draftStorageKey: 数字与同值字符串得到同一个键', () => {
  assert.equal(draftStorageKey('shop', 7), draftStorageKey('shop', '7'))
})

/* ===================== hasDraftContent ===================== */

test('hasDraftContent: 空值一律判为无内容', () => {
  assert.equal(hasDraftContent(null), false)
  assert.equal(hasDraftContent(undefined), false)
  assert.equal(hasDraftContent(''), false)
  assert.equal(hasDraftContent('   '), false)
  assert.equal(hasDraftContent([]), false)
  assert.equal(hasDraftContent({}), false)
})

test('hasDraftContent: 全空表单对象判为无内容（避免弹无意义的已恢复草稿提示）', () => {
  assert.equal(hasDraftContent({ name: '', address: '', merchantId: '', latitude: undefined }), false)
})

test('hasDraftContent: 任一字段有值即判为有内容', () => {
  assert.equal(hasDraftContent({ name: '门店A', address: '' }), true)
})

test('hasDraftContent: 数字 0 与布尔 false 视为用户明确填写的值', () => {
  assert.equal(hasDraftContent({ latitude: 0 }), true)
  assert.equal(hasDraftContent({ flag: false }), true)
})

test('hasDraftContent: 嵌套对象与数组递归判断', () => {
  assert.equal(hasDraftContent({ a: { b: '' } }), false)
  assert.equal(hasDraftContent({ a: { b: 'x' } }), true)
  assert.equal(hasDraftContent({ list: [''] }), false)
  assert.equal(hasDraftContent({ list: ['x'] }), true)
})

/* ===================== formatDraftAge ===================== */

test('formatDraftAge: 无时间戳返回空串', () => {
  assert.equal(formatDraftAge(0, 1_700_000_000_000), '')
})

test('formatDraftAge: 按分钟/小时/天换算', () => {
  const now = 1_700_000_000_000
  assert.equal(formatDraftAge(now - 30_000, now), '刚刚')
  assert.equal(formatDraftAge(now - 5 * 60_000, now), '5 分钟前')
  assert.equal(formatDraftAge(now - 3 * 3_600_000, now), '3 小时前')
  assert.equal(formatDraftAge(now - 2 * 86_400_000, now), '2 天前')
})

/* ===================== save / load / clear ===================== */

test('保存后能按同一用户读回，且带时间戳', () => {
  useMemoryStorage()
  try {
    const before = Date.now()
    assert.equal(saveFormDraft('shop', { name: '门店A' }, 'u1').saved, true)
    const draft = loadFormDraft<{ name: string }>('shop', 'u1')
    assert.equal(draft?.data.name, '门店A')
    assert.ok((draft?.at ?? 0) >= before)
  } finally { restoreStorage() }
})

test('⚠️ 不同用户互不可见（多人共用电脑的关键保障）', () => {
  useMemoryStorage()
  try {
    saveFormDraft('shop', { name: 'A 的草稿' }, 'u1')
    assert.equal(loadFormDraft('shop', 'u2'), null)
  } finally { restoreStorage() }
})

test('清除后读不到', () => {
  useMemoryStorage()
  try {
    saveFormDraft('shop', { name: 'x' }, 'u1')
    clearFormDraft('shop', 'u1')
    assert.equal(loadFormDraft('shop', 'u1'), null)
  } finally { restoreStorage() }
})

test('⚠️ 内容被改坏时按无草稿处理并顺手清掉，不抛错', () => {
  const storage = useMemoryStorage()
  const restoreWarn = silenceWarn()
  try {
    storage.setItem(draftStorageKey('shop', 'u1'), '{不是合法 JSON')
    assert.equal(loadFormDraft('shop', 'u1'), null)
    // 已被清掉，避免每次打开都报错
    assert.equal(storage.getItem(draftStorageKey('shop', 'u1')), null)
  } finally { restoreWarn(); restoreStorage() }
})

test('缺少 data 字段的旧格式按无草稿处理', () => {
  const storage = useMemoryStorage()
  try {
    storage.setItem(draftStorageKey('shop', 'u1'), JSON.stringify({ at: 1 }))
    assert.equal(loadFormDraft('shop', 'u1'), null)
  } finally { restoreStorage() }
})

test('⚠️ localStorage 抛异常时（无痕/配额满）静默降级，不阻断表单', () => {
  const restoreWarn = silenceWarn()
  globalRef.localStorage = new ThrowingStorage()
  try {
    assert.equal(saveFormDraft('shop', { name: 'x' }, 'u1').saved, false)
    assert.equal(loadFormDraft('shop', 'u1'), null)
    assert.doesNotThrow(() => clearFormDraft('shop', 'u1'))
  } finally { restoreWarn(); restoreStorage() }
})
