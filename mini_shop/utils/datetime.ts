/**
 * 时间工具（小程序端统一入口）
 *
 * 后端下发的时间是 ISO 8601（如 `2026-09-17T15:47:08`，可能带毫秒或时区）。
 *
 * ⚠️ 小程序里**不要**把这种字符串直接丢给 `new Date()`：iOS（JavaScriptCore）解析带 `T` 的
 * 非标准格式会得到 `Invalid Date`，算出来的时长就是 `NaN` —— 表现就是骑手端详情页「配送时长」一直显示 `—`
 * （开发者工具的 V8 能容忍，真机 iOS 不能，所以本地测不出来）。
 *
 * 统一在这里按字段拆出年月日时分秒，再交给 `new Date(y, m, d, h, mi, s)` 构造。
 */

/** ISO 时间字符串 → `[年, 月(0基), 日, 时, 分, 秒]`；解析失败返回 null。 */
function parseParts(value?: string | null): number[] | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value ?? '').trim())
  if (!matched) return null
  return [
    Number(matched[1]),
    Number(matched[2]) - 1,
    Number(matched[3]),
    Number(matched[4]),
    Number(matched[5]),
    Number(matched[6] || 0),
  ]
}

/** 补零。 */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `YYYY-MM-DD HH:mm:ss`（设计稿口径；解析不了原样返回，空值给占位符）。 */
export function formatDateTime(value?: string | null, fallback = '—'): string {
  const parts = parseParts(value)
  if (!parts) return value ? String(value) : fallback
  return `${parts[0]}-${pad(parts[1] + 1)}-${pad(parts[2])} ${pad(parts[3])}:${pad(parts[4])}:${pad(parts[5])}`
}

/** `HH:mm:ss`（详情页头部「送达时间：10:52:00」）。 */
export function formatClock(value?: string | null, fallback = ''): string {
  const parts = parseParts(value)
  if (!parts) return value ? String(value).slice(-8) : fallback
  return `${pad(parts[3])}:${pad(parts[4])}:${pad(parts[5])}`
}

/** ISO 时间 → 毫秒时间戳（解析不了返回 `NaN`）。 */
export function parseTime(value?: string | null): number {
  const parts = parseParts(value)
  if (!parts) return NaN
  return new Date(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]).getTime()
}

/** 两个时间之间的时长（分钟）；缺值 / 非法 / 倒挂返回占位符。 */
export function durationMinutesText(from?: string | null, to?: string | null, fallback = '—'): string {
  const start = parseTime(from)
  const end = parseTime(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return fallback
  return `${Math.round((end - start) / 60000)} 分钟`
}
