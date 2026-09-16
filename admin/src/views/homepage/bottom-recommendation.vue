<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, type UploadRequestOptions } from 'element-plus'
import ImageGridUpload from '@/components/ImageGridUpload.vue'
import { useHomepageStore } from '@/stores/homepage'
import type { HomepageConfigVO, HomepageEnabledValue } from '@/types/homepage'
import { Edit } from '@element-plus/icons-vue'

const store = useHomepageStore()
const editItem = ref<HomepageConfigVO | null>(null)
const form = reactive({ moreWelfareImage: [] as string[], followImage: [] as string[], moreWelfareAppId: '' })

/** 归一化。 */
function norm(value: HomepageEnabledValue | undefined): 0 | 1 {
  return value === 1 || value === '1' ? 1 : 0
}

/** 打开底部推荐编辑。 */
function openEditor(item: HomepageConfigVO): void {
  editItem.value = item
  Object.assign(form, {
    moreWelfareImage: item.bottomImageUrl?.[0] ? [item.bottomImageUrl[0]] : [],
    followImage: item.bottomImageUrl?.[1] ? [item.bottomImageUrl[1]] : [],
    moreWelfareAppId: item.bottomLinkTarget?.[0] || '',
  })
}

function closeEditor(): void { editItem.value = null }

type BottomImageField = 'moreWelfareImage' | 'followImage'

function remove(field: BottomImageField, i: number): void { form[field].splice(i, 1) }

/** 上传底部推荐图。 */
async function upload(options: UploadRequestOptions, field: BottomImageField): Promise<void> {
  const file = options.file as File
  if (form[field].length >= 1) { ElMessage.warning('每个区域只能上传一张图片'); return }
  if (!file.type.startsWith('image/')) { ElMessage.error('请上传图片'); return }
  if (file.size > 10 * 1024 * 1024) { ElMessage.error('图片不能超过 10MB'); return }
  try {
    form[field] = [await store.uploadFile(file)]
    ElMessage.success('上传成功')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败')
  }
}

/** 保存底部字段的部分更新。 */
async function save(): Promise<void> {
  if (!editItem.value) return
  const moreWelfareAppId = form.moreWelfareAppId.trim()
  if (moreWelfareAppId && !/^wx[a-zA-Z0-9]{16,}$/.test(moreWelfareAppId)) {
    ElMessage.error('请输入正确的小程序 AppID')
    return
  }
  try {
    await store.updateConfig(editItem.value.id, {
      bottomImageUrl: [form.moreWelfareImage[0] || '', form.followImage[0] || ''],
      bottomLinkTarget: [moreWelfareAppId, ''],
    })
    closeEditor()
    ElMessage.success('底部推荐保存成功')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  }
}

const enabledId = computed(() => {
  const item = store.list.find((i) => norm(i.isEnabled) === 1)
  return item ? String(item.id) : null
})

onMounted(() => {
  store.loadConfigs().catch((e: unknown) => ElMessage.error(e instanceof Error ? e.message : '加载失败'))
})
</script>

<template>
  <section class="page-container">
    <div class="page-heading">
      <div><h1>底部推荐</h1><p>管理首页底部推荐标题、图片和跳转目标。</p></div>
      <el-button v-if="editItem" @click="closeEditor">返回列表</el-button>
    </div>

    <el-card v-if="!editItem" shadow="never" class="content-card">
      <el-table v-loading="store.loading" :data="store.list" border>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column label="更多福利" min-width="140">
          <template #default="{ row }">
            <el-image v-if="row.bottomImageUrl?.[0]" :src="row.bottomImageUrl[0]" class="mini-thumb" fit="cover" :preview-src-list="[row.bottomImageUrl[0]]" preview-teleported />
            <span v-else class="empty">暂无</span>
          </template>
        </el-table-column>
        <el-table-column label="关注金华有" min-width="140">
          <template #default="{ row }">
            <el-image v-if="row.bottomImageUrl?.[1]" :src="row.bottomImageUrl[1]" class="mini-thumb" fit="cover" :preview-src-list="[row.bottomImageUrl[1]]" preview-teleported />
            <span v-else class="empty">暂无</span>
          </template>
        </el-table-column>
        <el-table-column label="跳转小程序" min-width="180">
          <template #default="{ row }">{{ row.bottomLinkTarget?.[0] || '未配置' }}</template>
        </el-table-column>
        <el-table-column label="当前启用" width="90">
          <template #default="{ row }"><el-tag size="small" :type="String(row.id) === enabledId ? 'success' : 'info'">{{ String(row.id) === enabledId ? '启用' : '禁用' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }"><div class="operator-actions"><el-button size="small" type="primary" @click="openEditor(row)"><el-icon><Edit /></el-icon>编辑</el-button></div></template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!store.loading && !store.list.length" description="暂无配置" />
    </el-card>

    <template v-if="editItem">
      <el-card shadow="never" class="content-card">
        <el-form label-width="110px">
          <el-form-item label="更多福利">
            <ImageGridUpload v-model="form.moreWelfareImage" :max="1" :uploading="store.uploading" @upload="upload($event, 'moreWelfareImage')" @remove="remove('moreWelfareImage', $event)" />
          </el-form-item>
          <el-form-item label="跳转小程序">
            <div class="field-hint">此 AppID 仅作用于“更多福利”图片，点击该图片时跳转。</div>
            <el-input v-model="form.moreWelfareAppId" placeholder="请输入目标小程序 AppID，例如 wx..." clearable />
          </el-form-item>
          <el-form-item label="关注金华有">
            <ImageGridUpload v-model="form.followImage" :max="1" :uploading="store.uploading" @upload="upload($event, 'followImage')" @remove="remove('followImage', $event)" />
          </el-form-item>
        </el-form>
        <div class="form-footer"><el-button @click="closeEditor">取消</el-button><el-button type="primary" :loading="store.saving" @click="save">保存底部推荐</el-button></div>
      </el-card>
    </template>
  </section>
</template>

<style scoped>
.mini-preview { display: flex; gap: 4px; }
.mini-thumb { width: 40px; height: 28px; border-radius: 3px; }
.empty { color: var(--vben-muted); font-size: 13px; }
.edit-block { width: 100%; }
.array-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.array-row .el-input { flex: 1; }
.array-actions { display: flex; gap: 10px; margin-top: 6px; }
.field-hint { margin-bottom: 8px; color: var(--vben-muted); font-size: 13px; line-height: 1.5; }
.thumb { width: 72px; height: 48px; border-radius: 4px; flex-shrink: 0; }
.form-footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--vben-border); }
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
</style>
