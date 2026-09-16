<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { useWalletStore } from '@/stores/wallet'
import type { WalletBalanceSaveDTO, WalletRecord } from '@/types/wallet'
import { Delete, Edit, Refresh } from '@element-plus/icons-vue'

const store = useWalletStore()
const balanceVisible = ref(false)
const balanceFormRef = ref<FormInstance>()
const editingWallet = ref<WalletRecord | null>(null)
const balanceForm = reactive<WalletBalanceSaveDTO>({ balance: 0 })
const balanceOriginal = ref<number | null>(null)

const balanceRules: FormRules = {
  balance: [
    { required: true, message: '请输入余额', trigger: 'blur' },
    { type: 'number', min: 0, message: '余额不能小于 0', trigger: 'change' },
  ],
}

const balanceTitle = computed(() => (editingWallet.value ? `设置用户 ${editingWallet.value.userId} 余额` : '设置余额'))

function money(value: number): string {
  return `¥ ${Number(value || 0).toFixed(2)}`
}

async function load(): Promise<void> {
  try {
    await store.fetchList()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '钱包列表查询失败')
  }
}

function openBalanceEditor(row: WalletRecord): void {
  editingWallet.value = row
  balanceOriginal.value = row.balance
  balanceForm.balance = row.balance
  balanceVisible.value = true
}

async function submitBalance(): Promise<void> {
  if (!editingWallet.value || !(await balanceFormRef.value?.validate().catch(() => false))) return
  if (balanceOriginal.value === balanceForm.balance) {
    ElMessage.warning('请先调整余额再保存')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认将用户 ${editingWallet.value.userId} 的余额调整为 ${money(balanceForm.balance)} 吗？`,
      '设置余额确认',
      { type: 'warning' },
    )
    await store.updateBalance(editingWallet.value.userId, balanceForm.balance)
    balanceVisible.value = false
    ElMessage.success('余额已更新')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '余额更新失败')
  }
}

async function removeWallet(row: WalletRecord): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除钱包记录 ${row.id} 吗？该操作不可恢复。`, '删除钱包确认', { type: 'warning' })
    await store.removeWallet(row.id)
    ElMessage.success('钱包记录已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '钱包删除失败')
  }
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

onMounted(() => { void load() })
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div><h1>钱包管理</h1><p>仅展示并维护用户可转账余额。</p></div>
      <el-button :loading="store.loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
    </div>

    <el-alert title="当前页面只保留可转账余额，其余钱包字段已隐藏。" type="info" :closable="false" show-icon class="wallet-alert" />

    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <div><strong>钱包列表</strong><span class="toolbar-count">共 {{ store.total }} 条</span></div>
      </div>
      <DataTable
        :data="store.list"
        :loading="store.loading"
        :total="store.total"
        :page="store.page"
        :page-size="store.pageSize"
        empty-text="暂无钱包数据"
        @page-change="pageChange"
        @size-change="sizeChange"
      >
        <el-table-column prop="id" label="钱包 ID" min-width="120" />
        <el-table-column prop="userId" label="用户 ID" min-width="120" />
        <el-table-column label="可转账余额" width="140"><template #default="{ row }">{{ money(row.balance) }}</template></el-table-column>
        <el-table-column prop="updateTime" label="更新时间" min-width="180" />
        <el-table-column label="操作" fixed="right" width="180">
          <template #default="{ row }">
            <div class="operator-actions">
              <el-button size="small" type="primary" @click="openBalanceEditor(row)"><el-icon><Edit /></el-icon>设置余额</el-button>
              <el-button size="small" type="danger" :loading="store.actionLoading" @click="removeWallet(row)"><el-icon><Delete /></el-icon>删除</el-button>
            </div>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <el-dialog v-model="balanceVisible" :title="balanceTitle" width="460px" append-to-body>
      <el-form ref="balanceFormRef" :model="balanceForm" :rules="balanceRules" label-width="100px">
        <el-form-item label="余额" prop="balance">
          <el-input-number v-model="balanceForm.balance" :min="0" :precision="2" :step="0.01" controls-position="right" class="balance-input" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="balanceVisible = false">取消</el-button>
        <el-button type="primary" :loading="store.actionLoading" @click="submitBalance">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.wallet-alert { margin-bottom: 16px; }
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.balance-input { width: 100%; }
</style>
