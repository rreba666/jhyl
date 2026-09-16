<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import type { AdminRole } from '@/types/auth'
import type { AdminInfo } from '@/types/admin'
import type { MerchantVO } from '@/types/merchant'
import { createAdmin, deleteAdmin, getAdmins, resetAdminPassword, restoreAdmin, updateAdminRole, updateAdminStatus } from '@/api/admin'
import { getMerchants } from '@/api/merchant'
import { Plus, Refresh, Search, Setting, Delete, Key, RefreshLeft, Edit } from '@element-plus/icons-vue'

const list = ref<AdminInfo[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const loading = ref(false)
const keyword = ref('')
const statusFilter = ref<'' | 0 | 1>('')

const formVisible = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const saving = ref(false)
const form = reactive<{ username: string; password: string; nickname: string; role: AdminRole; merchantId: number | null }>({ username: '', password: '', nickname: '', role: 'CUSTOMER_SERVICE', merchantId: null })
const rules: FormRules = {
  username: [{ required: true, message: '请输入登录用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入登录密码', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
}

const merchants = ref<MerchantVO[]>([])
const merchantOptions = ref<{ id: string; name: string }[]>([])

const ROLE_LABELS: Record<AdminRole, string> = { SUPER_ADMIN: '平台管理员', ADMIN: '商户管理员', CUSTOMER_SERVICE: '客服', FINANCE: '财务' }

/** 角色是否为平台岗（不绑商户）。 */
function isPlatformRole(role: AdminRole): boolean {
  return role === 'SUPER_ADMIN' || role === 'CUSTOMER_SERVICE' || role === 'FINANCE'
}

/** 加载商户选项（供绑定商户下拉）。 */
async function loadMerchants(): Promise<void> {
  try {
    const result = await getMerchants(1, 100)
    merchantOptions.value = result.list.map((m) => ({ id: m.id, name: m.brandName }))
  } catch {
    merchantOptions.value = []
  }
}

async function loadList(): Promise<void> {
  loading.value = true
  try {
    const result = await getAdmins(page.value, pageSize.value, keyword.value, statusFilter.value)
    total.value = result.total
    list.value = result.list
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '管理员列表查询失败')
  } finally {
    loading.value = false
  }
}

function search(): void {
  page.value = 1
  void loadList()
}

function openCreate(): void {
  editingId.value = null
  Object.assign(form, { username: '', password: '', nickname: '', role: 'CUSTOMER_SERVICE', merchantId: null })
  formVisible.value = true
}

function openEdit(row: AdminInfo): void {
  editingId.value = row.id
  Object.assign(form, { username: row.username, password: '', nickname: row.nickname, role: row.role, merchantId: row.merchantId ?? null })
  formVisible.value = true
}

async function submitForm(): Promise<void> {
  if (!(await formRef.value?.validate().catch(() => false))) return
  // 校验绑定商户：ADMIN 必选，平台岗禁选
  if (form.role === 'ADMIN' && !form.merchantId) {
    ElMessage.warning('商户管理员必须绑定一个商户')
    return
  }
  if (isPlatformRole(form.role) && form.merchantId) {
    ElMessage.warning('平台岗（超管/客服/财务）不可绑定商户')
    return
  }
  saving.value = true
  try {
    const payload = { username: form.username, password: form.password, nickname: form.nickname, role: form.role, merchantId: form.role === 'ADMIN' ? form.merchantId : null }
    if (editingId.value) {
      await updateAdminRole(editingId.value, { role: form.role, merchantId: form.role === 'ADMIN' ? form.merchantId : null })
    } else {
      await createAdmin(payload)
    }
    formVisible.value = false
    ElMessage.success(editingId.value ? '管理员已更新' : '管理员已创建')
    void loadList()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleStatus(row: AdminInfo): Promise<void> {
  const next: 0 | 1 = row.status === 1 ? 0 : 1
  try {
    await ElMessageBox.confirm(`确认${next === 1 ? '启用' : '禁用'}管理员“${row.username}”吗？`, '状态确认')
    await updateAdminStatus(row.id, next)
    ElMessage.success(next === 1 ? '已启用' : '已禁用')
    void loadList()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '状态更新失败')
  }
}

async function resetPassword(row: AdminInfo): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(`为“${row.username}”设置新密码`, '重置密码', { inputType: 'password', inputPattern: /^.{6,}$/, inputErrorMessage: '密码至少 6 位' })
    if (!value) return
    await resetAdminPassword(row.id, value)
    ElMessage.success('密码已重置')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '密码重置失败')
  }
}

