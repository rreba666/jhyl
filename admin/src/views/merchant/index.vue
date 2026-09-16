<script setup lang="ts">
/**
 * 商户业务台（商户管理员 ADMIN 登录后的默认落地页）
 * - 指标接真实数据：各列表接口的 total（门店/人员/商品/售后），单项失败不影响其它。
 * - 快捷入口按当前角色的路由白名单过滤，避免点进无权页面被守卫弹回。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { canAccess, ROLE_LABELS } from '@/utils/permission'
import type { AdminRole } from '@/types/auth'
import { getShops } from '@/api/shop'
import { getStaffAccounts } from '@/api/staff'
import { getAdminProducts } from '@/api/product'
import { getAfterSaleList } from '@/api/after-sale'

const router = useRouter()
const authStore = useAuthStore()

/** 指标卡（value=null 表示未取到，展示「—」）。 */
const metrics = ref([
  { key: 'shops', label: '门店数', value: null as number | null, note: '本商户门店' },
  { key: 'staff', label: '人员数', value: null as number | null, note: '店长/骑手/核销/档案' },
  { key: 'products', label: '在售商品', value: null as number | null, note: '本商户商品' },
  { key: 'aftersale', label: '售后单', value: null as number | null, note: '全部售后记录' },
])

/** 可用的快捷入口全集（会按角色白名单过滤）。 */
const ALL_ACTIONS = [
  { label: '门店管理', path: '/shops', desc: '门店 / 自提点' },
  { label: '店员管理', path: '/staff', desc: '店长 / 骑手 / 核销员' },
  { label: '商品管理', path: '/products', desc: '上架 / 改价 / 库存' },
  { label: '普通订单', path: '/orders', desc: '查看 / 处理订单' },
  { label: '自提订单', path: '/orders/pickup', desc: '自提核销' },
  { label: '售后管理', path: '/after-sale', desc: '退货 / 退款' },
  { label: '核销日志', path: '/logs/verify', desc: '核销记录' },
  { label: '操作追溯', path: '/logs/audit', desc: '操作审计' },
  { label: '地址变更审核', path: '/orders/address-audit', desc: '审核收货地址变更' },
]

/** 当前角色可访问的快捷入口（避免点进无权路由）。 */
const quickActions = computed(() => {
  const role = (authStore.role || 'ADMIN') as AdminRole
  return ALL_ACTIONS.filter((item) => canAccess(role, item.path))
})

/** 顶栏问候信息。 */
const merchantName = computed(() => authStore.merchantName || '本商户')
const roleLabel = computed(() => ROLE_LABELS[(authStore.role as AdminRole)] || '管理员')

/** 写入单个指标值。 */
function setMetric(key: string, value: unknown): void {
  const item = metrics.value.find((metric) => metric.key === key)
  if (item) item.value = Number(value) || 0
}

/** 并发加载各指标（单个接口失败保持 null，不阻塞其它）。 */
async function loadMetrics(): Promise<void> {
  await Promise.all([
    getShops(1, 1).then((result) => setMetric('shops', result.total)).catch(() => undefined),
    getStaffAccounts({ page: 1, size: 1 }).then((result) => setMetric('staff', result.total)).catch(() => undefined),
    getAdminProducts({ page: 1, pageSize: 1 }).then((result) => setMetric('products', result.total)).catch(() => undefined),
    getAfterSaleList({ page: 1, size: 1 }).then((result) => setMetric('aftersale', result.total)).catch(() => undefined),
  ])
}

onMounted(() => { void loadMetrics() })

function go(path: string): void {
  router.push(path)
}
</script>

<template>
  <section class="page-container page-enter merchant-page">
    <div class="page-heading">
      <div>
        <h1>商户业务台</h1>
        <p>您好，欢迎回来！当前身份：<strong>{{ roleLabel }}</strong>，商户：<strong>{{ merchantName }}</strong>。</p>
      </div>
      <el-button :loading="false" @click="loadMetrics">刷新数据</el-button>
    </div>

    <!-- 核心指标卡 -->
    <div class="merchant-metrics">
      <div v-for="metric in metrics" :key="metric.key" class="metric-panel">
        <span class="metric-label">{{ metric.label }}</span>
        <strong>{{ metric.value == null ? '—' : metric.value }}</strong>
        <small>{{ metric.note }}</small>
      </div>
    </div>

    <!-- 常用功能快捷入口（按角色过滤） -->
    <el-card shadow="never" class="content-card">
      <div class="toolbar"><div><strong>常用功能</strong></div></div>
      <div class="merchant-actions">
        <div v-for="action in quickActions" :key="action.path" class="action-card" @click="go(action.path)">
          <span class="action-title">{{ action.label }}</span>
          <span class="action-desc">{{ action.desc }}</span>
        </div>
      </div>
    </el-card>

    <el-alert
      title="指标取自各业务列表的合计条数（门店 / 人员 / 商品 / 售后），按当前登录身份的数据范围统计。"
      type="info"
      :closable="false"
      show-icon
      class="merchant-tip"
    />
  </section>
</template>

<style scoped>
.merchant-page { min-height: 60vh; }
.merchant-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px; }
.metric-panel { display: flex; flex-direction: column; gap: 6px; padding: 20px; border: 1px solid var(--vben-border); border-radius: var(--vben-card-radius); background: var(--vben-surface); box-shadow: var(--vben-shadow); color: var(--vben-text); }
.metric-label { color: var(--vben-muted); font-size: 14px; }
.metric-panel strong { font-size: 30px; font-weight: 700; }
.metric-panel small { color: var(--vben-muted); font-size: 12px; }
.merchant-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.action-card { display: flex; flex-direction: column; gap: 4px; padding: 18px; border: 1px solid var(--vben-border); border-radius: var(--vben-card-radius); background: var(--vben-surface); cursor: pointer; transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
.action-card:hover { transform: translateY(-3px); box-shadow: var(--vben-shadow-hover); border-color: var(--vben-primary); }
.action-title { color: var(--vben-text); font-size: 16px; font-weight: 600; }
.action-desc { color: var(--vben-muted); font-size: 13px; }
.merchant-tip { margin-top: 16px; }
@media (max-width: 900px) { .merchant-metrics { grid-template-columns: repeat(2, 1fr); } .merchant-actions { grid-template-columns: repeat(2, 1fr); } }
</style>
