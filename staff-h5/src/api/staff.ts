import { post } from './request'
import type { StaffLoginDTO, StaffLoginVO, StaffVerifyDTO, StaffVerifyVO } from '@/types/staff'

/** 店员登录（工号+密码）。 */
export async function staffLogin(payload: StaffLoginDTO): Promise<StaffLoginVO> {
  return post<StaffLoginVO>('/api/staff/auth/login', payload)
}

/** 店员核销自提订单（身份走 JWT，前端只传自提码和核销方式）。 */
export async function staffVerify(payload: StaffVerifyDTO): Promise<StaffVerifyVO> {
  return post<StaffVerifyVO>('/api/staff/verify', payload)
}
