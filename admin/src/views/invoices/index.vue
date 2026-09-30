<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { deleteAdminInvoice, deleteAdminInvoicesBatch, rejectAdminInvoice } from '@/api/invoice'
import { useAuthStore } from '@/stores/auth'
import { useInvoiceStore } from '@/stores/invoice'
import type { AdminInvoice, AdminInvoiceProcessDTO, AdminInvoiceRejectDTO, InvoiceStatus } from '@/types/invoice'

const store = useInvoiceStore()
const authStore = useAuthStore()
/**
 * 删除（单条/批量）**仅平台超管**可用：后端按登录态角色校验，非超管调用返回 1004。
 * 这里复用 auth store 已有的 `isPlatformAdmin`（= role === 'SUPER_ADMIN'），不另造一套角色判断。
 */
const canDelete = computed(() => authStore.isPlatformAdmin)
/** 表格勾选行（el-table selection），供批量删除使用。 */
const selected = ref<AdminInvoice[]>([])
/** 删除请求进行中（单条/批量共用），用于按钮 loading 与防重复点击。 */
const deleting = ref(false)
const detailVisible = ref(false)
const processVisible = ref(false)
const processFormRef = ref<FormInstance>()
const processForm = reactive<AdminInvoiceProcessDTO>({ invoiceNo: '', adminRemark: '' })
const processRules: FormRules = { invoiceNo: [{ required: true, message: '请输入发票号码', trigger: 'blur' }] }
const rejectVisible = ref(false)
const rejectFormRef = ref<FormInstance>()
const rejectForm = reactive<AdminInvoiceRejectDTO>({ reason: '' })
const rejectRules: FormRules = { reason: [{ required: true, message: '请输入驳回原因', trigger: 'blur' }] }
/** 当前正在驳回的申请（驳回后要刷新列表/详情，需要它的 id）。 */
const rejectTarget = ref<AdminInvoice | null>(null)
/** 驳回请求进行中，用于按钮 loading 与防重复提交。 */
const rejecting = ref(false)
/**
 * 驳回原因常用快捷选项。
 * ⚠️ 该原因会写入 admin_remark 并**在小程序对用户可见**（且本次不发通知），
 * 所以文案一律按「用户能看懂」写，不要出现内部黑话。
 */
const REJECT_REASON_PRESETS = [
  '发票抬头信息不完整，请补充后重新提交',
  '公司名称与税号不一致，请核对后重新提交',
  '开票金额与订单实付金额不一致',
  '订单已退款/已取消，无需开票',
]
/** 选中行中**可删**的部分：用于按钮禁用态与「整批失败」的本地预检。 */
const deletableSelected = computed(() => selected.value.filter((row) => isDeletable(row.status)))
/** 选中行中**不可删**的部分（1 已发送 / 2 待红冲财务凭证），批量删除前据此提示是哪一条不合适。 */
const blockedSelected = computed(() => selected.value.filter((row) => !isDeletable(row.status)))
const keyword = ref('')
const statusTab = ref<string>(store.filters.status === '' ? '' : String(store.filters.status))

const statusOptions: Array<{ label: string; value: InvoiceStatus }> = [
  { label: '待处理', value: 0 },
  { label: '已发送', value: 1 },
  { label: '待红冲', value: 2 },
  // 3=已驳回：2026-09-30 后端新增的独立终态，列表接口的 status 参数已支持按它筛选
  { label: '已驳回', value: 3 },
  { label: '已作废', value: 4 },
]

/** 返回发票类型中文名称。 */
function invoiceType(type: number): string { return type === 2 ? '公司' : '个人' }
/** 状态标签配色：已驳回用 danger，便于运营一眼从列表里区分出来。 */
function statusType(status: InvoiceStatus): 'warning' | 'success' | 'info' | 'danger' { return status === 0 || status === 2 ? 'warning' : status === 1 ? 'success' : status === 3 ? 'danger' : 'info' }
function statusLabel(status: InvoiceStatus, description?: string): string {
  // 后端下发的 statusDesc 优先；缺失时按状态值兜底 —— ⚠️ 3（已驳回）必须显式列出，
  // 漏了就会掉进最后的分支被显示成「已作废」，运营会误判用户的发票状态
  return description || (status === 0 ? '待处理' : status === 1 ? '已发送' : status === 2 ? '待红冲' : status === 3 ? '已驳回' : status === 4 ? '已作废' : '未知')
}
/**
 * 该状态是否允许删除（逻辑删除）。
 * 业务规则：只有 0 待处理 / 3 已驳回 / 4 已作废 可删；1 已发送 / 2 待红冲 属于财务凭证，后端返回 8301。
 */
