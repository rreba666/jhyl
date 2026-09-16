<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, CircleCheck, CircleClose } from '@element-plus/icons-vue'
import DataTable from '@/components/DataTable.vue'
import { useAddressAuditStore } from '@/stores/address-audit'
import type { AddressAuditStatus, OrderAddressChangeRequest } from '@/types/address-audit'

const store = useAddressAuditStore()

const statusOptions: Array<{ label: string; value: AddressAuditStatus | '' }> = [
  { label: '全部', value: '' },
  { label: '待审核', value: 0 },
  { label: '已通过', value: 1 },
  { label: '已拒绝', value: 2 },
]

const reasonVisible = ref(false)
const rejectReason = ref('')
const rejectTarget = ref<OrderAddressChangeRequest | null>(null)

function statusLabel(status: AddressAuditStatus): string {
  return statusOptions.find((option) => option.value === status)?.label || '未知状态'
}

function statusType(status: AddressAuditStatus): 'warning' | 'success' | 'danger' {
  if (status === 1) return 'success'
  if (status === 2) return 'danger'
  return 'warning'
}

/** 加载当前筛选条件下的地址申请列表。 */
async function load(): Promise<void> {
  try {
    await store.fetchList()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '地址审核列表加载失败')
  }
}

/** 提交筛选条件并回到第一页。 */
function search(): void {
  store.page = 1
  void load()
}

/** 清空筛选条件并重新加载。 */
function reset(): void {
  store.resetFilters()
  void load()
}

/** 切换审核状态筛选。 */
function handleStatusChange(value: AddressAuditStatus | ''): void {
  store.filters.status = value
  store.page = 1
  void load()
}

function pageChange(value: number): void {
  store.page = value
  void load()
}

function sizeChange(value: number): void {
  store.pageSize = value
  store.page = 1
  void load()
}

/** 审核通过前确认，后端会同步更新订单收货地址快照。 */
async function approve(row: OrderAddressChangeRequest): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认通过订单「${row.orderNo}」的地址修改申请吗？通过后订单将使用新收货地址。`,
      '审核通过确认',
      { type: 'warning', confirmButtonText: '确认通过', cancelButtonText: '取消' },
    )
    await store.approve(row.id)
    ElMessage.success('地址修改申请已通过')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '地址审核通过失败')
  }
}

/** 打开驳回原因输入框。 */
function openReject(row: OrderAddressChangeRequest): void {
  rejectTarget.value = row
  rejectReason.value = ''
  reasonVisible.value = true
}

/** 提交驳回原因并刷新申请列表。 */
async function submitReject(): Promise<void> {
  if (!rejectTarget.value) return
  try {
    await store.reject(rejectTarget.value.id, rejectReason.value.trim())
    reasonVisible.value = false
    ElMessage.success('地址修改申请已拒绝')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '地址审核驳回失败')
  }
}

onMounted(() => { void load() })
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div><h1>地址变更审核</h1><p>审核用户提交的订单收货地址修改申请，通过后才会更新订单地址。</p></div>
      <el-button :loading="store.loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form inline class="audit-filter-form" @submit.prevent="search">
        <el-form-item label="审核状态">
          <el-radio-group :model-value="store.filters.status" @change="handleStatusChange">
            <el-radio-button v-for="option in statusOptions" :key="String(option.value)" :value="option.value">{{ option.label }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="订单号">
          <el-input v-model="store.filters.orderNo" placeholder="请输入订单号" clearable @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="audit-filter-actions"><el-button type="primary" @click="search">搜索</el-button><el-button @click="reset">重置</el-button></el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="content-card">
      <div class="toolbar"><div><strong>地址变更申请</strong><span class="toolbar-count">共 {{ store.total }} 条</span></div></div>
      <DataTable :data="store.list" :loading="store.loading" :total="store.total" :page="store.page" :page-size="store.pageSize" empty-text="暂无地址变更申请" @page-change="pageChange" @size-change="sizeChange">
        <el-table-column prop="orderNo" label="订单号" min-width="190" />
        <el-table-column label="用户 ID" width="120"><template #default="{ row }">{{ row.userId || '--' }}</template></el-table-column>
        <el-table-column label="地址变更" min-width="420">
          <template #default="{ row }">
            <div class="address-block"><span class="address-label">原地址</span><span>{{ row.oldReceiverName }} {{ row.oldReceiverPhone }} {{ row.oldReceiverAddress }}</span></div>
            <div class="address-block new-address"><span class="address-label">新地址</span><span>{{ row.newReceiverName }} {{ row.newReceiverPhone }} {{ row.newReceiverAddress }}</span></div>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="申请原因" min-width="160" show-overflow-tooltip />
        <el-table-column label="审核状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="申请时间" min-width="170"><template #default="{ row }">{{ row.createTime || '--' }}</template></el-table-column>
        <el-table-column label="审核信息" min-width="170"><template #default="{ row }"><div>{{ row.reviewedBy || '--' }}</div><div v-if="row.reviewedAt" class="cell-sub">{{ row.reviewedAt }}</div><div v-if="row.rejectReason" class="reject-copy">{{ row.rejectReason }}</div></template></el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <div v-if="row.status === 0" class="operator-actions">
              <el-button size="small" type="success" :loading="store.actionLoading" @click="approve(row)"><el-icon><CircleCheck /></el-icon>通过</el-button>
              <el-button size="small" type="danger" :loading="store.actionLoading" @click="openReject(row)"><el-icon><CircleClose /></el-icon>驳回</el-button>
            </div>
            <span v-else class="cell-muted">—</span>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <el-dialog v-model="reasonVisible" title="驳回地址修改申请" width="460px" append-to-body>
      <p class="dialog-tip">订单：{{ rejectTarget?.orderNo || '--' }}</p>
      <el-input v-model="rejectReason" type="textarea" :rows="4" maxlength="255" show-word-limit placeholder="请输入驳回原因（可为空）" />
      <template #footer><el-button @click="reasonVisible = false">取消</el-button><el-button type="primary" :loading="store.actionLoading" @click="submitReject">确认驳回</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.audit-filter-form { display: flex; align-items: center; flex-wrap: wrap; gap: 0 16px; }
.audit-filter-form .el-form-item { margin-bottom: 0; }
.audit-filter-form .el-input { width: 240px; }
.audit-filter-actions { margin-left: auto; }
.address-block { display: flex; gap: 8px; line-height: 1.6; }
.new-address { margin-top: 6px; }
.address-label { flex: 0 0 42px; color: #909399; }
.cell-sub { margin-top: 2px; color: #909399; font-size: 12px; }
.reject-copy { margin-top: 4px; color: #f56c6c; font-size: 12px; line-height: 1.5; }
.cell-muted { color: #c0c4cc; }
.dialog-tip { margin: 0 0 12px; color: #606266; }
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }

@media (max-width: 1200px) {
  .audit-filter-actions { margin-left: 0; }
}
</style>
