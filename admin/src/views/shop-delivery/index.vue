<script setup lang="ts">
/**
 * 商家配送工作台（商户管理员 / 平台）
 * 组合四个面板：配送任务、本店同城订单、配送员与业绩、配送规则（只读）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { getMyUnread } from '@/api/shop-delivery'
import { getEnabledShops } from '@/api/shop'
import type { Shop } from '@/types/shop'
import TaskPanel from './components/TaskPanel.vue'
import OrderPanel from './components/OrderPanel.vue'
import StaffPanel from './components/StaffPanel.vue'
import RulePanel from './components/RulePanel.vue'

const activeTab = ref('tasks')
/** 「配送任务」面板引用：同城订单里安排配送成功后刷新任务列表。 */
const taskPanelRef = ref<InstanceType<typeof TaskPanel> | null>(null)
/** 门店下拉数据（默认仅启用；勾选后含禁用门店）。 */
const shops = ref<Shop[]>([])
/** 是否包含已禁用门店。 */
const includeDisabled = ref(false)
/** 当前操作门店（留空=后端按登录者商户上下文解析；**平台账号不传会报 1000「请指定门店」**）。 */
const shopId = ref('')
/** 商家工作台红点未读数（拉取即清零）。 */
const unread = ref(0)

/**
 * 门店是否已就绪。
 * **没选门店前不挂载 4 个子面板** —— 否则每个面板都会各自请求 `my/**` 接口，
 * 平台账号拿不到门店上下文 → 一次进页面弹 5~6 个「请指定门店」错误提示（历史 bug）。
 */
const shopReady = computed(() => Boolean(shopId.value))

/** 拉取未读数（进入页面/切换门店时调用，后端会清零）。⚠️ 必须带 shopId。 */
async function loadUnread(): Promise<void> {
  if (!shopId.value) {
    unread.value = 0
    return
  }
  try {
    unread.value = await getMyUnread(shopId.value)
  } catch {
    unread.value = 0
  }
}

/** 拉取门店下拉；未选门店时默认选中第一个（平台账号不传 shopId 会返回 1000）。 */
async function loadShops(): Promise<void> {
  try {
    shops.value = await getEnabledShops(includeDisabled.value)
  } catch {
    shops.value = []
  }
  if (!shopId.value && shops.value.length) shopId.value = String(shops.value[0].id)
}

// 切换门店：重新拉未读数（子面板通过 watch(shopId) 自行刷新）
watch(shopId, () => { void loadUnread() })

onMounted(async () => {
  await loadShops()
  void loadUnread()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div>
        <h1>配送工作台</h1>
        <p>本店配送任务、同城订单与取消审核、配送员与业绩、配送规则（只读）——数据范围仅限本商户门店。</p>
      </div>
      <div class="heading-actions">
        <el-badge v-if="unread > 0" :value="unread" type="danger"><span class="muted">待处理</span></el-badge>
        <span class="muted">门店</span>
        <el-select v-model="shopId" clearable placeholder="请选择门店" style="width: 200px">
          <el-option v-for="shop in shops" :key="shop.id" :label="shop.name" :value="shop.id" />
        </el-select>
        <el-checkbox v-model="includeDisabled" @change="loadShops">含禁用门店</el-checkbox>
      </div>
    </div>

    <el-tabs v-if="shopReady" v-model="activeTab">
      <el-tab-pane label="配送任务" name="tasks"><TaskPanel ref="taskPanelRef" :shop-id="shopId" /></el-tab-pane>
      <el-tab-pane label="同城订单" name="orders"><OrderPanel :shop-id="shopId" @dispatched="taskPanelRef?.loadTasks()" /></el-tab-pane>
      <el-tab-pane label="配送员与业绩" name="staff"><StaffPanel :shop-id="shopId" /></el-tab-pane>
      <el-tab-pane label="配送规则" name="rules"><RulePanel :shop-id="shopId" /></el-tab-pane>
    </el-tabs>
    <!-- 未选门店时不挂载面板，避免子面板各自请求 my/** 接口报「请指定门店」 -->
    <el-empty v-else :description="shops.length ? '请先选择门店：平台账号需要指定门店才能查看配送数据' : '暂无可用门店，请先到「门店管理」新增或启用门店'" />
  </section>
</template>

<style scoped>
.heading-actions { display: flex; align-items: center; gap: 12px; }
.muted { color: var(--vben-muted); font-size: 13px; }
</style>
