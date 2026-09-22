import { request } from './request'
import { extractMediaUrl } from './media'
import type {
  MerchantWithdrawOrder,
  MerchantWithdrawPage,
  MerchantWithdrawQuery,
  MerchantWithdrawReviewPayload,
  MerchantWithdrawSummary,
} from '@/types/merchantWithdraw'

/**
 * 商户提现审核（平台财务端）接口层 —— 后端积木 `fengling-settlement`。
 *
 * 契约：`docs/商户提现-前端开发文档-2026-09-22.md` §3（财务接口 7 条）+ `api_doc.json`。
 * 鉴权：`/api/admin/merchant-withdraw/**` 后端已登记为**仅超管 + 财务（FINANCE）**，其余角色返回 `1004`。
 *
 * ⚠️ 与既有 `api/withdraw.ts`（C 端**用户**提现）是两套业务，勿混用。
 */

/** 后端统一响应体。 */
interface MerchantWithdrawResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

/**
 * 带**业务码**的接口错误。
 *
 * 为什么需要它：`13015 提现单状态已变化，请刷新后重试` 是并发操作的正常结果，
 * 页面必须能识别出来**刷新列表 + 汇总**，而不是当成普通报错弹一下就完事。
 * 只靠文案匹配既脆弱又会漏（后端文案可能带前后缀），所以这里把 `code` 一并带出来。
 */
export class MerchantWithdrawApiError extends Error {
  /** 后端业务码（`Result.code`）；HTTP 层错误时为 `null`。 */
  readonly code: number | null

  constructor(message: string, code: number | null) {
    super(message)
    this.name = 'MerchantWithdrawApiError'
    this.code = code
  }
}

/** 业务码 `13015`：提现单状态已变化（并发操作 / 重复点击），提示后需刷新列表与汇总。 */
export const WITHDRAW_STATUS_CHANGED_CODE = 13015

/**
 * 校验业务响应码并取出 `data`（沿用 `api/withdraw.ts` / `api/ledger.ts` 的 `unwrap` 范式）。
 * 失败时抛出 {@link MerchantWithdrawApiError} 并携带业务码，供页面区分 `13015` 等特定场景。
 */
function unwrap<T>(response: { data: MerchantWithdrawResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) {
    throw new MerchantWithdrawApiError(result.message || fallback, typeof result.code === 'number' ? result.code : null)
  }
  return result.data as T
}

/** 任意值归一化为字符串；null / undefined 归一为 null（保留"语义为空"的区分）。 */
function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

/** 任意值归一化为数字（非数字兜底 0，避免页面出现 `NaN`）。 */
function toNumber(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

/**
 * 解析发票图片字段。
 *
 * ⚠️ **本批最大的字段坑**：后端响应的 `invoiceImages` 目前是 **JSON 字符串**
 * （形如 `"[\"https://oss…/1.png\"]"`）而不是数组（见开发文档 §2.5 注意 + §7 待优化项 1）。
 * 这里统一 `JSON.parse` 并兜底：解析失败 / 类型不符 / 非 JSON 数组 → **返回空数组**，
 * 保证页面只吃数组（`normalizeOrder(...).invoiceImages` 恒为 `string[]`）。
 *
 * 同时兼容三种入参形态，便于后端改成返回数组后前端无需再改：
 * 1. 真数组 → 直接逐项归一化；
 * 2. JSON 字符串 → `JSON.parse` 后取数组；
 * 3. 以逗号分隔的纯字符串（防御性兜底，后端当前不会这么返回）。
 */
function parseInvoiceImages(value: unknown): string[] {
  // ① 已经是数组（后端改回数组形态时直接命中）
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  const text = value.trim()
  if (!text) return []
  // ② JSON 字符串（当前后端形态）：解析失败一律兜底为空数组，绝不让页面拿到非法结构
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text)
      return Array.isArray(parsed) ? parsed.map((item) => String(item ?? '').trim()).filter(Boolean) : []
    } catch {
      return []
    }
  }
  // ③ 兜底：按逗号切分（防御性，后端当前不这么返回）
  return text.split(',').map((item) => item.trim()).filter(Boolean)
}

/**
 * 归一化单条商户提现单。
 * `id` / `merchantId` / `reviewerAdminId` 等 BIGINT 统一转字符串（与 `api/ledger.ts` 同策略，避免精度丢失）；
 * 可空字段**保留 null**（页面要区分"空"与"有值"，如 `paidAt` 为空时展示"未打款"）。
 */
