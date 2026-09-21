import { auditTargetTypeLabel, operatorTypeLabel } from './labels.ts'
import type { LedgerCategoryOption, LedgerDiffRow, LedgerRecord } from '../types/ledger.ts'

/**
 * 留痕台账的展示翻译层（枚举中文化 + 快照解析 + 「前 → 后」对比构建）。
 * 依据：`docs/audit-9-categories.md` §3.1 结果、§3.2 操作人、§3.3 目标类型、§3.4 状态码翻译表、§七 已知限制。
 *
 * ⚠️ 约定（沿用 `utils/labels.ts`）：**未知枚举一律原样回显**，方便发现后端新增状态。
 */

/** 操作人类型中文（`operatorType`）：复用 `labels.ts` 的映射（已含平台级角色）。 */
export { operatorTypeLabel }

/** 目标类型中文（`targetType`）：复用 `labels.ts` 的映射（已含 `PRODUCT_SKU`/`FINANCE_FLOW` 等）。 */
export { auditTargetTypeLabel as ledgerTargetTypeLabel }

/** 历史数据标记（`category` 为 null 的行，不要隐藏）。 */
export const LEDGER_LEGACY_CATEGORY_LABEL = '(历史数据)'

/**
 * `result='SKIPPED'` 的警示文案。
 * 条件 UPDATE 未命中时该行前值取自 SQL 的 WHERE 条件，而条件恰恰**没命中** —— 前值可能断言一个库里从未存在的状态。
 */
export const LEDGER_SKIPPED_HINT = '本次未改成（前值不可信）'

/** 结果枚举 → 展示文案与标签颜色（§3.1）。 */
export function ledgerResultMeta(result?: string | null): { label: string; tag: 'success' | 'warning' | 'info' | 'danger' } {
  switch (result) {
    case 'SUCCESS':
      return { label: '成功', tag: 'success' }
    case 'FAILURE':
      return { label: '失败', tag: 'danger' }
    case 'SKIPPED':
      return { label: '未改成', tag: 'info' }
    case 'INCONSISTENT':
      return { label: '不一致', tag: 'warning' }
    default:
      // null = 语义为空（灰色）
      return { label: result || '—', tag: 'info' }
  }
}

/** 本行 `beforeJson` 是否不可信（§七.2）。 */
export function isSkippedLedger(row: Pick<LedgerRecord, 'result'>): boolean {
  return row.result === 'SKIPPED'
}

/** 分类字典 → `枚举名: 中文标签` 映射（供表格/时间线渲染）。 */
export function buildCategoryLabelMap(options: LedgerCategoryOption[]): Record<string, string> {
  return options.reduce<Record<string, string>>((map, option) => {
    if (option.value) map[option.value] = option.label || option.value
    return map
  }, {})
}

/** 分类展示：字典命中用中文标签，`null` 显示"(历史数据)"，未知枚举原样回显。 */
export function ledgerCategoryLabel(category: string | null | undefined, labelMap: Record<string, string>): string {
  if (!category) return LEDGER_LEGACY_CATEGORY_LABEL
  return labelMap[category] || category
}

/** 订单交易主状态（§3.4）。 */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  '0': '待支付',
  '1': '已支付',
  '2': '已发货',
  '3': '已收货',
  '4': '已完成',
  '5': '已关闭',
  '6': '退款中',
  '7': '已退款',
  '8': '已核销完成',
}

/** 配送状态（§3.4）。 */
export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  WAIT_ACCEPT: '待商家接单',
  ACCEPTED: '商家已接单',
  PREPARING: '备货中',
  WAIT_ASSIGN: '待安排配送',
  ASSIGNED: '已分配配送员',
  PICKED_UP: '已取货',
  DELIVERING: '配送中',
  NEARBY: '已到达附近',
  DELIVERED: '已送达',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  CANCEL_REQUESTED: '取消申请中',
  EXCEPTION: '配送异常',
  PAUSED: '商家已暂停',
}

/** 订单状态码 → 中文；未知原样回显。 */
export function orderStatusLabel(value: unknown): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return ORDER_STATUS_LABELS[key] || key
}

/** 配送状态码 → 中文；未知原样回显。 */
export function deliveryStatusLabel(value: unknown): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return DELIVERY_STATUS_LABELS[key] || key
}

/** 快照字段的中文名（表格「字段」列）。 */
const SNAPSHOT_KEY_LABELS: Record<string, string> = {
  status: '状态',
  delivery_status: '配送状态',
  skuId: 'SKU ID',
  available: '可售',
  locked: '锁定',
  total: '合计（可售+锁定）',
  inTransit: '在途',
  amount: '金额',
  direction: '方向',
  beforeAmount: '变动前余额',
  balanceAfter: '变动后余额',
  accountType: '账户类型',
}

