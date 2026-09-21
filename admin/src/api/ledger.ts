import { request } from './request'
import type {
  LedgerCategoryOption,
  LedgerPageResult,
  LedgerQueryParams,
  LedgerRecord,
  LedgerStatus,
  LedgerUnifiedQueryParams,
  StockDimension,
} from '@/types/ledger'

/**
 * 留痕台账（审计台账）接口层。
 * 契约：`docs/audit-9-categories.md` 第四节 / 第八节。
 * ⚠️ 参数名以文档为准（`api_doc.json` 里的 `arg0`~`arg12` 是 Knife4j 未保留编译参数名导致的假象）。
 */

/** 后端统一响应体。 */
interface LedgerResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

/** 校验业务码并取出 data（沿用 `api/log.ts` 的写法）。 */
function unwrap<T>(response: { data: LedgerResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 剔除空值，避免把空串当成筛选条件发给后端（空串会被当成"精确匹配空"）。 */
function compact(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value !== null && value !== undefined))
}

/** 把任意值归一化为字符串；null / undefined 归一为 null（保留"语义为空"的区分）。 */
function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

/**
 * 归一化单条留痕记录。
 * ⚠️ `id`/`operatorId` 是 BIGINT，统一转字符串避免大整数精度丢失（与 `api/log.ts` 同策略）；
 * 其余可空字段**保留 null**，不要塞空串 —— 页面要区分"空"和"有值"（如 `operatorName` 为空时回退展示 `类型#ID`）。
 */
function normalizeRecord(item: unknown): LedgerRecord {
  const raw = (item || {}) as Record<string, unknown>
  const category = toNullableString(raw.category)
  const id = String(raw.id ?? '')
  return {
    id,
    operatorType: String(raw.operatorType ?? ''),
    operatorId: String(raw.operatorId ?? ''),
    operatorName: toNullableString(raw.operatorName),
    operation: String(raw.operation ?? ''),
    category,
    block: toNullableString(raw.block),
    result: toNullableString(raw.result),
    requestId: toNullableString(raw.requestId),
    beforeJson: toNullableString(raw.beforeJson),
    afterJson: toNullableString(raw.afterJson),
    targetType: toNullableString(raw.targetType),
    targetId: toNullableString(raw.targetId),
    detail: toNullableString(raw.detail),
    ipAddress: toNullableString(raw.ipAddress),
    createTime: toNullableString(raw.createTime),
    // 金额行沿用 finance_flow 的 id，与台账 id 可能重号 → 行键拼上分类保证唯一
    rowKey: `${category ?? 'NULL'}#${id}`,
  }
}

/**
 * 归一化分页结构。
 * ⚠️ 后端字段名是 **`list`**（`records` 仅是历史写法，这里做兼容但不作为主路径）。
 */
function normalizePage(value: unknown, page: number, pageSize: number): LedgerPageResult {
  const raw = (value || {}) as Record<string, unknown>
  const records = Array.isArray(raw.list) ? raw.list : Array.isArray(raw.records) ? raw.records : []
  return {
    list: records.map(normalizeRecord),
    page: Number(raw.page ?? raw.current ?? page) || page,
    pageSize: Number(raw.pageSize ?? raw.size ?? pageSize) || pageSize,
    total: Number(raw.total ?? records.length) || 0,
  }
}

/** 分类字典缓存：分类是穷举枚举，一次会话内不必重复拉取（成功后才缓存，失败不污染）。 */
let categoryCache: LedgerCategoryOption[] | null = null

/**
 * 分类字典（下拉框数据源，**不要硬编码枚举**）。
 * 共 10 项 = 9 个业务类 + `ANOMALY`；其中 `MONEY` 只在 `/unified` 能查到。
 */
export async function getLedgerCategories(force = false): Promise<LedgerCategoryOption[]> {
  if (!force && categoryCache) return categoryCache
  const response = await request.get<LedgerResponse<LedgerCategoryOption[]>>('/api/admin/ledger/categories')
  const list = unwrap(response, '留痕分类查询失败') || []
  categoryCache = list.map((item) => ({ value: String(item?.value ?? ''), label: String(item?.label ?? item?.value ?? '') }))
  return categoryCache
}

/** 9 类台账分页查询（**不含 MONEY**，`categories=MONEY` 会返回 total=0）。 */
export async function getLedgerList(params: LedgerQueryParams): Promise<LedgerPageResult> {
  const response = await request.get<LedgerResponse<unknown>>('/api/admin/ledger', { params: compact({ ...params }) })
  return normalizePage(unwrap(response, '留痕台账查询失败'), params.page, params.pageSize)
}

/** 统一台账分页查询（查询期 UNION `finance_flow`，**要看金额必须用这个**）。 */
export async function getLedgerUnified(params: LedgerUnifiedQueryParams): Promise<LedgerPageResult> {
  const response = await request.get<LedgerResponse<unknown>>('/api/admin/ledger/unified', { params: compact({ ...params }) })
  return normalizePage(unwrap(response, '统一台账查询失败'), params.page, params.pageSize)
}

/**
 * 按操作目标反查全部留痕（**按时间升序**，即执行顺序，与 `/ledger` 的倒序相反）。
 * ⚠️ `targetType` 必须是**逻辑类型**（`ORDER` / `DELIVERY_TASK` / `PRODUCT_SKU`），不是表名。
 */
