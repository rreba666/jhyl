import { request } from './request'
import type {
  GhostCheckMeta,
  GhostInspectData,
  GhostInspectItem,
  GhostResponse,
  GhostSkippedCheck,
} from '@/types/ghost-inspect'

/**
 * 幽灵单巡检接口层。
 *
 * 依据：`docs/20269231438/幽灵单巡检-前端对接说明-2026-09-23.md` §1（接口）。
 *
 * | 方法 | 路径 | 副作用 |
 * |---|---|---|
 * | GET | `/api/admin/order/ghost-inspect` | ⚠️ **有**：白名单内的项会做零资金风险的自动收敛 |
 * | GET | `/api/admin/order/ghost-inspect/checks` | 无 |
 */

function unwrap<T>(response: { data: GhostResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 数字字段兜底（后端可能给 null；`NaN` 会让模板渲染成空白）。 */
function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 字符串数组兜底（`undefined` 会让 `.length` 直接抛错）。 */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 命中项归一化：补齐数组/数字/可空字段，避免页面因缺字段整页崩。 */
function normalizeItem(value: unknown): GhostInspectItem {
  const row = (value || {}) as Partial<GhostInspectItem>
  return {
    key: String(row.key ?? ''),
    label: String(row.label ?? ''),
    severity: (row.severity ?? 'RISK') as GhostInspectItem['severity'],
    count: toNumber(row.count),
    newCount: toNumber(row.newCount),
    legacyCount: toNumber(row.legacyCount),
    sampleKind: row.sampleKind ?? null,
    samples: toStringArray(row.samples),
    suggestion: String(row.suggestion ?? ''),
    autoFixable: Boolean(row.autoFixable),
    fixed: toNumber(row.fixed),
    fixNote: row.fixNote ?? null,
  }
}

/** 跳过项归一化。 */
function normalizeSkipped(value: unknown): GhostSkippedCheck {
  const row = (value || {}) as Partial<GhostSkippedCheck>
  return {
    key: String(row.key ?? ''),
    label: String(row.label ?? ''),
    severity: (row.severity ?? 'RISK') as GhostSkippedCheck['severity'],
    error: String(row.error ?? ''),
  }
}

/**
 * 跑一次幽灵单巡检。
 *
 * ⚠️ **有副作用**：`autoFixable=true` 且在 `autoFixEnabledChecks` 白名单内的项，
 * 后端会做**零资金风险**的收敛动作（返回 `fixedTotal` / `fixed` 供如实展示）。
 * 涉及资金的项后端设计上绝不自动动钱，前端也**不提供"一键修复"按钮**（后端没有该接口）。
 *
 * @param types 只跑指定项（key 数组）；不传 = **全跑 27 项**。
 *   传了拼错的 key **不会静默缩范围**，会回传到 `data.unknownTypes[]` ⇒ 页面必须提示。
 */
export async function runGhostInspect(types?: string[]): Promise<GhostInspectData> {
  // 手拼 query（逗号分隔）：后端约定 `?types=KEY1,KEY2`，空数组等价于"不传"
  const keys = (types || []).filter((key) => !!key)
  const query = keys.length ? `?types=${encodeURIComponent(keys.join(','))}` : ''
  const data = unwrap(
    await request.get<GhostResponse<GhostInspectData>>(`/api/admin/order/ghost-inspect${query}`),
    '幽灵单巡检执行失败',
  )
  const row = (data || {}) as Partial<GhostInspectData>
  return {
    newTotal: toNumber(row.newTotal),
    total: toNumber(row.total),
    fixedTotal: toNumber(row.fixedTotal),
    checkedTypes: toNumber(row.checkedTypes),
    allChecks: toNumber(row.allChecks),
    executedTypes: toNumber(row.executedTypes),
    unknownTypes: toStringArray(row.unknownTypes),
    baselineKeys: toStringArray(row.baselineKeys),
    autoFixEnabledChecks: toStringArray(row.autoFixEnabledChecks),
    skippedChecks: Array.isArray(row.skippedChecks) ? row.skippedChecks.map(normalizeSkipped) : [],
    items: Array.isArray(row.items) ? row.items.map(normalizeItem) : [],
  }
}

/**
 * 检查项字典（**不执行任何 SQL，无副作用**）。
 *
 * 用途：拿到 `baselined` 判断某项要不要渲染"新增/存量"拆分 UI，
 * 以及用 `allChecks` 展示"本次跑了 x / 27 项"。
 */
export async function getGhostCheckMetas(): Promise<GhostCheckMeta[]> {
  const data = unwrap(
    await request.get<GhostResponse<GhostCheckMeta[]>>('/api/admin/order/ghost-inspect/checks'),
    '巡检项字典查询失败',
  )
  return Array.isArray(data) ? data : []
}
