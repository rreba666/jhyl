<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormRules, type UploadRequestOptions } from 'element-plus'
import ImageGridUpload from '@/components/ImageGridUpload.vue'
import { useHomepageStore } from '@/stores/homepage'
import type { HomepageConfigVO, HomepageEnabledValue } from '@/types/homepage'
import { Edit } from '@element-plus/icons-vue'

const store = useHomepageStore()
const activeTab = ref(0)
const editItem = ref<HomepageConfigVO | null>(null)
const form = reactive({
  description: '',
  imageUrl: [] as string[],
  videoUrl: [] as string[],
  coverUrl: [] as string[],
  linkTarget: [] as string[],
  isEnabled: 0 as 0 | 1,
})
const rules: FormRules = {
  description: [{ required: true, message: '请输入品牌文案', trigger: 'blur' }],
}

/** 统一状态归一化。 */
function norm(value: HomepageEnabledValue | undefined): 0 | 1 {
  return value === 1 || value === '1' ? 1 : 0
}

/** 回填表单为指定配置的首屏字段。 */
function openEditor(item: HomepageConfigVO): void {
  editItem.value = item
  Object.assign(form, {
    description: item.description || '',
    imageUrl: [...(item.imageUrl || [])],
    videoUrl: [...(item.videoUrl || [])],
    coverUrl: [...(item.coverUrl || [])],
    linkTarget: [...(item.linkTarget || [])],
    isEnabled: norm(item.isEnabled),
  })
  activeTab.value = 0
}

/** 关闭编辑器，重置选中项。 */
function closeEditor(): void {
  editItem.value = null
  activeTab.value = 0
}

/** 数组工具。 */
function add(field: 'imageUrl' | 'videoUrl' | 'coverUrl' | 'linkTarget'): void { form[field].push('') }
function remove(field: 'imageUrl' | 'videoUrl' | 'coverUrl' | 'linkTarget', i: number): void { form[field].splice(i, 1) }

/** 文件校验。 */
function validate(file: File, field: 'imageUrl' | 'videoUrl' | 'coverUrl'): string | null {
  const isVid = field === 'videoUrl'
  const ext = file.name.toLowerCase().split('.').pop()
  if (isVid && file.type !== 'video/mp4' && ext !== 'mp4') return '视频仅支持 MP4'
  if (!isVid && !file.type.startsWith('image/')) return '请上传图片'
  if (file.size > (isVid ? 50 : 10) * 1024 * 1024) return `文件不能超过 ${isVid ? 50 : 10}MB`
  return null
}

/** 上传并追加到数组。 */
async function upload(options: UploadRequestOptions, field: 'imageUrl' | 'videoUrl' | 'coverUrl'): Promise<void> {
  const file = options.file as File
  if ((field === 'imageUrl' || field === 'coverUrl') && form[field].length >= 5) {
    ElMessage.warning('最多上传5张图片')
    return
  }
  const msg = validate(file, field)
  if (msg) { ElMessage.error(msg); return }
  try {
    form[field].push(await store.uploadFile(file))
    ElMessage.success('上传成功')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败')
  }
}

/** 保存首屏字段的部分更新。 */
async function save(): Promise<void> {
  if (!editItem.value) return
  try {
    await store.updateConfig(editItem.value.id, {
      description: form.description,
      imageUrl: form.imageUrl,
      videoUrl: form.videoUrl,
      coverUrl: form.coverUrl,
      linkTarget: form.linkTarget,
      isEnabled: form.isEnabled,
    })
    closeEditor()
    ElMessage.success('首屏配置保存成功')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  }
}

onMounted(() => {
  store.loadConfigs().catch((e: unknown) => ElMessage.error(e instanceof Error ? e.message : '加载失败'))
})
</script>

