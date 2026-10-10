import { clearSession, getSession, markMustChangePassword } from '@/utils/auth'
import { CODE_NEED_CHANGE_PWD, CODE_SESSION_INVALID } from '@/utils/error'
import { goToChangePassword, goToLogin, isOnChangePasswordPage } from '@/utils/navigation'
import type { StaffResponse } from '@/types/staff'

/** 后端地址，去掉尾部斜杠。 */
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
/**
 * 品牌标识（X-App-Key）：读 `VITE_APP_KEY`，小写 trim。
 * 未配置时默认 **`longping`（今华有礼自己的品牌）** —— 原默认值是 `jinhua`（今华有肽），
 * 今天华有礼的核销页若漏配环境变量会被后端路由到**另一个品牌的库**，属高危默认值（2026-09-22 修改）。
 */
const APP_KEY = String(import.meta.env.VITE_APP_KEY || 'longping').trim().toLowerCase()

/**
 * 首登强制改密期间后端**唯一放行**的两个接口（`docs/26/10.10/前端对接文档-2026-10-10-全集.md` §一-③）：
 * `POST /api/staff/auth/change-password` 与 `GET /api/staff/me`。
 * 这两个路径即使返回 8109 也不做跳转，是防重定向环的最后一道闸。
 */
const CHANGE_PWD_ALLOWED_PATHS: readonly string[] = ['/api/staff/auth/change-password', '/api/staff/me']

/** 携带后端错误码的异常对象。 */
export interface RequestError extends Error {
  code?: number
  /** 后端把业务码放在响应体 `data.code` 时的取值（HTTP 403 场景）。 */
  dataCode?: number
}

/** 重定向进行中标记：同一时刻只发起一次跳转，避免并发 8109 触发多次 `router.replace`。 */
let redirecting = false

/**
 * 全局拦截「必须先修改初始密码」（业务码 8109，HTTP 403）。
 * 后端在未改密时对**除改密与 `/api/staff/me` 之外**的一切请求回 8109 ⇒ 这里统一跳改密页，
 * 不要当普通错误弹提示。
 *
 * 防重定向环（三重）：
 *  1. 放行清单：改密接口自身 + `/api/staff/me` **永不触发**跳转；
 *  2. 已在改密页（`/change-password`，忽略 `?force=1`）时**不再跳**；
 *  3. `redirecting` 锁：跳转期间重复到达的 8109 被丢弃，`finally` 里解锁。
 * （另有 `markMustChangePassword()` 把标记落到会话，路由守卫据此直接在导航层拦住用户，
 *   所以即使某个页面/接口漏判，也不会出现"改密页 ↔ 业务页"来回跳。）
 */
function handleNeedChangePassword(path: string): void {
  if (CHANGE_PWD_ALLOWED_PATHS.includes(path)) return
  if (isOnChangePasswordPage()) return
  if (redirecting) return
  markMustChangePassword()
  redirecting = true
  void goToChangePassword().finally(() => {
    redirecting = false
  })
}

/**
 * 统一请求封装：拼接 baseURL、自动注入 Bearer Token 与品牌标识、解析统一响应。
 * code !== 0（或 success === false、HTTP 非 2xx）时抛出带 message 的错误。
 */
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = getSession()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-App-Key': APP_KEY,
    ...(options.headers as Record<string, string> | undefined),
  }
  if (session?.token) headers.Authorization = `Bearer ${session.token}`

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers })

  let body: StaffResponse<T> | null = null
  try {
    body = (await response.json()) as StaffResponse<T>
  } catch {
    /* 响应非 JSON 时按 HTTP 状态处理 */
  }

  const ok = response.ok && body != null && (body.code === 0 || body.code === 200) && body.success !== false
  if (!ok) {
    // 业务码优先取响应体 `code`，其次取 `data.code`（HTTP 403 包裹业务码时），最后退回 HTTP 状态。
    const dataCode = (body?.data as { code?: number } | null | undefined)?.code
    const code = body?.code ?? dataCode ?? response.status

    if (code === CODE_NEED_CHANGE_PWD) {
      handleNeedChangePassword(path)
    } else if (code === CODE_SESSION_INVALID) {
      // 登录态失效：清掉本地登录态并回登录页，**任何接口**都一样 —— 包括改密接口自身。
      // ⚠️ 不要因为"当前已在改密页"就不跳：那时本地还留着**已失效的 token**，用户会卡在改密页
      // 反复提交且页面也不提示（改密页对 8104 不做就地提示）⇒ 死路。
      clearSession()
      void goToLogin()
    }

    const error = new Error(body?.message || `请求失败（${response.status}）`) as RequestError
    error.code = code
    error.dataCode = dataCode
    throw error
  }
  // 走到这里 body 必非空（ok 已校验），显式断言以满足严格模式收窄。
  return (body as StaffResponse<T>).data as T
}

/** 发送 JSON POST 请求。 */
export function post<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: data == null ? undefined : JSON.stringify(data) })
}
