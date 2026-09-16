<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Bell,
  Box,
  Collection,
  Document,
  Fold,
  House,
  List,
  Moon,
  Shop,
  WalletFilled,
  Sunny,
  Tickets,
  User,
  UserFilled,
  Expand,
  Search,
  Setting,
  Star,
  Grid,
  PriceTag,
  Van,
  Bicycle,
} from '@element-plus/icons-vue'

import { useAuthStore } from '@/stores/auth'
import { useSettingStore } from '@/stores/setting'
import { useThemeStore } from '@/stores/theme'
import { useTodoStore } from '@/stores/todo'
import { getAuthMe } from '@/api/auth'
import { ROLE_LABELS, canAccess } from '@/utils/permission'
import { getTodoSummary, type TodoItem } from '@/api/todo'
import type { AdminRole } from '@/types/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const settingStore = useSettingStore()
const themeStore = useThemeStore()
const todoStore = useTodoStore()
const collapsed = ref(false)
const keyword = ref('')

const pageTitle = computed(() => String(route.meta.title || '工作台'))
const adminName = computed(() => authStore.nickname || '管理员')
const adminRole = computed(() => ROLE_LABELS[authStore.role as keyof typeof ROLE_LABELS] || authStore.role || '管理员')
const adminAvatar = computed(() => adminName.value.slice(0, 1).toUpperCase())
/** 平台管理员商标识（顶部展示 ADMIN 所属商户）。 */
const isMerchantAdmin = computed(() => authStore.isMerchantAdmin)

/** 当前登录角色（未取到按空串，矩阵查不到即不显示对应菜单）。 */
const currentRole = computed(() => (authStore.role || '') as AdminRole)

/**
 * 菜单显隐：**统一走「模块 × 角色」矩阵**（`utils/permission.ts` 的 `canAccess`），
 * 与路由守卫 `meta.roles` 同源 —— 菜单里出现的一定进得去，进不去的一定不显示。
 * 历史 bug：商户管理员（ADMIN）菜单里有普通订单/自提订单/地址变更审核，但路由 roles 漏了 ADMIN，
 * 点击后被打回「商户业务台」且没有任何提示。
 */
function canVisit(path: string): boolean {
  return canAccess(currentRole.value, path)
}
/** 主页管理子菜单：任一子项可访问即显示。 */
const showHomepageMenu = computed(() => canVisit('/homepage') || canVisit('/announcement'))
/** 订单管理子菜单：任一子项可访问即显示。 */
const showOrdersMenu = computed(() => canVisit('/orders') || canVisit('/orders/pickup') || canVisit('/orders/address-audit') || canVisit('/after-sale'))
/** 日志管理子菜单：任一子项可访问即显示。 */
const showLogsMenu = computed(() => canVisit('/logs/verify') || canVisit('/logs/audit'))

/** 刷新当前管理员身份（从 /me 拉取角色/所属商户/权限点）。 */
async function refreshCurrentAdmin(): Promise<void> {
  try {
    const admin = await getAuthMe()
    authStore.applyCurrentAdmin(admin)
  } catch {
    // 网络或后端暂时不可用时，不影响已有登录态。
  }
}

/** 预载商品资金比例，确保商品编辑页使用最新系统默认值。 */
async function refreshFundRates(): Promise<void> {
  try {
    await settingStore.loadProfitRates()
  } catch {
    // 设置读取失败时保留前端默认兜底值。
  }
}

/** 清理本地认证状态并返回登录页面。 */
function logout(): void {
  authStore.logout()
  ElMessage.success('已退出登录')
  router.replace('/login')
}

// ===== 右上角待办铃铛（GET /api/admin/todo/summary，中控 + 商户后台共用） =====
/** 待办总数（徽标；0 不显示、>99 显示 99+）。 */
const todoTotal = ref(0)
/** 待办明细（只渲染 count > 0 的项）。 */
const todoItems = ref<TodoItem[]>([])
const todoLoading = ref(false)
let todoTimer: ReturnType<typeof setInterval> | null = null

