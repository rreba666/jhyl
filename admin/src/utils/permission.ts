import type { AdminRole } from '@/types/auth'

/** 角色中文名称。 */
export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: '平台管理员',
  ADMIN: '商户管理员',
  CUSTOMER_SERVICE: '客服',
  FINANCE: '财务',
}

/** 权限点码（与后端 /me 返回的 permissions 一致，用于商户管理细化）。 */
export const PERMISSION_CODES = {
  MERCHANT_VIEW: 'MERCHANT_VIEW',
  MERCHANT_AUDIT: 'MERCHANT_AUDIT',
  MERCHANT_SHOP_MANAGE: 'MERCHANT_SHOP_MANAGE',
  MERCHANT_STAFF_MANAGE: 'MERCHANT_STAFF_MANAGE',
} as const

export type PermissionCode = (typeof PERMISSION_CODES)[keyof typeof PERMISSION_CODES]

/** 某角色拥有的权限点码（商户管理细化）。 */
export const ROLE_PERMISSIONS: Record<AdminRole, PermissionCode[]> = {
  SUPER_ADMIN: [PERMISSION_CODES.MERCHANT_VIEW, PERMISSION_CODES.MERCHANT_AUDIT, PERMISSION_CODES.MERCHANT_SHOP_MANAGE, PERMISSION_CODES.MERCHANT_STAFF_MANAGE],
  ADMIN: [PERMISSION_CODES.MERCHANT_SHOP_MANAGE, PERMISSION_CODES.MERCHANT_STAFF_MANAGE],
  CUSTOMER_SERVICE: [],
  FINANCE: [],
}

/** 全部后台角色（用于「所有角色可见」的模块）。 */
export const ALL_ADMIN_ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE', 'FINANCE']

/**
 * 各角色可访问的后台路由 path 集合（按「模块 × 角色」矩阵，《今华有礼PC后台-双端开发基准》§三）。
 * **这是菜单显隐与路由守卫的唯一数据源**：router 的 `meta.roles` 由 {@link rolesForPath} 反推生成，
 * 菜单项也用 `canAccess` 判断，避免出现「菜单能点、路由却拦截」的不一致
 * （历史 bug：`ADMIN` 菜单里有普通订单/自提订单/地址变更审核/商品管理，但路由 roles 漏了 `ADMIN` → 点击后被打回商户业务台）。
 */
const ROLE_ROUTES: Record<AdminRole, string[]> = {
  SUPER_ADMIN: [
    '/dashboard', '/merchant', '/homepage', '/homepage/bottom-recommendation', '/announcement',
    '/users', '/products', '/categories', '/brands', '/delivery', '/shops', '/staff', '/shop-console', '/shop-delivery', '/orders', '/orders/pickup',
    '/orders/address-audit', '/after-sale', '/invoices', '/profit', '/wallets', '/transfers',
    '/withdraw', '/logs/verify', '/logs/audit', '/logs/ledger', '/admins', '/merchants', '/settings',
  ],
  ADMIN: [
    // ⚠️ 不含 '/logs/ledger'：留痕台账是**跨商户全量视图**（含金额/库存），仅平台角色可见
    '/dashboard', '/merchant', '/products', '/shops', '/staff', '/orders', '/orders/pickup',
    '/orders/address-audit', '/after-sale', '/logs/verify', '/logs/audit', '/shop-console', '/shop-delivery',
  ],
  CUSTOMER_SERVICE: [
    '/dashboard', '/merchant', '/users', '/products', '/categories', '/brands', '/delivery', '/shops', '/orders', '/orders/pickup',
    '/orders/address-audit', '/after-sale', '/invoices', '/logs/verify', '/logs/ledger',
  ],
  FINANCE: [
    '/dashboard', '/merchant', '/invoices', '/profit', '/wallets', '/transfers', '/withdraw', '/logs/audit', '/logs/ledger', '/shops',
  ],
}

/** 路由 path 对应的权限中文名（与 router meta.title 保持一致）。 */
const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': '仪表盘',
  '/merchant': '商户业务台',
  '/merchants': '商户管理',
  '/homepage': '首屏与品牌',
  '/homepage/bottom-recommendation': '底部推荐',
  '/announcement': '公告栏',
  '/users': '用户管理',
  '/products': '商品管理',
  '/categories': '分类管理',
  '/brands': '商品品牌',
  '/delivery': '同城配送管理',
  '/shop-console': '店铺运营',
  '/shop-delivery': '配送工作台',
  '/shops': '门店管理',
  '/staff': '店员管理',
  '/admins': '管理员管理',
  '/orders': '普通订单',
  '/orders/pickup': '自提订单',
  '/orders/address-audit': '地址变更审核',
  '/after-sale': '售后管理',
  '/invoices': '发票管理',
  '/profit': '推广资金',
  '/wallets': '钱包管理',
  '/transfers': '余额转账记录',
  '/withdraw': '提现审核',
  '/logs/verify': '核销日志',
  '/logs/audit': '操作追溯',
  '/logs/ledger': '留痕台账',
  '/settings': '业务设置',
}

/** 各角色登录后的默认落地页。 */
const ROLE_HOME: Record<AdminRole, string> = {
  SUPER_ADMIN: '/dashboard',
  ADMIN: '/merchant',
  CUSTOMER_SERVICE: '/dashboard',
  FINANCE: '/dashboard',
}

/** 判断指定角色是否拥有某个路由 path 的访问权。 */
export function canAccess(role: AdminRole, path: string): boolean {
  return (ROLE_ROUTES[role] || []).includes(path)
}

/**
 * path → 可访问角色集合（由 {@link ROLE_ROUTES} 反推）。
 * 覆盖所有登记在 {@link ROUTE_LABELS} 里的路由；未登记的 path 返回空数组（= 不做角色限制）。
 */
export const ROUTE_ROLES: Record<string, AdminRole[]> = Object.keys(ROUTE_LABELS).reduce<Record<string, AdminRole[]>>((map, path) => {
  map[path] = ALL_ADMIN_ROLES.filter((role) => (ROLE_ROUTES[role] || []).includes(path))
  return map
}, {})

/**
 * 取某路由 path 的可访问角色白名单，供 `router` 的 `meta.roles` 使用。
 * 未登记的 path 返回空数组 → 路由守卫按「不限制角色」处理（仅要求已登录）。
 */
export function rolesForPath(path: string): AdminRole[] {
  return ROUTE_ROLES[path] || []
}

/** 判断角色是否属于指定角色集合（用于菜单/按钮级过滤）。 */
export function hasRole(role: AdminRole, allowed: AdminRole[]): boolean {
  return allowed.includes(role)
}

/** 获取角色登录后的默认落地页。 */
export function homeForRole(role: AdminRole): string {
  return ROLE_HOME[role] || '/dashboard'
}

/** 判断角色是否拥有某权限点。 */
export function hasPermission(role: AdminRole, code: PermissionCode): boolean {
  return (ROLE_PERMISSIONS[role] || []).includes(code)
}
