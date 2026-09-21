/**
 * 操作留痕回溯（审计台账）相关类型。
 * 契约来源：`docs/audit-9-categories.md`（后端给的前端对接文档，字段以它为准）。
 *
 * ⚠️ 三个必须记住的坑：
 * 1. 列表分页字段是 **`list`**（不是 `records`）；
 * 2. `beforeJson` / `afterJson` 是 **JSON 字符串**且可能为 null，必须二次 `JSON.parse`；
 * 3. `result='SKIPPED'` 行的 `beforeJson` **不可信**（条件 UPDATE 未命中，前值取自 WHERE 条件）。
 */

/** 留痕分类字典项（`GET /api/admin/ledger/categories`，共 10 项，含中文标签）。 */
export interface LedgerCategoryOption {
  value: string
  label: string
}

/**
 * 留痕记录（`AuditRecordView`，16 字段，`/ledger` `/unified` `/timeline` `/by-request` 共用）。
 * ⚠️ 金额行沿用 `finance_flow` 的 id，**与台账 id 可能重号**，不要当跨表唯一键。
 * 这里把 `id` / `operatorId` / `targetId` 统一按字符串处理，避免 JS 大整数精度丢失。
 */
export interface LedgerRecord {
  id: string
  /** 操作人类型：ADMIN / SUPER_ADMIN / MERCHANT / MERCHANT_PC / STAFF / USER / DELIVERY_PERSON / PLATFORM / SYSTEM。 */
  operatorType: string
  /** 操作人 ID；系统发起为 `0`。 */
  operatorId: string
  /** 操作人标识（冗余存）；系统发起时为 null。 */
  operatorName: string | null
  /** 操作码（自由字符串，精确匹配，不支持模糊）。 */
  operation: string
  /** 分类枚举名；⚠️ 历史行可能为 null（展示为"(历史数据)"，不要隐藏）。 */
  category: string | null
  /** 产生方积木名（delivery/shop/wallet/staff/platform/audit…）。 */
  block: string | null
  /** 结果：SUCCESS / FAILURE / SKIPPED / INCONSISTENT / null。 */
  result: string | null
  /** 请求链路 ID；⚠️ 历史行与定时任务行为空（实测覆盖率仅 14.2%）。 */
  requestId: string | null
  /** 变更前快照（JSON 字符串，可能为 null）。 */
  beforeJson: string | null
  /** 变更后快照（JSON 字符串，可能为 null）。 */
  afterJson: string | null
  targetType: string | null
  targetId: string | null
  /** 人话摘要（**动作类事件的唯一内容**）。 */
  detail: string | null
  /** 来源 IP；⚠️ 埋点普遍未传（多数为 null），不要用于风控展示。 */
  ipAddress: string | null
  /** `yyyy-MM-ddTHH:mm:ss`（ISO 本地时间，无时区后缀）。 */
  createTime: string | null
  /** 前端表格行键：`分类#id`（跨表 id 可能重号，故拼上分类）。 */
  rowKey: string
}

/** 台账分页对象（⚠️ 字段名是 `list`，不是 `records`）。 */
export interface LedgerPageResult {
  list: LedgerRecord[]
  page: number
  pageSize: number
  total: number
}

/**
 * 台账查询参数（`GET /api/admin/ledger`）。
 * ⚠️ 参数名是复数 `categories`（传 `category` 会被后端忽略并返回全量）。
 * ⚠️ `unified` 只支持其中一部分（没有 block/operation/targetType/requestId）。
 */
export interface LedgerQueryParams {
  /** 分类，**逗号分隔多选**。 */
  categories?: string
  block?: string
  /** 操作码精确匹配。 */
  operation?: string
  operatorType?: string
  operatorId?: string
  targetType?: string
  targetId?: string
  result?: string
  requestId?: string
  startTime?: string
  endTime?: string
  page: number
  pageSize: number
}

/** 统一台账（含金额）查询参数：`/ledger` 的子集。 */
export type LedgerUnifiedQueryParams = Omit<LedgerQueryParams, 'block' | 'operation' | 'targetType' | 'requestId'>

/** `requestId` 覆盖率巡检（`/status`）。分母已排除 SYSTEM 行与 SKIPPED 行。 */
export interface LedgerRequestIdCoverage {
  hours: number
  total: number
  withRequestId: number
  rate: number
}

/** 台账自检状态（`GET /api/admin/ledger/status`）。 */
export interface LedgerStatus {
  /** 查询侧是否可用。 */
  queryReady: boolean
  /** ⚠️ `false` 表示未装配 audit 积木，留痕会被静默丢弃。 */
  writeReady: boolean
  /** 分类数（正常为 10）。 */
  categoryCount: number
  note?: string | null
  requestIdCoverage?: LedgerRequestIdCoverage | null
  /** 覆盖率低于 0.8 时为 true（运维告警信号）。 */
  degraded: boolean
}

/**
 * 库存动态四维（`GET /api/admin/stock-dimension?skuIds=...`）。
 * ⚠️ `total = available + locked`，**不含 `inTransit`**。
 * ⚠️ 不存在的 SKU **只回 `skuId`**，其余字段全部缺失 → 必须按"字段可能缺失"渲染。
 */
export interface StockDimension {
  skuId: string
  available?: number | null
  locked?: number | null
  inTransit?: number | null
  total?: number | null
}

/** 快照对比的一行（「前 → 后」）。 */
export interface LedgerDiffRow {
  /** 快照里的原始键名。 */
  key: string
  /** 中文/人话字段名。 */
  label: string
  /** 变更前展示值。 */
  before: string
  /** 变更后展示值。 */
  after: string
}
