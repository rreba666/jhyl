import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { getSession } from '@/utils/auth'
import { CHANGE_PASSWORD_PATH, LOGIN_PATH } from '@/utils/navigation'

// 店员核销 H5 路由：默认落地到核销页，扫码链接形如 /pickup?c=自提码。
// 首登强制改密页 `/change-password` 为普通 history 路由（与其它路由同构），
// 直接输入地址也能进 —— 依赖 nginx 的 SPA 回退（`try_files $uri $uri/ /index.html`），不要改 hash 路由。
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/pickup' },
    { path: '/pickup', name: 'Pickup', component: () => import('@/views/pickup.vue') },
    { path: '/change-password', name: 'ChangePassword', component: () => import('@/views/change-password.vue') },
  ],
})

/**
 * 首登强制改密守卫：
 *  - 已登录且 `mustChangePassword === true` ⇒ 除改密页外的一切页面都送回改密页（含深链直达 `/pickup`）；
 *  - ⚠️ `/change-password` 本身**无条件放行**（否则 8109 拦截跳进来又被守卫弹回去 ⇒ 死循环）；
 *  - 未登录 ⇒ 回登录页：改密必须带 token，未登录时改密页无意义。
 * 标记来源有两处：登录响应 `mustChangePassword`（`@/utils/auth` 的 `setSession`）与
 * 请求层拦截 8109 时的 `markMustChangePassword()`。
 */
router.beforeEach((to: RouteLocationNormalized) => {
  const onChangePasswordPage = to.path === CHANGE_PASSWORD_PATH

  if (onChangePasswordPage) {
    // 未登录进改密页：没有 token 无法改密，回登录页（改密页内不再做任何跳转，避免与守卫互相触发）。
    if (!getSession()) return { path: LOGIN_PATH }
    return true
  }

  const session = getSession()
  if (session?.mustChangePassword === true) {
    // 用 replace 语义 + force 标记跳转；已在改密页时 request 层/跳转出口会先行短路，不会重复跳。
    return { path: CHANGE_PASSWORD_PATH, query: { force: '1' }, replace: true }
  }
  return true
})

export default router
