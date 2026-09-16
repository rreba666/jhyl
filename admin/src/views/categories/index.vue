<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useCategoryStore } from '@/stores/category'
import type { AdminCategory, AdminCategorySaveDTO, CategoryStatus } from '@/types/category'
import { CircleCheck, CircleClose, Delete, Edit } from '@element-plus/icons-vue'

const store = useCategoryStore()
const formVisible = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const form = reactive<AdminCategorySaveDTO>(createEmptyForm())
const rules: FormRules = {
  name: [{ required: true, message: '请输入分类名称', trigger: 'blur' }],
}

/** 创建分类表单默认值。 */
function createEmptyForm(): AdminCategorySaveDTO {
  return { name: '', parentId: '0', icon: '', sortOrder: 0, enabled: 1 }
}

/** 将后台分类平铺为父级下拉选项，避免选择自身或子分类。 */
const parentOptions = computed(() => store.list.filter((item) => item.id !== editingId.value).map((item) => ({ id: item.id, label: item.name })))

/** 打开新增或编辑弹窗。 */
function openForm(category?: AdminCategory): void {
  editingId.value = category?.id || null
  Object.assign(form, category
    ? { name: category.name, parentId: category.parentId, icon: category.icon, sortOrder: category.sortOrder, enabled: category.enabled }
    : createEmptyForm())
  formVisible.value = true
}

/** 提交 B 端分类新增或修改请求。 */
async function submitForm(): Promise<void> {
  if (!(await formRef.value?.validate().catch(() => false))) return
  try {
    if (editingId.value) await store.update(editingId.value, { ...form })
    else await store.create({ ...form })
    formVisible.value = false
    ElMessage.success(editingId.value ? '分类修改成功' : '分类新增成功')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '分类保存失败')
  }
}

/** 确认并软删除分类。后端会拒绝仍有子分类的一级分类。 */
async function remove(category: AdminCategory): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除分类“${category.name}”吗？`, '删除确认')
    await store.remove(category.id)
    ElMessage.success('分类已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '分类删除失败')
  }
}

/** 初始化后台分类列表。 */
onMounted(() => {
  store.fetchList().catch((error: unknown) => ElMessage.error(error instanceof Error ? error.message : '分类列表查询失败'))
})
</script>

<template>
  <section class="page-container">
    <div class="page-heading"><div><h1>分类管理</h1><p>使用后台分类接口维护商品分类树。</p></div><div><el-button @click="store.fetchList">刷新</el-button><el-button type="primary" @click="openForm()">新增分类</el-button></div></div>
    <el-card shadow="never" class="content-card">
      <el-table v-loading="store.loading" :data="store.list" row-key="id" border>
        <el-table-column prop="id" label="分类 ID" width="180" />
        <el-table-column prop="name" label="分类名称" min-width="180" />
        <el-table-column prop="parentId" label="父级 ID" width="120" />
        <el-table-column prop="sortOrder" label="排序" width="90" />
        <el-table-column label="状态" width="150"><template #default="{ row }"><div class="category-status"><el-button class="category-status-button" :class="row.enabled === 1 ? 'is-enabled' : 'is-disabled'" :type="row.enabled === 1 ? 'success' : 'info'" circle :aria-label="row.enabled === 1 ? '启用状态' : '禁用状态'"><el-icon><CircleCheck v-if="row.enabled === 1" /><CircleClose v-else /></el-icon></el-button><span class="category-status-label" :class="row.enabled === 1 ? 'is-enabled' : 'is-disabled'">{{ row.enabled === 1 ? '启用' : '禁用' }}</span></div></template></el-table-column>
        <el-table-column label="操作" fixed="right" width="170"><template #default="{ row }"><div class="operator-actions"><el-button size="small" type="primary" @click="openForm(row)"><el-icon><Edit /></el-icon>编辑</el-button><el-button size="small" type="danger" :loading="store.deleting" @click="remove(row)"><el-icon><Delete /></el-icon>删除</el-button></div></template></el-table-column>
      </el-table>
      <el-empty v-if="!store.loading && !store.list.length" description="暂无分类数据" />
    </el-card>

    <el-dialog v-model="formVisible" :title="editingId ? '编辑分类' : '新增分类'" width="520px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px"><el-form-item label="名称" prop="name"><el-input v-model="form.name" /></el-form-item><el-form-item label="父级分类"><el-select v-model="form.parentId" clearable placeholder="一级分类"><el-option label="一级分类" value="0" /><el-option v-for="option in parentOptions" :key="option.id" :label="option.label" :value="option.id" /></el-select></el-form-item><el-form-item label="图标"><el-input v-model="form.icon" placeholder="图标 URL" /></el-form-item><el-form-item label="排序"><el-input-number v-model="form.sortOrder" :min="0" /></el-form-item><el-form-item label="状态"><el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" /></el-form-item></el-form>
      <template #footer><el-button @click="formVisible = false">取消</el-button><el-button type="primary" :loading="store.saving" @click="submitForm">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.category-status { display: inline-flex; align-items: center; gap: 8px; min-height: 28px; }
.category-status-button { width: 28px; height: 28px; padding: 0; }
/* 启用状态按钮：深金底配白字，任何状态均不使用浅金底，保证对比度达标 */
.category-status-button.is-enabled { --el-button-bg-color: #a07c1f; --el-button-border-color: #a07c1f; --el-button-hover-bg-color: #b8912f; --el-button-hover-border-color: #b8912f; --el-button-active-bg-color: #8f6a18; --el-button-active-border-color: #8f6a18; color: #fff; }
.category-status-button.is-disabled { --el-button-bg-color: #606266; --el-button-border-color: #606266; --el-button-hover-bg-color: #73767a; --el-button-hover-border-color: #73767a; --el-button-active-bg-color: #4b4d50; --el-button-active-border-color: #4b4d50; color: #fff; }
.category-status-label { font-size: 13px; line-height: 28px; }
.category-status-label.is-enabled { color: #d4a843; }
.category-status-label.is-disabled { color: var(--vben-muted); }
</style>
