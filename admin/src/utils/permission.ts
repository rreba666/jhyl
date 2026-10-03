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
    '/users', '/products', '/categories', '/brands', '/delivery', '/delivery/ghost', '/shops', '/staff', '/shop-console', '/shop-delivery', '/orders', '/orders/pickup',
    '/orders/address-audit', '/after-sale', '/invoices', '/profit', '/wallets', '/transfers',
    '/withdraw', '/merchant-withdraw', '/logs/verify', '/logs/audit', '/logs/ledger', '/logs/apicount', '/admins', '/merchants', '/settings',
    // 短信模板管理 / 语音配置管理：后端 `/api/admin/sms/**`、`/api/admin/voice/**` 都是超管专属（非超管 403）
    '/settings/sms-templates', '/settings/voice',
    // 功能模块开关（2026-10-03 新增）：**仅超管** —— 模块启停是平台级功能开关（影响 C 端所有用户），
    // 且停用带 `pathPatterns` 的模块会**拦截后端接口**（实测 `delivery` 含 `/api/merchant/**`）。
    // ⇒ 商户管理员（ADMIN）不给：菜单与路由同源，他既看不到菜单、也进不来。
    '/settings/modules',
    // 入驻申请审核：与 `/merchants` 同角色（现行矩阵里只有超管）；含身份证等敏感信息，不放开给其它角色
    '/merchant-apply',
    // 微信通知（订阅消息诊断 + 测试发送）：与「短信模板管理 / 语音配置管理」同层的**通知通道页**。
    // 后端 `/api/admin/notify/**` 为**超管 + 运营客服**专属：含跨商户信息面，且「测试发送」会消耗商家授权额度
    // ⇒ 商户管理员（ADMIN）**访问会 403**，矩阵里也不给他（菜单与路由同源，见文件头说明）。
    '/notify',
    // 2026-10-02 物流单结算改造（P5/P7/P8）新增三页：
    // - `/logistics/sign-pending`：⚠️ **仅超管**（P5 §一 明确"仅超管"）—— 人工修正签收时间会决定资金释放锚点
    // - `/logs/channel-reconcile`、`/logs/fund-report`：中控财务向
    //   ⚠️ 2026-10-02 按后端反馈 §五 修正：后端 `SUPER_OR_FINANCE_PREFIXES` ⇒ **超管 + 财务**，
    //   **客服 403**（原先误给客服，见下方 CUSTOMER_SERVICE 处的说明）。
    '/logistics/sign-pending', '/logs/channel-reconcile', '/logs/fund-report',
  ],
  ADMIN: [
    // ⚠️ 不含 '/logs/ledger'：留痕台账是**跨商户全量视图**（含金额/库存），仅平台角色可见
    // ⚠️ 不含 '/logs/apicount'：接口调用计数是**平台级经营数据**（全平台接口结构 + 任意商户 shopId 的调用量 + 调用明细），
    //    且后端该模块**尚未声明权限点**（`auth/me` 的 permissions 里没有对应项）→ 前端先按**仅超管**处理，
    //    待后端明确「仅超管/含客服财务」后再放开（见 docs/logs/2026-09/2026-09-22-接口调用计数apicount评估.md 第五节）。
    // ⚠️ 含 '/delivery/ghost'：商户管理员的待办里有「取消待审核超时」，其 route 深链到
    //    `/delivery/ghost?types=CANCEL_REQUESTED_TOO_LONG`（后端只给"可见性"，ADMIN 走门店过滤）。
    //    若前端路由守卫不给 ADMIN 这个 path，商户点自己的待办会被打回商户业务台。
    //    ⚠️ 待确认：体检接口本身对 ADMIN 的数据范围（全量 or 本门店）需后端明确。
    '/dashboard', '/merchant', '/products', '/shops', '/staff', '/orders', '/orders/pickup', '/delivery/ghost',
    '/orders/address-audit', '/after-sale', '/logs/verify', '/logs/audit', '/shop-console', '/shop-delivery',
  ],
  CUSTOMER_SERVICE: [
    '/dashboard', '/merchant', '/users', '/products', '/categories', '/brands', '/delivery', '/delivery/ghost', '/shops', '/orders', '/orders/pickup',
    '/orders/address-audit', '/after-sale', '/invoices', '/logs/verify', '/logs/ledger',
    // 微信通知（订阅消息诊断）：后端只给**超管 + 运营客服**，客服是这条链路的日常使用方（答疑"店长收不到"）
    '/notify',
    // ⚠️⚠️ 2026-10-02（后端《给前端的反馈-契约缺口补充》§五 Q-1）：
    //    `/api/admin/ledger/**` 在 `RoleGuardInterceptor` 里属于 `SUPER_OR_FINANCE_PREFIXES`
    //    ⇒ 放行条件为 **`SUPER_ADMIN || FINANCE`**，**客服访问会 403**。
    //    ⇒ 因此「渠道账单对账 / 资金报表」**不能给 CUSTOMER_SERVICE**（原按"超管+客服+财务"给是错的）。
    //    ⚠️ 物流签收兜底本就不在本列表（**仅超管**，与 P5 一致）。
  ],
  FINANCE: [
    '/dashboard', '/merchant', '/invoices', '/profit', '/wallets', '/transfers', '/withdraw', '/merchant-withdraw', '/logs/audit', '/logs/ledger', '/shops',
    // 2026-10-02（P7/P8）：渠道对账与资金报表是财务日常对账入口 ⇒ 必须给财务。
    // ⚠️ **不含** `/logistics/sign-pending`（P5 明确仅超管）。
    '/logs/channel-reconcile', '/logs/fund-report',
  ],
}

/**
 * 路由 path 对应的权限中文名（与 router meta.title 保持一致）。
 * ⚠️ 注意区分两个「提现审核」：
 * - `/withdraw` —— C 端**用户**提现审核（商户管理员及以上可见）；
 * - `/merchant-withdraw` —— **商户（品牌主体）**提现审核（后端 `RoleGuardInterceptor` 登记为**仅超管 + FINANCE**，
 *   故矩阵里只给 SUPER_ADMIN 与 FINANCE，商户管理员越权会被后端拦掉）。
 */
const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': '仪表盘',
  '/merchant': '商户业务台',
  '/merchants': '商户管理',
  '/merchant-apply': '入驻申请审核',
  '/homepage': '首屏与品牌',
  '/homepage/bottom-recommendation': '底部推荐',
  '/announcement': '公告栏',
  '/users': '用户管理',
  '/products': '商品管理',
  '/categories': '分类管理',
  '/brands': '商品品牌',
  '/delivery': '同城配送管理',
  // ⚠️ 2026-10-02：菜单名从「幽灵单巡检」改为「**订单异常巡检**」——
  //    「幽灵单」是后端内部叫法，入驻商家看不懂（用户实测反馈）；路径仍为 `/delivery/ghost`（后端 4 个待办类型的 route 深链依赖它）。
  '/delivery/ghost': '订单异常巡检',
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
  '/merchant-withdraw': '商户提现审核',
  '/logs/verify': '核销日志',
  '/logs/audit': '操作追溯',
  '/logs/ledger': '留痕台账',
  '/logs/apicount': '接口调用计数',
  // 2026-10-02 物流单结算改造（P5/P7/P8）
  '/logistics/sign-pending': '物流签收兜底',
  '/logs/channel-reconcile': '渠道账单对账',
  '/logs/fund-report': '资金报表',
  '/settings': '业务设置',
  '/settings/modules': '功能模块开关',
  '/settings/sms-templates': '短信模板管理',
  '/settings/voice': '语音配置管理',
  '/notify': '微信通知',
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
