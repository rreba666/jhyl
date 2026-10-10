import { request } from './request'
import { resolveMediaUrl } from './media'
import type { AdminWalletUpsertDTO, User, UserBanStatus, UserDetail, UserIdentity, UserListQuery, UserPageResult, UserResponse } from '@/types/user'
import { sanitizeBonusText } from '@/utils/textSafe'

/** 校验用户管理接口响应；后端错误文案统一做旧词兜底替换，避免页面出现历史遗留旧词。 */
function unwrapResponse<T>(response: { data: UserResponse<T> }, fallbackMessage: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(sanitizeBonusText(result.message) || fallbackMessage)
  return result.data as T
}

/**
 * 归一化用户列表中的长整型 ID、封禁状态与**身份**。
 *
 * ⚠️ `identity`（契约：0=游客, 1=注册用户）此前**完全没做归一化**，而列表页用
 * `row.identity === 1`（严格相等）判断「注册用户 / 游客」⇒
 * 后端若下发字符串 `"1"`（该字段在 `api_doc.json` 里的 `enum` 恰恰写成 `["0","1"]`
 * **字符串**，与其 `type: integer` 自相矛盾），页面会把注册用户**静默显示成「游客」**。
 * 两处（列表页 + 详情抽屉）都读这个字段，所以在**这一层**归一化，只做一次。
 */
function normalizeIdentity(value: unknown): UserIdentity {
  return value === 1 || value === '1' ? 1 : 0
}

/** 归一化用户列表中的长整型 ID 和封禁状态。 */
function normalizeUserPage(data: UserPageResult): UserPageResult {
  return {
    ...data,
    total: Number(data.total) || 0,
    list: (data.list || []).map((user) => ({ ...user, id: String(user.id), identity: normalizeIdentity(user.identity), avatarUrl: resolveMediaUrl(user.avatarUrl), banStatus: user.banStatus ?? 0, delFlag: Number(user.delFlag) === 1 ? 1 : 0 })),
  }
}

/**
 * ⚠️ 2026-10-08 新增：**关键钱包字段缺失/非法时告警**。
 *
 * 为什么需要：原先一律 `?? 0` / `: 0` 兜底 ⇒ **"后端真值 0"** 与 **"字段没取到"**
 * 在页面上**长得一模一样**（都显示 ¥0.00），运营会照着**假数字对账**。
 * 今华有肽就出过同类事故（应急池「累计抽取/注入」恒显示 ¥0.00 ⇒ 把注入堵死）。
 *
 * ⚠️ 只在**真正异常**（`undefined` / `null` / 非有限数 / 负数）时告警；
 * **合法的 0 不告警**（0 是正常值，不是缺失）。
 */
function warnInvalidWalletField(field: string, raw: unknown): void {
  console.warn(
    `[wallet] 用户详情字段 \`${field}\` 缺失或非法（收到：${JSON.stringify(raw)}）⇒ 已按 0 兜底显示。`
    + ' 请核对此字段是否被后端改名/移除，不要照当前页面数字对账。',
  )
}

