import { request } from '@/utils/request'

/** 免确认收款授权状态。 */
export type TransferAuthState = 'TAKING_EFFECT' | 'WAIT_USER_CONFIRM' | ''

/** 授权状态查询返回。 */
export interface TransferAuthStatus {
  /** TAKING_EFFECT=已授权；WAIT_USER_CONFIRM=待用户确认；空字符串=从未授权。 */
  state: TransferAuthState
}

/** 发起授权返回。 */
export interface TransferAuthApplyResult {
  /** 微信返回的 package 信息；为 null 表示已授权（幂等），直接刷新状态即可。 */
  packageInfo: string | null
}

/** 查询免确认收款授权状态。 */
export function getTransferAuthStatus(): Promise<TransferAuthStatus> {
  return request<TransferAuthStatus>({ url: '/api/wallet/transfer-auth/status', method: 'GET' })
}

/** 发起免确认收款授权，返回微信 package 信息。 */
export function applyTransferAuth(): Promise<TransferAuthApplyResult> {
  return request<TransferAuthApplyResult>({ url: '/api/wallet/transfer-auth/apply', method: 'POST' })
}
