/** 店员登录请求体。 */
export interface StaffLoginDTO {
  /** 工号/账号。 */
  username: string
  /** 密码。 */
  password: string
  /**
   * 登录入口白名单标识：本页固定传 `H5`。
   * 后端按此放行 `VERIFIER`（核销独立账号）与 `MANAGER`（店长内含核销能力）；
   * 商家账号 / 骑手 → `8106`（文案已说明"骑手不可核销"）。
   */
  client: 'H5' | 'PC'
}

/** 登录身份：核销员 / 店长（店长用同一工号密码登录核销页，便于追溯谁核销）。 */
export type StaffRole = 'VERIFIER' | 'MANAGER'

/** 店员登录返回。 */
export interface StaffLoginVO {
  /** Staff JWT，30 分钟有效。 */
  token: string
  /** 店员姓名。 */
  staffName: string
  /** 身份：`VERIFIER` 核销员 / `MANAGER` 店长（含核销）。 */
  role?: StaffRole | string
  /** 过期时间戳（毫秒）。 */
  expireAt: number
  /**
   * 是否必须先修改初始密码；`true` ⇒ 前端强制进入改密页。
   * 契约 `StaffLoginVO.mustChangePassword`：「true=只能先改密；后端对业务请求返回 8109」。
   * 后端未下发该字段时为 `undefined`（按"无需改密"处理）。
   */
  mustChangePassword?: boolean
}

/** 修改密码请求体（`POST /api/staff/auth/change-password`）。 */
export interface ChangePasswordDTO {
  /** 原密码（首次登录时为初始密码）。 */
  oldPassword: string
  /** 新密码：6~32 位，且不能与原密码相同。 */
  newPassword: string
}

/** 店员核销请求体。 */
export interface StaffVerifyDTO {
  /** 12 位自提码。 */
  code: string
  /** 核销方式：0=扫码，1=手动输码（默认 0）。 */
  verifyType?: 0 | 1
}

/** 核销结果中的商品明细。 */
export interface StaffVerifyItem {
  productName: string
  quantity: number
}

/** 店员核销返回。 */
export interface StaffVerifyVO {
  orderId: number | string
  orderNo: string
  payAmount: number
  verifyTime: string
  items: StaffVerifyItem[]
}

/** 后端统一响应结构。 */
export interface StaffResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
