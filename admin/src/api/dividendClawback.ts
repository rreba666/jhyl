import { request } from './request'
import type {
  DividendClawbackQuery,
  DividendClawbackRawList,
  DividendClawbackResponse,
  DividendClawbackRow,
} from '@/types/dividendClawback'

/**
 * 红包追回失败（中控运维）接口层。
 *
 * | 方法 | 路径 | 说明 |
 * |---|---|---|
 * | GET | `/api/admin/dividend-clawback/list` | `status`（0 未处理 / 1 已处理 / **不传 = 全部**）、`page`（从 1）、`size`（≤ 100） |
 * | POST | `/api/admin/dividend-clawback/{id}/handled` | 标记已处理；`remark` **可选**（query）；**仅 `status=0` 可改**，重复调用报参数错误 |
 *
 * 权限：**仅超管 / 财务**（其它角色 `1004`）；未带 token ⇒ `401`（证明端点已注册）。
 *
 * ## ⚠️⚠️ 字段名未经验证（这是本文件最重要的说明）
 *
 * `list` 的 200 schema 是 `ResultListMapStringObject`（`data: array<object>`，
 * `additionalProperties` **为空**）⇒ 契约里**没有字段明细**，只有文档正文给的语义清单
 * （`id / orderNo / orderId / error / status / handleBy / handleTime / remark / createTime`）。
 *
 * 2026-10-09 实测（dev `http://192.168.1.4:8080`，超管账号，凭据取自仓库文档、**不在此留痕**）：
 *
 * ```json
 * GET /api/admin/dividend-clawback/list?status=0&page=1&size=20  ->  HTTP 200
 * { "code": 0, "message": "操作成功", "data": [], "success": true }
 * ```
 *
 * ⇒ 端点**确实存在且已注册**（不带 token 是 `401`），但 `data` 是**空数组**（库里暂无失败记录）
 * ⇒ **字段名一次都没被真实行验证过**。因此：
 * 1. 多别名 + 大小写/下划线不敏感读取（别名数组的**第一个名字**是文档给的名字）；
 * 2. 原始对象整份带回页面（`raw`），页面用「原始数据」折叠区原样展示 —— 这是核对字段名的唯一真相；
 * 3. 识别不出 `id` 的行**禁止**提交处理（fail-closed），不猜、不造。
 *
 * ## ⚠️ 分页：响应里**没有 `total`**（`data` 就是裸数组）
 * ⇒ 前端**无法**计算总条数/总页数。页面的翻页策略见 `views/dividend-clawback/index.vue`
 * （按"本页返回条数是否 == size"判断是否可能还有下一页），**已标注需后端确认**。
 */

/** `size` 上限（后端约定：最大 100）。 */
export const DIVIDEND_CLAWBACK_MAX_SIZE = 100

