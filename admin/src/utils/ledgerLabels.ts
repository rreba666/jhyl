import { auditTargetTypeLabel, operatorTypeLabel } from './labels.ts'
import type { LedgerCategoryOption, LedgerDiffRow, LedgerOption, LedgerRecord } from '../types/ledger.ts'

/**
 * 留痕台账的展示翻译层（枚举中文化 + 快照解析 + 「前 → 后」对比构建）。
 * 依据：`docs/audit-9-categories.md` §3.1 结果、§3.2 操作人、§3.3 目标类型、§3.4 状态码翻译表、§七 已知限制。
 *
 * ⚠️ 本文件定位（2026-09-21 更新）：**后端已提供权威字典** ——
 * `GET /api/admin/ledger/operations`（操作码中文字典）、`GET /api/admin/ledger/target-types`（目标类型权威枚举），
 * 且 `AuditRecordView` 新增 `operationDesc`（操作码中文名，`/ledger` `/unified` `/timeline` `/by-request` 都下发）。
 * 因此**展示一律优先用后端数据**（`operationDesc` / 字典接口），本文件里的映射表**只作兜底**：
 * 字典接口未上线、断网、后端漏下发 `operationDesc`、或后端尚未收录该操作码时，页面仍能显示可读中文。
 * ⚠️ **本表不要删**（删了兜底就没了，风险大于收益）；新增操作码优先请后端补字典，而不是往这里堆。
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

/**
 * 产生方积木（`block`）→ 中文。
 * 依据：`docs/audit-9-categories.md` §4.1 与第二节「真实生产者」列（实测 12 个值）。
 * 同时导出为下拉选项（`LEDGER_BLOCK_OPTIONS`），筛选下拉与展示共用一份映射，避免两处维护。
 * ⚠️ 与其它枚举同约定：**未知值原样回显**（不要显示"未知"，方便发现后端新增积木名）。
 */
export const LEDGER_BLOCK_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'delivery', label: '配送' },
  { value: 'shop', label: '门店' },
  { value: 'wallet', label: '钱包' },
  { value: 'staff', label: '员工' },
  { value: 'platform', label: '平台' },
  { value: 'audit', label: '审计' },
  { value: 'framework', label: '框架' },
  { value: 'external', label: '外部服务' },
  { value: 'promotion', label: '推广' },
  { value: 'bonus', label: '红包' },
  { value: 'aftersale', label: '售后' },
  { value: 'demo-mall', label: '演示商城' },
]

/** 产生方积木 → 中文映射（由 `LEDGER_BLOCK_OPTIONS` 派生，单一数据源）。 */
export const LEDGER_BLOCK_LABELS: Record<string, string> = LEDGER_BLOCK_OPTIONS.reduce<Record<string, string>>(
  (map, option) => {
    map[option.value] = option.label
    return map
  },
  {},
)

/** 产生方积木 → 中文；为空显示"—"，未知原样回显。 */
export function ledgerBlockLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return LEDGER_BLOCK_LABELS[key] || key
}

/**
 * 操作码（`operation`）→ 中文。
 * ✅ 2026-09-21：后端已按前端需求 §9 落地 —— `AuditRecordView.operationDesc` 直接下发中文名，
 * 并提供 `GET /api/admin/ledger/operations` 字典。**展示请用 `ledgerOperationText(row)`**（优先 operationDesc），
 * 本表退化为**兜底**（字典缺失 / 后端漏下发中文名时仍可读）。
 * ⚠️ `operation` 是**自由字符串、后端未限定枚举** → 本表**注定滞后**：
 * 后端每新增一个操作码，这里查不到就会回退成英文（这是设计上的兜底，不是 bug）。
 * 因此：**未知值一律原样回显**，并在列上给"后端未收录该操作码的中文名"的 tooltip。
 * 需求原文见 `docs/留痕台账-后端需求-2026-09-21.md` §9。
 */
export const LEDGER_OPERATION_LABELS: Record<string, string> = {
  ORDER_STATUS: '订单状态变更',
  DELIVERY_STATUS: '配送状态变更',
  AFTER_SALE_STATUS: '售后状态变更',
  ORDER_CREATE: '下单（锁定库存）',
  PAY_CLEAR_LOCK: '支付清除锁定',
  REFUND_RESTOCK: '退款回补库存',
  VERIFY_CLEAR_LOCK: '核销清除锁定',
  SKU_CREATE: '新增 SKU',
  MANUAL_SET: '人工设置库存',
  CREATE_ADMIN: '新增管理员',
  LOGISTICS_QUERY: '物流轨迹查询',
  MANUAL_VERIFY: '人工核销',
  FLYWAY_APPLIED: '数据库迁移',
  ORDER_PAY: '订单支付',
  DAILY_FINGERPRINT: '每日留痕指纹',
  FINGERPRINT_MISMATCH: '留痕指纹不符',
  'INV-1_MONEY_WITHOUT_ORDER_STATUS': '不变式1：有支付流水但无订单状态留痕',
  'INV-2_REFUND_WITHOUT_REFUND_STATUS': '不变式2：有退款流水但无退款状态留痕',
  'INV-3_STOCK_WITHOUT_OPERATION': '不变式3：人造库存变动无后台操作留痕',
  'INV-4_LOGISTICS_WITHOUT_FULFILLMENT': '不变式4：查过物流但无履约状态留痕',
}

/** 未知操作码的提示（列 tooltip 用）。 */
export const LEDGER_OPERATION_UNKNOWN_HINT = '后端未收录该操作码的中文名，可提需求补充字典'

/** 操作码 → 中文；为空显示"—"，**未知原样回显英文操作码**。 */
export function ledgerOperationLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return LEDGER_OPERATION_LABELS[key] || key
}

