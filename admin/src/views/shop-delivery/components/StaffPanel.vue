<script setup lang="ts">
/**
 * 配送员与业绩面板：本店配送员列表（开启/关闭配送）+ 本店骑手配送业绩排行。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getMyRiderStats, getMyStaff, toggleMyStaff, type DeliveryStaff, type ShopRiderStats } from '@/api/shop-delivery'

const props = defineProps<{ shopId: string }>()

// ===== 配送员 =====
const staff = ref<DeliveryStaff[]>([])
const staffLoading = ref(false)

async function loadStaff(): Promise<void> {
  // 未选门店时不请求（平台账号调 my/** 会返回 1000「请指定门店」）
  if (!props.shopId) {
    staff.value = []
    return
  }
  staffLoading.value = true
  try {
    staff.value = await getMyStaff(props.shopId || undefined)
  } catch (error) {
    staff.value = []
    ElMessage.error(error instanceof Error ? error.message : '配送员查询失败')
  } finally {
    staffLoading.value = false
  }
}

/** 关闭某店员的配送员身份（列表里都是已开启的）。 */
async function disableStaff(row: DeliveryStaff): Promise<void> {
  if (row.id == null) return
  try {
    await ElMessageBox.confirm(`确认关闭「${row.name || row.id}」的配送员身份？`, '关闭配送员', { type: 'warning' })
    await toggleMyStaff(props.shopId || undefined, row.id, false)
    ElMessage.success('已关闭配送员')
    await loadStaff()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '关闭失败')
  }
}

/** 开启配送员：输入店员 ID（可从「店员管理」取）。 */
async function enableStaff(): Promise<void> {
  try {
    const result = await ElMessageBox.prompt('请输入店员 ID（该店员需属于本门店；商家账号不可设为骑手）', '开启配送员', {
      inputPattern: /^\d+$/,
      inputErrorMessage: '请输入数字 ID',
    })
    await toggleMyStaff(props.shopId || undefined, result.value, true)
    ElMessage.success('已开启配送员')
    await loadStaff()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '开启失败')
  }
}

// ===== 骑手业绩 =====
const stats = ref<ShopRiderStats | null>(null)
const statsLoading = ref(false)
const statsRange = ref('DAY')

/** 排名明细列（按返回数据动态生成表头）。 */
const riderColumns = computed<string[]>(() => {
  const rows = stats.value?.riders || []
  return rows.length ? Object.keys(rows[0] || {}) : []
})

async function loadStats(): Promise<void> {
  // 未选门店时不请求（平台账号调 my/** 会返回 1000「请指定门店」）
  if (!props.shopId) {
    stats.value = null
    return
  }
  statsLoading.value = true
  try {
    stats.value = await getMyRiderStats(props.shopId || undefined, statsRange.value)
  } catch (error) {
    stats.value = null
    ElMessage.error(error instanceof Error ? error.message : '骑手业绩查询失败')
  } finally {
    statsLoading.value = false
  }
}

watch(() => props.shopId, () => { void Promise.all([loadStaff(), loadStats()]) })
onMounted(() => { void Promise.all([loadStaff(), loadStats()]) })

defineExpose({ loadStaff, loadStats })
</script>

<template>
  <el-card shadow="never" class="content-card" v-loading="staffLoading">
    <div class="toolbar">
      <div><strong>本店配送员</strong><span class="muted">共 {{ staff.length }} 人</span></div>
      <div class="toolbar-actions">
        <el-button type="primary" @click="enableStaff">开启配送员</el-button>
        <el-button :loading="staffLoading" @click="loadStaff">刷新</el-button>
      </div>
    </div>
    <el-table :data="staff" border size="small">
      <el-table-column prop="id" label="店员 ID" width="120" />
      <el-table-column prop="name" label="姓名" min-width="140" />
      <el-table-column prop="phone" label="手机号" min-width="150" />
      <el-table-column label="操作" width="120">
        <template #default="{ row }"><el-button size="small" type="danger" plain @click="disableStaff(row)">关闭配送员</el-button></template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!staffLoading && !staff.length" description="暂无配送员，可点击「开启配送员」" />
  </el-card>

  <el-card shadow="never" class="content-card">
    <div class="toolbar">
      <div>
        <strong>本店骑手业绩</strong>
        <span v-if="stats" class="muted">
          {{ stats.rangeLabel || stats.range }}（{{ stats.fromDate || '—' }} ~ {{ stats.toDate || '—' }}）：送达 {{ stats.totalDelivered ?? 0 }} 单 / {{ Number(stats.totalDistanceKm || 0).toFixed(1) }} km / 骑手 {{ stats.riderCount ?? 0 }} 人
        </span>
      </div>
      <div class="toolbar-actions">
        <el-select v-model="statsRange" style="width: 130px" @change="loadStats">
          <el-option label="今日 DAY" value="DAY" /><el-option label="本周 WEEK" value="WEEK" />
          <el-option label="本月 MONTH" value="MONTH" /><el-option label="全部 ALL" value="ALL" />
        </el-select>
        <el-button :loading="statsLoading" @click="loadStats">查询</el-button>
      </div>
    </div>
    <el-table v-loading="statsLoading" :data="stats?.riders || []" border size="small" max-height="420">
      <el-table-column v-for="key in riderColumns" :key="key" :prop="key" :label="key" min-width="130" />
    </el-table>
    <el-empty v-if="!statsLoading && !(stats?.riders || []).length" description="暂无业绩数据" />
  </el-card>
</template>

<style scoped>
.content-card { margin-bottom: 16px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 12px; flex-wrap: wrap; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; }
.muted { color: var(--vben-muted); font-size: 13px; margin-left: 8px; }
</style>