function isDeletable(status: InvoiceStatus): boolean { return status === 0 || status === 3 || status === 4 }
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
    // 驳回原因（adminRemark）也参与筛选：运营常按驳回原因回查记录
    row.adminRemark,
  ].some((value) => String(value || '').toLowerCase().includes(query)))
})

const visibleTotal = computed(() => keyword.value.trim() ? filteredList.value.length : store.total)
const visiblePage = computed(() => keyword.value.trim() ? 1 : store.page)
const visiblePageSize = computed(() => keyword.value.trim() ? Math.max(filteredList.value.length, 1) : store.pageSize)

/** 查询当前筛选条件下的列表。 */
async function search(): Promise<void> {
  store.page = 1
  // 重新查询后表格数据整体替换，旧勾选行已不在表内 → 清空勾选，避免批量删除作用到看不见的行
  selected.value = []
  try { await store.fetchList() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '发票列表查询失败') }
}
async function reset(): Promise<void> { keyword.value = ''; statusTab.value = ''; store.resetFilters(); await search() }
async function load(): Promise<void> {
  selected.value = []
  try { await store.fetchList() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '发票列表查询失败') }
}

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

/**
 * 打开驳回弹窗。
 * 仅「待处理(0)」可驳回（已发送(1)/待红冲(2) 会被后端拒绝并返回 8301）——
 * 非待处理行的按钮本来就不渲染，这里再兜一道，避免任何入口误调。
 */
function openReject(row: AdminInvoice): void {
  if (row.status !== 0) { ElMessage.warning('仅「待处理」的发票申请可以驳回'); return }
  rejectTarget.value = row
  rejectForm.reason = ''
  rejectVisible.value = true
}

/**
 * 提交驳回（待处理 → 已驳回，终态）。
 * 原因**必填**：为空时只提示、**不发请求**（后端对空原因会返回 1000「驳回原因不能为空」）；
 * 表单 rules 负责 blur 时的即时反馈，但它拦不住"全是空格"，所以这里再按 trim 后判一次。
 */
async function submitReject(): Promise<void> {
  const target = rejectTarget.value
  if (!target) return
  const reason = rejectForm.reason.trim()
  if (!reason) { ElMessage.warning('请填写驳回原因'); return }
  const valid = await rejectFormRef.value?.validate().catch(() => false)
  if (!valid) return
  rejecting.value = true
  try {
    await rejectAdminInvoice(target.id, { reason })
    rejectVisible.value = false
    rejectTarget.value = null
    await store.fetchList()
    // 详情弹窗打开的是同一条时同步刷新：驳回是终态，详情里要立刻看到「已驳回 + 驳回原因」
    if (store.detail?.id === target.id) await store.fetchDetail(target.id)
    ElMessage.success('发票申请已驳回')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '发票驳回失败')
  } finally { rejecting.value = false }
}

/** 删除成功后收尾：被删记录正是详情弹窗里那条时关闭弹窗并清空缓存，避免详情停留在一条已不存在的记录上（后端详情会返回 8300）。 */
function closeDetailIfRemoved(ids: string[]): void {
  if (!store.detail || !ids.includes(store.detail.id)) return
  detailVisible.value = false
  store.detail = null
}

/** 删除后刷新列表：当前页被删空且不是第一页时回退一页，避免运营停在空白页。 */
async function reloadAfterRemove(): Promise<void> {
  await store.fetchList()
  // 关键词筛选时前端固定只展示当前页结果（visiblePage 恒为 1），不做页码回退
  if (!store.list.length && store.page > 1 && !keyword.value.trim()) {
    store.page -= 1
    await store.fetchList()
  }
}

/**
 * 单条删除（**逻辑删除**，仅平台超管 —— 非超管入口整体隐藏，后端另会返回 1004）。
 * 二次确认文案必须点明「逻辑删除」：列表与详情都不再显示，但数据仍保留在系统中。
 */
async function removeInvoice(row: AdminInvoice): Promise<void> {
  // 本地先按状态兜一道（1 已发送 / 2 待红冲是财务凭证）；最终裁决仍以后端的 8301 / 1004 为准
  if (!isDeletable(row.status)) { ElMessage.warning('已发送 / 待红冲的发票属于财务凭证，不可删除'); return }
  try {
    await ElMessageBox.confirm(`确认删除申请 ID ${row.id} 的发票申请吗？删除后列表与详情都不再显示，但数据仍保留在系统中。`, '删除发票申请', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    deleting.value = true
    await deleteAdminInvoice(row.id)
    closeDetailIfRemoved([row.id])
    selected.value = selected.value.filter((item) => item.id !== row.id)
    await reloadAfterRemove()
    ElMessage.success('发票申请已删除')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error instanceof Error ? error.message : '发票删除失败')
  } finally { deleting.value = false }
}

