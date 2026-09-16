const AUTH_STORAGE_KEY = 'mini_shop_auth'
const WALLET_NOTICE_STORAGE_KEY = 'mini_shop_wallet_notice_seen'
const ADDRESS_CHANGE_DRAFT_PREFIX = 'address-change-draft:'

export interface MiniShopAuthData {
  token: string
  userId: number
  isNewUser: boolean
  expireAt: number
}

/** 保存小程序登录成功后的认证信息。 */
export function saveAuth(data: MiniShopAuthData): void {
  uni.setStorageSync(AUTH_STORAGE_KEY, data)
  uni.setStorageSync('mini_shop_token', data.token)
  clearWalletNoticeSeen()
}

/** 读取本地保存的认证信息。 */
export function getAuth(): MiniShopAuthData | null {
  const data = uni.getStorageSync(AUTH_STORAGE_KEY) as MiniShopAuthData | ''
  return data || null
}

/** 判断当前是否存在可用的本地 Token。 */
export function isLoggedIn(): boolean {
  return Boolean(uni.getStorageSync('mini_shop_token'))
}

/** 统一判断用户是否已经完成订单并成为注册用户，兼容后端数字/字符串序列化。 */
export function isRegisteredUser(identity: unknown): boolean {
  return Number(identity) === 1
}

/** 清理本地登录状态。 */
export function clearAuth(): void {
  clearAddressChangeDrafts()
  uni.removeStorageSync(AUTH_STORAGE_KEY)
  uni.removeStorageSync('mini_shop_token')
  clearWalletNoticeSeen()
}

/** 退出登录时清理当前账号的地址修改草稿，避免共享设备残留收货信息。 */
function clearAddressChangeDrafts(): void {
  const userId = Number(getAuth()?.userId)
  if (!Number.isInteger(userId) || userId <= 0) return
  try {
    const prefix = `${ADDRESS_CHANGE_DRAFT_PREFIX}${userId}:`
    const keys = uni.getStorageInfoSync().keys || []
    keys.filter((key) => key.startsWith(prefix)).forEach((key) => uni.removeStorageSync(key))
  } catch {
    // 本地缓存清理失败不阻断退出登录。
  }
}

/** 判断钱包首次进入提示是否已经看过。 */
export function hasWalletNoticeSeen(): boolean {
  return Boolean(uni.getStorageSync(WALLET_NOTICE_STORAGE_KEY))
}

/** 标记钱包首次进入提示已经确认。 */
export function markWalletNoticeSeen(): void {
  uni.setStorageSync(WALLET_NOTICE_STORAGE_KEY, true)
}

/** 清理钱包首次进入提示状态，供重新登录后重新展示。 */
export function clearWalletNoticeSeen(): void {
  uni.removeStorageSync(WALLET_NOTICE_STORAGE_KEY)
}