/** 金额类字段（展示两位小数，null 显示 "—" 而不是 "0.00"）。 */
const MONEY_SNAPSHOT_KEYS = new Set(['amount', 'beforeAmount', 'balanceAfter'])

/**
 * 单个快照值的展示翻译。
 * - `status` → 订单状态中文；`delivery_status` → 配送状态中文；
 * - `direction` → 收入/支出（§6.4：1=收入，2=支出）；
 * - 金额字段 → 两位小数；⚠️ 微信渠道支付的 `beforeAmount`/`balanceAfter` 为 null 是**语义正确**的，显示"—"。
 */
export function formatSnapshotValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (key === 'status') return orderStatusLabel(value)
  if (key === 'delivery_status') return deliveryStatusLabel(value)
  if (key === 'direction') {
    if (String(value) === '1') return '收入'
    if (String(value) === '2') return '支出'
    return String(value)
  }
  if (MONEY_SNAPSHOT_KEYS.has(key)) {
    const amount = Number(value)
    return Number.isFinite(amount) ? amount.toFixed(2) : String(value)
  }
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * 安全解析快照 JSON 字符串（§七.7：是字符串不是对象，且可能为 null）。
 * 解析失败返回 null，**不抛错**（留痕是追溯数据，单行脏数据不能拖垮整页）。
 */
export function parseLedgerSnapshot(raw?: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 是否"变更类"事件（有前后快照）—— 动作类两者均为 null，只显示 `detail`，不要渲染空对比框。 */
export function isLedgerChangeRecord(row: Pick<LedgerRecord, 'beforeJson' | 'afterJson'>): boolean {
  return Boolean(row.beforeJson || row.afterJson)
}

/**
 * 构建「前 → 后」对比行。
 * - 只在一侧出现的字段也会成行（另一侧显示"—"）；
 * - 字段顺序：先按变更前的顺序，再补变更后新增的字段；
 * - 两侧都解析不出（含脏 JSON）时返回空数组 → 调用方回退到只显示 `detail`。
 */
export function buildLedgerDiff(beforeJson?: string | null, afterJson?: string | null): LedgerDiffRow[] {
  const before = parseLedgerSnapshot(beforeJson)
  const after = parseLedgerSnapshot(afterJson)
  if (!before && !after) return []
  const keys: string[] = []
  for (const key of Object.keys(before || {})) if (!keys.includes(key)) keys.push(key)
  for (const key of Object.keys(after || {})) if (!keys.includes(key)) keys.push(key)
  return keys.map((key) => ({
    key,
    label: SNAPSHOT_KEY_LABELS[key] || key,
    before: formatSnapshotValue(key, (before || {})[key]),
    after: formatSnapshotValue(key, (after || {})[key]),
  }))
}

/** 原始快照的展示文本（详情抽屉里展示 16 字段用，保持后端原文）。 */
export function ledgerRawSnapshot(value?: string | null): string {
  return value ?? '—'
}

/**
 * 操作人展示：`operatorName` 为空时回退为 `operatorType#operatorId`（§5.2：系统发起时 name 为 null）。
 */
export function ledgerOperatorText(row: Pick<LedgerRecord, 'operatorName' | 'operatorType' | 'operatorId'>): string {
  if (row.operatorName) return row.operatorName
  if (!row.operatorType && !row.operatorId) return '—'
  return `${row.operatorType || '未知'}#${row.operatorId || '0'}`
}

/** 目标展示：`目标类型 目标ID`（两者都空显示"—"）。 */
export function ledgerTargetText(row: Pick<LedgerRecord, 'targetType' | 'targetId'>): string {
  const type = row.targetType ? auditTargetTypeLabel(row.targetType) : ''
  const id = row.targetId || ''
  if (!type && !id) return '—'
  return `${type || '未知'}${id ? ` ${id}` : ''}`
}

/**
 * 时间展示：后端为 `yyyy-MM-ddTHH:mm:ss`（ISO 本地时间、**无时区后缀**）。
 * 这里只做字符串规范化，不经过 `new Date()`，避免浏览器时区差异导致时间漂移。
 */
export function formatLedgerTime(value?: string | null): string {
  if (!value) return '—'
  return String(value).replace('T', ' ').replace(/\.\d+$/, '').slice(0, 19)
}

/** `requestId` 覆盖率 → 百分比文案（null 显示"—"）。 */
export function formatCoverageRate(rate?: number | null): string {
  if (rate === null || rate === undefined || !Number.isFinite(Number(rate))) return '—'
  return `${(Number(rate) * 100).toFixed(1)}%`
}