/**
 * 批量删除（**逻辑删除**，仅平台超管）。
 * ⚠️ 后端语义是**整批失败**：选中项里只要有一条不可删（1 已发送 / 2 待红冲），整批都不删并事务回滚（不会删掉一半）。
 * 所以这里分两层：
 * 1. 点击时先本地预检状态，把「哪一条不合适」直接说出来并返回 —— 不发这次注定失败的请求；
 * 2. **仍然保留后端报错的处理**（并发下数据可能已变、或权限被收回返回 1004），后端 message 原样提示给运营。
 */
async function removeSelected(): Promise<void> {
  if (!selected.value.length) { ElMessage.warning('请先勾选要删除的发票申请'); return }
  if (blockedSelected.value.length) {
    const blockedIds = blockedSelected.value.map((row) => row.id).join('、')
    ElMessage.warning(`选中的申请里有 ${blockedSelected.value.length} 条是已发送/待红冲的财务凭证（ID ${blockedIds}），按后端规则整批都不会删除，请先取消勾选`)
    return
  }
  const ids = deletableSelected.value.map((row) => row.id)
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${ids.length} 条发票申请吗？删除后列表与详情都不再显示，但数据仍保留在系统中。`, '批量删除发票申请', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    deleting.value = true
    const removed = await deleteAdminInvoicesBatch(ids)
    // 能走到这里就是**整批成功**（后端任一失败都会抛错并回滚），可安全整批收尾
    closeDetailIfRemoved(ids)
    selected.value = []
    await reloadAfterRemove()
    ElMessage.success(`已删除 ${removed || ids.length} 条发票申请`)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  } finally { deleting.value = false }
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
      <div class="toolbar"><div><strong>发票申请</strong><span class="toolbar-count">共 {{ visibleTotal }} 条</span></div><span v-if="canDelete && selected.length" class="selection-tip">已选择 {{ selected.length }} 项</span><el-button v-if="canDelete" type="danger" plain :disabled="!selected.length || deleting" :loading="deleting" @click="removeSelected">批量删除</el-button><el-button :loading="store.loading" @click="load">刷新</el-button></div>
      <DataTable :data="filteredList" :loading="store.loading" :total="visibleTotal" :page="visiblePage" :page-size="visiblePageSize" empty-text="暂无发票申请" @selection-change="selected = $event" @page-change="handlePageChange" @size-change="handlePageSizeChange">
        <el-table-column prop="id" label="申请 ID" width="110" />
        <el-table-column label="申请人" min-width="150"><template #default="{ row }"><div>{{ row.userNickname || '未设置昵称' }}</div><small>{{ row.userPhone || '未设置手机号' }}</small></template></el-table-column>
        <el-table-column label="发票类型" width="100"><template #default="{ row }">{{ invoiceType(row.type) }}</template></el-table-column>
        <el-table-column label="发票抬头" min-width="190" show-overflow-tooltip><template #default="{ row }">{{ titleOf(row) }}</template></el-table-column>
        <el-table-column prop="email" label="收票邮箱" min-width="220" show-overflow-tooltip />
        <el-table-column label="金额" width="120"><template #default="{ row }">¥ {{ Number(row.amount || 0).toFixed(2) }}</template></el-table-column>
        <el-table-column prop="statusDesc" label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status, row.statusDesc) }}</el-tag></template></el-table-column>
        <el-table-column label="驳回原因" min-width="150" show-overflow-tooltip><template #default="{ row }"><span v-if="row.status === 3">{{ row.adminRemark || '未填写' }}</span><span v-else class="cell-muted">—</span></template></el-table-column>
        <el-table-column prop="createTime" label="申请时间" min-width="180" />
        <el-table-column label="操作" width="300" fixed="right"><template #default="{ row }"><div class="operator-actions"><el-button size="small" type="primary" @click="showDetail(row)">详情</el-button><el-button v-if="row.status === 0" size="small" type="success" @click="openProcess(row)">标记已发送</el-button><el-button v-if="row.status === 0" size="small" type="danger" plain @click="openReject(row)">驳回</el-button><el-button v-if="row.status === 2" size="small" type="warning" @click="confirmRedFlush(row)">确认红冲</el-button><el-button v-if="canDelete && isDeletable(row.status)" size="small" type="danger" @click="removeInvoice(row)">删除</el-button></div></template></el-table-column>
      </DataTable>
    </el-card>

    <el-dialog v-model="detailVisible" title="发票申请详情" width="900px" append-to-body>
      <el-skeleton v-if="store.detailLoading" :rows="8" animated />
      <template v-else-if="store.detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="申请 ID">{{ store.detail.id }}</el-descriptions-item><el-descriptions-item label="申请状态"><el-tag :type="statusType(store.detail.status)">{{ statusLabel(store.detail.status, store.detail.statusDesc) }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="用户">{{ store.detail.userNickname }}（{{ store.detail.userPhone || '无手机号' }}）</el-descriptions-item><el-descriptions-item label="发票类型">{{ invoiceType(store.detail.type) }}</el-descriptions-item>
          <el-descriptions-item label="发票抬头">{{ titleOf(store.detail) }}</el-descriptions-item><el-descriptions-item label="税号">{{ store.detail.taxNo || '个人发票无税号' }}</el-descriptions-item>
          <el-descriptions-item label="收票邮箱">{{ store.detail.email }}</el-descriptions-item><el-descriptions-item label="发票金额">¥ {{ Number(store.detail.amount || 0).toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="关联订单" :span="2">{{ store.detail.orderIds }}</el-descriptions-item><el-descriptions-item v-if="store.detail.invoiceNo" label="发票号码">{{ store.detail.invoiceNo }}</el-descriptions-item><el-descriptions-item v-if="store.detail.adminRemark" :label="store.detail.status === 3 ? '驳回原因（用户可见）' : '管理员备注'">{{ store.detail.adminRemark }}</el-descriptions-item>
        </el-descriptions>
        <el-divider content-position="left">关联商品明细</el-divider>
        <el-table :data="store.detail.orderItems" border empty-text="暂无商品明细"><el-table-column prop="orderNo" label="订单号" min-width="190" /><el-table-column prop="productName" label="商品名称" min-width="180" /><el-table-column prop="specs" label="规格" min-width="120" /><el-table-column prop="price" label="单价" width="110" /><el-table-column prop="quantity" label="数量" width="80" /><el-table-column prop="subtotal" label="小计" width="110" /></el-table>
      </template>
    </el-dialog>

    <el-dialog v-model="processVisible" title="标记发票已发送" width="520px" append-to-body>
      <el-form ref="processFormRef" :model="processForm" :rules="processRules" label-width="100px"><el-form-item label="发票号码" prop="invoiceNo"><el-input v-model="processForm.invoiceNo" placeholder="请输入发票号码" /></el-form-item><el-form-item label="管理员备注"><el-input v-model="processForm.adminRemark" type="textarea" :rows="3" placeholder="可选" /></el-form-item></el-form>
      <template #footer><el-button @click="processVisible = false">取消</el-button><el-button type="primary" :loading="store.processing" @click="submitProcess">确认发送</el-button></template>
    </el-dialog>

    <el-dialog v-model="rejectVisible" title="驳回发票申请" width="520px" append-to-body>
      <el-alert class="reject-tip" type="warning" :closable="false" show-icon title="驳回为终态：之后不能再改为已开票，用户如需开票需重新提交申请；本次不会给用户发邮件/短信通知。" />
      <el-form ref="rejectFormRef" :model="rejectForm" :rules="rejectRules" label-width="100px">
        <el-form-item label="申请 ID">{{ rejectTarget?.id || '—' }}</el-form-item>
        <el-form-item label="驳回原因" prop="reason"><el-input v-model="rejectForm.reason" type="textarea" :rows="4" maxlength="200" show-word-limit placeholder="必填。该原因会展示给用户（小程序「我的发票」），请写清楚、勿使用内部用语" /></el-form-item>
        <el-form-item label="常用原因"><div class="reject-presets"><el-tag v-for="preset in REJECT_REASON_PRESETS" :key="preset" class="reject-preset" @click="rejectForm.reason = preset">{{ preset }}</el-tag></div></el-form-item>
      </el-form>
      <template #footer><el-button @click="rejectVisible = false">取消</el-button><el-button type="danger" :loading="rejecting" @click="submitReject">确认驳回</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.invoice-keyword { width: 280px; }
.invoice-status-tabs { margin-bottom: 16px; }
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions small { color: var(--vben-muted); }
.cell-muted { color: var(--vben-muted); }
.reject-tip { margin-bottom: 12px; }
.reject-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.reject-preset { cursor: pointer; }
</style>
