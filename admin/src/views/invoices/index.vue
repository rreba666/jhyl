<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { useInvoiceStore } from '@/stores/invoice'
import type { AdminInvoice, AdminInvoiceProcessDTO, InvoiceStatus } from '@/types/invoice'

const store = useInvoiceStore()
const detailVisible = ref(false)
const processVisible = ref(false)
const processFormRef = ref<FormInstance>()
const processForm = reactive<AdminInvoiceProcessDTO>({ invoiceNo: '', adminRemark: '' })
const processRules: FormRules = { invoiceNo: [{ required: true, message: '请输入发票号码', trigger: 'blur' }] }
const keyword = ref('')
const statusTab = ref<string>(store.filters.status === '' ? '' : String(store.filters.status))

const statusOptions: Array<{ label: string; value: InvoiceStatus }> = [
  { label: '待处理', value: 0 },
  { label: '已发送', value: 1 },
  { label: '待红冲', value: 2 },
  { label: '已作废', value: 4 },
]

/** 返回发票类型中文名称。 */
function invoiceType(type: number): string { return type === 2 ? '公司' : '个人' }
function statusType(status: InvoiceStatus): 'warning' | 'success' | 'info' { return status === 0 || status === 2 ? 'warning' : status === 1 ? 'success' : 'info' }
function statusLabel(status: InvoiceStatus, description?: string): string {
  return description || (status === 0 ? '待处理' : status === 1 ? '已发送' : status === 2 ? '待红冲' : '已作废')
}
function titleOf(row: AdminInvoice): string { return row.type === 2 ? row.companyName || '公司抬头' : row.personalName || '个人抬头' }

/** 后端暂未提供关键词参数，先在当前已加载页内筛选常用字段。 */
const filteredList = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return store.list
  return store.list.filter((row) => [
    row.userNickname,
    row.userPhone,
    row.email,
    row.orderIds,
    row.personalName,
    row.companyName,
    row.invoiceNo,
    row.statusDesc,
  ].some((value) => String(value || '').toLowerCase().includes(query)))
})

const visibleTotal = computed(() => keyword.value.trim() ? filteredList.value.length : store.total)
const visiblePage = computed(() => keyword.value.trim() ? 1 : store.page)
const visiblePageSize = computed(() => keyword.value.trim() ? Math.max(filteredList.value.length, 1) : store.pageSize)

/** 查询当前筛选条件下的列表。 */
async function search(): Promise<void> {
  store.page = 1
  try { await store.fetchList() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '发票列表查询失败') }
}
async function reset(): Promise<void> { keyword.value = ''; statusTab.value = ''; store.resetFilters(); await search() }
async function load(): Promise<void> { try { await store.fetchList() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '发票列表查询失败') } }

/** 切换发票处理状态，并沿用后端已支持的 status 参数。 */
function handleStatusTabChange(value: string | number): void {
  const normalizedValue = String(value)
  statusTab.value = normalizedValue
  store.filters.status = normalizedValue === '' ? '' : Number(normalizedValue) as InvoiceStatus
  store.page = 1
  void load()
}

/** 关键词筛选时只展示当前页结果，后端补充 keyword 参数后可直接迁移到接口层。 */
function handlePageChange(page: number): void {
  if (keyword.value.trim()) return
  store.page = page
  void load()
}

function handlePageSizeChange(size: number): void {
  if (keyword.value.trim()) return
  store.pageSize = size
  store.page = 1
  void load()
}

/** 打开发票详情。 */
async function showDetail(row: AdminInvoice): Promise<void> {
  try { await store.fetchDetail(row.id); detailVisible.value = true } catch (error) { ElMessage.error(error instanceof Error ? error.message : '发票详情查询失败') }
}

/** 打开标记已发送表单并预填已有发票号。 */
async function openProcess(row: AdminInvoice): Promise<void> {
  try {
    const detail = await store.fetchDetail(row.id)
    Object.assign(processForm, { invoiceNo: detail.invoiceNo || row.invoiceNo || '', adminRemark: detail.adminRemark || row.adminRemark || '' })
    processVisible.value = true
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '发票详情查询失败') }
}

/** 提交发票处理结果。 */
async function submitProcess(): Promise<void> {
  if (!store.detail) return
  const valid = await processFormRef.value?.validate().catch(() => false)
  if (!valid) return
  try {
    await store.process(store.detail.id, { invoiceNo: processForm.invoiceNo.trim(), adminRemark: processForm.adminRemark?.trim() })
    processVisible.value = false
    ElMessage.success('发票已标记为已发送')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '发票处理失败') }
}

/** 二次确认红冲完成，避免误将待红冲申请直接作废。 */
async function confirmRedFlush(row: AdminInvoice): Promise<void> {
  try {
    await ElMessageBox.confirm('确认该发票已完成红冲并将状态改为已作废吗？', '确认红冲', {
      type: 'warning',
      confirmButtonText: '确认作废',
      cancelButtonText: '取消',
    })
    await store.confirmRedFlush(row.id)
    ElMessage.success('发票已确认红冲')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error instanceof Error ? error.message : '确认红冲失败')
  }
}

