/**
 * 「模块 × 角色」矩阵一致性自检（无需测试框架，Node 直接跑）。
 *
 * 用法：在 `LonPin/admin` 目录执行
 *   node scripts/check-permission-matrix.ts        # 或 pnpm run check:perm
 * 依赖 Node ≥ 22.18（原生 TS 类型擦除），无需装 typescript/ts-node。
 *
 * 为什么需要它：菜单显隐与路由守卫都依赖 `src/utils/permission.ts` 的同一份矩阵，
 * 一旦有人手写路由 `roles` 或菜单条件造成漂移，就会出现「菜单能点、点进去被打回工作台」的问题。
 * 本脚本断言矩阵、rolesForPath、菜单用到的 path 三者一致。
 *
 * 背景 bug（2026-09-15 修复）：商户管理员（ADMIN）菜单里有「普通订单 / 自提订单 / 地址变更审核」，
 * 但 router 里这三个路由的 roles 写成了 ['SUPER_ADMIN','CUSTOMER_SERVICE']，点击后被静默打回「商户业务台」。
 */
import { canAccess, rolesForPath, ROUTE_ROLES, homeForRole } from '../src/utils/permission.ts'

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE', 'FINANCE'] as const

/** 菜单里实际用 canVisit() 判断过的 path（漏登记或拼错会在这里暴露）。 */
const MENU_PATHS = [
  '/dashboard', '/merchant', '/merchants', '/admins', '/homepage', '/announcement', '/users', '/products',
  '/categories', '/brands', '/delivery', '/shop-console', '/shop-delivery', '/shops', '/staff',
  '/orders', '/orders/pickup', '/orders/address-audit', '/after-sale', '/invoices', '/profit',
  '/wallets', '/transfers', '/withdraw', '/logs/verify', '/logs/audit', '/settings',
]

let failed = 0
function assert(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  →  ${JSON.stringify(actual)}${ok ? '' : ` (期望 ${JSON.stringify(expected)})`}`)
}

// ① 商户管理员（ADMIN）必须能进订单三个页面 + 商品管理（本次修复点）
for (const path of ['/orders', '/orders/pickup', '/orders/address-audit', '/products', '/after-sale', '/shops', '/staff', '/shop-console', '/shop-delivery', '/logs/audit']) {
  assert(`ADMIN 可访问 ${path}`, canAccess('ADMIN', path), true)
}
// ② ADMIN 不该进的模块（越权风险面）
for (const path of ['/merchants', '/admins', '/users', '/categories', '/brands', '/delivery', '/invoices', '/profit', '/wallets', '/transfers', '/withdraw', '/settings']) {
  assert(`ADMIN 不可访问 ${path}`, canAccess('ADMIN', path), false)
}
// ③ 客服回归
for (const path of ['/users', '/products', '/categories', '/brands', '/delivery', '/orders', '/orders/pickup', '/orders/address-audit', '/after-sale', '/invoices', '/logs/verify']) {
  assert(`CUSTOMER_SERVICE 可访问 ${path}`, canAccess('CUSTOMER_SERVICE', path), true)
}
// ④ 财务回归
for (const path of ['/merchants', '/admins', '/products', '/orders', '/users']) {
  assert(`FINANCE 不可访问 ${path}`, canAccess('FINANCE', path), false)
}
for (const path of ['/invoices', '/profit', '/wallets', '/transfers', '/withdraw', '/logs/audit', '/shops']) {
  assert(`FINANCE 可访问 ${path}`, canAccess('FINANCE', path), true)
}
// ⑤ 菜单用到的每个 path 都要在矩阵里登记（否则菜单会被永久隐藏）
for (const path of MENU_PATHS) {
  assert(`菜单 ${path} 矩阵有登记`, rolesForPath(path).length > 0, true)
}
assert('商户业务台保持全角色可见', rolesForPath('/merchant').length, 4)
// ⑥ 路由守卫用的 rolesForPath 与 canAccess 必须完全等价（菜单与路由同源）
for (const path of Object.keys(ROUTE_ROLES)) {
  const fromRoles = rolesForPath(path).slice().sort()
  const fromCanAccess = ROLES.filter((role) => canAccess(role, path)).sort()
  assert(`rolesForPath ≡ canAccess：${path}`, fromRoles, fromCanAccess)
}
// ⑦ 落地页
assert('ADMIN 落地页', homeForRole('ADMIN'), '/merchant')
assert('SUPER_ADMIN 落地页', homeForRole('SUPER_ADMIN'), '/dashboard')

// 附：各角色菜单预览（人工核对用）
console.log('\n各角色菜单预览：')
for (const role of ROLES) {
  console.log(`  ${role.padEnd(17)} ${MENU_PATHS.filter((path) => canAccess(role, path)).join(' ')}`)
}
console.log(`\nROUTE_ROLES 条目数：${Object.keys(ROUTE_ROLES).length}`)
console.log(failed === 0 ? '\n全部通过 ✅' : `\n失败 ${failed} 项 ❌`)
process.exit(failed === 0 ? 0 : 1)
