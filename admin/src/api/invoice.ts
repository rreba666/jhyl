import { request } from './request'
import type { AdminInvoice, AdminInvoiceBatchDeleteDTO, AdminInvoiceDetail, AdminInvoiceFilters, AdminInvoicePageResult, AdminInvoiceProcessDTO, AdminInvoiceRejectDTO, InvoiceResponse } from '@/types/invoice'

function unwrap<T>(response: { data: InvoiceResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/**
 * 只接受后端文档定义的全部发票状态，避免未知值被误显示为待处理。
 * ⚠️ 白名单**必须包含 3（已驳回，终态）**：后端 2026-09-30 新增了该状态且**实际会返回 3**，
 * 而 `api_doc.json` 的契约描述漏写了它（只写到 0/1/2/4）。若这里跟着漏，后端返回的「已驳回」
 * 会被**静默归一化成 0（待处理）**——界面上看不出报错，但状态标签、操作按钮、筛选结果全错
 * （本项目同类「白名单式归一化漏字段」已踩过 5 次，见 CLAUDE.md）。
 */
function normalizeStatus(value: unknown): AdminInvoice['status'] {
  const status = Number(value)
  return status === 1 || status === 2 || status === 3 || status === 4 ? status : 0
}

/** 兼容后端分页返回 list/records 两种字段，并保护 BIGINT 标识。 */
function normalizePage(value: unknown, page: number, pageSize: number): AdminInvoicePageResult {
  const raw = (value || {}) as Record<string, unknown>
  const source = Array.isArray(raw.list) ? raw.list : Array.isArray(raw.records) ? raw.records : []
  return {
    total: Number(raw.total ?? source.length) || 0,
    page: Number(raw.page ?? raw.current ?? page) || page,
    pageSize: Number(raw.pageSize ?? raw.size ?? pageSize) || pageSize,
    list: source.map((item) => {
      const row = item as Partial<AdminInvoice>
      return {
        ...row,
        id: String(row.id ?? ''),
        userId: String(row.userId ?? ''),
        userNickname: String(row.userNickname ?? ''),
        userPhone: String(row.userPhone ?? ''),
        type: Number(row.type) === 2 ? 2 : 1,
        amount: Number(row.amount ?? 0),
        orderIds: String(row.orderIds ?? ''),
        status: normalizeStatus(row.status),
        statusDesc: String(row.statusDesc ?? ''),
        createTime: String(row.createTime ?? ''),
        updateTime: String(row.updateTime ?? ''),
      } as AdminInvoice
    }),
  }
}

/** 查询后台发票申请列表。 */
export async function getAdminInvoices(params: { page: number; pageSize: number } & AdminInvoiceFilters): Promise<AdminInvoicePageResult> {
  const response = await request.get<InvoiceResponse<unknown>>('/api/admin/invoice/list', {
    params: { page: params.page, pageSize: params.pageSize, ...(params.status === '' ? {} : { status: params.status }) },
  })
  return normalizePage(unwrap(response, '发票列表查询失败'), params.page, params.pageSize)
}

/** 查询后台发票申请详情及商品明细。 */
export async function getAdminInvoiceDetail(id: string): Promise<AdminInvoiceDetail> {
  const response = await request.get<InvoiceResponse<AdminInvoiceDetail>>(`/api/admin/invoice/detail/${id}`)
  const detail = unwrap(response, '发票详情查询失败')
  // status 走与列表**同一个**归一化函数（含 3=已驳回），避免同一条记录在列表与详情里显示成两种状态
  return { ...detail, id: String(detail.id), userId: String(detail.userId), status: normalizeStatus(detail.status), orderItems: detail.orderItems || [] }
}

/** 标记发票已发送。 */
export async function processAdminInvoice(id: string, payload: AdminInvoiceProcessDTO): Promise<void> {
  unwrap(await request.put<InvoiceResponse<null>>(`/api/admin/invoice/${id}/process`, payload), '发票处理失败')
}

/** 确认待红冲发票已完成红冲，将状态更新为已作废。 */
export async function confirmRedFlushAdminInvoice(id: string): Promise<void> {
  unwrap(await request.put<InvoiceResponse<null>>(`/api/admin/invoice/${id}/confirm-red-flush`), '确认红冲失败')
}

/**
 * 驳回发票申请（待处理 0 → 已驳回 3，**终态**）。
 * 业务约束（前端只做体验层兜底，最终裁决在后端）：
 * - 仅「待处理(0)」可驳回；已发送(1)/待红冲(2) 会被后端拒绝并返回 `8301`；
 * - 原因**必填**，为空后端返回 `1000`「驳回原因不能为空」⇒ 调用方必须先做非空校验再发请求；
 * - 原因写入 `admin_remark`，**用户在小程序可见**（不发邮件/短信通知），文案请引导运营写清楚、别写内部黑话。
 */
export async function rejectAdminInvoice(id: string, payload: AdminInvoiceRejectDTO): Promise<void> {
  // 只提交 reason 一个字段，避免把表单里的其它字段（如空的 adminRemark）带给后端
  unwrap(await request.put<InvoiceResponse<null>>(`/api/admin/invoice/${id}/reject`, { reason: payload.reason }), '发票驳回失败')
}

/**
 * 删除单条发票申请（**逻辑删除**，仅平台超管）。
 * - 权限：后端按登录态角色校验，非超管返回 `1004`（前端同步隐藏入口，见发票页 `canDelete`）；
 * - 状态：仅 0/3/4 可删，1（已发送）/2（待红冲）是财务凭证，会被拒绝并返回 `8301`；
 * - 删除后 list / detail 都不再返回该记录（数据仍在库中，`del_flag=1`），详情接口会返回 `8300`。
 */
export async function deleteAdminInvoice(id: string): Promise<void> {
  unwrap(await request.delete<InvoiceResponse<null>>(`/api/admin/invoice/${id}`), '发票删除失败')
}

/**
 * 批量删除发票申请（**逻辑删除**，仅平台超管）。
 * ⚠️ 后端语义是**整批失败**：只要选中项里有一条状态不允许（1 已发送 / 2 待红冲），
 * **整批都不删并事务回滚**（不会删掉一半）。因此调用方：
 * 1. 点击前先本地预检，把「哪一条不合适」提示出来，避免发一次注定失败的请求；
 * 2. **不能因此省掉后端报错的展示** —— 并发/数据已变更等情况下仍可能失败，后端的 message 原样提示给运营。
 * @returns 后端返回的实际删除条数（失败时抛错，不会返回部分成功）
 */
export async function deleteAdminInvoicesBatch(ids: string[]): Promise<number> {
  // ⚠️ 入参是 string[]（列表归一化后 id 统一为字符串，BIGINT 精度保护），
  //    但**发给后端必须是数字**：契约里 body 是 `{"ids":[1,2,3]}`（int64 数组），
  //    且本项目后端的 Jackson **把字符串→数字的强制转换关掉了**
  //    （商品多分类那次实测：`long[]` 传字符串会被判「请求体格式错误」code=1000）。
  // ⚠️ 关键：转换后**数量必须一致** —— 否则 `Number('abc')=NaN` 会被 filter 掉，
  //    变成「静默少删几条」（运营以为删了 3 条、其实只删了 2 条）。这里直接抛错让调用方重试。
  const numericIds = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
  if (numericIds.length !== ids.length) throw new Error('发票 ID 参数不合法，请刷新列表后重试')
  const payload: AdminInvoiceBatchDeleteDTO = { ids: numericIds }
  // DELETE 带 body：axios 需放在 config.data 里（后端 body 形如 {"ids":[1,2,3]}）
  const result = unwrap(await request.delete<InvoiceResponse<unknown>>('/api/admin/invoice/batch', { data: payload }), '批量删除发票失败')
  return Number(result ?? 0) || 0
}