/** 后端响应校验（与其它模块同形）。 */
function ensureSuccess<T>(result: DividendClawbackResponse<T>, fallback: string): T {
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 字段名归一化：去掉下划线/连字符并转小写（`handle_by` / `handleBy` 视为同一个名字）。 */
function normalizeFieldName(name: string): string {
  return name.replace(/[_-]/g, '').toLowerCase()
}

/**
 * 在一行原始对象里按**别名顺序**取值（命中即返回；都取不到返回 `undefined`）。
 * ⚠️ 按别名顺序、不按后端 JSON 字段顺序 —— 同一行若同时出现两种写法，取哪个由本文件决定。
 */
function pickRaw(row: Record<string, unknown>, aliases: string[]): unknown {
  const byName = new Map<string, unknown>()
  for (const [name, value] of Object.entries(row)) {
    const normalized = normalizeFieldName(name)
    if (!byName.has(normalized)) byName.set(normalized, value)
  }
  for (const alias of aliases) {
    const normalized = normalizeFieldName(alias)
    if (byName.has(normalized)) return byName.get(normalized)
  }
  return undefined
}

/** 取文本：`null` / `undefined` / 空串一律返回 `null`（= 后端没给，**不给默认值**）。 */
function pickText(row: Record<string, unknown>, aliases: string[]): string | null {
  const value = pickRaw(row, aliases)
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

/** 取数值：非有限数按"后端没给"处理（`null`）。 */
function pickNumber(row: Record<string, unknown>, aliases: string[]): number | null {
  const value = pickRaw(row, aliases)
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 单行归一化。
 * ⚠️ 别名数组里的第一个名字 = 文档（`前端总对接文档-2026-10-09.md` §八）给的真实语义名，
 * 其余只是后端改名的兜底。**未识别出 `id`** 的行照样渲染（能在「原始数据」里看到），但**禁止处理**。
 */
export function normalizeDividendClawbackRow(value: unknown): DividendClawbackRow {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const id = pickNumber(row, ['id', 'clawbackId', 'recordId', 'failureId'])
  return {
    id,
    idRecognized: id !== null,
    orderNo: pickText(row, ['orderNo', 'orderNumber', 'orderSn']),
    orderId: pickNumber(row, ['orderId']),
    error: pickText(row, ['error', 'errorMsg', 'errorMessage', 'failReason', 'failureReason', 'reason']),
    // ⚠️ status 不做 0/1 之外的归一化：拿到 2 就存 2，页面显示原值 + 「未知状态」
    status: pickNumber(row, ['status', 'handleStatus', 'handleState', 'state']),
    handleBy: pickText(row, ['handleBy', 'handledBy', 'handler', 'handleByName', 'handlerName', 'operator']),
    handleTime: pickText(row, ['handleTime', 'handledTime', 'handleAt', 'handledAt']),
    remark: pickText(row, ['remark', 'handleRemark', 'handleNote', 'note']),
    createTime: pickText(row, ['createTime', 'createdTime', 'createAt', 'createdAt']),
    raw: row,
  }
}

/**
 * 读：失败记录列表。
 *
 * ⚠️ 返回 `[]` 与"接口失败"是**两件事**：只有真的拿到空数组才返回 `[]`；
 * 请求失败 / `code≠0` 一律抛错，由页面显示「查询失败，本次结果不可用」
 * —— 不把失败渲染成"没有失败记录"（那是两个完全相反的结论）。
 *
 * ⚠️ `status` **不传 = 全部**（后端语义）：这里绝不给 `status` 兜底成 0，
 * 否则"查全部"会被前端悄悄改成"只查未处理"。
 */
export async function getDividendClawbackList(
  params: DividendClawbackQuery,
): Promise<DividendClawbackRow[]> {
  const query: Record<string, number> = {}
  if (params.status !== undefined) query.status = params.status
  if (params.page !== undefined) query.page = params.page
  if (params.size !== undefined) query.size = params.size
  const response = await request.get<DividendClawbackResponse<DividendClawbackRawList>>(
    '/api/admin/dividend-clawback/list',
    { params: query },
  )
  const data = ensureSuccess(response.data, '红包追回失败记录查询失败')
  return (Array.isArray(data) ? data : []).map(normalizeDividendClawbackRow)
}

/**
 * 写：标记某条记录为已处理（置 `status=1` + 记录处理人/时间/备注）。
 *
 * @param id 取**后端返回的** `row.id`（⛔ 不要手写/猜测 id，猜错会改到别的记录）。
 * @param remark 处理备注，**可选**：留空时**不带该 query 参数**（不写 `remark=`、更不编造一句默认备注）。
 *
 * ⚠️ 后端是**条件更新**（仅 `status=0` 可改）⇒ 重复调用会报参数错误。
 * **具体错误码未知**（`api_doc.json` 未登记）⇒ 这里**不硬编码任何 code**：
 * 非 0 的 `code` 一律按后端 `message` 抛出，由页面原样提示 + **重新拉取列表**核对真实状态
 * （不做"看到某个 code 就当作已处理"的推断 —— 那是猜）。
 */
export async function markDividendClawbackHandled(id: number, remark?: string): Promise<void> {
  if (!Number.isFinite(Number(id))) throw new Error('记录 ID 无效，无法标记（请让后端确认 list 的字段名）')
  const params: Record<string, string> = {}
  const text = (remark ?? '').trim()
  if (text) params.remark = text
  const response = await request.post<DividendClawbackResponse<null>>(
    `/api/admin/dividend-clawback/${id}/handled`,
    null,
    { params },
  )
  ensureSuccess(response.data, '标记已处理失败')
}
