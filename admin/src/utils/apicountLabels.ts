import type { ApiCallSubjectType, ApiCallTrendPoint } from '@/types/apicount'

/**
 * 接口调用计数（apicount）的展示翻译层。
 *
 * 这里只做「后端值 → 人话」的映射与纯计算，**不发请求、不依赖组件**，因此可以直接被单测覆盖
 * （见 `apicountLabels.test.ts`，用 `node --test src/utils/apicountLabels.test.ts` 运行）。
 *
 * 设计取舍：接口 key（`apiKey`）的**权威中文名应由后端下发**，但 apicount 目前没有字典端点
 * （对比留痕台账已有 `/ledger/operations`）→ 这里用**试点接口硬编码表**兜底，
 * 未收录的 key **原样展示并标注「未收录」**，绝不猜名字（猜错比不翻更糟）。
 */

/** 主体类型的中文名（`USER` / `STAFF` / `DELIVERY_PERSON` / `ADMIN` / `ANON`）。 */
export const API_CALL_SUBJECT_LABELS: Record<string, string> = {
  USER: 'C 端用户',
  STAFF: '门店店员',
  DELIVERY_PERSON: '门店骑手',
  ADMIN: '平台管理员',
  ANON: '未登录（公开接口）',
}

/** 主体类型筛选下拉项（含"全部"）。 */
export const API_CALL_SUBJECT_OPTIONS: Array<{ value: '' | ApiCallSubjectType; label: string }> = [
  { value: '', label: '全部主体' },
  { value: 'USER', label: 'C 端用户（USER）' },
  { value: 'STAFF', label: '门店店员（STAFF）' },
  { value: 'DELIVERY_PERSON', label: '门店骑手（DELIVERY_PERSON）' },
  { value: 'ADMIN', label: '平台管理员（ADMIN）' },
  { value: 'ANON', label: '未登录（ANON）' },
]

/**
 * 主体类型的展示文案（未知类型原样返回，避免把后端新增类型显示成空白）。
 * ⚠️ 主体 ID 的含义**随类型变化**，页面上必须与类型一起展示。
 */
export function apiCallSubjectLabel(type?: string | null): string {
  const key = String(type || '').trim()
  if (!key) return '—'
  return API_CALL_SUBJECT_LABELS[key] || key
}

/**
 * 已知（后端试点已接入计数的）接口 key → 中文名。
 * 来源：后端说明稿第四节「试点已接入 6 个关键接口（覆盖全部主体类型）」。
 * ⚠️ 这只是**兜底映射**，不是权威字典；后端新增接入点后这里会滞后，未收录的 key 会被标注出来。
 */
export const API_CALL_API_KEY_LABELS: Record<string, string> = {
  'delivery.quote': '同城配送试算',
  'delivery.user.confirm-receive': '用户确认收货',
  'delivery.merchant.accept': '商家接单',
  'delivery.rider.accept': '骑手接单',
  'delivery.admin.save-rule': '后台保存配送规则',
  'audit.ledger.query': '留痕台账查询',
}

/** 接口 key 的展示文案：命中兜底表 → 中文名；未命中 → 原样返回 key（页面会另行标注"未收录"）。 */
export function apiCallApiKeyLabel(apiKey?: string | null): string {
  const key = String(apiKey || '').trim()
  if (!key) return '—'
  return API_CALL_API_KEY_LABELS[key] || key
}

/** 该接口 key 是否已被前端兜底表收录（未收录时页面要提示"中文名待后端补字典"）。 */
export function isKnownApiCallKey(apiKey?: string | null): boolean {
  const key = String(apiKey || '').trim()
  return Boolean(key) && Object.prototype.hasOwnProperty.call(API_CALL_API_KEY_LABELS, key)
}

/**
 * 时间展示：后端为 `yyyy-MM-ddTHH:mm:ss`（ISO 本地时间、**无时区后缀**）。
 * 与 `formatLedgerTime` 同策略：只做字符串规范化，**不经过 `new Date()`**，避免浏览器时区导致时间漂移。
 */
export function formatApiCallTime(value?: string | null): string {
  if (!value) return '—'
  return String(value).replace('T', ' ').replace(/\.\d+$/, '').slice(0, 19)
}

/** 次数千分位（大数字在表格里一眼可读）。 */
export function formatApiCallCount(value?: number | null): string {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  return num.toLocaleString('zh-CN')
}

