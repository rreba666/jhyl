<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { useLogStore } from '@/stores/log'

const store = useLogStore()
const dateRange = ref<[string, string] | null>(null)

/** 将日期范围转换为日志接口的时间参数。 */
function updateDateRange(value: [string, string] | null): void {
  dateRange.value = value
  store.verifyFilters.startTime = value?.[0] ? `${value[0]} 00:00:00` : ''
  store.verifyFilters.endTime = value?.[1] ? `${value[1]} 23:59:59` : ''
}

/** 将核销方式数值转换为中文描述：0=扫码核销，1=手动输码，2=后台手工核销。 */
function verifyTypeText(type: number): string {
  return ({ 0: '扫码核销', 1: '手动输码', 2: '后台手工核销' } as const)[type as 0 | 1 | 2] ?? '未知'
}

/** 将操作人类型转换为中文描述：STAFF=店员核销，ADMIN=管理员手工核销。 */
function operatorTypeText(type: string): string {
  if (type === 'STAFF') return '店员核销'
  if (type === 'ADMIN') return '管理员手工核销'
  return type || '未知'
}

async function search(): Promise<void> { try { store.verifyPage = 1; await store.fetchVerifyLogs() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '核销日志查询失败') } }
async function reset(): Promise<void> { store.resetVerifyFilters(); dateRange.value = null; await search() }
async function load(): Promise<void> { try { await store.fetchVerifyLogs() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '核销日志查询失败') } }

onMounted(() => { void load() })
</script>

<template>
  <section class="page-container page-enter"><div class="page-heading"><div><h1>核销日志</h1><p>查询自提订单的后台核销记录和操作人员。</p></div></div><el-card shadow="never" class="filter-card"><el-form inline @submit.prevent="search"><el-form-item label="订单号"><el-input v-model="store.verifyFilters.orderNo" clearable placeholder="请输入订单号" /></el-form-item><el-form-item label="店员 ID"><el-input v-model="store.verifyFilters.staffId" clearable placeholder="请输入店员 ID" /></el-form-item><el-form-item label="核销时间"><el-date-picker :model-value="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" @update:model-value="updateDateRange" /></el-form-item><el-form-item><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button></el-form-item></el-form></el-card><el-card shadow="never" class="content-card"><div class="toolbar"><div><strong>核销记录</strong><span class="toolbar-count">共 {{ store.verifyTotal }} 条</span></div></div><DataTable :data="store.verifyList" :loading="store.verifyLoading" :total="store.verifyTotal" :page="store.verifyPage" :page-size="store.verifyPageSize" empty-text="暂无核销日志" @page-change="store.verifyPage = $event; void load()" @size-change="store.verifyPageSize = $event; store.verifyPage = 1; void load()"><el-table-column prop="orderNo" label="订单号" min-width="190" /><el-table-column prop="pickupCode" label="自提码" width="140" /><el-table-column label="操作人类型" width="140"><template #default="{ row }">{{ operatorTypeText(row.operatorType) }}</template></el-table-column><el-table-column prop="staffName" label="操作人" width="120" /><el-table-column prop="shopName" label="门店" min-width="170" /><el-table-column label="核销方式" width="120"><template #default="{ row }">{{ verifyTypeText(row.verifyType) }}</template></el-table-column><el-table-column prop="verifyTime" label="核销时间" min-width="180" /></DataTable></el-card></section>
</template>
