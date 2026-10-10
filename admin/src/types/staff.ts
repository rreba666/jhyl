export type StaffStatus = 0 | 1
export type StaffGender = 0 | 1 | 2
export type StaffDeleteFlag = 0 | 1

/** 身份角色名（v8 出参新名；旧值 SHOP_MANAGER/SHOP_DELIVERY 仅作后端入参别名）。 */
export type StaffRoleName = 'MERCHANT_OWNER' | 'MANAGER' | 'RIDER' | 'VERIFIER' | 'STAFF'

/**
 * 新增/改身份时可选的"身份组合"：
 * - MANAGER = 店长（后端同时置 is_merchant=1 + delivery_enabled=1，即"店长兼骑手"）
 * - RIDER   = 纯骑手
 * - VERIFIER= 核销店员（独立账号，不绑微信）
 * - NONE    = 仅档案（identities 传 []）
 */
export type StaffIdentityOption = 'MANAGER' | 'RIDER' | 'VERIFIER' | 'NONE'

/** 中控人员台账行（StaffAccountVO）。 */
export interface StaffAccount {
  id: number
  username?: string | null
  name: string
  phone?: string
  idCard?: string
  gender?: number
  shopId?: number
  shopName?: string
  merchantId?: number
  merchantName?: string
  staffRole: string
  identities: string[]
  /** 中文身份标签（直接展示，如：商家 / 店长兼骑手 / 骑手 / 核销店员 / 仅档案）。 */
  identityLabel: string
  deliveryEnabled: boolean
  isMerchant?: number
  managerLevel?: string
  /** 是否已发号（false 表示还没工号密码）。 */
  accountIssued: boolean
  canLoginPc?: boolean
  canLoginH5?: boolean
  boundUserId?: number | null
  boundNickname?: string
  boundOpenidMasked?: string
  status: number
  delFlag?: number
  createTime?: string
  shopStatus?: number
  managerCount?: number
  riderCount?: number
  boundUserCount?: number
}

/** 建号入参（中控 D1 / 商家 PC C3）。 */
export interface StaffAccountSaveDTO {
  /** 身份集合：['MANAGER'] / ['RIDER'] / ['VERIFIER'] / []（仅档案）。 */
  identities: string[]
  name: string
  shopId?: number | string
  /** 工号：需要密码的身份（MANAGER / VERIFIER）必填。 */
  username?: string
  /** 密码：需要密码的身份（MANAGER / VERIFIER）必填。 */
  password?: string
  phone?: string
  /** 绑定微信用户 ID（与 openid 二选一；店长/骑手必填）。 */
  userId?: number | string
  /** 绑定微信 openid（与 userId 二选一）。 */
  openid?: string
  gender?: number
  idCard?: string
}

/** 发号入参（D1b：把"审核通过但未发号"的账号激活）。 */
export interface StaffIssueAccountDTO {
  username: string
  password: string
}

/** 改身份入参（D4；username/password 可选 = 支持"升店长同时发号"一步式）。 */
export interface StaffIdentityUpdateDTO {
  identities: string[]
  username?: string
  password?: string
}

/** 绑定微信入参（D4b）。 */
export interface StaffBindDTO {
  userId?: number | string
  openid?: string
}

/** 查看登录明文（D2，仅中控）。 */
export interface StaffPasswordView {
  id: number
  username?: string
  name: string
  /** 登录入口提示：PC 商户控制台 / H5 核销页（店长内含核销能力）。 */
  entry: string
  /**
   * 登录密码明文（契约：「历史账号可能无留档，此时为 null」）。
   *
   * ⚠️ 2026-10-10：类型放宽为 `string | null | undefined` 以**容忍字段消失** ——
   * `docs/26/10.10/后端需求-入驻默认密码与首登改密-2026-10-10.md` §六（R5）建议后端
   * 「停止新增明文留档」并撤掉该字段；字段一旦撤掉/改名，前端必须走「无留档」而不是渲染空白。
   */
  passwordPlain?: string | null
  /**
   * true = 历史账号 BCrypt 不可逆，无明文记录（展示 hint + 引导重置密码）。
   * ⚠️ 同上：**字段本身可能不存在**（撤字段时它是第一个消失的）⇒ 调用方**不得**只依据它判断
   * 「有没有明文」，必须以 `passwordPlain` 本体为准（见 `views/staff/index.vue` 的 `hasPlainPassword`）。
   */
  noPlainRecord?: boolean
  hint?: string
  updateTime?: string
}

/** 改密留痕（D3b）。 */
export interface StaffPasswordLog {
  id: number
  staffId: number
  username?: string
  /** 改前密码（明文留档）。⚠️ 契约 R5 建议去掉明文 ⇒ 可能为 null / 字段消失（展示「无留档」）。 */
  passwordBefore?: string | null
  /** 改后密码（明文留档）。⚠️ 同上。 */
  passwordAfter?: string | null
  changeType: 'CREATE' | 'RESET'
  operatorType: 'ADMIN' | 'MERCHANT_PC'
  operatorId?: number
  remark?: string
  createTime: string
}

/** 人员台账查询参数（D0）。 */
export interface StaffAccountQuery {
  shopId?: number | string
  role?: string
  keyword?: string
  status?: number | string
  /** P7：true = 只返回已删除账号（「回收站」视图，恢复入口在这里）。 */
  onlyDeleted?: boolean
  /** P7：true = 在用 + 已删除一起返回（按行内 `delFlag` 区分）。 */
  includeDeleted?: boolean
  page?: number
  size?: number
}

/** 人员台账分页结果。 */
export interface StaffAccountPageResult {
  total: number
  list: StaffAccount[]
  page: number
  pageSize: number
}

export interface StaffResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
  traceId?: string
}