function normalizeOrder(value: unknown): MerchantWithdrawOrder {
  const raw = (value || {}) as Record<string, unknown>
  return {
    id: String(raw.id ?? ''),
    withdrawNo: String(raw.withdrawNo ?? ''),
    merchantId: String(raw.merchantId ?? ''),
    subjectType: String(raw.subjectType ?? ''),
    applyStaffId: toNullableString(raw.applyStaffId),
    applyUserId: toNullableString(raw.applyUserId),
    applyName: String(raw.applyName ?? ''),
    amount: toNumber(raw.amount),
    invoiceAmount: toNumber(raw.invoiceAmount),
    invoiceNo: toNullableString(raw.invoiceNo),
    // 发票图：JSON 字符串 → 数组（见 parseInvoiceImages）
    invoiceImages: parseInvoiceImages(raw.invoiceImages),
    balanceSnapshot: toNumber(raw.balanceSnapshot),
    payeeType: String(raw.payeeType ?? ''),
    payeeName: String(raw.payeeName ?? ''),
    payeeAccount: String(raw.payeeAccount ?? ''),
    payeeQrUrl: toNullableString(raw.payeeQrUrl),
    status: String(raw.status ?? ''),
    reviewerAdminId: toNullableString(raw.reviewerAdminId),
    reviewTime: toNullableString(raw.reviewTime),
    reviewRemark: toNullableString(raw.reviewRemark),
    payNo: toNullableString(raw.payNo),
    payVoucherUrl: toNullableString(raw.payVoucherUrl),
    paidAt: toNullableString(raw.paidAt),
    createTime: String(raw.createTime ?? ''),
    updateTime: toNullableString(raw.updateTime),
  }
}

/**
 * 归一化分页结构（后端 `PageResult`：`list` / `total` / `page` / `pageSize`）。
 * `page` / `pageSize` 以后端返回为准，缺失时回退请求参数。
 */
function normalizePage(value: unknown, page: number, pageSize: number): MerchantWithdrawPage {
  const raw = (value || {}) as Record<string, unknown>
  const list = Array.isArray(raw.list) ? raw.list : []
  return {
    list: list.map(normalizeOrder),
    total: toNumber(raw.total) || 0,
    page: toNumber(raw.page) || page,
    pageSize: toNumber(raw.pageSize) || pageSize,
  }
}

/**
 * 分页查询商户提现单（`GET /api/admin/merchant-withdraw/list`）。
 * - `status` 多值英文逗号分隔（页面默认 `PENDING_REVIEW`）；
 * - `keyword` 匹配 提现单号 / 申请人 / 收款人姓名 / 收款账号；
 * - 只拼接有值的筛选条件，避免把空串发给后端造成误筛选。
 */
export async function getMerchantWithdrawList(params: MerchantWithdrawQuery): Promise<MerchantWithdrawPage> {
  const query: Record<string, string | number> = { page: params.page, size: params.size }
  const status = String(params.status ?? '').trim()
  const keyword = String(params.keyword ?? '').trim()
  if (status) query.status = status
  if (keyword) query.keyword = keyword
  const data = unwrap(await request.get<MerchantWithdrawResponse<unknown>>('/api/admin/merchant-withdraw/list', { params: query }), '商户提现列表查询失败')
  return normalizePage(data, params.page, params.size)
}

/**
 * 待办汇总（`GET /api/admin/merchant-withdraw/summary`）：待审核笔数 + 待审核金额合计。
 * ⚠️ 后端用 `Map<String,Object>` 返回，字段缺失/为 null 时统一兜底为 0（页面按 0 展示，不显示 `NaN`）。
 */
export async function getMerchantWithdrawSummary(): Promise<MerchantWithdrawSummary> {
  const data = unwrap(await request.get<MerchantWithdrawResponse<unknown>>('/api/admin/merchant-withdraw/summary'), '商户提现汇总查询失败')
  const raw = (data || {}) as Record<string, unknown>
  return {
    pendingCount: toNumber(raw.pendingCount),
    pendingAmount: toNumber(raw.pendingAmount),
  }
}

/**
 * 提现单详情（`GET /api/admin/merchant-withdraw/{withdrawNo}`）—— 三数核对页数据源。
 * 返回体与列表行同结构（`MerchantWithdrawOrderEntity`），因此共用 `normalizeOrder`。
 */
export async function getMerchantWithdrawDetail(withdrawNo: string): Promise<MerchantWithdrawOrder> {
  const no = String(withdrawNo ?? '').trim()
  if (!no) throw new MerchantWithdrawApiError('缺少提现单号，无法查询详情', null)
  const data = unwrap(
    await request.get<MerchantWithdrawResponse<unknown>>(`/api/admin/merchant-withdraw/${encodeURIComponent(no)}`),
    '商户提现详情查询失败',
  )
  return normalizeOrder(data)
}