export async function getLedgerTimeline(targetType: string, targetId: string): Promise<LedgerRecord[]> {
  const response = await request.get<LedgerResponse<unknown[]>>('/api/admin/ledger/timeline', { params: { targetType, targetId } })
  const list = unwrap(response, '留痕时间线查询失败') || []
  return list.map(normalizeRecord)
}

/**
 * 按**请求链路 ID** 串联同一次 HTTP 请求产生的全部留痕（**按时间升序**，与 `/ledger` 的倒序相反）。
 * 用途：回答"我刚点了一次按钮，到底改了哪几条数据"。
 * ⚠️ 文档 §七.3：`requestId` 实测覆盖率仅 14.2%，历史行与定时任务行天然为空 ——
 * 因此本接口**返回空数组是正常结果**，前端不要当异常。
 */
export async function getLedgerByRequest(requestId: string): Promise<LedgerRecord[]> {
  const id = String(requestId ?? '').trim()
  if (!id) return []
  const response = await request.get<LedgerResponse<unknown>>(`/api/admin/ledger/by-request/${encodeURIComponent(id)}`)
  const data = unwrap(response, '按请求链路查询留痕失败')
  // 文档写的是"直接返回列表"，这里对"分页对象"做一层兼容，避免后端改成分页后整页报错
  const records = Array.isArray(data) ? data : ((data as { list?: unknown[] } | null)?.list ?? [])
  return records.map(normalizeRecord)
}

/** 台账自检状态（`queryReady` / `writeReady` / `categoryCount` / `requestIdCoverage` / `degraded`）。 */
export async function getLedgerStatus(): Promise<LedgerStatus> {
  const response = await request.get<LedgerResponse<LedgerStatus>>('/api/admin/ledger/status')
  const data = unwrap(response, '台账自检状态查询失败') || ({} as LedgerStatus)
  return {
    queryReady: Boolean(data.queryReady),
    writeReady: Boolean(data.writeReady),
    categoryCount: Number(data.categoryCount ?? 0) || 0,
    note: data.note ?? null,
    requestIdCoverage: data.requestIdCoverage
      ? {
          hours: Number(data.requestIdCoverage.hours ?? 0) || 0,
          total: Number(data.requestIdCoverage.total ?? 0) || 0,
          withRequestId: Number(data.requestIdCoverage.withRequestId ?? 0) || 0,
          rate: Number(data.requestIdCoverage.rate ?? 0) || 0,
        }
      : null,
    degraded: Boolean(data.degraded),
  }
}

/** 从 `Content-Disposition` 解析导出文件名，取不到时用默认名。 */
function resolveExportFilename(disposition: string): string {
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      // 解码失败则继续尝试普通 filename
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(disposition)
  return plainMatch ? plainMatch[1] : 'audit-ledger.csv'
}

/** 触发浏览器下载（Blob → 临时 <a>）。 */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * CSV 导出（与 `/ledger` 同参数；同参数上限 **5000 条**，按筛选条件取最新一批，不是全量）。
 * ⚠️ 无权限 / 接口未上线时后端会返回 JSON 而不是 CSV → 这里按 content-type 识别并抛出业务文案，
 * 否则用户会下载到一个内容是报错 JSON 的 ".csv"。
 */
export async function exportLedgerCsv(params: LedgerQueryParams): Promise<void> {
  const response = await request.get<Blob>('/api/admin/ledger/export', {
    params: compact({ ...params }),
    responseType: 'blob',
  })
  const contentType = String(response.headers['content-type'] || '')
  if (contentType.includes('application/json')) {
    const text = await response.data.text()
    let message = '留痕导出失败'
    try {
      message = (JSON.parse(text) as { message?: string }).message || message
    } catch {
      // 非 JSON 内容保持默认文案
    }
    throw new Error(message)
  }
  saveBlob(response.data, resolveExportFilename(String(response.headers['content-disposition'] || '')))
}

/**
 * 手动跑一次留痕对账（4 条不变式交叉校验）。
 * ⚠️ 幂等但**不防重**：连点两次会把同一批不一致落两条异常留痕 → 调用方必须防连点 + 二次确认。
 */
export async function runLedgerReconcile(): Promise<string> {
  const response = await request.post<LedgerResponse<string>>('/api/admin/ledger/reconcile')
  return String(unwrap(response, '手动对账失败') ?? '')
}

/**
 * 库存动态四维（可售 / 锁定 / 在途 / 合计），入参为 SKU ID 列表（逗号分隔，最多 200 个）。
 * ⚠️ `total = available + locked`，**不含 `inTransit`**；不存在的 SKU 只回 `skuId`。
 */
export async function getStockDimensions(skuIds: Array<string | number>): Promise<StockDimension[]> {
  const ids = skuIds.map((id) => String(id)).filter(Boolean)
  if (!ids.length) return []
  const response = await request.get<LedgerResponse<StockDimension[]>>('/api/admin/stock-dimension', {
    params: { skuIds: ids.join(',') },
  })
  const list = unwrap(response, '库存四维查询失败') || []
  return list.map((item) => ({
    skuId: String(item?.skuId ?? ''),
    // ⚠️ 缺失字段保持 undefined（不补 0）：不存在的 SKU 只有 skuId
    available: item?.available ?? undefined,
    locked: item?.locked ?? undefined,
    inTransit: item?.inTransit ?? undefined,
    total: item?.total ?? undefined,
  }))
}
