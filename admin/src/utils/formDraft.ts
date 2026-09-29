/**
 * 表单草稿工具（2026-09-29 新增）。
 *
 * ## 为什么需要
 * 后台的长表单（门店、商品、商家入驻…）字段多，运营常常填到一半去查资料、或误关弹窗 / 刷新页面，
 * **未保存的内容会全部丢失**，只能重填。这里用 `localStorage` 自动暂存草稿，下次打开自动恢复。
 *
 * ## ⚠️ 三条设计约束
 * 1. **按登录用户隔离**：后台常有多人共用一台电脑，草稿必须带 `userId` 前缀，
 *    否则 A 的草稿会被 B 看到（既困扰又可能泄露手机号等经营信息）。
 * 2. **只在「新增」时用**：编辑既有记录时，表单里是**服务端数据**，
 *    若也存草稿，用户下次打开会看到"过期的本地修改"覆盖真实数据，比丢失更糟。
 * 3. **保存成功后必须清**，否则下次新增还会冒出上一条已提交的内容。
 *
 * ## ⚠️ 存储失败要吞掉
 * Safari 无痕模式 / 配额满 / 用户禁用存储时 `localStorage` 会抛异常。
 * 草稿是**锦上添花**的功能，**绝不能因为它失败而阻断表单主流程**。
 */

/** 草稿在 localStorage 里的 key 前缀，便于统一清理与排查。 */
const DRAFT_PREFIX = 'admin_form_draft'

/** 保存草稿的结果，供调用方（可选地）给用户提示。 */
export interface DraftSaveResult {
  /** 是否真的写入成功（false = 存储不可用或超限，已静默降级）。 */
  saved: boolean
}

/**
 * 计算某个表单草稿的存储键。
 *
 * @param name   表单标识（同一表单用同一个字符串，如 `'shop'`）
 * @param userId 当前登录管理员 ID；为空时退化为 `anonymous`，
 *   此时**不做用户隔离**（未登录理论上进不来后台，属于兜底）
 */
export function draftStorageKey(name: string, userId?: string | number | null): string {
  const owner = userId === null || userId === undefined || userId === '' ? 'anonymous' : String(userId)
  return `${DRAFT_PREFIX}:${name}:${owner}`
}

/**
 * 保存草稿。
 *
 * ⚠️ 只存**可 JSON 序列化的普通数据**。文件对象（`File` / `Blob`）**无法序列化**，
 * 调用方要先把文件上传拿到 URL 再存（本项目的表单存的都是 URL 字符串，符合要求）。
 */
export function saveFormDraft(name: string, data: unknown, userId?: string | number | null): DraftSaveResult {
  try {
    localStorage.setItem(draftStorageKey(name, userId), JSON.stringify({ at: Date.now(), data }))
    return { saved: true }
  } catch (error) {
    // 配额超限 / 隐私模式禁用存储：静默降级，不影响表单本身
    console.warn('[form-draft] 草稿保存失败（已忽略，不影响表单使用）：', error)
    return { saved: false }
  }
}

/** 草稿读取结果。 */
export interface DraftReadResult<T> {
  data: T
  /** 草稿的写入时间戳（毫秒）。 */
  at: number
}

/**
 * 读取草稿；没有草稿、格式损坏或存储不可用时返回 `null`。
 *
 * @param name   表单标识
 * @param userId 当前登录管理员 ID
 */
export function loadFormDraft<T>(name: string, userId?: string | number | null): DraftReadResult<T> | null {
  try {
    const raw = localStorage.getItem(draftStorageKey(name, userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: number; data?: T }
    if (!parsed || typeof parsed !== 'object' || parsed.data === undefined) return null
    return { data: parsed.data, at: typeof parsed.at === 'number' ? parsed.at : 0 }
  } catch (error) {
    // 内容被改坏 / 存储不可用：当作没有草稿，并顺手清掉，避免每次打开都报错
    console.warn('[form-draft] 草稿读取失败（已按无草稿处理）：', error)
    clearFormDraft(name, userId)
    return null
  }
}

/** 清除草稿（保存成功后必须调用）。存储不可用时静默忽略。 */
export function clearFormDraft(name: string, userId?: string | number | null): void {
  try {
    localStorage.removeItem(draftStorageKey(name, userId))
  } catch (error) {
    console.warn('[form-draft] 草稿清除失败（已忽略）：', error)
  }
}

/**
 * 判断一份草稿数据是否「实际有内容」（避免把全空对象当成草稿恢复，弹无意义的提示）。
 *
 * 规则：字符串非空、数组非空、数字/布尔视为有值、对象递归判断。
 * `null` / `undefined` / `''` / `[]` / `{}` 都算空。
 */
export function hasDraftContent(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.some((item) => hasDraftContent(item))
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => hasDraftContent(item))
  }
  // 数字 / 布尔：0 与 false 也可能是用户明确填的值，故一律算"有内容"
  return true
}

/** 把时间戳格式化成「几分钟前」这种易读文案，用于「已恢复 X 前的草稿」提示。 */
export function formatDraftAge(at: number, now: number = Date.now()): string {
  if (!at || at <= 0) return ''
  const diff = Math.max(0, now - at)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  return `${Math.floor(diff / day)} 天前`
}
