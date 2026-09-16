import type { StaffLoginVO } from '@/types/staff'

/** 本地存储 key。 */
const STORAGE_KEY = 'staff_session'

/** 本地登录态结构。 */
export interface StaffSession {
  token: string
  staffName: string
  /** 身份：VERIFIER 核销员 / MANAGER 店长（含核销）；用于顶栏文案。 */
  role?: string
  expireAt: number
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
  const session: StaffSession = { token: vo.token, staffName: vo.staffName, role: vo.role, expireAt: vo.expireAt }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  return session
}

/** 清除本地登录态。 */
export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}
