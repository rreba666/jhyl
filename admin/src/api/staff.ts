import { request } from './request'
import type {
  StaffAccount,
  StaffAccountPageResult,
  StaffAccountQuery,
  StaffAccountSaveDTO,
  StaffBindDTO,
  StaffIdentityUpdateDTO,
  StaffIssueAccountDTO,
  StaffPasswordLog,
  StaffPasswordView,
  StaffResponse,
} from '@/types/staff'

/** 统一校验业务响应并取 data。 */
function unwrap<T>(response: { data: StaffResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 兼容 records / list 两种分页返回结构，并归一化行数据。 */
function normalizePage(value: unknown, page: number, pageSize: number): StaffAccountPageResult {
  const raw = (value || {}) as Record<string, unknown>
  const records = Array.isArray(raw.records) ? raw.records : Array.isArray(raw.list) ? raw.list : Array.isArray(value) ? value : []
  return {
    total: Number(raw.total ?? records.length) || 0,
    page: Number(raw.current ?? raw.page ?? page) || page,
    pageSize: Number(raw.size ?? raw.pageSize ?? pageSize) || pageSize,
    list: records.map((item) => {
      const account = item as Partial<StaffAccount>
      return {
        ...account,
        id: Number(account.id ?? 0),
        identities: Array.isArray(account.identities) ? account.identities : [],
        identityLabel: account.identityLabel || '仅档案',
        deliveryEnabled: Boolean(account.deliveryEnabled),
        accountIssued: Boolean(account.accountIssued),
        status: Number(account.status) === 1 ? 1 : 0,
      } as StaffAccount
    }),
  }
}

/** D0 人员台账（新「店员管理」页数据源；旧 /api/admin/staff/list 已不用于本页）。 */
export async function getStaffAccounts(query: StaffAccountQuery = {}): Promise<StaffAccountPageResult> {
  const params: Record<string, string | number> = { page: query.page ?? 1, size: query.size ?? 10 }
  if (query.shopId !== undefined && query.shopId !== '') params.shopId = query.shopId
  if (query.role) params.role = query.role
  if (query.keyword && query.keyword.trim()) params.keyword = query.keyword.trim()
  if (query.status !== undefined && query.status !== '') params.status = query.status
  // P7：删除状态筛选——都不传=只在用；onlyDeleted=只看已删除（回收站）；includeDeleted=一起返回
  if (query.onlyDeleted) params.onlyDeleted = 'true'
  else if (query.includeDeleted) params.includeDeleted = 'true'
  const response = await request.get<StaffResponse<unknown>>('/api/admin/staff/accounts', { params })
  return normalizePage(unwrap(response, '人员台账查询失败'), query.page ?? 1, query.size ?? 10)
}

/** D1 建号（新建人员档案 / 叠加身份）。返回新建的 staffId。 */
export async function createStaffAccount(payload: StaffAccountSaveDTO): Promise<number> {
  const data = unwrap(await request.post<StaffResponse<number>>('/api/admin/staff/account', payload), '人员建号失败')
  return Number(data ?? 0)
}

/** D1b 发号（激活"审核通过但未发号"的商家/店长账号）。 */
export async function issueStaffAccount(id: number | string, payload: StaffIssueAccountDTO): Promise<void> {
  unwrap(await request.post<StaffResponse<null>>(`/api/admin/staff/${id}/issue-account`, payload), '账号发号失败')
}

/** D5 账号详情（无密码字段，用于排查"为什么他没身份"）。 */
export async function getStaffAccount(id: number | string): Promise<StaffAccount> {
  return unwrap(await request.get<StaffResponse<StaffAccount>>(`/api/admin/staff/${id}/account`), '账号详情查询失败')
}

/** D2 查看登录密码明文（敏感：前端必须二次确认；后端写审计）。 */
export async function viewStaffLoginPassword(id: number | string): Promise<StaffPasswordView> {
  return unwrap(await request.get<StaffResponse<StaffPasswordView>>(`/api/admin/staff/${id}/login-password`), '登录密码查看失败')
}

/** D3b 改密留痕（含改前/改后明文 + 操作人 + 类型）。 */
export async function getStaffPasswordHistory(id: number | string, limit = 20): Promise<StaffPasswordLog[]> {
  const data = unwrap(
    await request.get<StaffResponse<StaffPasswordLog[]>>(`/api/admin/staff/${id}/password-history`, { params: { limit } }),
    '改密留痕查询失败',
  )
  return Array.isArray(data) ? data : []
}

/** D3 重置密码（后端留痕 + 踢下线）。 */
export async function resetStaffPassword(id: number | string, newPassword: string): Promise<void> {
  unwrap(await request.put<StaffResponse<null>>(`/api/admin/staff/${id}/reset-password`, { newPassword }), '密码重置失败')
}

/**
 * D6① 启停账号。
 * 注意：中控是**查询参数** `?status=0|1`（商家 PC 的 C7 才是 JSON body），两处格式不同勿混用。
 */
export async function updateStaffStatus(id: number | string, status: 0 | 1): Promise<void> {
  unwrap(await request.put<StaffResponse<null>>(`/api/admin/staff/${id}/status`, null, { params: { status } }), '账号状态更新失败')
}

/** D4 改身份（可一步式发号；identities 传 [] 回"仅档案"）。 */
export async function updateStaffIdentities(id: number | string, payload: StaffIdentityUpdateDTO): Promise<void> {
  unwrap(await request.put<StaffResponse<null>>(`/api/admin/staff/${id}/identities`, payload), '身份修改失败')
}

/** D4b 绑定微信用户（userId / openid 二选一）。 */
export async function bindStaffWechat(id: number | string, payload: StaffBindDTO): Promise<void> {
  unwrap(await request.post<StaffResponse<null>>(`/api/admin/staff/${id}/bind`, payload), '微信绑定失败')
}

/** D4c 解绑微信。 */
export async function unbindStaffWechat(id: number | string): Promise<void> {
  unwrap(await request.post<StaffResponse<null>>(`/api/admin/staff/${id}/unbind`), '微信解绑失败')
}

/** 软删除人员（旧接口保留兼容）。 */
export async function deleteStaff(id: number | string): Promise<void> {
  unwrap(await request.delete<StaffResponse<null>>(`/api/admin/staff/${id}`), '人员删除失败')
}

/** 恢复已删除人员（旧接口保留兼容）。 */
export async function restoreStaff(id: number | string): Promise<void> {
  unwrap(await request.put<StaffResponse<null>>(`/api/admin/staff/${id}/restore`), '人员恢复失败')
}
