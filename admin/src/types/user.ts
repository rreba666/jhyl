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

/**
 * 用户列表的服务端筛选条件。
 *
 * ⚠️ 2026-10-10 修「分页与筛选不自洽」：
 * 契约 `GET /api/admin/user/list` 支持 `keyword` / `delFlag` / `banStatus` **服务端筛选**，
 * 而本仓库此前**只发 `keyword`**、再在前端 `store.list.filter(...)` 按页签过滤
 * ⇒ 后端回的是「全部用户」的第 N 页，前端再筛 ⇒ 每页可见条数偏少/为空，
 * 且 `total`/页数按**筛选后**的数量算 ⇒ 「已删除」页签可能是空页而实际有数据。
 *
 * ⇒ 现在页签直接下发到后端（见 `stores/user.ts` 的 `resolveListQuery`）。
 *
 * ⚠️ `banStatus` 的契约语义是「**仅未删除用户参与**」⇒ 它**只与 `delFlag: 0` 组合**才有意义
 * （已删除页签**不能**带 `banStatus`，否则自相矛盾）。
 * ⚠️ 未选 = **不下发该参数**（契约「不传返回全部」）——**不要发空串**。
 */
export interface UserListQuery {
  /** 删除标记：0=正常, 1=已删除；**不传 = 全部**。 */
  delFlag?: UserBanStatus
  /** 封禁状态：0=正常, 1=封禁；**不传 = 全部（仅未删除用户参与）**。 */
  banStatus?: UserBanStatus
}

/**
 * 用户列表的**前端**筛选状态：只剩关键词。
 *
 * ⚠️ 2026-10-10：原来的 `phone` / `banStatus` 两个字段从来没有任何写入方
 * （页面只有关键词输入框）⇒ 已删除，避免"看起来能筛、其实没接线"的假筛选。
 * 页签筛选走服务端 `UserListQuery`（见上）。
 */
export interface UserFilters {
  keyword: string
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
