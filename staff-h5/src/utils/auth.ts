import type { StaffLoginVO } from '@/types/staff'

/** 本地存储 key。 */
const STORAGE_KEY = 'staff_session'
/** 一次性提示的存储 key（改密成功 → 登录页展示「密码已修改，请用新密码登录」）。 */
const NOTICE_KEY = 'staff_notice'

/** 本地登录态结构。 */
export interface StaffSession {
  token: string
  staffName: string
  /** 身份：VERIFIER 核销员 / MANAGER 店长（含核销）；用于顶栏文案。 */
  role?: string
  expireAt: number
  /**
   * 首登强制改密标记（来自登录响应 `mustChangePassword`）。
   * `true` 时除改密页外的路由一律被路由守卫拦回改密页；改密成功后随登录态一起清除。
   */
  mustChangePassword?: boolean
}

/**
 * 记录强制改密标记：只改标记、不动 token。
 * 用于请求层全局拦截到 `8109`（初始密码未修改）时把当前会话标记为"必须先改密"，
 * 从而让路由守卫在后续任何导航上都把用户留在改密页（防跳转抖动/重定向环）。
 */
export function markMustChangePassword(): void {
  const session = getSession()
  if (!session || session.mustChangePassword === true) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, mustChangePassword: true }))
}

/** 写入一次性提示（下一次读取后即失效）。 */
export function setNotice(message: string): void {
  try {
    sessionStorage.setItem(NOTICE_KEY, message)
  } catch {
    /* 隐私模式下 sessionStorage 可能不可写：提示丢失不影响主流程 */
  }
}

/** 读取并清除一次性提示；无提示返回空串。 */
export function consumeNotice(): string {
  try {
    const message = sessionStorage.getItem(NOTICE_KEY) || ''
    sessionStorage.removeItem(NOTICE_KEY)
    return message
  } catch {
    return ''
  }
}

/** 读取本地登录态；不存在或已过期时清除并返回 null。 */
export function getSession(): StaffSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as StaffSession
    if (!session.token || (session.expireAt > 0 && session.expireAt <= Date.now())) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

/** 保存登录态到本地。 */
export function setSession(vo: StaffLoginVO): StaffSession {
  const session: StaffSession = {
    token: vo.token,
    staffName: vo.staffName,
    role: vo.role,
    expireAt: vo.expireAt,
    // 后端未下发时按 false（不缺省成"必须先改密"，避免把正常账号锁在改密页）。
    mustChangePassword: vo.mustChangePassword === true,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  return session
}

/**
 * 清除本地登录态（token 与强制改密标记一并清除）。
 * ⚠️ 改密成功后后端会删 Redis 登录标记（踢下线），旧 token 立即失效 ⇒ 必须调用本函数再跳登录页，
 * 否则用户会停留在"token 已死"的页面上。
 * 一次性提示（NOTICE_KEY）**不在这里清除** —— 它要留给登录页展示一次。
 */
export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}