/**
 * 占比文案（用于排行的条形与百分比列）。
 * 分母为 0 时返回 `—`（不是 `0.0%`：那是"统计到了但为 0"，与"没有数据"不是一回事）。
 */
export function formatApiCallShare(cnt?: number | null, total?: number | null): string {
  const numerator = Number(cnt)
  const denominator = Number(total)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return '—'
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

/** 占比数值（0~100，供 `el-progress` 使用；分母为 0 时返回 0）。 */
export function apiCallSharePercent(cnt?: number | null, total?: number | null): number {
  const numerator = Number(cnt)
  const denominator = Number(total)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return Math.min(100, Math.max(0, (numerator / denominator) * 100))
}

/**
 * 把 `yyyy-MM-dd` 解析成 UTC 毫秒（**只用 UTC，避开本地时区把日期挪一天**）。
 * 格式不合法返回 null，调用方自行兜底。
 */
function parseDayMs(day: string): number | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '').trim())
  if (!matched) return null
  const year = Number(matched[1])
  const month = Number(matched[2])
  const date = Number(matched[3])
  const ms = Date.UTC(year, month - 1, date)
  return Number.isFinite(ms) ? ms : null
}

/** UTC 毫秒 → `yyyy-MM-dd`。 */
function formatDayMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * 枚举 `from` ~ `to`（**闭区间**）之间的所有自然日。
 * 区间非法（格式错误或 from > to）时返回空数组；区间过长时由调用方自行限制（后端默认只给 7 天）。
 */
export function enumerateDays(from: string, to: string): string[] {
  const startMs = parseDayMs(from)
  const endMs = parseDayMs(to)
  if (startMs === null || endMs === null || endMs < startMs) return []
  const days: string[] = []
  const dayMs = 24 * 60 * 60 * 1000
  // 上限保护：避免异常区间把页面卡死（10 年 ≈ 3650 天，足够覆盖任何正常用法）
  for (let ms = startMs; ms <= endMs && days.length < 3660; ms += dayMs) {
    days.push(formatDayMs(ms))
  }
  return days
}

/** 区间天数（闭区间；非法区间返回 0）。 */
export function countApiCallDays(from: string, to: string): number {
  return enumerateDays(from, to).length
}

/**
 * 趋势折线用数据：**按 `from..to` 补齐没有调用的日期**。
 *
 * 为什么必须补：后端 `trend` 对**没有成功调用的日期不返回该行**（说明稿第三节 + 实测），
 * 直接把返回数组丢给 ECharts，折线会把 09-18 直接连到 09-20，看起来像"那天没数据"而不是"那天是 0"。
 *
 * @returns `series` 为区间内每一天（`cnt` 缺失补 0）；`filledDays` 为补零的天数（用于页面提示）。
 *          区间非法时 `series` 为空数组。
 */
export function buildApiCallTrendSeries(
  points: ApiCallTrendPoint[],
  from: string,
  to: string,
): { series: ApiCallTrendPoint[]; filledDays: number; missingKeys: number } {
  const days = enumerateDays(from, to)
  const map = new Map<string, number>()
  let missingKeys = 0
  ;(points || []).forEach((point) => {
    const day = String(point?.statDate || '').trim()
    if (!day) return
    // 落在区间外的点直接丢弃（后端不应返回，但传错区间时不至于把图撑坏）
    if (days.length && !days.includes(day)) {
      missingKeys += 1
      return
    }
    map.set(day, Number(point.cnt) || 0)
  })
  if (!days.length) return { series: [], filledDays: 0, missingKeys }
  const series = days.map((day) => ({ statDate: day, cnt: map.has(day) ? Number(map.get(day)) || 0 : 0 }))
  const filledDays = series.filter((item) => item.cnt === 0 && !map.has(item.statDate)).length
  return { series, filledDays, missingKeys }
}

/**
 * 日均成功调用次数（总量 ÷ 区间天数，保留 1 位小数）。
 * ⚠️ 分母是**区间自然日数**（含没有调用的日子），不是"有调用的天数" —— 后者会把日均算虚高。
 */
export function averageApiCallPerDay(totalCnt: number, from: string, to: string): string {
  const days = countApiCallDays(from, to)
  const total = Number(totalCnt)
  if (!days || !Number.isFinite(total)) return '—'
  return (total / days).toFixed(1)
}
