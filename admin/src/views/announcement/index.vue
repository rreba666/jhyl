<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Delete, Edit, Plus, Refresh } from '@element-plus/icons-vue'
import { createAnnouncement, deleteAnnouncement, getAnnouncements, updateAnnouncement } from '@/api/announcement'
import type { Announcement } from '@/types/announcement'

const list = ref<Announcement[]>([])
const loading = ref(false)
const saving = ref(false)
const editorVisible = ref(false)
const editorId = ref('')
const editorFormRef = ref<FormInstance>()
const editorForm = reactive({ content: '', enabled: 1, sortOrder: 0 })
const editorRules: FormRules = {
  content: [{ required: true, message: '请输入公告文案', trigger: 'blur' }],
}

async function load(): Promise<void> {
  loading.value = true
  try {
    list.value = await getAnnouncements()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '公告加载失败')
  } finally {
    loading.value = false
  }
}

/** 打开新增弹窗。 */
function openCreate(): void {
  editorId.value = ''
  Object.assign(editorForm, { content: '', enabled: 1, sortOrder: 0 })
  editorVisible.value = true
}

/** 打开编辑弹窗。 */
function openEdit(row: Announcement): void {
  editorId.value = row.id
  Object.assign(editorForm, { content: row.content, enabled: row.enabled, sortOrder: row.sortOrder })
  editorVisible.value = true
}

/** 保存新增/修改。 */
async function submitEditor(): Promise<void> {
  const valid = await editorFormRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    const payload = { content: editorForm.content.trim(), enabled: editorForm.enabled, sortOrder: editorForm.sortOrder }
    if (editorId.value) await updateAnnouncement(editorId.value, payload)
    else await createAnnouncement(payload)
    editorVisible.value = false
    ElMessage.success(editorId.value ? '公告已更新' : '公告已新增')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '公告保存失败')
  } finally {
    saving.value = false
  }
}

/** 软删除公告。 */
async function remove(row: Announcement): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除公告「${row.content.slice(0, 20)}」吗？`, '删除公告', { type: 'warning' })
    await deleteAnnouncement(row.id)
    ElMessage.success('公告已删除')
    await load()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

onMounted(() => { void load() })
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div><h1>公告栏</h1><p>管理个人中心首页顶部的滚动公告，按排序权重倒序展示。</p></div>
      <div class="heading-actions">
        <el-button :loading="loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
        <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新增公告</el-button>
      </div>
    </div>

    <el-card shadow="never" class="content-card">
      <el-table :data="list" v-loading="loading" border stripe empty-text="暂无公告">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="content" label="公告文案" min-width="320" show-overflow-tooltip />
        <el-table-column prop="sortOrder" label="排序权重" width="100" />
        <el-table-column label="启用状态" width="100">
          <template #default="{ row }"><el-tag :type="row.enabled === 1 ? 'success' : 'info'">{{ row.enabled === 1 ? '启用' : '停用' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" min-width="170" />
        <el-table-column prop="updateTime" label="更新时间" min-width="170" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <div class="operator-actions">
              <el-button size="small" type="primary" @click="openEdit(row)"><el-icon><Edit /></el-icon>编辑</el-button>
              <el-button size="small" type="danger" @click="remove(row)"><el-icon><Delete /></el-icon>删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="editorVisible" :title="editorId ? '编辑公告' : '新增公告'" width="520px" append-to-body @closed="editorFormRef?.resetFields()">
      <el-form ref="editorFormRef" :model="editorForm" :rules="editorRules" label-width="80px">
        <el-form-item label="公告文案" prop="content"><el-input v-model="editorForm.content" type="textarea" :rows="3" maxlength="100" show-word-limit placeholder="请输入滚动展示的公告文案" /></el-form-item>
        <el-form-item label="启用状态"><el-switch v-model="editorForm.enabled" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="停用" /></el-form-item>
        <el-form-item label="排序权重"><el-input-number v-model="editorForm.sortOrder" :min="0" :step="1" controls-position="right" /><span class="form-tip">数值越大越靠前</span></el-form-item>
      </el-form>
      <template #footer><el-button @click="editorVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="submitEditor">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.heading-actions { display: flex; align-items: center; gap: 8px; }
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.form-tip { margin-left: 12px; color: var(--el-text-color-secondary); font-size: 12px; }
</style>