/** 拉取待办汇总；失败静默兜底（不显示徽标、下拉「暂无待办」）。 */
async function refreshTodo(): Promise<void> {
  todoLoading.value = true
  try {
    const summary = await getTodoSummary()
    todoTotal.value = Number(summary.total) || 0
    todoItems.value = summary.items.filter((item) => Number(item.count) > 0)
  } catch {
    todoTotal.value = 0
    todoItems.value = []
  } finally {
    todoLoading.value = false
  }
}

/**
 * 点击待办项：按后端给的 route 跳转（query 由后端保证与列表页筛选一致）。
 *
 * 两个坑：
 * 1. **同一模块内**点不同待办（普通订单 → 待发货 / 自提待核销 / 微信上报失败）路径相同、只有 query 变
 *    → 目标页必须监听 `route.query` 才会响应（各页面已改）；
 * 2. **重复点同一个待办**（或手动改了筛选后想回到该待办视图）→ 目标路由与当前路由完全一致，
 *    vue-router 不会重新导航 → 这里额外广播一次点击信号，目标页监听 `clickTick` 重新套用筛选。
 */
function openTodo(item: TodoItem): void {
  if (!item.route) return
  const queryString = new URLSearchParams(route.query as Record<string, string>).toString()
  const current = `${route.path}${queryString ? `?${queryString}` : ''}`
  todoStore.notifyClick()
  if (item.route === route.fullPath || item.route === current) return
  router.push(item.route)
}

/** 待办等级 → 标签颜色。 */
function todoTagType(level?: string): 'primary' | 'warning' | 'danger' {
  if (level === 'DANGER') return 'danger'
  if (level === 'WARN') return 'warning'
  return 'primary'
}

/** 徽标文案：>99 显示 99+。 */
const todoBadge = computed(() => (todoTotal.value > 99 ? '99+' : String(todoTotal.value)))

onMounted(() => {
  void refreshCurrentAdmin()
  void refreshFundRates()
  // 待办铃铛：进入后台立即拉一次，之后 30s 轮询（后端建议 30~60s）
  void refreshTodo()
  todoTimer = setInterval(() => { void refreshTodo() }, 30000)
})

onUnmounted(() => {
  if (todoTimer) clearInterval(todoTimer)
  todoTimer = null
})

</script>

