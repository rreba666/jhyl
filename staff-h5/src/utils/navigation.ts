import type { Router } from 'vue-router'

/**
 * 全局跳转出口（staff-h5 核销端）
 * ------------------------------------------------------------
 * 为什么单独放一个模块：
 * `@/api/request` 需要在响应层拦截 `8109`（初始密码未修改）后跳改密页，
 * 但 `router/index.ts` 的路由组件又依赖 `@/api/request` ⇒ 若在 request 里直接 import router，
 * 就形成「request → router → views → request」的循环依赖（初始化顺序不确定、难以推理）。
 * 这里用**动态 import** 拿 router，方向始终是 request → navigation ⇢ router（单向），无环。
 *
 * ⚠️ "当前在哪一页"**只**读 router 自己的 `currentRoute`，不另外维护一份缓存副本：
 * 缓存副本要靠 `afterEach` 更新，而**重复导航时 `afterEach` 不会触发**
 * （vue-router 对同一 location 直接短路），缓存会变陈旧 ⇒ 误判"已经在改密页"而**静默跳过跳转**。
 * 这种"看似等价、实则可能不同步"的第二份状态是 bug 温床 ⇒ 一律以 router 为准。
 */

/** 改密页路径。 */
export const CHANGE_PASSWORD_PATH = '/change-password'
/** 登录页路径（核销页内含登录表单）。 */
export const LOGIN_PATH = '/pickup'

/** 已取到的 router 实例（动态 import 只付出一次代价）。 */
let cachedRouter: Router | null = null

async function loadRouter(): Promise<Router> {
  if (!cachedRouter) {
    // ⚠️ 这里**必须**保留裸 `'@/router'`，**不能**在该 import 上加 vite 的 ignore 注记：
    // 加了会连别名替换一起跳过，产物残留字面量 `import("@/router")` ⇒ 浏览器解析不了该说明符
    // ⇒ 动态 import 抛错、被下面 navigateTo 的 catch 吞掉 ⇒ 8109 跳转**静默失效**（2026-10-10 实际踩到）。
    // 代价是构建时多一条 INEFFECTIVE_DYNAMIC_IMPORT 提示（router 已由 main.ts 静态引入，
    // 本就不会额外分包）——那只是提示、不是错误，可接受。
    const mod = await import('@/router')
    cachedRouter = mod.default
  }
  return cachedRouter
}

/** 读 router 的当前路径；router 尚未就绪（首次导航未落定）时返回空串。 */
function currentPath(): string {
  return cachedRouter?.currentRoute.value.path ?? ''
}

/** 当前是否已在改密页（`?force=1` 之类 query 忽略，只比路径）。 */
export function isOnChangePasswordPage(): boolean {
  return currentPath() === CHANGE_PASSWORD_PATH
}

/**
 * 跳登录页（登录态失效 / 改密成功统一走这里）。
 * ⚠️ 用**整页跳转**（`location.replace`）而不是 router.replace：此时登录态已被清空，
 * 而路由守卫会"未登录 → 回 /pickup"，两者同目标时 router 会把它当**重复导航直接短路**
 * （实测：原地不动）⇒ 不跳反而卡死。整页跳转顺带把内存里的旧状态一起清掉，是登出语义最稳的做法。
 * 用 replace 而非 href，避免把失效页面留在浏览历史里（返回键不会退回死页面）。
 */
export function goToLogin(): void {
  window.location.replace(LOGIN_PATH)
}

/**
 * 跳改密页（带 `force=1` 标记，供改密页判断是否为"被强制带过来"）。
 * ⚠️ 已在改密页时**直接返回** —— 这是防重定向环的一环（与 request 层的 `redirecting` 锁互补）。
 */
export async function goToChangePassword(): Promise<void> {
  if (isOnChangePasswordPage()) return
  await navigateTo(`${CHANGE_PASSWORD_PATH}?force=1`)
}

/**
 * 安全跳转：跳转本身失败（未注册该路由 / 被 guard 取消 / 重复导航被拒）不得冒泡成调用方的业务失败。
 * ⚠️ 不比对"目标是否等于缓存里的当前位置"——是否重复交给 router 判定（它短路且不报错）；
 * 我们多调一次 replace 的代价可忽略，换掉的是"陈旧缓存导致静默不跳"的风险。
 */
async function navigateTo(fullPath: string): Promise<void> {
  try {
    const router = await loadRouter()
    await router.replace(fullPath)
  } catch {
    /* 导航失败不影响调用方主流程 */
  }
}