<template>
  <section class="page-container">
    <div class="page-heading">
      <div><h1>首屏与品牌</h1><p>管理品牌文案、首屏轮播图、视频及封面。</p></div>
      <el-button v-if="editItem" @click="closeEditor">返回列表</el-button>
    </div>

    <el-card v-if="!editItem" shadow="never" class="content-card">
      <el-table v-loading="store.loading" :data="store.list" border>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="description" label="品牌文案" min-width="180" show-overflow-tooltip />
        <el-table-column label="轮播图" min-width="140">
          <template #default="{ row }">{{ row.imageUrl?.length || 0 }} 张</template>
        </el-table-column>
        <el-table-column label="视频" min-width="100">
          <template #default="{ row }">{{ row.videoUrl?.length || 0 }} 个</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><el-tag :type="norm(row.isEnabled) ? 'success' : 'info'">{{ norm(row.isEnabled) ? '启用' : '禁用' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }"><div class="operator-actions"><el-button size="small" type="primary" @click="openEditor(row)"><el-icon><Edit /></el-icon>编辑</el-button></div></template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!store.loading && !store.list.length" description="暂无配置，请先在首页概览中添加" />
    </el-card>

    <template v-if="editItem">
      <el-card shadow="never" class="content-card">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="品牌文案" />
          <el-tab-pane label="轮播图" />
          <el-tab-pane label="视频与封面" />
        </el-tabs>

        <el-form label-width="100px" class="tab-form">
          <template v-if="activeTab === 0">
            <el-form-item label="品牌文案" prop="description" :rules="[{ required: true, message: '请输入品牌文案', trigger: 'blur' }]">
              <el-input v-model="form.description" type="textarea" :rows="3" placeholder="品牌介绍文案" />
            </el-form-item>
            <el-form-item label="启用状态">
              <el-switch v-model="form.isEnabled" :active-value="1" :inactive-value="0" />
              <span class="hint">启用后其他配置会自动禁用</span>
            </el-form-item>
          </template>

          <template v-if="activeTab === 1">
            <el-form-item label="轮播图">
              <ImageGridUpload v-model="form.imageUrl" :uploading="store.uploading" @upload="(options) => upload(options, 'imageUrl')" @remove="remove('imageUrl', $event)" />
            </el-form-item>
            <el-form-item label="跳转目标">
              <div class="edit-block">
                <div v-for="(_, i) in form.linkTarget" :key="`link-${i}`" class="array-row">
                  <el-input v-model="form.linkTarget[i]" placeholder="小程序页面路径" />
                  <el-button link type="danger" @click="remove('linkTarget', i)">删除</el-button>
                </div>
                <el-button v-if="form.imageUrl.length && !form.linkTarget.length" link @click="add('linkTarget')">与轮播图对应</el-button>
                <el-button v-else link @click="add('linkTarget')">新增目标</el-button>
              </div>
            </el-form-item>
          </template>

          <template v-if="activeTab === 2">
            <el-form-item label="首屏视频">
              <div class="edit-block">
                <div v-for="(url, i) in form.videoUrl" :key="`vid-${i}`" class="array-row">
                  <el-input v-model="form.videoUrl[i]" placeholder="视频 URL" />
                  <video v-if="url" :src="url" class="thumb-video" controls preload="metadata" />
                  <el-button link type="danger" @click="remove('videoUrl', i)">删除</el-button>
                </div>
                <div class="array-actions">
                  <el-upload :show-file-list="false" :http-request="(o: UploadRequestOptions) => upload(o, 'videoUrl')" accept="video/mp4">
                    <el-button :loading="store.uploading">上传 MP4</el-button>
                  </el-upload>
                  <el-button link @click="add('videoUrl')">手动添加</el-button>
                </div>
              </div>
            </el-form-item>
            <el-form-item label="视频封面">
              <ImageGridUpload v-model="form.coverUrl" :uploading="store.uploading" @upload="(options) => upload(options, 'coverUrl')" @remove="remove('coverUrl', $event)" />
            </el-form-item>
          </template>
        </el-form>

        <div class="form-footer"><el-button @click="closeEditor">取消</el-button><el-button type="primary" :loading="store.saving" @click="save">保存首屏配置</el-button></div>
      </el-card>
    </template>
  </section>
</template>

<style scoped>
.tab-form { margin-top: 24px; }
.hint { margin-left: 12px; color: var(--vben-muted); font-size: 13px; }
.edit-block { width: 100%; }
.array-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.array-row .el-input { flex: 1; }
.array-actions { display: flex; gap: 10px; margin-top: 6px; }
.thumb { width: 56px; height: 36px; border-radius: 4px; flex-shrink: 0; }
.thumb-video { width: 120px; height: 68px; border-radius: 4px; background: #111827; flex-shrink: 0; }
.form-footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--vben-border); }
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
</style>
