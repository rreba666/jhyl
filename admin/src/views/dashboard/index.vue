<script setup lang="ts">
import { onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import SalesCharts from '@/components/dashboard/SalesCharts.vue'
import { useDashboardStore } from '@/stores/dashboard'
import { useThemeStore } from '@/stores/theme'
import type { DashboardTimeRange } from '@/types/dashboard'

const store = useDashboardStore()
const themeStore = useThemeStore()
const timeRangeOptions: Array<{ label: string; value: DashboardTimeRange }> = [
  { label: '近 7 天', value: '7' },
  { label: '近 30 天', value: '30' },
  { label: '近 90 天', value: '90' },
  { label: '全部', value: 'all' },
]

/** 格式化金额，统一保留两位小数。 */
function formatMoney(value: number): string {
  return Number(value || 0).toFixed(2)
}

/** 加载仪表盘购买记录。 */
async function load(): Promise<void> {
  try {
    await store.fetchSalesRecords()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '购买记录查询失败')
  }
}

/** 按商品名称重新查询全量记录。 */
function search(): void {
  store.page = 1
  void load()
}

/** 清空商品名称并重新查询。 */
function reset(): void {
  store.resetFilters()
  void load()
}

function handlePageChange(page: number): void {
  store.page = page
}

function handlePageSizeChange(size: number): void {
  store.pageSize = size
  store.page = 1
}

onMounted(() => { void load() })
</script>

<template>
  <section class="page-container page-enter dashboard-page">
    <div class="page-heading">
      <div><h1>仪表盘</h1><p>查看全量有效购买记录、商品排行和销售趋势。</p></div>
      <el-button :loading="store.loading" @click="load">刷新</el-button>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="search">
        <el-form-item label="商品名称"><el-input v-model="store.filters.productName" clearable placeholder="请输入商品名称" @keyup.enter="search" /></el-form-item>
        <el-form-item label="时间范围">
          <el-radio-group :model-value="store.timeRange" size="small" @update:model-value="store.setTimeRange">
            <el-radio-button v-for="option in timeRangeOptions" :key="option.value" :label="option.value">{{ option.label }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="重点商品">
          <el-select v-model="store.selectedProductName" clearable filterable placeholder="选择商品查看" class="focus-product-select">
            <el-option v-for="name in store.productNames" :key="name" :label="name" :value="name" />
          </el-select>
        </el-form-item>
        <el-form-item><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button></el-form-item>
      </el-form>
    </el-card>

    <div class="dashboard-metrics">
      <div class="metric-panel"><span class="metric-label">有效购买记录</span><strong>{{ store.total }}</strong><small>当前时间范围筛选结果</small></div>
      <div class="metric-panel"><span class="metric-label">商品销量</span><strong>{{ store.totalQuantity }}</strong><small>全量有效记录商品数量</small></div>
      <div class="metric-panel"><span class="metric-label">销售金额</span><strong>¥ {{ formatMoney(store.totalAmount) }}</strong><small>全量商品小计合计</small></div>
      <div class="metric-panel"><span class="metric-label">平均成交单价</span><strong>¥ {{ formatMoney(store.averagePrice) }}</strong><small>按商品销量加权计算</small></div>
    </div>

    <SalesCharts
      :product-sales="store.productSales"
      :daily-sales="store.dailySales"
      :focus-product="store.selectedProductName"
      :focus-product-sales="store.selectedProductSales"
      :focus-product-daily-sales="store.selectedProductDailySales"
      :loading="store.loading"
      :dark="themeStore.isDark"
    />

    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <div><strong>商品购买记录</strong><span class="toolbar-count">共 {{ store.tableTotal }} 条</span></div>
        <div class="toolbar-actions">
          <el-input
            v-model="store.tableKeyword"
            clearable
            placeholder="搜索订单号、商品或购买用户"
            class="table-search"
            @input="store.page = 1"
          />
        </div>
      </div>
      <DataTable :data="store.list" :loading="store.loading" :total="store.tableTotal" :page="store.page" :page-size="store.pageSize" empty-text="暂无购买记录" @page-change="handlePageChange" @size-change="handlePageSizeChange">
        <el-table-column prop="orderNo" label="订单号" min-width="190" show-overflow-tooltip />
        <el-table-column prop="productName" label="商品名称" min-width="220" show-overflow-tooltip />
        <el-table-column prop="nickname" label="购买用户" min-width="140" show-overflow-tooltip />
        <el-table-column prop="quantity" label="数量" width="90" />
        <el-table-column label="单价" width="120"><template #default="{ row }">¥ {{ formatMoney(row.price) }}</template></el-table-column>
        <el-table-column label="小计" width="120"><template #default="{ row }">¥ {{ formatMoney(row.subtotal) }}</template></el-table-column>
        <el-table-column prop="createTime" label="下单时间" min-width="180" />
        <el-table-column prop="payTime" label="支付时间" min-width="180" />
        <el-table-column prop="statusDesc" label="状态" width="110" />
      </DataTable>
    </el-card>
  </section>
</template>

<style scoped>
.dashboard-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
.metric-panel { min-width: 0; padding: 20px 22px; border: 1px solid var(--vben-border); border-radius: 8px; background: var(--vben-surface); }
.metric-label, .metric-panel small { display: block; color: var(--vben-muted); }
.metric-panel strong { display: block; margin: 12px 0 8px; color: var(--vben-text); font-size: 26px; line-height: 1.2; white-space: nowrap; }
.metric-panel small { font-size: 12px; white-space: nowrap; }
.focus-product-select { width: 220px; }
.table-search { width: 260px; }
@media (max-width: 1100px) { .dashboard-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) {
  .dashboard-metrics { grid-template-columns: 1fr; }
  .toolbar-actions, .table-search { width: 100%; }
}
</style>
