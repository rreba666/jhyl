import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AuthMeVO } from '@/types/auth'
import type { AdminLoginVO } from '@/types/auth'

const TOKEN_KEY = 'admin_token'
const ADMIN_INFO_KEY = 'admin_login_info'

/** 管理今华有礼 PC 后台管理员认证状态及本地持久化数据（单商城系统，无品牌切换）。 */
export const useAuthStore = defineStore('auth', () => {
  const token = ref('')
  const adminUserId = ref<string | null>(null)
  const nickname = ref('')
  const role = ref('')
  const expireAt = ref<number | null>(null)
  /** 所属商户 ID（仅 ADMIN 商户管理员有值，平台岗为空）。 */
  const merchantId = ref<number | null>(null)
  /** 所属商户名（品牌名，仅 ADMIN 有值）。 */
  const merchantName = ref('')
  /** 角色权限点码列表（商户管理细化用）。 */
  const permissions = ref<string[]>([])
  const isAuthenticated = computed(() => Boolean(token.value))
  /** 是否平台管理员（SUPER_ADMIN）。 */
  const isPlatformAdmin = computed(() => role.value === 'SUPER_ADMIN')
  /** 是否商户管理员（ADMIN）。 */
  const isMerchantAdmin = computed(() => role.value === 'ADMIN')

  /** 将登录结果写入响应式状态和本地存储。 */
  function setLoginData(loginData: AdminLoginVO): void {
    token.value = loginData.token
    adminUserId.value = String(loginData.adminId)
    nickname.value = loginData.username
    role.value = loginData.role
    merchantId.value = loginData.merchantId ?? null
    merchantName.value = loginData.merchantName || ''
    permissions.value = loginData.permissions || []
    localStorage.setItem(TOKEN_KEY, loginData.token)
    localStorage.setItem(ADMIN_INFO_KEY, JSON.stringify(loginData))
  }

  /** 用后端本人信息更新身份展示字段，不覆盖 Token 和过期时间。 */
  /** 用后端 auth/me 身份信息更新展示字段（AuthMeVO，字段用 adminId）。 */
  function applyCurrentAdmin(admin: AuthMeVO): void {
    if (!admin.adminId) throw new Error('当前管理员信息无效')
    adminUserId.value = String(admin.adminId)
    nickname.value = admin.nickname
    role.value = admin.role
    merchantId.value = admin.merchantId ?? null
    merchantName.value = admin.merchantName || ''
    permissions.value = admin.permissions || []
    const savedInfo = { token: token.value, adminUserId: adminUserId.value, nickname: nickname.value, role: role.value, merchantId: merchantId.value, merchantName: merchantName.value, permissions: permissions.value, expireAt: expireAt.value }
    localStorage.setItem(ADMIN_INFO_KEY, JSON.stringify(savedInfo))
  }

  /** 刷新当前管理员信息，由调用方（如 AdminLayout onMounted）调 /me 后 applyCurrentAdmin。 */
  async function refreshCurrentAdmin(): Promise<void> {
    return
  }

  /** 从本地存储恢复上一次登录留下的认证数据。 */
  function restore(): void {
    const savedToken = localStorage.getItem(TOKEN_KEY)
    const savedInfo = localStorage.getItem(ADMIN_INFO_KEY)
    if (!savedToken || !savedInfo) return

    try {
      const loginData = JSON.parse(savedInfo) as AdminLoginVO
      if (loginData.token !== savedToken) return
      setLoginData(loginData)
    } catch {
      logout()
    }
  }

  /** 清理本地认证数据并重置当前登录状态。 */
  function logout(): void {
    token.value = ''
    adminUserId.value = null
    nickname.value = ''
    role.value = ''
    expireAt.value = null
    merchantId.value = null
    merchantName.value = ''
    permissions.value = []
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ADMIN_INFO_KEY)
  }

  return {
    token,
    adminUserId,
    nickname,
    role,
    expireAt,
    merchantId,
    merchantName,
    permissions,
    isAuthenticated,
    isPlatformAdmin,
    isMerchantAdmin,
    setLoginData,
    applyCurrentAdmin,
    refreshCurrentAdmin,
    restore,
    logout,
  }
})
