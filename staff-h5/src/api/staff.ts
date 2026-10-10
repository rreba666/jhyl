import { post } from './request'
import type { ChangePasswordDTO, StaffLoginDTO, StaffLoginVO, StaffVerifyDTO, StaffVerifyVO } from '@/types/staff'

/** 店员登录（工号+密码）。 */
export async function staffLogin(payload: StaffLoginDTO): Promise<StaffLoginVO> {
  return post<StaffLoginVO>('/api/staff/auth/login', payload)
}

/**
 * 本人修改密码（首登强制改密）。
 * `POST /api/staff/auth/change-password`，Body `{ oldPassword, newPassword }`（新密码 6~32 位、不能与原密码相同）。
 * ⚠️ 成功 ⇒ 后端**踢下线**（删 Redis 登录标记，旧 token 立即失效）⇒ 调用方必须清本地登录态并跳登录页。
 * 失败：原密码错 ⇒ `8102`；长度/与原密码相同 ⇒ `1000`；登录态失效 ⇒ `8104`。
 */
export async function staffChangePassword(payload: ChangePasswordDTO): Promise<void> {
  return post<void>('/api/staff/auth/change-password', payload)
}

/** 店员核销自提订单（身份走 JWT，前端只传自提码和核销方式）。 */
export async function staffVerify(payload: StaffVerifyDTO): Promise<StaffVerifyVO> {
  return post<StaffVerifyVO>('/api/staff/verify', payload)
}
