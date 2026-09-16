import { getAuth, isLoggedIn } from '@/utils/auth'
import { bindPromotion } from '@/api/promotion'

const PROMOTION_CONTEXT_KEY = 'mini_shop_promotion_context'
const PROMOTION_BIND_MAX_ATTEMPTS = 3
const PROMOTION_BIND_RETRY_DELAYS = [400, 1000] as const
let promotionBindingPromise: Promise<boolean> | null = null

/** 将推广者 ID 标准化为后端可接受的正整数。 */
function normalizePromoterId(value: unknown): number | null {
  const promoterId = Number(value)
  return Number.isInteger(promoterId) && promoterId > 0 ? promoterId : null
}

/** 从 scene 字符串中解析推广者 ID，兼容编码后的键值对和纯数字 scene。 */
function parseScenePromoterId(scene: unknown): number | null {
  if (typeof scene !== 'string' || !scene.trim()) return null
  let decoded = scene.trim()
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }

  const directId = normalizePromoterId(decoded)
  if (directId) return directId

  const matched = decoded.match(/(?:^|[&;,])(?:promoterId|promoterUserId)\s*[=:]\s*(\d+)/i)
  return normalizePromoterId(matched?.[1])
}

/** 读取微信页面参数并保存推广者身份，支持原生分享参数和扫码 scene。 */
export function capturePromotionContext(options?: Record<string, unknown> | null): number | null {
  const query = options?.query && typeof options.query === 'object'
    ? options.query as Record<string, unknown>
    : null
  const promoterId = normalizePromoterId(options?.promoterId)
    || normalizePromoterId(query?.promoterId)
    || parseScenePromoterId(options?.scene)
    || parseScenePromoterId(query?.scene)
  if (promoterId) uni.setStorageSync(PROMOTION_CONTEXT_KEY, promoterId)
  return promoterId || getStoredPromoterId()
}

/** 生成携带当前登录用户身份的原生分享路径，兼容已有查询参数的页面。 */
export function buildPromotionSharePath(path: string): string {
  const userId = getAuth()?.userId
  if (!Number.isInteger(userId) || Number(userId) <= 0) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}promoterId=${encodeURIComponent(String(userId))}`
}

/** 读取当前待绑定的推广者身份。 */
export function getStoredPromoterId(): number | null {
  return normalizePromoterId(uni.getStorageSync(PROMOTION_CONTEXT_KEY))
}

/** 登录绑定完成后清理推广上下文，避免退出后被错误复用。 */
export function clearPromotionContext(): void {
  uni.removeStorageSync(PROMOTION_CONTEXT_KEY)
}

function waitForPromotionBindRetry(delay: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delay))
}

/** 对已登录用户补绑定推广关系，失败时有限重试并保留待绑定身份。 */
async function bindPromotionWithRetry(promoterId: number): Promise<boolean> {
  for (let attempt = 1; attempt <= PROMOTION_BIND_MAX_ATTEMPTS; attempt += 1) {
    try {
      const bound = await bindPromotion(promoterId)
      if (bound) {
        clearPromotionContext()
        return true
      }
      console.warn(`推广关系绑定未确认，第 ${attempt}/${PROMOTION_BIND_MAX_ATTEMPTS} 次`)
    } catch (error) {
      console.warn(`推广关系绑定请求失败，第 ${attempt}/${PROMOTION_BIND_MAX_ATTEMPTS} 次`, error)
    }

    if (attempt < PROMOTION_BIND_MAX_ATTEMPTS) {
      await waitForPromotionBindRetry(PROMOTION_BIND_RETRY_DELAYS[attempt - 1])
    }
  }

  console.warn('推广关系绑定未完成，已保留待绑定身份，后续将继续重试')
  return false
}

/** 对已登录用户补绑定推广关系，供已登录扫码进入的场景使用。 */
export async function bindStoredPromotionIfLoggedIn(): Promise<boolean> {
  const promoterId = getStoredPromoterId()
  if (!promoterId || !isLoggedIn()) return false

  if (promotionBindingPromise) return promotionBindingPromise

  const pending = bindPromotionWithRetry(promoterId)
  promotionBindingPromise = pending
  pending.then(
    () => { if (promotionBindingPromise === pending) promotionBindingPromise = null },
    () => { if (promotionBindingPromise === pending) promotionBindingPromise = null },
  )
  return pending
}
