/**
 * 店员端业务错误码口径（staff-h5 核销端）
 * ------------------------------------------------------------
 * 依据：后端契约 `api_doc.json` + `docs/26/10.10/前端对接文档-2026-10-10-全集.md` §一（B1/B2）/ §七。
 * 职责：把后端业务码翻成**中文可读文案**（绝不把裸码丢给用户）。
 *
 * ⚠️ 同一个业务码在不同接口含义不同，**必须按调用点区分**（2026-10-10 修）：
 * `8102` 在 `POST /api/staff/auth/login` 上是「工号或密码错误」（契约 400 响应示例即此文案），
 * 在 `POST /api/staff/auth/change-password` 上才是「原密码不正确」。
 * 若只做全局映射，登录页会把"工号或密码错误"显示成「原密码不正确」——
 * 用户会以为自己正在改密码，是**错的文案**。
 *
 * 契约复核（改动前已逐条核对 `api_doc.json`）：
 *  - login：`responses.400.content['application/json'].example = { code: 8102, message: '工号或密码错误' }`；
 *  - change-password：描述里 `8102` **只**对应「原密码错」；长度/与原密码相同 ⇒ `1000`；
 *    登录态失效 ⇒ `8104` ⇒ 该接口的 8102 **不承载别的语义**（无歧义）。
 */

/** 初始密码未修改（STAFF_NEED_CHANGE_PWD）：后端对业务请求返回 HTTP 403 + 业务码 8109。 */
export const CODE_NEED_CHANGE_PWD = 8109
/** 原密码错（登录接口复用该码表示"工号或密码错误"，见文件头）。 */
export const CODE_OLD_PASSWORD_WRONG = 8102
/** 参数错误（改密接口的"长度 / 与原密码相同"）。 */
export const CODE_PARAM_INVALID = 1000
/** 登录态失效（token 过期 / 已被踢下线）。 */
export const CODE_SESSION_INVALID = 8104

/**
 * 错误来自哪个调用点 —— 同一业务码的文案依赖它。
 *  - `login`：`POST /api/staff/auth/login` ⇒ 8102 = 工号或密码错误
 *  - `change-password`：`POST /api/staff/auth/change-password` ⇒ 8102 = 原密码不正确
 *  - 省略：按通用口径（只按码映射；放不下的码回退后端 message）
 */
export type ErrorContext = 'login' | 'change-password'

/** 携带后端业务码的异常形状。 */
export interface CodedError extends Error {
  code?: number
  /** 后端在 HTTP 403 等场景下可能把业务码放在 `data.code`。 */
  dataCode?: number
}

/** 从任意异常里取出后端业务码（`code` 优先，回退 `data.code`）。 */
export function errorCode(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined
  const e = err as CodedError
  return typeof e.code === 'number' ? e.code : e.dataCode
}

/** 取后端 message（trim 后非空才算数）。 */
function backendMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message
  if (typeof err === 'object' && err !== null) {
    const raw = (err as { message?: unknown }).message
    if (typeof raw === 'string' && raw.trim()) return raw
  }
  return ''
}

/** 是否登录态失效（8104）。 */
export function isSessionInvalidError(err: unknown): boolean {
  return errorCode(err) === CODE_SESSION_INVALID
}

/**
 * 是否"必须先修改初始密码"（8109）。
 * ⚠️ 该码在 `@/api/request` 里已做全局拦截（跳改密页），页面**不要**再当普通报错弹提示。
 */
export function isNeedChangePwdError(err: unknown): boolean {
  return errorCode(err) === CODE_NEED_CHANGE_PWD
}

/** 是否原密码错误（8102）。⚠️ 仅凭码判断；文案随调用点而变，请用 `authErrorMessage`。 */
export function isOldPasswordWrongError(err: unknown): boolean {
  return errorCode(err) === CODE_OLD_PASSWORD_WRONG
}

/**
 * 按**调用点 + 业务码**给文案；未知码回退后端 message，再回退 `fallback`。
 * 不传 `context` 时按通用口径（8102 ⇒ 原密码不正确），既有调用方行为不变。
 */
export function authErrorMessage(err: unknown, fallback: string, context?: ErrorContext): string {
  const code = errorCode(err)

  if (code === CODE_OLD_PASSWORD_WRONG) {
    // 登录路径：**原样透出后端 message**（契约里就是「工号或密码错误」），不自己编文案；
    // 后端没给 message 时才退回契约里的同一句话。
    if (context === 'login') return backendMessage(err) || '工号或密码错误'
    return '原密码不正确'
  }

  if (code === CODE_SESSION_INVALID) return '登录已失效，请重新登录'
  if (code === CODE_NEED_CHANGE_PWD) return '请先修改初始密码'
  return backendMessage(err) || fallback
}
