import { request } from './request'
import type { AuthMeResponse, AuthMeVO, AdminLoginDTO, AdminLoginResponse, AdminLoginVO } from '@/types/auth'

/** 调用管理员登录接口并校验后端返回的登录数据。 */
export async function loginAdmin(payload: AdminLoginDTO): Promise<AdminLoginVO> {
  const response = await request.post<AdminLoginResponse>('/api/admin/auth/login', payload)
  const result = response.data

  if (result.code !== 0 || result.success === false || !result.data?.token) {
    throw new Error(result.message || '管理员登录失败')
  }

  return result.data
}

/** 查询当前登录管理员信息（auth/me，返回 AuthMeVO：adminId/role/merchantId/merchantName/permissions）。 */
export async function getAuthMe(): Promise<AuthMeVO> {
  const response = await request.get<AuthMeResponse>('/api/admin/auth/me', { skipAuthRedirect: true })
  const result = response.data
  if (result.code !== 0 || result.success === false || !result.data?.adminId) {
    throw new Error(result.message || '当前管理员信息查询失败')
  }
  return result.data
}

