/**
 * 幽灵单巡检（体检页）类型定义。
 *
 * 依据：`docs/20269231438/幽灵单巡检-前端对接说明-2026-09-23.md` §8（类型参考）+ §9（样例响应）。
 *
 * ## 一句话业务
 * 后端定时/按需扫一批"不该存在的订单状态组合"（幽灵单），返回**计数 + 命中明细**。
 * 本批（2026-09-24）的**唯一行为性变化**是：计数拆成「新增 / 存量」，
 * **徽标只算 `newCount` / `newTotal`**（存量是上线前已记账的历史留痕，不染红）。
 */

/**
 * 巡检项严重级别。
 * ⚠️ 它只表示"这类问题的性质"，**不表示是否新增** —— 是否染红看 `newCount`。
 */
export type GhostSeverity = 'MONEY' | 'INCONSISTENT' | 'STUCK' | 'RISK'

/**
 * 样例归属。
 * - `NEW`：命中全是新增，样例即全部新增；
 * - `LEGACY`：`newCount=0`，样例取自存量段；
 * - `NEW_AND_LEGACY`：新增不足 5 条，前面是新增、后面用存量补满；
 * - `null`：该项**不参与基线化**，没有"段"的概念 ⇒ **不渲染任何标签**。
 */
export type GhostSampleKind = 'NEW' | 'LEGACY' | 'NEW_AND_LEGACY' | null

/** 执行失败被跳过的巡检项（非空即"本轮体检不完整"）。 */
export interface GhostSkippedCheck {
  key: string
  label: string
  severity: GhostSeverity
  /** 后端 SQL 执行失败的原文（用于定位，如"列改名后 SQL 未同步"）。 */
  error: string
}

/** 单个命中项（`items[]` **只含 `count > 0` 的项**，`count=0` 不会出现）。 */
export interface GhostInspectItem {
  /** 稳定标识（与 `/checks` 的 `key` 一一对应，后端只新增不改语义）。 */
  key: string
  /** 中文说明，**直接展示**（后端可能给较长描述）。 */
  label: string
  severity: GhostSeverity
  /** 命中总数 = `newCount + legacyCount`（语义未变，为兼容旧调用方保留）。 */
  count: number
  /** **基线之外 = 真回归，要处置** ⇒ 徽标/染红只算这个数。 */
  newCount: number
  /** 基线之内 = 上线前已存在、已记账的历史留痕；未基线化的项恒为 0。 */
  legacyCount: number
  sampleKind: GhostSampleKind
  /** ≤5 条定位样例，**恒为"新增优先"**；纯文本，**勿 `JSON.parse`**。 */
  samples: string[]
  /** 建议动作（人工处置指引，可直接展示）。 */
  suggestion: string
  /** 该项**是否具备**自动修复实现（≠ 当前已开启，见 `autoFixEnabledChecks`）。 */
  autoFixable: boolean
  /** 该项本轮修复行数。 */
  fixed: number
  /** 修复说明（含"本轮无需修复""自动修复失败"等原因）。 */
  fixNote: string | null
}

/** 巡检结果（`GET /api/admin/order/ghost-inspect` 的 `data`）。 */
export interface GhostInspectData {
  /** **新增命中数**（各类 `newCount` 之和）⇒ 徽标 / 红点 / 告警**只算它**。 */
  newTotal: number
  /** 命中总数（含存量）= 各类 `count` 之和 ⇒ ⚠️ **不要做徽标**。 */
  total: number
  /** 本轮自动修复行数（未开启自动修复时恒 0）。 */
  fixedTotal: number
  /** **本次纳入范围**的检查项数（不传 `types` 时 = 27）。 */
  checkedTypes: number
  /** 全部检查项总数（当前 **27**）。 */
  allChecks: number
  /** 本轮**实际执行成功**的项数；`< checkedTypes` ⇒ **有盲区**，看 `skippedChecks`。 */
  executedTypes: number
  /** 请求里无法识别的 key（**仅非空时出现**）；非空即"这些类型没被巡检"。 */
  unknownTypes: string[]
  /** 本轮**参与存量基线化**的项 key（不在列表里的项 `legacyCount` 恒为 0）。 */
  baselineKeys: string[]
  /** 当前生效的自动修复白名单（线上配置核对用）。 */
  autoFixEnabledChecks: string[]
  /** 执行失败被跳过的项；**非空 ⇒ 顶部黄色告警**。 */
  skippedChecks: GhostSkippedCheck[]
  /** 命中明细，**只含 `count>0` 的项**。 */
  items: GhostInspectItem[]
}

/** 检查项字典（`GET /api/admin/order/ghost-inspect/checks`，**无副作用**）。 */
export interface GhostCheckMeta {
  key: string
  label: string
  severity: GhostSeverity
  suggestion: string
  autoFixable: boolean
  autoFixEnabled: boolean
  /**
   * 该项是否参与基线化。
   * `false` ⇒ 恒有 `newCount = count`、`legacyCount = 0`、`sampleKind = null`
   * ⇒ ⚠️ **不要渲染"新增/存量"拆分 UI**（否则满屏 `新增 N / 存量 0` 噪声）。
   */
  baselined: boolean
}

/** 后端统一响应包装（与其它 api 模块一致，由 `request` 层透出）。 */
export interface GhostResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
