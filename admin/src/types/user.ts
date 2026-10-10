export type UserIdentity = 0 | 1
export type UserBanStatus = 0 | 1
export type UserBanStatusValue = UserBanStatus | '0' | '1'

export interface User {
  id: string
  nickname: string
  avatarUrl: string
  phone: string
  /**
   * 微信号（**人工登记值**）。
   * 契约 `AdminUserListVO.wxId` 描述原文：「微信号（人工登记；**null=未登记**。
   * 修改走 `PUT /api/admin/user/{userId}/wechat-id`）」。
   * ⇒ 它决定该用户能不能用**微信号**作为人员绑定的 key（未登记就必然失败）。
   */
  wxId?: string | null
  identity: UserIdentity
  banStatus: UserBanStatusValue
  delFlag: 0 | 1
  createTime: string
}

export interface UserDetail extends User {
  pendingPromotion: number
  pendingBonus: number
  /** 余额（独立账户，可消费可提现）。 */
  balance: number
}

export interface AdminWalletUpsertDTO {
  pendingPromotion?: number
  pendingBonus?: number
  /** 余额（独立账户，可消费可提现）。 */
  balance?: number
}

export interface UserFilters {
  keyword: string
  phone: string
  banStatus: '' | UserBanStatusValue
}

export interface UserPageResult {
  total: number
  list: User[]
  page: number
  pageSize: number
}

export interface UserResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
