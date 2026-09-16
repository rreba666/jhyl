import { request } from './request'
import type { AdminCreateDTO, AdminInfo, AdminPageResult, AdminResponse, AdminRoleDTO, AdminStatus } from '@/types/admin'

/** 校验管理员接口响应，返回业务数据。 */
function unwrapResponse<T>(response: { data: AdminResponse<T> }, fallbackMessage: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallbackMessage)
  return result.data as T
}

/** 归一化管理员记录。 */
function normalizeAdmin(admin: AdminInfo): AdminInfo {
  return {
    ...admin,
    id: String(admin.id),
    merchantId: admin.merchantId != null ? Number(admin.merchantId) : null,
    merchantName: admin.merchantName || '',
    status: Number(admin.status) === 1 ? 1 : 0,
    delFlag: Number(admin.delFlag) === 1 ? 1 : 0,
  }
}

function normalizePage(data: AdminPageResult): AdminPageResult {
  return {
    ...data,
    total: Number(data.total) || 0,
    list: (data.list || []).map(normalizeAdmin),
  }
}

/** 查询管理员分页列表（含已删除）。 */
export async function getAdmins(page: number, pageSize: number, keyword?: string, status?: '' | 0 | 1): Promise<AdminPageResult> {
  const params: Record<string, string | number> = { page, pageSize }
  if (keyword && keyword.trim()) params.keyword = keyword.trim()
  if (status !== undefined && status !== '') params.status = status
  const response = await request.get<AdminResponse<AdminPageResult>>('/api/admin/role/list', { params })
  return normalizePage(unwrapResponse(response, '管理员列表查询失败'))
}

/** 新建管理员账号（ADMIN 角色必填 merchantId，平台岗必须为空）。 */
export async function createAdmin(payload: AdminCreateDTO): Promise<void> {
  const response = await request.post<AdminResponse<null>>('/api/admin/role', payload)
  unwrapResponse(response, '管理员创建失败')
}

/** 修改管理员角色（ADMIN 角色必填 merchantId，平台岗必须为空）。 */
export async function updateAdminRole(id: string, payload: AdminRoleDTO): Promise<void> {
  const response = await request.put<AdminResponse<null>>(`/api/admin/role/${String(id)}/role`, payload)
  unwrapResponse(response, '管理员角色更新失败')
}

/** 启用/禁用管理员。 */
export async function updateAdminStatus(id: string, status: AdminStatus): Promise<void> {
  const response = await request.put<AdminResponse<null>>(`/api/admin/role/${String(id)}/status`, { status })
  unwrapResponse(response, '管理员状态更新失败')
}

/** 软删除管理员（DELETE /api/admin/role/{id}，delFlag 0→1，不能删自己）。 */
export async function deleteAdmin(id: string): Promise<void> {
  const response = await request.delete<AdminResponse<null>>(`/api/admin/role/${String(id)}`)
  unwrapResponse(response, '管理员删除失败')
}

/** 重置管理员密码。 */
export async function resetAdminPassword(id: string, newPassword: string): Promise<void> {
  const response = await request.put<AdminResponse<null>>(`/api/admin/role/${String(id)}/reset-password`, { newPassword })
  unwrapResponse(response, '密码重置失败')
}

/** 恢复已软删除管理员。 */
export async function restoreAdmin(id: string): Promise<void> {
  const response = await request.put<AdminResponse<null>>(`/api/admin/role/${String(id)}/restore`)
  unwrapResponse(response, '管理员恢复失败')
}
