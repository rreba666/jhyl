import { request } from './request'
import type {
  ApiCallApiRank,
  ApiCallLogPage,
  ApiCallLogQueryParams,
  ApiCallLogRecord,
  ApiCallRankParams,
  ApiCallSummary,
  ApiCallSubjectRank,
  ApiCallTrendParams,
  ApiCallTrendPoint,
} from '@/types/apicount'

/**
 * 接口调用计数（后端积木 `fengling-apicount`）接口层。
 *
 * 契约：`api_doc.json` tag「接口调用计数（平台级）」（5 个 GET 端点，统一前缀 `/api/admin/apicount/**`）
 * ＋ 后端说明稿《接口调用计数-apicount-说明-2026-09-22.md》。
 * 2026-09-22 在 dev 后端逐个实测：5 个端点全部 `HTTP 200` + `code=0`；未带 token → `401`
 * （确认前缀挂在 **admin 鉴权链**下，没有落到 C 端拦截器）。
 *
 * 🔒 平台级数据：本模块返回**全平台**接口调用结构、主体排行与调用明细（含任意商户 `shopId`）。
 * 后端当前**未声明任何权限点**（`auth/me` 的 `permissions` 里也没有 apicount 项），
 * 前端按「仅超管可见」处理（见 `utils/permission.ts` 的 `ROLE_ROUTES`），后端口径确认后再调整。
 *
 * 本文件**不新增任何写接口**：5 个端点全部是只读查询。
 */

/** 后端统一响应体。 */
interface ApiCountResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

/** 校验业务码并取出 data（沿用 `api/ledger.ts` 的写法）。 */
function unwrap<T>(response: { data: ApiCountResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 剔除空值：不传的筛选条件就**真的不传**（空串会被后端当成"精确匹配空"）。 */
function compact(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== '' && value !== null && value !== undefined),
  )
}

/** 任意值 → 字符串；null / undefined / 空串归一为 null（保留"语义为空"的区分）。 */
function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

/**
 * int64 字段（`id` / `subjectId` / `shopId`）→ 字符串。
 * ⚠️ 后端这些列是 BIGINT，用 JS number 接会在超过 2^53 时静默失真；统一转字符串展示与比较。
 */
function toIdString(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  return String(value)
}