onMounted(() => { void load() })
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading"><div><h1>发票管理</h1><p>处理用户发票申请并核对关联订单商品明细。</p></div></div>
    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="search">
        <el-form-item label="关键词"><el-input v-model="keyword" class="invoice-keyword" clearable placeholder="申请人、邮箱或订单号" @keyup.enter="search" /></el-form-item>
        <el-form-item><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button></el-form-item>
      </el-form>
    </el-card>
    <el-tabs v-model="statusTab" class="invoice-status-tabs" @tab-change="handleStatusTabChange">
      <el-tab-pane label="全部" name="" />
      <el-tab-pane v-for="option in statusOptions" :key="option.value" :label="option.label" :name="String(option.value)" />
    </el-tabs>
    <el-card shadow="never" class="content-card">
      <div class="toolbar"><div><strong>发票申请</strong><span class="toolbar-count">共 {{ visibleTotal }} 条</span></div><el-button :loading="store.loading" @click="load">刷新</el-button></div>
      <DataTable :data="filteredList" :loading="store.loading" :total="visibleTotal" :page="visiblePage" :page-size="visiblePageSize" empty-text="暂无发票申请" @page-change="handlePageChange" @size-change="handlePageSizeChange">
        <el-table-column prop="id" label="申请 ID" width="110" />
        <el-table-column label="申请人" min-width="150"><template #default="{ row }"><div>{{ row.userNickname || '未设置昵称' }}</div><small>{{ row.userPhone || '未设置手机号' }}</small></template></el-table-column>
        <el-table-column label="发票类型" width="100"><template #default="{ row }">{{ invoiceType(row.type) }}</template></el-table-column>
        <el-table-column label="发票抬头" min-width="190" show-overflow-tooltip><template #default="{ row }">{{ titleOf(row) }}</template></el-table-column>
        <el-table-column prop="email" label="收票邮箱" min-width="220" show-overflow-tooltip />
        <el-table-column label="金额" width="120"><template #default="{ row }">¥ {{ Number(row.amount || 0).toFixed(2) }}</template></el-table-column>
        <el-table-column prop="statusDesc" label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status, row.statusDesc) }}</el-tag></template></el-table-column>
        <el-table-column prop="createTime" label="申请时间" min-width="180" />
        <el-table-column label="操作" width="220" fixed="right"><template #default="{ row }"><div class="operator-actions"><el-button size="small" type="primary" @click="showDetail(row)">详情</el-button><el-button v-if="row.status === 0" size="small" type="success" @click="openProcess(row)">标记已发送</el-button><el-button v-if="row.status === 2" size="small" type="warning" @click="confirmRedFlush(row)">确认红冲</el-button></div></template></el-table-column>
      </DataTable>
    </el-card>

    <el-dialog v-model="detailVisible" title="发票申请详情" width="900px" append-to-body>
      <el-skeleton v-if="store.detailLoading" :rows="8" animated />
      <template v-else-if="store.detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="申请 ID">{{ store.detail.id }}</el-descriptions-item><el-descriptions-item label="申请状态"><el-tag :type="statusType(store.detail.status)">{{ store.detail.statusDesc }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="用户">{{ store.detail.userNickname }}（{{ store.detail.userPhone || '无手机号' }}）</el-descriptions-item><el-descriptions-item label="发票类型">{{ invoiceType(store.detail.type) }}</el-descriptions-item>
          <el-descriptions-item label="发票抬头">{{ titleOf(store.detail) }}</el-descriptions-item><el-descriptions-item label="税号">{{ store.detail.taxNo || '个人发票无税号' }}</el-descriptions-item>
          <el-descriptions-item label="收票邮箱">{{ store.detail.email }}</el-descriptions-item><el-descriptions-item label="发票金额">¥ {{ Number(store.detail.amount || 0).toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="关联订单" :span="2">{{ store.detail.orderIds }}</el-descriptions-item><el-descriptions-item v-if="store.detail.invoiceNo" label="发票号码">{{ store.detail.invoiceNo }}</el-descriptions-item><el-descriptions-item v-if="store.detail.adminRemark" label="管理员备注">{{ store.detail.adminRemark }}</el-descriptions-item>
        </el-descriptions>
        <el-divider content-position="left">关联商品明细</el-divider>
        <el-table :data="store.detail.orderItems" border empty-text="暂无商品明细"><el-table-column prop="orderNo" label="订单号" min-width="190" /><el-table-column prop="productName" label="商品名称" min-width="180" /><el-table-column prop="specs" label="规格" min-width="120" /><el-table-column prop="price" label="单价" width="110" /><el-table-column prop="quantity" label="数量" width="80" /><el-table-column prop="subtotal" label="小计" width="110" /></el-table>
      </template>
    </el-dialog>

    <el-dialog v-model="processVisible" title="标记发票已发送" width="520px" append-to-body>
      <el-form ref="processFormRef" :model="processForm" :rules="processRules" label-width="100px"><el-form-item label="发票号码" prop="invoiceNo"><el-input v-model="processForm.invoiceNo" placeholder="请输入发票号码" /></el-form-item><el-form-item label="管理员备注"><el-input v-model="processForm.adminRemark" type="textarea" :rows="3" placeholder="可选" /></el-form-item></el-form>
      <template #footer><el-button @click="processVisible = false">取消</el-button><el-button type="primary" :loading="store.processing" @click="submitProcess">确认发送</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.invoice-keyword { width: 280px; }
.invoice-status-tabs { margin-bottom: 16px; }
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions small { color: var(--vben-muted); }
</style>
