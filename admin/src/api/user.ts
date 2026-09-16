import { request } from './request'
import { resolveMediaUrl } from './media'
import type { AdminWalletUpsertDTO, User, UserBanStatus, UserDetail, UserPageResult, UserResponse } from '@/types/user'
import { sanitizeBonusText } from '@/utils/textSafe'

/** 校验用户管理接口响应；后端错误文案统一做旧词兜底替换，避免页面出现历史遗留旧词。 */
function unwrapResponse<T>(response: { data: UserResponse<T> }, fallbackMessage: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(sanitizeBonusText(result.message) || fallbackMessage)
  return result.data as T
}

/** 归一化用户列表中的长整型 ID 和封禁状态。 */
function normalizeUserPage(data: UserPageResult): UserPageResult {
  return {
    ...data,
    total: Number(data.total) || 0,
    list: (data.list || []).map((user) => ({ ...user, id: String(user.id), avatarUrl: resolveMediaUrl(user.avatarUrl), banStatus: user.banStatus ?? 0, delFlag: Number(user.delFlag) === 1 ? 1 : 0 })),
  }
}

/** 归一化用户详情并拒绝无效余额，避免浮点异常进入编辑流程。 */
function normalizeUserDetail(data: UserDetail): UserDetail {
  const pendingPromotion = Number(data.pendingPromotion)
  const pendingBonus = Number(data.pendingBonus)
  if (!Number.isFinite(pendingPromotion) || pendingPromotion < 0 || !Number.isFinite(pendingBonus) || pendingBonus < 0) {
    throw new Error('用户钱包余额数据无效')
  }
  // 余额 balance：详情接口暂未返回时兜底为 0，不因缺失字段阻断详情展示
  const balance = Number(data.balance)
  return {
    ...data,
    id: String(data.id),
    avatarUrl: resolveMediaUrl(data.avatarUrl),
    banStatus: data.banStatus ?? 0,
    delFlag: Number(data.delFlag) === 1 ? 1 : 0,
    pendingPromotion,
    pendingBonus,
    balance: Number.isFinite(balance) && balance >= 0 ? balance : 0,
  }
}

/** 查询 B 端用户分页列表。keyword 纯数字按用户 ID 精确匹配，否则按昵称/手机号模糊匹配。 */
export async function getUsers(page: number, pageSize: number, keyword?: string): Promise<UserPageResult> {
  const params: Record<string, string | number> = { page, pageSize }
  if (keyword && keyword.trim()) params.keyword = keyword.trim()
  const response = await request.get<UserResponse<UserPageResult>>('/api/admin/user/list', { params })
  return normalizeUserPage(unwrapResponse(response, '用户列表查询失败'))
}

/** 查询用户详情，始终以字符串拼接长整型用户 ID。 */
export async function getUserDetail(userId: string): Promise<UserDetail> {
  userId = String(userId)
  const response = await request.get<UserResponse<UserDetail>>(`/api/admin/user/${userId}`)
  return normalizeUserDetail(unwrapResponse(response, '用户详情查询失败'))
}

/** 校验钱包编辑字段，只允许有限非负数字。 */
function validateWalletPayload(payload: AdminWalletUpsertDTO): void {
  for (const field of ['pendingPromotion', 'pendingBonus', 'balance'] as const) {
    const value = payload[field]
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error('余额必须是有限非负数字')
  }
}

/** 覆盖指定用户的可提现推广金或待提现红包。 */
export async function updateUserWallet(userId: string, payload: AdminWalletUpsertDTO): Promise<void> {
  validateWalletPayload(payload)
  userId = String(userId)
  const response = await request.post<UserResponse<unknown>>(`/api/admin/wallet/${userId}`, payload)
  unwrapResponse(response, '用户钱包更新失败')
}

/** 修改用户封禁状态。 */
export async function updateUserBanStatus(userId: string, banStatus: UserBanStatus): Promise<void> {
  const response = await request.put<UserResponse<null>>(`/api/admin/user/${userId}/ban`, { banStatus })
  unwrapResponse(response, '用户状态更新失败')
}

/** 软删除用户。 */
export async function deleteUser(userId: string): Promise<void> {
  const response = await request.delete<UserResponse<null>>(`/api/admin/user/${userId}`)
  unwrapResponse(response, '用户删除失败')
}

/** 恢复已软删除用户。 */
export async function restoreUser(userId: string): Promise<void> {
  const response = await request.put<UserResponse<null>>(`/api/admin/user/${userId}/restore`)
  unwrapResponse(response, '用户恢复失败')
}
