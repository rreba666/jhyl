import { request } from '@/utils/request'

export interface MiniShopLoginData {
  token: string
  userId: number
  isNewUser: boolean
  expireAt: number
}

/** 调用小程序登录接口，用微信登录凭证换取业务 Token。 */
export function loginByWechat(code: string, phoneCode?: string, promoterId?: number | null): Promise<MiniShopLoginData> {
  const data: { code: string; phoneCode?: string; promoterId?: number } = { code }
  if (phoneCode) data.phoneCode = phoneCode
  if (Number.isInteger(promoterId) && Number(promoterId) > 0) data.promoterId = Number(promoterId)

  return request<MiniShopLoginData>({
    url: '/api/auth/login',
    method: 'POST',
    data,
  })
}