/**
 * 审核通过（`PUT /api/admin/merchant-withdraw/{withdrawNo}/approve`）→ `APPROVED`（**还没到账**）。
 * `remark` 选填（如"三数一致，同意打款"）。
 */
export async function approveMerchantWithdraw(withdrawNo: string, remark?: string): Promise<void> {
  await putReviewAction(withdrawNo, 'approve', { remark: String(remark ?? '').trim() || undefined }, '商户提现审核通过失败')
}

/**
 * 驳回（`PUT /api/admin/merchant-withdraw/{withdrawNo}/reject`）→ `REJECTED`（**冻结立即解冻**）。
 * ⚠️ `remark` **必填**（后端强校验，返回 `13015` 之外的参数错误）：这里前置校验，避免白跑一次请求。
 */
export async function rejectMerchantWithdraw(withdrawNo: string, remark: string): Promise<void> {
  const reason = String(remark ?? '').trim()
  if (!reason) throw new MerchantWithdrawApiError('驳回原因必填，请填写后重试', null)
  await putReviewAction(withdrawNo, 'reject', { remark: reason }, '商户提现驳回失败')
}

/**
 * 确认打款（`PUT /api/admin/merchant-withdraw/{withdrawNo}/confirm-paid`）→ `SUCCESS`（冻结真正出账）。
 * ⚠️ 后端允许从 `APPROVED` **或** `PENDING_REVIEW` 一步到位（财务在一个弹窗里做完"核对 + 打款"也支持）。
 * `payNo` / `payVoucherUrl` / `remark` 均选填，但建议回填 `payNo` 便于对账。
 */
export async function confirmMerchantWithdrawPaid(
  withdrawNo: string,
  payload: MerchantWithdrawReviewPayload = {},
): Promise<void> {
  await putReviewAction(
    withdrawNo,
    'confirm-paid',
    {
      remark: String(payload.remark ?? '').trim() || undefined,
      payNo: String(payload.payNo ?? '').trim() || undefined,
      payVoucherUrl: String(payload.payVoucherUrl ?? '').trim() || undefined,
    },
    '确认打款失败',
  )
}

/**
 * 标记打款失败（`PUT /api/admin/merchant-withdraw/{withdrawNo}/fail`）→ `FAILED`（冻结解冻）。
 * `remark` 选填（如"收款账号有误"）。
 */
export async function failMerchantWithdraw(withdrawNo: string, remark?: string): Promise<void> {
  await putReviewAction(withdrawNo, 'fail', { remark: String(remark ?? '').trim() || undefined }, '标记打款失败失败')
}

/**
 * 四个 PUT 操作的公共实现（同一路径前缀 + 同一请求体 DTO `MerchantWithdrawReviewDTO`）。
 * 单独抽出来是为了让四处**共用同一套错误语义**（业务码透传给页面识别 `13015`），避免漏改其中之一。
 *
 * @param action 接口动作段：`approve` / `reject` / `confirm-paid` / `fail`
 */
async function putReviewAction(
  withdrawNo: string,
  action: 'approve' | 'reject' | 'confirm-paid' | 'fail',
  body: MerchantWithdrawReviewPayload,
  fallback: string,
): Promise<void> {
  const no = String(withdrawNo ?? '').trim()
  if (!no) throw new MerchantWithdrawApiError('缺少提现单号，无法执行操作', null)
  // body 里已剔除空串（后端对 `remark: ""` 与不传的处理不同，这里统一按"不传"语义发送）
  const response = await request.put<MerchantWithdrawResponse<null>>(
    `/api/admin/merchant-withdraw/${encodeURIComponent(no)}/${action}`,
    body,
  )
  unwrap(response, fallback)
}

/**
 * 上传打款回单图片，返回 OSS 直链（复用既有 `POST /api/common/upload`，与商家端发票上传同一接口）。
 * ⚠️ 该接口是**通用上传**（非本批新增），只支持 jpg/jpeg/png/webp/gif 且 ≤10MB。
 */
export async function uploadMerchantWithdrawVoucher(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await request.post<MerchantWithdrawResponse<unknown>>('/api/common/upload', formData)
  const url = extractMediaUrl(unwrap(response, '打款回单上传失败'))
  if (!url) throw new MerchantWithdrawApiError('打款回单上传未返回图片地址', null)
  return url
}