/** 计数字段 → number（缺失/非数字一律 0，避免表格里出现 NaN）。 */
function toCount(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

/** 归一化「按接口排行」的一行（`rank/api` 与 `summary.byApi` 共用）。 */
function normalizeApiRank(item: unknown): ApiCallApiRank {
  const raw = (item || {}) as Record<string, unknown>
  return {
    apiKey: String(raw.apiKey ?? ''),
    cnt: toCount(raw.cnt),
    subjectCount: toCount(raw.subjectCount),
  }
}

/** 归一化「按主体排行」的一行（`rank/subject`）。 */
function normalizeSubjectRank(item: unknown): ApiCallSubjectRank {
  const raw = (item || {}) as Record<string, unknown>
  return {
    subjectType: String(raw.subjectType ?? ''),
    subjectId: toIdString(raw.subjectId),
    shopId: toIdString(raw.shopId),
    cnt: toCount(raw.cnt),
    apiCount: toCount(raw.apiCount),
  }
}

/** 归一化一条调用明细（`logs`）。 */
function normalizeLogRecord(item: unknown): ApiCallLogRecord {
  const raw = (item || {}) as Record<string, unknown>
  return {
    id: toIdString(raw.id),
    apiKey: String(raw.apiKey ?? ''),
    subjectType: String(raw.subjectType ?? ''),
    subjectId: toIdString(raw.subjectId),
    shopId: toIdString(raw.shopId),
    // ⚠️ 未传 X-Request-Id 时后端**不返回这个键**（NON_NULL 序列化），故用 toNullableString 兜底
    requestId: toNullableString(raw.requestId),
    traceId: toNullableString(raw.traceId),
    ipAddress: toNullableString(raw.ipAddress),
    userAgent: toNullableString(raw.userAgent),
    costMs: raw.costMs === null || raw.costMs === undefined ? null : toCount(raw.costMs),
    createTime: toNullableString(raw.createTime),
  }
}

/**
 * 调用总览：总次数 / 接口数 / 主体数 + 接口排行。
 * `topN` 默认 10、上限 200；区间不传则后端默认最近 7 天。
 */
export async function getApiCallSummary(params: { from?: string; to?: string; topN?: number } = {}): Promise<ApiCallSummary> {
  const response = await request.get<ApiCountResponse<ApiCallSummary>>('/api/admin/apicount/summary', {
    params: compact({ from: params.from, to: params.to, topN: params.topN }),
  })
  const data = unwrap(response, '接口调用总览查询失败')
  const raw = (data || {}) as unknown as Record<string, unknown>
  return {
    // ⚠️ 回显后端给的生效区间（不传/传反时后端会补默认值或自动交换）
    from: String(raw.from ?? ''),
    to: String(raw.to ?? ''),
    totalCnt: toCount(raw.totalCnt),
    apiCount: toCount(raw.apiCount),
    subjectCount: toCount(raw.subjectCount),
    byApi: Array.isArray(raw.byApi) ? raw.byApi.map(normalizeApiRank) : [],
  }
}

/**
 * 按接口排行：「哪些接口是大头」。
 * ⚠️ 该端点**不支持** `apiKey` 过滤（实测传了会被静默忽略），要看单个接口请用 `trend` / `logs`。
 */
export async function getApiCallApiRank(params: ApiCallRankParams = {}): Promise<ApiCallApiRank[]> {
  const response = await request.get<ApiCountResponse<ApiCallApiRank[]>>('/api/admin/apicount/rank/api', {
    params: compact({ from: params.from, to: params.to, subjectType: params.subjectType, limit: params.limit }),
  })
  const data = unwrap(response, '接口排行查询失败')
  return Array.isArray(data) ? data.map(normalizeApiRank) : []
}

/** 按主体排行：「谁在调」（含 `shopId`，可回答"某门店调了多少次"）。 */
export async function getApiCallSubjectRank(params: ApiCallRankParams = {}): Promise<ApiCallSubjectRank[]> {
  const response = await request.get<ApiCountResponse<ApiCallSubjectRank[]>>('/api/admin/apicount/rank/subject', {
    params: compact({ from: params.from, to: params.to, subjectType: params.subjectType, limit: params.limit }),
  })
  const data = unwrap(response, '主体排行查询失败')
  return Array.isArray(data) ? data.map(normalizeSubjectRank) : []
}

/**
 * 按自然日趋势：「涨还是跌 / 哪天有尖峰」。
 * ⚠️ 区间内没有调用的日期**不会返回**（后端刻意不补零）→ 调用方需自行补零后再画图。
 */
export async function getApiCallTrend(params: ApiCallTrendParams = {}): Promise<ApiCallTrendPoint[]> {
  const response = await request.get<ApiCountResponse<ApiCallTrendPoint[]>>('/api/admin/apicount/trend', {
    params: compact({ from: params.from, to: params.to, apiKey: params.apiKey }),
  })
  const data = unwrap(response, '接口调用趋势查询失败')
  if (!Array.isArray(data)) return []
  return data
    .map((item) => {
      // ⚠️ 这里要按「运行时可能任意形状」防御性读取：先经 unknown 再转索引签名（TS 不允许直接把接口类型转 Record）
      const raw = (item || {}) as unknown as Record<string, unknown>
      return { statDate: String(raw.statDate ?? ''), cnt: toCount(raw.cnt) }
    })
    .filter((item) => Boolean(item.statDate))
}

/**
 * 调用明细分页（可追溯）：「这一次到底是谁、什么时候、从哪个 IP 调的」。
 * 按**写入倒序**（主键倒序）。`pageSize` 上限 200（实测传 500 被截为 200）。
 */
export async function getApiCallLogs(params: ApiCallLogQueryParams = {}): Promise<ApiCallLogPage> {
  const response = await request.get<ApiCountResponse<ApiCallLogPage>>('/api/admin/apicount/logs', {
    params: compact({
      apiKey: params.apiKey,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      from: params.from,
      to: params.to,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    }),
  })
  const data = unwrap(response, '调用明细查询失败')
  const raw = (data || {}) as unknown as Record<string, unknown>
  return {
    total: toCount(raw.total),
    list: Array.isArray(raw.list) ? raw.list.map(normalizeLogRecord) : [],
    page: toCount(raw.page) || 1,
    pageSize: toCount(raw.pageSize) || 20,
  }
}