<template>
  <el-container class="admin-shell">
    <el-aside :width="collapsed ? '72px' : '240px'" class="admin-aside">
      <div class="brand" :class="{ 'brand--collapsed': collapsed }">
        <div class="brand-mark">E</div>
        <span v-if="!collapsed">E-Admin Pro</span>
      </div>
      <el-menu :default-active="route.path" :default-openeds="['/homepage', '/orders']" :collapse="collapsed" router class="admin-menu">
        <!-- 商户业务台：所有角色 -->
        <el-menu-item index="/merchant">
          <el-icon><DataBoard /></el-icon>
          <template #title>商户业务台</template>
        </el-menu-item>
        <!-- 商户管理：仅平台管理员 -->
        <el-menu-item v-if="canVisit('/merchants')" index="/merchants">
          <el-icon><Shop /></el-icon>
          <template #title>商户管理</template>
        </el-menu-item>
        <!-- 管理员管理：仅平台管理员 -->
        <el-menu-item v-if="canVisit('/admins')" index="/admins">
          <el-icon><User /></el-icon>
          <template #title>管理员管理</template>
        </el-menu-item>
        <!-- 主页管理（首页/公告）：仅平台管理员 -->
        <el-sub-menu v-if="showHomepageMenu" index="/homepage">
          <template #title><el-icon><House /></el-icon><span>主页管理</span></template>
          <el-menu-item v-if="canVisit('/homepage')" index="/homepage/v2-config"><el-icon><Grid /></el-icon><template #title>金刚区与落地页</template></el-menu-item>
          <el-menu-item v-if="canVisit('/announcement')" index="/announcement"><el-icon><Bell /></el-icon><template #title>公告栏</template></el-menu-item>
        </el-sub-menu>
        <!-- 用户管理：超管 + 客服 -->
        <el-menu-item v-if="canVisit('/users')" index="/users">
          <el-icon><User /></el-icon>
          <template #title>用户管理</template>
        </el-menu-item>
        <!-- 商品管理：超管 + 客服 + 商户管理员（ADMIN 数据范围=本商户） -->
        <el-menu-item v-if="canVisit('/products')" index="/products">
          <el-icon><Box /></el-icon>
          <template #title>商品管理</template>
        </el-menu-item>
        <!-- 分类管理：超管 + 客服 -->
        <el-menu-item v-if="canVisit('/categories')" index="/categories">
          <el-icon><Collection /></el-icon>
          <template #title>分类管理</template>
        </el-menu-item>
        <!-- 商品品牌：平台级内容，超管 + 客服 -->
        <el-menu-item v-if="canVisit('/brands')" index="/brands">
          <el-icon><PriceTag /></el-icon>
          <template #title>商品品牌</template>
        </el-menu-item>
        <!-- 同城配送管理：运营/客服（总开关/报表/订单/任务干预/骑手业绩/退款/配送费） -->
        <el-menu-item v-if="canVisit('/delivery')" index="/delivery">
          <el-icon><Van /></el-icon>
          <template #title>同城配送</template>
        </el-menu-item>
        <!-- 店铺运营：商户管理员 + 超管（营业状态/时间、门店价/门店库存/本店上下架） -->
        <el-menu-item v-if="canVisit('/shop-console')" index="/shop-console">
          <el-icon><Shop /></el-icon>
          <template #title>店铺运营</template>
        </el-menu-item>
        <!-- 配送工作台：商户管理员 + 超管（本店配送任务/同城订单/配送员/规则） -->
        <el-menu-item v-if="canVisit('/shop-delivery')" index="/shop-delivery">
          <el-icon><Bicycle /></el-icon>
          <template #title>配送工作台</template>
        </el-menu-item>
        <!-- 门店管理：全部角色（读） -->
        <el-menu-item v-if="canVisit('/shops')" index="/shops">
          <el-icon><Shop /></el-icon>
          <template #title>门店管理</template>
        </el-menu-item>
        <!-- 店员管理：超管 + 商户管理员 -->
        <el-menu-item v-if="canVisit('/staff')" index="/staff">
          <el-icon><UserFilled /></el-icon>
          <template #title>店员管理</template>
        </el-menu-item>
        <!-- 订单管理：超管 + 客服 + 商户管理员（ADMIN 数据范围=本商户） -->
        <el-sub-menu v-if="showOrdersMenu" index="/orders">
          <template #title><el-icon><List /></el-icon><span>订单管理</span></template>
          <el-menu-item v-if="canVisit('/orders')" index="/orders"><template #title>普通订单</template></el-menu-item>
          <el-menu-item v-if="canVisit('/orders/pickup')" index="/orders/pickup"><template #title>自提订单</template></el-menu-item>
          <el-menu-item v-if="canVisit('/orders/address-audit')" index="/orders/address-audit"><template #title>地址变更审核</template></el-menu-item>
          <el-menu-item v-if="canVisit('/after-sale')" index="/after-sale"><template #title>售后管理</template></el-menu-item>
        </el-sub-menu>
        <!-- 发票管理：超管 + 客服 + 财务 -->
        <el-menu-item v-if="canVisit('/invoices')" index="/invoices">
          <el-icon><Document /></el-icon>
          <template #title>发票管理</template>
        </el-menu-item>
        <!-- 推广资金/钱包/转账/提现：超管 + 财务 -->
        <el-menu-item v-if="canVisit('/profit')" index="/profit">
          <el-icon><Promotion /></el-icon>
          <template #title>推广资金</template>
        </el-menu-item>
        <el-menu-item v-if="canVisit('/wallets')" index="/wallets">
          <el-icon><WalletFilled /></el-icon>
          <template #title>钱包管理</template>
        </el-menu-item>
        <el-menu-item v-if="canVisit('/transfers')" index="/transfers">
          <el-icon><Document /></el-icon>
          <template #title>余额转账记录</template>
        </el-menu-item>
        <el-menu-item v-if="canVisit('/withdraw')" index="/withdraw">
          <el-icon><Tickets /></el-icon>
          <template #title>提现审核</template>
        </el-menu-item>
        <!-- 日志管理：核销(全部) + 操作追溯(超管/商户管理员) -->
        <el-sub-menu v-if="showLogsMenu" index="/logs">
          <template #title><el-icon><Document /></el-icon><span>日志管理</span></template>
          <el-menu-item v-if="canVisit('/logs/verify')" index="/logs/verify"><el-icon><Tickets /></el-icon><template #title>核销日志</template></el-menu-item>
          <el-menu-item v-if="canVisit('/logs/audit')" index="/logs/audit"><el-icon><List /></el-icon><template #title>操作追溯</template></el-menu-item>
        </el-sub-menu>
        <!-- 业务设置：仅平台管理员 -->
        <el-menu-item v-if="canVisit('/settings')" index="/settings">
          <el-icon><Setting /></el-icon>
          <template #title>业务设置</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="admin-header">
        <div class="header-left">
          <el-button text class="header-collapse" title="收起侧栏" @click="collapsed = !collapsed">
            <el-icon size="20"><Expand v-if="collapsed" /><Fold v-else /></el-icon>
          </el-button>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item>E-Admin Pro</el-breadcrumb-item>
            <el-breadcrumb-item>{{ pageTitle }}</el-breadcrumb-item>
          </el-breadcrumb>
          <span v-if="isMerchantAdmin && authStore.merchantName" class="merchant-tag">当前商户：{{ authStore.merchantName }}</span>
        </div>
        <div class="header-actions">
          <el-input v-model="keyword" placeholder="全局搜索（暂未接入）" clearable class="global-search">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-button text class="theme-toggle" :title="themeStore.isDark ? '切换浅色主题' : '切换暗色主题'" @click="themeStore.toggle"><el-icon><Sunny v-if="themeStore.isDark" /><Moon v-else /></el-icon></el-button>
          <!-- 待办铃铛：徽标 + 下拉清单（GET /api/admin/todo/summary，30s 轮询，失败不报错） -->
          <el-popover placement="bottom-end" :width="300" trigger="click">
            <template #reference>
              <el-badge :value="todoTotal > 0 ? todoBadge : ''" :hidden="todoTotal === 0" class="todo-badge">
                <el-button text class="header-icon-button" title="待办提醒"><el-icon><Bell /></el-icon></el-button>
              </el-badge>
            </template>
            <div class="todo-panel">
              <div class="todo-panel-head">
                <span>待办提醒</span>
                <span class="todo-refresh" @click="refreshTodo">{{ todoLoading ? '刷新中…' : '刷新' }}</span>
              </div>
              <div v-if="!todoItems.length" class="todo-empty">暂无待办</div>
              <div v-else class="todo-list">
                <div v-for="item in todoItems" :key="item.key" class="todo-item" @click="openTodo(item)">
                  <span class="todo-label">{{ item.label }}</span>
                  <el-tag :type="todoTagType(item.level)" size="small" effect="light">{{ item.count }}</el-tag>
                </div>
              </div>
            </div>
          </el-popover>
          <el-dropdown>
            <span class="profile-trigger"><el-avatar :size="32">{{ adminAvatar }}</el-avatar><span>{{ adminName }}</span></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item>{{ adminRole }}</el-dropdown-item>
                <el-dropdown-item divided @click="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="admin-main"><RouterView /></el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.merchant-tag { margin-left: 12px; padding: 2px 10px; font-size: 12px; color: #a07c1f; background: rgba(160, 124, 31, .12); border-radius: 4px; white-space: nowrap; }
/* 待办铃铛下拉 */
.todo-badge { margin-right: 10px; }
.todo-panel { padding: 4px 2px; }
.todo-panel-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid var(--vben-border); font-size: 14px; font-weight: 600; }
.todo-refresh { color: var(--vben-primary); font-size: 12px; font-weight: 400; cursor: pointer; }
.todo-empty { padding: 24px 0; color: var(--vben-muted); font-size: 13px; text-align: center; }
.todo-list { max-height: 320px; overflow-y: auto; }
.todo-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 4px; border-bottom: 1px solid var(--vben-border); cursor: pointer; }
.todo-item:last-child { border-bottom: none; }
.todo-label { color: var(--vben-text); font-size: 13px; }
</style>
