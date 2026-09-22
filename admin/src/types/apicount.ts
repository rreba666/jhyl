/**
 * 接口调用计数（后端积木 `fengling-apicount`）类型定义。
 *
 * 契约来源：LonPin `api_doc.json` 的 tag「接口调用计数（平台级）」5 个端点
 * ＋ 后端说明稿《接口调用计数-apicount-说明-2026-09-22.md》。
 * 2026-09-22 已在 dev 后端（`192.168.1.4:8080`）**逐个实测**：5 个端点全部 `HTTP 200` + `code=0`。
 *
 * ⚠️ 写代码前必须知道的三条口径（都是实测确认的，不是推断）：
 * 1. **只统计业务成功**：后端以 `Result.code == 0` 为唯一判据。本项目 `GlobalExceptionHandler`
 *    会把 `BizException` 转成 **HTTP 200 + `Result.fail`**，所以「失败」在这里表现为 `code != 0`，
 *    而不是 HTTP 非 200 → 页面文案必须写清「这是**成功调用量**，不是请求量，也不是业务量（订单数）」。
 * 2. **`rank/api` 与 `rank/subject` 在 OpenAPI 里共用同一个 `ApiCallRankVO`**，但两侧真实返回的字段是
 *    这个 VO 的**不同子集**（未填字段为 null → 被后端 NON_NULL 序列化**整键剔除**）：
 *    - `rank/api` → `apiKey` / `cnt` / `subjectCount`
 *    - `rank/subject` → `subjectType` / `subjectId` / `shopId` / `cnt` / `apiCount`
 *    → 因此这里**刻意拆成两个类型**（{@link ApiCallApiRank} / {@link ApiCallSubjectRank}），
 *    不要合成一个「全字段可选」的大类型，否则表格列很容易渲染出 `undefined`。
 * 3. **int64 字段一律按字符串处理**：`id` / `subjectId` / `shopId` 是 BIGINT，JS 的 number 只有
 *    2^53 精度，直接当数字用会在极端值下静默失真（与 `types/ledger.ts` 同策略）。
 */

/** 调用主体类型（后端 `subject_type`）。 */
export type ApiCallSubjectType = 'USER' | 'STAFF' | 'DELIVERY_PERSON' | 'ADMIN' | 'ANON'

/**
 * 按接口排行的一行。
 * 用于 `GET /rank/api` 的列表，也用于 `GET /summary` 里的 `data.byApi[]`。
 */
export interface ApiCallApiRank {
  /** 接口逻辑 key（如 `delivery.quote`）。后端用**逻辑 key** 而非 URL，所以接口改路径不影响历史数据。 */
  apiKey: string
  /** 成功调用次数。 */
  cnt: number
  /**
   * 该接口涉及的**不同主体数**（`subject_type` + `subject_id` 去重）。
   * 用来区分「一个接口被单人高频刷」与「被很多人正常使用」。
   */
  subjectCount: number
}

/**
 * 按主体排行的一行（`GET /rank/subject`）。
 * ⚠️ `subjectId` 的含义**随 `subjectType` 变化**：`USER`=用户 ID、`STAFF`/`DELIVERY_PERSON`=店员 ID
 * （骑手也是 `staffId`，只有类型能区分）、`ADMIN`=管理员 ID、`ANON`=固定 0。
 * 渲染时**必须同时展示主体类型**，否则「1001 是用户还是店员」无法区分。
 */
export interface ApiCallSubjectRank {
  subjectType: ApiCallSubjectType | string
  /** 主体 ID（int64 → 字符串）。 */
  subjectId: string
  /** 所属门店 ID（`wx_shop.id`）；`0` 表示无门店归属（C 端用户与平台管理员天然为 0）。 */
  shopId: string
  /** 成功调用次数（该主体所有被计数接口的合计）。 */
  cnt: number
  /** 该主体调用过的**不同接口数**。 */
  apiCount: number
}

/**
 * 调用总览（`GET /summary`）。
 * ⚠️ `from`/`to` 是**后端实际生效的区间**（不传时 = 今天-6 ~ 今天，传反了后端会自动交换）→
 * 页面要**回显后端给的值**，不要用前端自己算的默认值，否则跨天/跨时区会对不上。
 */
