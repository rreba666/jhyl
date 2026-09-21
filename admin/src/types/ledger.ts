/**
 * 操作留痕回溯（审计台账）相关类型。
 * 契约来源：`docs/audit-9-categories.md`（后端给的前端对接文档，字段以它为准）。
 *
 * ⚠️ 三个必须记住的坑：
 * 1. 列表分页字段是 **`list`**（不是 `records`）；
 * 2. `beforeJson` / `afterJson` 是 **JSON 字符串**且可能为 null，必须二次 `JSON.parse`；
 * 3. `result='SKIPPED'` 行的 `beforeJson` **不可信**（条件 UPDATE 未命中，前值取自 WHERE 条件）。
 */

/**
 * 留痕分类字典项（`GET /api/admin/ledger/categories`，共 10 项，含中文标签）。
 * 后端 `ResultListCategoryOption` 的每项就是 `{value,label}`，因此本结构同时作为
 * `/operations`（操作码字典）与 `/target-types`（目标类型字典）的元素类型（见 `LedgerOption`）。
 */
export interface LedgerCategoryOption {
  value: string
  label: string
}

/**
 * 通用字典项（`{value,label}`）。
 * 后端 `/categories` `/operations` `/target-types` 三个字典接口返回的是**同一个 schema**
 * （`ResultListCategoryOption`），这里给一个语义化别名 → 调用方一眼能看出"这是字典项"，
 * 而不必让 `/operations` 的返回值也叫 "CategoryOption"。
 */
export type LedgerOption = LedgerCategoryOption

/**
 * 留痕记录（`AuditRecordView`，17 字段，`/ledger` `/unified` `/timeline` `/by-request` 共用）。
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
  /**
   * 操作码（自由字符串；筛选时带 `*` 为前缀通配、不带 `*` 为精确匹配）。
   * ⚠️ 展示请优先用 `operationDesc`（后端下发的中文名），本字段只在中文名缺失时作回退。
   */
  operation: string
  /**
   * 操作码中文名（2026-09-21 后端按前端需求 §9 新增；`/ledger` `/unified` `/timeline` `/by-request` 都会下发）。
   * ⚠️ 为 null 时才回退前端硬编码映射表 `utils/ledgerLabels.ts`（后端是操作码全集的唯一持有方，它更可靠）。
   */
  operationDesc: string | null
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
 * ⚠️ `unified` 只支持其中一部分（没有 block/operation/targetType；`requestId` 见下）。
 */
export interface LedgerQueryParams {
  /** 分类，**逗号分隔多选**。 */
  categories?: string
  block?: string
  /**
   * 操作码。**带 `*` 时为前缀通配**（`ORDER_*` 匹配 `ORDER_STATUS` / `ORDER_CREATED`）；
   * **不带 `*` 时为精确匹配**（与旧行为兼容 —— 后端明确说明"不写通配符不会变成前缀匹配"，
   * 否则 `LOGIN` 会被扩成 `LOGIN%` 误伤）。
   */
  operation?: string
  operatorType?: string
  operatorId?: string
  targetType?: string
  targetId?: string
  result?: string
  /**
   * **排除 `result=SKIPPED` 的行**（后端需求 §2 新增，`/ledger` 与 `/unified` 都支持）。
   * 追责/风控场景建议开：SKIPPED 行的 `beforeJson` 取自**没命中的 WHERE 条件**，前值不可信。
   * ⚠️ 后端实现是 NULL 安全的：`result` 为空的历史行**会保留**（实测占 31%），不是"滤成 result='SUCCESS'"。
   */
  excludeSkipped?: boolean
  requestId?: string
  startTime?: string
  endTime?: string
  page: number
  pageSize: number
}

/**
 * 统一台账（含金额）查询参数：`/ledger` 的子集。
 * ⚠️ `excludeSkipped` 会自动包含进来（后端 `/unified` 同样支持该参数，只是**只排除台账侧**，
 * 金额行（finance_flow）没有 SKIPPED 状态、不受影响）。
 * ⚠️ 已知偏差（未在本次改动中放开）：后端 `/unified` 现已支持 `requestId`（需求 §10 已落地），
 * 但本类型与 `stores/ledger.ts` 的 `UNIFIED_UNSUPPORTED_FIELDS` 仍把它排除 → 统一台账下按链路筛选仍被禁用。
 */
export type LedgerUnifiedQueryParams = Omit<LedgerQueryParams, 'block' | 'operation' | 'targetType' | 'requestId'>

/**
 * 对账命中的一条不变式明细（后端 schema `InvariantHit`）。
 * ⚠️ `described` 是后端的**原始字段名**（疑似 `description` 的拼写，但 `api_doc.json` 实测为 `described`）
 * —— 按后端实际字段解析，不要"顺手改成 description"。
 */
export interface LedgerReconcileHit {
  /** 命中的不变式名（如 `INV-1_MONEY_WITHOUT_ORDER_STATUS`），可用前端映射表翻译中文。 */
  operation: string
  /** 涉及对象 ID（订单号 / 退款单号 / SKU ID…），可据此跳转筛选。 */
  targetId: string
  /** 后端给的一句话说明（人话描述）。 */
  described: string
}

/**
 * 手动对账结果（`POST /api/admin/ledger/reconcile`，后端需求 §7 已从 `ResultString` 改为结构化）。
 * ⚠️ `inconsistencies=0` **且** `invariantsChecked < 4` 说明有 SQL 没跑成、**结论不可信**，
 * 页面必须据此提示，而不是显示"全部通过"（后端描述原文）。
 * ⚠️ `structured=false` 是**前端归一化时补的本地字段**（非后端字段）：后端若回退成旧版纯文本，
 * 内容会被放进 `note`，此时所有计数都无意义，页面**不要**展示"检查了 0 条不变式"。
 */
export interface LedgerReconcileResult {
  /** 检查窗口起点（`yyyy-MM-dd HH:mm:ss`）；降级为纯文本时为空串。 */
  since: string
  /** 本次实际执行了几条不变式（正常为 4）。 */
  invariantsChecked: number
  /** 发现的不一致条数。 */
  inconsistencies: number
  /** 逐条明细（不变式名 + 涉及对象），可据此做"查看这几条"的跳转。 */
  hits: LedgerReconcileHit[]
  /** 后端异常说明，正常为 null；降级时承载旧版纯文本。 */
  note: string | null
  /** 是否为结构化响应：false = 后端回了旧版纯文本（计数不可信，只展示 `note`）。 */
  structured: boolean
}

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
