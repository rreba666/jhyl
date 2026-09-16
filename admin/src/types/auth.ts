/** 管理员登录请求参数。 */
export interface AdminLoginDTO {
  username: string
  password: string
}

/** 后端管理员角色枚举。 */
export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'CUSTOMER_SERVICE' | 'FINANCE'

/** 后端返回的管理员登录信息（今华有礼 api_doc: AdminLoginResult）。 */
export interface AdminLoginVO {
  token: string
  adminId: number
  username: string
  role: AdminRole
  /** 所属商户 ID（仅 ADMIN 商户管理员有值，平台岗为空）。 */
  merchantId?: number | null
  /** 所属商户名（品牌名，仅 ADMIN 有值）。 */
  merchantName?: string | null
  /** 角色权限点码列表（菜单/按钮显隐依据）。 */
  permissions?: string[]
}

/** 管理员登录接口的完整响应结构。 */
export interface AdminLoginResponse {
  code: number
  message: string
  data: AdminLoginVO | null
  success?: boolean
}

/** auth/me 返回的当前管理员信息（后端 AuthMeVO，字段用 adminId）。 */
export interface AuthMeVO {
  adminId: number
  username: string
  nickname: string
  role: AdminRole
  /** 绑定商户 ID（仅 ADMIN 有值）。 */
  merchantId?: number | null
  /** 绑定商户名（仅 ADMIN 有值）。 */
  merchantName?: string | null
  /** 权限点码列表。 */
  permissions?: string[]
}

/** auth/me 完整响应结构。 */
export interface AuthMeResponse {
  code: number
  message: string
  data: AuthMeVO | null
  success?: boolean
}
