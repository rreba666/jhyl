import { request } from '@/utils/request'

/** 可切换身份卡（对接文档 §4.2 / §11）。 */
export interface IdentityItem {
  /** 绑定记录 id；切回商城时传 null。 */
  bindingId: number | null
  /** 身份：MERCHANT_OWNER 商家 / MANAGER 店长（内含骑手能力）/ RIDER 骑手；VERIFIER、STAFF 不会出现在 identities。 */
  role: 'MERCHANT_OWNER' | 'MANAGER' | 'RIDER' | 'VERIFIER' | 'STAFF' | string
  /** 身份卡文案（直接展示，不要自己拼中文）：门店管理 / 骑手工作台 / 门店管理（待开通）。 */
  label: string
  /** 切换后要去的页面。 */
  targetPage: 'CUSTOMER' | 'MANAGER' | 'RIDER'
  merchantId?: number
  merchantName?: string
  shopId?: number
  shopName?: string
  /** 是否默认身份（多身份时优先展示）。 */
  primary: boolean
  /** true = 待开通占位（只能展示，按钮必须 disabled）。 */
  pending: boolean
  /** 待开通时的提示文案。 */
  hint?: string | null
}

/** 身份列表（含待开通占位）。 */
export interface IdentityVO {
  identities: IdentityItem[]
  pendingIdentities: IdentityItem[]
  hasBusinessIdentity: boolean
  staffRole: string
  shopId?: number
  merchantId?: number
  /** 当前是否具备骑手能力（店长页内含骑手功能）。 */
  deliveryCapability: boolean
  /** true = 身份被解绑/禁用/门店停用，前端提示并强制回商城页。 */
  roleChanged: boolean
}

/** 切换身份返回（token 不变）。 */
export interface IdentitySwitchVO {
  entry: 'CUSTOMER' | 'MANAGER' | 'RIDER'
  hasBusinessIdentity: boolean
  staffRole: string
  shopId?: number
  merchantId?: number
  deliveryCapability: boolean
  identities: IdentityItem[]
  pendingIdentities: IdentityItem[]
}

/** 读取当前用户身份列表（打开个人中心 / 切换前刷新 / 被改角色后同步）。 */
export function getIdentity(): Promise<IdentityVO> {
  return request<IdentityVO>({ url: '/api/auth/identity', method: 'GET' })
}

/** 切换身份：传 bindingId 进对应工作台；传 null 回商城页（entry=CUSTOMER）。 */
export function switchIdentity(bindingId: number | null): Promise<IdentitySwitchVO> {
  return request<IdentitySwitchVO>({ url: '/api/auth/identity/switch', method: 'POST', data: { bindingId } })
}
