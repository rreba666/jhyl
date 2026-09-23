import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { homeForRole, rolesForPath } from '@/utils/permission'
import type { AdminRole } from '@/types/auth'

/**
 * 路由表。
 * ⚠️ 每个业务路由的 `meta.roles` **不要在本地手写**，统一用 `rolesForPath(path)` 从
 * `utils/permission.ts` 的「模块 × 角色」矩阵反推 —— 该矩阵同时驱动左侧菜单显隐，
 * 二者同源才能避免「菜单能点、路由却拦回工作台」的问题
 * （历史 bug：商户管理员菜单里有普通订单/自提订单/地址变更审核/商品管理，但 roles 漏了 ADMIN）。
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/login/index.vue'),
      meta: { title: '管理员登录', public: true },
    },
    {
      path: '/',
      redirect: '/dashboard',
    },
    {
      path: '/',
      component: () => import('@/layouts/AdminLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: () => import('@/views/dashboard/index.vue'),
          meta: { title: '仪表盘', permission: ['dashboard:read'], roles: rolesForPath('/dashboard'), requiresAuth: true },
        },
        {
          path: 'merchant',
          name: 'MerchantHome',
          component: () => import('@/views/merchant/index.vue'),
          meta: { title: '商户业务台', permission: ['dashboard:read'], roles: rolesForPath('/merchant'), requiresAuth: true },
        },
        {
          path: 'merchants',
          name: 'Merchants',
          component: () => import('@/views/merchants/index.vue'),
          meta: { title: '商户管理', permission: ['merchant:read'], roles: rolesForPath('/merchants'), requiresAuth: true },
        },
        {
          path: 'admins',
          name: 'Admins',
          component: () => import('@/views/admins/index.vue'),
          meta: { title: '管理员管理', permission: ['admin:read'], roles: rolesForPath('/admins'), requiresAuth: true },
        },
        {
          path: 'homepage/v2-config',
          name: 'HomepageV2Config',
          component: () => import('@/views/homepage/v2-config.vue'),
          meta: { title: '金刚区与落地页配置', permission: ['homepage:read'], roles: rolesForPath('/homepage'), requiresAuth: true },
        },
        { path: 'homepage/preview', redirect: '/homepage/v2-config' },
        {
          path: 'users',
          name: 'Users',
          component: () => import('@/views/users/index.vue'),
          meta: { title: '用户管理', permission: ['user:read'], roles: rolesForPath('/users'), requiresAuth: true },
        },
        {
          path: 'products',
          name: 'Products',
          component: () => import('@/views/products/index.vue'),
          meta: { title: '商品管理', permission: ['product:read'], roles: rolesForPath('/products'), requiresAuth: true },
        },
        {
          path: 'categories',
          name: 'Categories',
          component: () => import('@/views/categories/index.vue'),
          meta: { title: '分类管理', permission: ['category:read'], roles: rolesForPath('/categories'), requiresAuth: true },
        },
        {
          path: 'brands',
          name: 'GoodsBrands',
          component: () => import('@/views/brands/index.vue'),
          meta: { title: '商品品牌', permission: ['product:read'], roles: rolesForPath('/brands'), requiresAuth: true },
        },
        {
          path: 'delivery',
          name: 'DeliveryManage',
          component: () => import('@/views/delivery/index.vue'),
          meta: { title: '同城配送管理', permission: ['delivery:read'], roles: rolesForPath('/delivery'), requiresAuth: true },
        },
        {
          // 幽灵单巡检（体检页）。⚠️ 路径必须是 `/delivery/ghost`：后端 4 个待办类型的 route
          // 都深链到这里（`?types=<CHECK_KEY>` 只跑指定项），此前该 route 不存在 ⇒ 铃铛点了没反应。
          path: 'delivery/ghost',
          name: 'DeliveryGhostInspect',
          component: () => import('@/views/delivery/ghost/index.vue'),
          meta: { title: '幽灵单巡检', permission: ['delivery:read'], roles: rolesForPath('/delivery/ghost'), requiresAuth: true },
        },
        {
          path: 'shop-console',
          name: 'ShopConsole',
          component: () => import('@/views/shop-console/index.vue'),
          meta: { title: '店铺运营', permission: ['shop:write'], roles: rolesForPath('/shop-console'), requiresAuth: true },
        },
        {
          path: 'shop-delivery',
          name: 'ShopDelivery',
          component: () => import('@/views/shop-delivery/index.vue'),
          meta: { title: '配送工作台', permission: ['delivery:read'], roles: rolesForPath('/shop-delivery'), requiresAuth: true },
        },
        {
          path: 'shops',
          name: 'Shops',
          component: () => import('@/views/shops/index.vue'),
          meta: { title: '门店管理', permission: ['shop:read'], roles: rolesForPath('/shops'), requiresAuth: true },
        },
        {
          path: 'staff',
          name: 'Staff',
          component: () => import('@/views/staff/index.vue'),
          meta: { title: '店员管理', permission: ['staff:read'], roles: rolesForPath('/staff'), requiresAuth: true },
        },
        {
          path: 'orders',
          name: 'Orders',
          component: () => import('@/views/orders/index.vue'),
          meta: { title: '普通订单', permission: ['order:read'], roles: rolesForPath('/orders'), requiresAuth: true },
        },
        {
          path: 'orders/pickup',
          name: 'PickupOrders',
          component: () => import('@/views/orders/index.vue'),
          meta: { title: '自提订单', permission: ['order:read'], roles: rolesForPath('/orders/pickup'), requiresAuth: true },
        },
        {
          path: 'orders/address-audit',
          name: 'OrderAddressAudit',
          component: () => import('@/views/orders/address-audit.vue'),
          meta: { title: '地址变更审核', permission: ['order:read'], roles: rolesForPath('/orders/address-audit'), requiresAuth: true },
        },
        {
          path: 'after-sale',
          name: 'AfterSale',
          component: () => import('@/views/after-sale/index.vue'),
          meta: { title: '售后管理', permission: ['order:read'], roles: rolesForPath('/after-sale'), requiresAuth: true },
        },
        {
          path: 'announcement',
          name: 'Announcement',
          component: () => import('@/views/announcement/index.vue'),
          meta: { title: '公告栏', roles: rolesForPath('/announcement'), requiresAuth: true },
        },
        {
          path: 'invoices',
          name: 'Invoices',
          component: () => import('@/views/invoices/index.vue'),
          meta: { title: '发票管理', permission: ['invoice:read'], roles: rolesForPath('/invoices'), requiresAuth: true },
        },
        {
          path: 'profit',
          name: 'Profit',
          component: () => import('@/views/profit/index.vue'),
          meta: { title: '推广资金', permission: ['profit:read'], roles: rolesForPath('/profit'), requiresAuth: true },
        },
        {
          path: 'wallets',
          name: 'Wallets',
          component: () => import('@/views/wallet/index.vue'),
          meta: { title: '钱包管理', permission: ['wallet:read'], roles: rolesForPath('/wallets'), requiresAuth: true },
        },
        {
          path: 'transfers',
          name: 'Transfers',
          component: () => import('@/views/transfers/index.vue'),
          meta: { title: '余额转账记录', permission: ['transfer:read'], roles: rolesForPath('/transfers'), requiresAuth: true },
        },
        {
          path: 'withdraw',
          name: 'Withdraw',
          component: () => import('@/views/withdraw/index.vue'),
          meta: { title: '提现审核', permission: ['withdraw:read'], roles: rolesForPath('/withdraw'), requiresAuth: true },
        },
        {
          // 商户提现审核（平台财务端）：审的是**商户（品牌主体）**按发票发起的提现，与上面 C 端「提现审核」是两套业务。
          // 后端 `/api/admin/merchant-withdraw/**` 已登记为**仅超管 + 财务**，矩阵里也只给这两个角色。
          path: 'merchant-withdraw',
          name: 'MerchantWithdraw',
          component: () => import('@/views/merchant-withdraw/index.vue'),
          meta: { title: '商户提现审核', permission: ['withdraw:read'], roles: rolesForPath('/merchant-withdraw'), requiresAuth: true },
        },
        {
          path: 'logs/verify',
          name: 'VerifyLogs',
          component: () => import('@/views/logs/verify.vue'),
          meta: { title: '核销日志', permission: ['verify:read'], roles: rolesForPath('/logs/verify'), requiresAuth: true },
        },
        {
          path: 'logs/audit',
          name: 'AuditLogs',
          component: () => import('@/views/logs/audit.vue'),
          meta: { title: '操作追溯', permission: ['audit:read'], roles: rolesForPath('/logs/audit'), requiresAuth: true },
        },
        {
          // 留痕台账：跨商户全量视图（含金额/库存），仅平台角色（超管/客服/财务），商户管理员不可见
          path: 'logs/ledger',
          name: 'AuditLedger',
          component: () => import('@/views/logs/ledger.vue'),
          meta: { title: '留痕台账', permission: ['audit:read'], roles: rolesForPath('/logs/ledger'), requiresAuth: true },
        },
        {
          // 接口调用计数（后端积木 apicount）：平台级数据（全平台接口结构 + 任意商户 shopId + 调用明细）
          // → 前端先按**仅超管**处理；后端该模块尚未声明权限点（auth/me 里没有对应项），口径确认后再调整
          path: 'logs/apicount',
          name: 'ApiCallCount',
          component: () => import('@/views/logs/apicount.vue'),
          meta: { title: '接口调用计数', permission: ['audit:read'], roles: rolesForPath('/logs/apicount'), requiresAuth: true },
        },
        {
          path: 'settings',
          name: 'Settings',
          component: () => import('@/views/settings/index.vue'),
          meta: { title: '业务设置', roles: rolesForPath('/settings'), requiresAuth: true },
        },
      ],
    },
  ],
})

/** 仅允许跳转到当前站点内的路径，避免 redirect 参数造成外部跳转。 */
function getSafeRedirect(path: unknown): string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : '/dashboard'
}

/** 当前登录角色（未登录/角色缺失按空串处理，交由 homeForRole 兜底）。 */
function currentRole(): AdminRole {
  return useAuthStore().role as AdminRole
}

/** 设置页面标题、拦截未登录访问，并按角色校验路由访问权限。 */
router.beforeEach((to) => {
  document.title = `${String(to.meta.title || '电商后台')} - E-Admin Pro`
  const authStore = useAuthStore()
  authStore.restore()
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)

  if (to.name === 'Login' && authStore.isAuthenticated) {
    return getSafeRedirect(to.query.redirect || homeForRole(currentRole()))
  }
  if (requiresAuth && !authStore.isAuthenticated) {
    return { name: 'Login', query: { redirect: to.fullPath } }
  }
  if (requiresAuth && authStore.isAuthenticated) {
    const roles = to.matched.flatMap((record) => (record.meta.roles as AdminRole[] | undefined) || [])
    if (roles.length && !roles.includes(currentRole())) {
      // 明确提示后再回落地页：避免出现「点了没反应」的静默跳转（菜单与路由不一致时一眼可见）
      ElMessage.warning('当前角色无权访问该页面，已返回工作台')
      return { path: homeForRole(currentRole()) }
    }
  }
  return true
})

export default router