async function removeRow(row: AdminInfo): Promise<void> {
  if (row.delFlag === 1) return
  try {
    await ElMessageBox.confirm(`确认删除管理员“${row.username}”吗？`, '删除确认')
    await deleteAdmin(row.id)
    ElMessage.success('管理员已删除')
    void loadList()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

async function restore(row: AdminInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认恢复管理员“${row.username}”吗？`, '恢复确认')
    await restoreAdmin(row.id)
    ElMessage.success('已恢复')
    void loadList()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '恢复失败')
  }
}

onMounted(() => { void loadList(); void loadMerchants() })
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div><h1>管理员管理</h1><p>管理 PC 后台管理员账号，商户管理员需绑定商户，平台岗不绑商户。</p></div>
      <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新增管理员</el-button>
    </div>

    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <div><strong>管理员列表</strong><span class="toolbar-count">共 {{ total }} 条</span></div>
        <div class="toolbar-actions">
          <el-select v-model="statusFilter" placeholder="状态" clearable class="status-select" @change="search">
            <el-option label="启用" :value="1" />
            <el-option label="禁用" :value="0" />
          </el-select>
          <el-input v-model="keyword" placeholder="用户名" clearable class="search-input" @keyup.enter="search" @clear="search" />
          <el-button type="primary" @click="search"><el-icon><Search /></el-icon>搜索</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="list" row-key="id" border stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="nickname" label="显示名" min-width="120" />
        <el-table-column label="角色" width="110"><template #default="{ row }">{{ ROLE_LABELS[row.role as AdminRole] || row.role }}</template></el-table-column>
        <el-table-column label="所属商户" min-width="150">
          <template #default="{ row }">{{ row.merchantId ? row.merchantName || `商户#${row.merchantId}` : '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><el-tag :type="row.status === 1 ? 'success' : 'info'">{{ row.status === 1 ? '启用' : '禁用' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" fixed="right" width="280">
          <template #default="{ row }">
            <div class="operator-actions">
              <el-button v-if="row.delFlag !== 1" size="small" type="primary" @click="openEdit(row)"><el-icon><Edit /></el-icon>编辑</el-button>
              <el-button v-if="row.delFlag !== 1" size="small" @click="toggleStatus(row)"><el-icon><Setting /></el-icon>{{ row.status === 1 ? '禁用' : '启用' }}</el-button>
              <el-button v-if="row.delFlag !== 1" size="small" @click="resetPassword(row)"><el-icon><Key /></el-icon>重置密码</el-button>
              <el-button v-if="row.delFlag !== 1" size="small" @click="removeRow(row)"><el-icon><Delete /></el-icon>删除</el-button>
              <el-button v-else size="small" type="success" @click="restore(row)"><el-icon><RefreshLeft /></el-icon>恢复</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !list.length" description="暂无管理员数据" />
      <div v-if="total > 0" class="table-pagination">
        <el-pagination background layout="total, sizes, prev, pager, next" :current-page="page" :page-size="pageSize" :total="total" @current-change="page = $event; void loadList()" @size-change="pageSize = $event; page = 1; void loadList()" />
      </div>
    </el-card>

    <el-dialog v-model="formVisible" :title="editingId ? '编辑管理员' : '新增管理员'" width="520px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="用户名" prop="username"><el-input v-model="form.username" :disabled="!!editingId" /></el-form-item>
        <el-form-item v-if="!editingId" label="密码" prop="password"><el-input v-model="form.password" type="password" show-password /></el-form-item>
        <el-form-item label="显示名"><el-input v-model="form.nickname" /></el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" style="width:100%">
            <el-option v-for="(label, code) in ROLE_LABELS" :key="code" :label="label" :value="code" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.role === 'ADMIN'" label="绑定商户">
          <el-select v-model="form.merchantId" placeholder="选择商户（必填）" clearable filterable style="width:100%">
            <el-option v-for="m in merchantOptions" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
          <p class="form-hint">商户管理员只能运营所绑定商户的数据。</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.toolbar-count { margin-left: 8px; color: #909399; font-size: 13px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; }
.search-input { width: 200px; }
.status-select { width: 110px; }
.operator-actions { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.table-pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
.form-hint { margin: 4px 0 0; color: #909399; font-size: 12px; }
</style>