/** 归一化用户详情并拒绝无效余额，避免浮点异常进入编辑流程。 */
function normalizeUserDetail(data: UserDetail): UserDetail {
  const pendingPromotion = Number(data.pendingPromotion)
  const pendingBonus = Number(data.pendingBonus)
  if (!Number.isFinite(pendingPromotion) || pendingPromotion < 0 || !Number.isFinite(pendingBonus) || pendingBonus < 0) {
    throw new Error('用户钱包余额数据无效')
  }
  // 余额 balance：详情接口暂未返回时兜底为 0，不因缺失字段阻断详情展示
  // ⚠️ 但**必须告警**：否则"后端没返回"与"余额真是 0"无法区分（见 warnInvalidWalletField 注释）。
  // ⚠️⚠️ 2026-10-08 修：**先判原始值是否"缺失"**，再看数值合法性。
  //   只判 `Number.isFinite(balance)` 是不够的 —— `Number(null)`/`Number('')`/`Number(false)` **都等于 0**
  //   ⇒ 后端下发 `"balance": null` 时会**静默通过**、页面显示 ¥0.00 且不告警，
  //   正是本告警要消灭的"假数字"（`api/wallet.ts` 的兄弟实现是显式判 `null` 的）。
  // ⚠️ 声明为 `unknown`：契约上 `balance` 是 `number`，但**运行时**后端可能下发 `null` /
  //    缺字段 / `''`（本告警要防的正是这种漂移）⇒ 不能依赖编译期类型做判断
  //    （直接写 `data.balance === ''` 会被 `vue-tsc` 判为 TS2367「无重叠」）。
  const rawBalance: unknown = data.balance
  const balanceMissing = rawBalance === null || rawBalance === undefined || rawBalance === ''
  const balance = Number(rawBalance)
  const balanceValid = !balanceMissing && Number.isFinite(balance) && balance >= 0
  if (!balanceValid) warnInvalidWalletField('balance', rawBalance)
  return {
    ...data,
    id: String(data.id),
    identity: normalizeIdentity(data.identity),
    avatarUrl: resolveMediaUrl(data.avatarUrl),
    banStatus: data.banStatus ?? 0,
    delFlag: Number(data.delFlag) === 1 ? 1 : 0,
    pendingPromotion,
    pendingBonus,
    balance: balanceValid ? balance : 0,
  }
}

/**
 * 查询 B 端用户分页列表。
 *
 * ⚠️ 筛选是**服务端**行为（2026-10-10 修「分页与筛选不自洽」）：契约
 * `GET /api/admin/user/list` 支持 `keyword` / `delFlag` / `banStatus` / `page` / `pageSize`，
 * 而此前本函数**只发 `keyword`** ⇒ 页签筛选被迫在前端做（对**当前页**过滤），
 * 页数/总数全错。现在页签映射成 `query.delFlag` / `query.banStatus` 一并下发。
 *
 * ⚠️ 未选 = **不下发该参数**（契约「不传返回全部」）；**不要**发空串/`null`占位。
 *
 * `keyword` 纯数字按用户 ID 精确匹配，否则按昵称/手机号模糊匹配。
 */
export async function getUsers(page: number, pageSize: number, keyword?: string, query?: UserListQuery): Promise<UserPageResult> {
  const params: Record<string, string | number> = { page, pageSize }
  if (keyword && keyword.trim()) params.keyword = keyword.trim()
  if (query?.delFlag !== undefined) params.delFlag = query.delFlag
  if (query?.banStatus !== undefined) params.banStatus = query.banStatus
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

/**
 * 人工登记 / 清空用户微信号（`PUT /api/admin/user/{userId}/wechat-id`）。
 *
 * ⚠️ 2026-10-10 新增：**这条链路此前在本仓库没有任何 UI**（三个前端全文检索 `wechat-id` 均为 0 命中），
 * 而人员绑定微信号**必须**先经过它 —— 契约接口描述原文：
 *
 * > 把客服线下收集到的用户**微信号**登记到用户档案（`wx_user.wx_id`）。
 * > **背景**：小程序 OpenAPI 拿不到微信号，只能拿 openid；所以微信号只能人工登记，
 * > **登记后「新增人员 → 绑定微信」可直接填微信号**。
 *
 * 绑定接口的描述同样写明：「微信号是人工登记值…**需先在「用户管理」里登记，否则报 2000 并提示去登记**。」
 * ⇒ 没有这个入口时，「新增人员」里的「微信号」选项就是**死路**（登记不出来，填了必报 2000）。
 *
 * `wechatId` 传**空串 = 清空登记**（契约原文：「入参：`wechatId` 非空=登记；空串/null=清空登记（纠正手误）」）。
 * 同一微信号只能登记到一个用户档案（登记给别的用户会返回 `1000` 并告知占用者用户 ID）。
 */
export async function registerUserWechatId(userId: string, wechatId: string): Promise<void> {
  const response = await request.put<UserResponse<null>>(`/api/admin/user/${String(userId)}/wechat-id`, { wechatId })
  unwrapResponse(response, '微信号登记失败')
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