export interface ApiCallSummary {
  /** 生效起始日（yyyy-MM-dd，闭区间）。 */
  from: string
  /** 生效截止日（yyyy-MM-dd，闭区间）。 */
  to: string
  /** 区间内成功调用总次数。 */
  totalCnt: number
  /** 区间内被成功调用过的不同接口数。 */
  apiCount: number
  /** 区间内出现过的不同主体数（`subject_type` + `subject_id` 去重）。 */
  subjectCount: number
  /** 接口排行（条数由 `topN` 决定，默认 10，上限 200）。 */
  byApi: ApiCallApiRank[]
}

/**
 * 趋势的一天（`GET /trend`）。
 * ⚠️ 区间内**没有成功调用的日期不会返回该行**（后端刻意不补零）→
 * 画图前要用 {@link buildApiCallTrendSeries} 按 `from..to` 补齐，否则折线会把「没调用的那天」直接跳过。
 */
export interface ApiCallTrendPoint {
  /** 自然日（yyyy-MM-dd）。 */
  statDate: string
  /** 当日成功调用次数。 */
  cnt: number
}

/**
 * 一条调用明细（`GET /logs` 的 `data.list[]`）。
 * ⚠️ 后端 NON_NULL 序列化：**未传 `X-Request-Id` 时 `requestId` 这个键根本不存在**（实测 3 条样本都没有）
 * → 类型上一律按可空处理，不要假设键存在。
 */
export interface ApiCallLogRecord {
  /** 明细主键（int64 → 字符串），也是「按写入倒序」的排序依据（比 createTime 更稳，同秒并发不会并列）。 */
  id: string
  apiKey: string
  subjectType: ApiCallSubjectType | string
  subjectId: string
  shopId: string
  /** 幂等键（请求头 `X-Request-Id`）；未传时后端不返回该键。 */
  requestId: string | null
  /** 链路 ID（与日志/留痕同源，可串起来排查）。 */
  traceId: string | null
  ipAddress: string | null
  userAgent: string | null
  /**
   * 本次调用的耗时（毫秒）。
   * ⚠️ 后端说明稿第七节明确：并发压测时该值可达 987ms，那是**聚合表行锁竞争**而非接口慢 →
   * 不要把它当接口性能指标用（要查真实耗时请按 `traceId` 看日志）。
   */
  costMs: number | null
  /** 业务成功时刻（ISO 本地时间、无时区后缀）。 */
  createTime: string | null
}

/** `GET /logs` 的分页结果（后端 `PageResult<ApiCallLogEntity>`）。 */
export interface ApiCallLogPage {
  total: number
  list: ApiCallLogRecord[]
  page: number
  pageSize: number
}

/**
 * 时间区间查询参数（所有端点公用）。
 * `from`/`to` 为自然日 `yyyy-MM-dd`、**闭区间**；不传则默认最近 7 天（今天-6 ~ 今天）；传反后端自动交换。
 */
export interface ApiCallRangeParams {
  from?: string
  to?: string
}

/** `GET /rank/api` 与 `GET /rank/subject` 的查询参数（两者参数集相同）。 */
export interface ApiCallRankParams extends ApiCallRangeParams {
  /** 只看某类主体：`USER` / `STAFF` / `DELIVERY_PERSON` / `ADMIN` / `ANON`（不传 = 全部）。 */
  subjectType?: string
  /** 返回条数，默认 20，**上限 200**（超出后端静默截断）。 */
  limit?: number
}

/** `GET /trend` 的查询参数。 */
export interface ApiCallTrendParams extends ApiCallRangeParams {
  /**
   * 只看某个接口（**精确匹配**，如 `order.accept`）；不传 = 全部接口合计。
   * ⚠️ 只有 `trend` 与 `logs` 支持按 `apiKey` 过滤（`rank/api` 不支持，传了会被忽略）。
   */
  apiKey?: string
}

/** `GET /logs` 的查询参数。 */
export interface ApiCallLogQueryParams extends ApiCallRangeParams {
  /** 接口逻辑 key（精确匹配）。 */
  apiKey?: string
  subjectType?: string
  /** 主体 ID（传数字；`ANON` 固定 0）。 */
  subjectId?: string
  /** 页码，从 1 开始。 */
  page?: number
  /** 每页条数，默认 20，**上限 200**。 */
  pageSize?: number
}