/** 该操作码是否有中文名（未知 → 页面上给"后端未收录"提示）。 */
export function isLedgerOperationKnown(value?: string | null): boolean {
  const key = String(value ?? '').trim()
  return Boolean(key) && Boolean(LEDGER_OPERATION_LABELS[key])
}

/**
 * 操作码列的 tooltip：**中文全称 + 原始操作码**（已知码很长时列内省略显示，全称靠 tooltip）；
 * 未知码提示"后端未收录"，避免使用者把英文码当成本地 bug。
 */
export function ledgerOperationTooltip(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  const label = LEDGER_OPERATION_LABELS[key]
  if (!label) return `${key}（${LEDGER_OPERATION_UNKNOWN_HINT}）`
  return `${label}（${key}）`
}

/**
 * 记录级操作码展示：**优先后端下发的 `operationDesc`**，为空才回退前端映射表。
 * 表格、详情抽屉、时间线三处必须走本函数（单一入口），否则"同一行两个地方显示不一样"。
 * ⚠️ 后端是操作码全集的唯一持有方 → 它的中文名比前端硬编码表新，永远优先。
 */
export function ledgerOperationText(row: Pick<LedgerRecord, 'operation' | 'operationDesc'>): string {
  const desc = String(row.operationDesc ?? '').trim()
  if (desc) return desc
  return ledgerOperationLabel(row.operation)
}

/**
 * 记录级操作码 tooltip：中文全称 + 原始操作码（可读性最强的形式）。
 * - 有 `operationDesc` → `中文名（CODE）`；
 * - 无 → 回退 `ledgerOperationTooltip`（映射表命中给 `中文名（CODE）`，未命中提示"后端未收录"）。
 */
export function ledgerOperationRecordTooltip(row: Pick<LedgerRecord, 'operation' | 'operationDesc'>): string {
  const code = String(row.operation ?? '').trim()
  if (!code) return '—'
  const desc = String(row.operationDesc ?? '').trim()
  return desc ? `${desc}（${code}）` : ledgerOperationTooltip(code)
}

/**
 * 该行的操作码是否有中文名（后端 `operationDesc` 或前端映射表任一命中）。
 * 未知 → 页面上给"后端未收录"的灰色提示，方便发现后端新增操作码。
 */
export function isLedgerOperationKnownRecord(row: Pick<LedgerRecord, 'operation' | 'operationDesc'>): boolean {
  return Boolean(String(row.operationDesc ?? '').trim()) || isLedgerOperationKnown(row.operation)
}

/**
 * 操作码字典（`/ledger/operations`）→ 下拉选项：`中文名（CODE）`。
 * ⚠️ 与表格列展示同一口径（列里省略号截断、tooltip 给全称），避免"下拉里叫一个名字、选完列里叫另一个"。
 * `value` 保持原始操作码（后端筛选用它，**不要**把中文名传上去）。
 */
export function buildLedgerOperationOptions(dict: LedgerOption[]): LedgerOption[] {
  return dict.map((item) => ({ value: item.value, label: item.label ? `${item.label}（${item.value}）` : item.value }))
}

/**
 * 目标类型字典（`/ledger/target-types`）→ `枚举名: 中文标签` 映射。
 * 供展示层在**不外发请求**的渲染路径（表格「目标」列等）优先使用后端权威中文名；
 * ⚠️ 中文名最终仍由 `ledgerTargetTypeLabel`（`labels.ts`）兜底 —— 后端字典里的 label 若为英文枚举名，
 * 就用映射表翻译，两者取"更像人话"的那个（见 `ledgerTargetTypeText`）。
 */
export function buildTargetTypeLabelMap(dict: LedgerOption[]): Record<string, string> {
  return dict.reduce<Record<string, string>>((map, item) => {
    if (item.value) map[item.value] = item.label || item.value
    return map
  }, {})
}

/**
 * 目标类型展示：**优先后端字典的中文名**，没有则回退 `labels.ts` 的映射表。
 * ⚠️ 判据是"后端 label 与 value 不同"（相同说明后端只回显了枚举名，等于没翻译）。
 */
export function ledgerTargetTypeText(value?: string | null, labelMap: Record<string, string> = {}): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  const fromServer = labelMap[key]
  if (fromServer && fromServer !== key) return fromServer
  // ⚠️ 这里调本地绑定名（文件顶部 `import { auditTargetTypeLabel }`），
  // 对外导出名是 `ledgerTargetTypeLabel`，模块作用域内**不可**用导出别名调用
  return auditTargetTypeLabel(key)
}

/**
 * 结果筛选项（§3.1）：中文标签**统一取自 `ledgerResultMeta`**，避免下拉与表格两处各写一份。
 */
export const LEDGER_RESULT_OPTIONS: Array<{ value: string; label: string }> = ['SUCCESS', 'FAILURE', 'SKIPPED', 'INCONSISTENT'].map(
  (value) => ({ value, label: ledgerResultMeta(value).label }),
)

/**
 * 「请求链路 ID」的说明文案（筛选框 tooltip / 表格列 tooltip / 详情抽屉共用一处，避免三处口径不一致）。
 */
export const LEDGER_REQUEST_ID_TIP =
  '一次 HTTP 请求的链路追踪 ID：同一次操作产生的多条留痕共用同一个 ID，用来回答「我刚点了一次按钮，到底改了哪几条数据」。⚠️ 历史行与定时任务行天然为空（实测近 24h 覆盖率仅 14.2%），空值不是数据缺陷。点击 ID 可查看该链路全部留痕。'

/** 请求链路 ID 为空时的展示文案（历史行 / 定时任务行没有 HTTP 请求上下文）。 */
export const LEDGER_REQUEST_ID_EMPTY = '—（历史行/定时任务行为空）'

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
