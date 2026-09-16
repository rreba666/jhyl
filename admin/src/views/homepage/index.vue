<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules, type UploadRequestOptions } from 'element-plus'
import ImageGridUpload from '@/components/ImageGridUpload.vue'
import { useHomepageStore } from '@/stores/homepage'
import type { HomepageConfigSaveDTO, HomepageConfigVO, HomepageEnabled, HomepageEnabledValue } from '@/types/homepage'
import { cropImageToSize, HERO_IMAGE_SIZE } from '@/utils/imageCrop'
import { Delete, Edit } from '@element-plus/icons-vue'

const store = useHomepageStore()
const formRef = ref<FormInstance>()
const formVisible = ref(false)
const editingId = ref<number | string | null>(null)
const statusSavingIds = ref<string[]>([])
const form = reactive<HomepageConfigSaveDTO>({
  description: '',
  logoUrl: '',
  imageUrl: [],
  videoUrl: [],
  coverUrl: [],
  linkTarget: [],
  bottomImageUrl: [],
  bottomLinkTarget: [],
  bottomTitle: '',
  isEnabled: 0,
})
const rules: FormRules = {
  description: [{ required: true, message: '请输入主页配置描述', trigger: 'blur' }],
}

/** 将后端返回的启用状态统一转换为数字，供标签和开关使用。 */
function normalizeEnabled(value: HomepageEnabledValue | undefined): HomepageEnabled {
  return value === 1 || value === '1' || value === true ? 1 : 0
}

/** 判断当前记录是否为允许管理的配置。 */
function isManagedConfig(config: HomepageConfigVO): boolean {
  const normalizedId = Number(String(config.id).trim())
  return Number.isFinite(normalizedId) && normalizedId > 0
}

/** 判断指定主页配置是否正在提交状态变更。 */
function isStatusSaving(config: HomepageConfigVO): boolean {
  return statusSavingIds.value.includes(String(config.id))
}

/** 切换主页配置启用状态，失败时恢复切换前的状态。 */
async function toggleConfigStatus(config: HomepageConfigVO, value: HomepageEnabledValue): Promise<void> {
  if (!isManagedConfig(config) || isStatusSaving(config)) return
  const id = String(config.id)
  const previous = normalizeEnabled(config.isEnabled)
  const next = normalizeEnabled(value)
  config.isEnabled = next
  statusSavingIds.value = [...statusSavingIds.value, id]
  try {
    await store.updateConfig(config.id, { isEnabled: next })
    ElMessage.success(next === 1 ? '主页配置已启用' : '主页配置已禁用')
  } catch (error) {
    config.isEnabled = previous
    ElMessage.error(error instanceof Error ? error.message : '状态更新失败，请稍后重试')
  } finally {
    statusSavingIds.value = statusSavingIds.value.filter((item) => item !== id)
  }
}

/** 清空并初始化主页配置表单。 */
function resetForm(config?: HomepageConfigVO): void {
  Object.assign(form, {
    description: config?.description || '',
    logoUrl: config?.logoUrl || '',
    imageUrl: [...(config?.imageUrl || [])],
    videoUrl: [...(config?.videoUrl || [])],
    coverUrl: [...(config?.coverUrl || [])],
    linkTarget: [...(config?.linkTarget || [])],
    bottomImageUrl: [...(config?.bottomImageUrl || [])],
    bottomLinkTarget: [...(config?.bottomLinkTarget || [])],
    bottomTitle: config?.bottomTitle || '',
    isEnabled: normalizeEnabled(config?.isEnabled),
  })
}

/** 打开新增或编辑弹窗。编辑操作只允许固定 ID 为 1 的配置。 */
function openForm(config?: HomepageConfigVO): void {
  editingId.value = config?.id ?? null
  resetForm(config)
  formVisible.value = true
}

/** 校验表单并调用新增或固定 ID 更新接口。 */
async function submitForm(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  try {
    if (editingId.value !== null) await store.updateConfig(editingId.value, { ...form })
    else await store.createConfig({ ...form })
    formVisible.value = false
    ElMessage.success('主页配置保存成功')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败，请稍后重试')
  }
}

/** 确认后删除固定 ID 为 1 的主页配置。 */
async function removeConfig(config: HomepageConfigVO): Promise<void> {
  try {
    await ElMessageBox.confirm(`将删除主页配置 ID ${config.id}，此操作为软删除，是否继续？`, '删除确认')
    await store.removeConfig(config.id)
    ElMessage.success('主页配置已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error instanceof Error ? error.message : '删除失败，请稍后重试')
    }
  }
}

/** 统一显示数组字段的数量和首项摘要。 */
function summarizeValues(values: string[]): string {
  if (!values.length) return '暂无'
  return values.length === 1 ? values[0] : `${values.length} 项：${values[0]}`
}

/** 在指定数组末尾新增一个可编辑项。 */
function addValue(field: 'imageUrl' | 'videoUrl' | 'coverUrl' | 'linkTarget'): void {
  form[field].push('')
}

/** 删除指定数组下标对应的表单项。 */
function removeValue(field: 'imageUrl' | 'videoUrl' | 'coverUrl' | 'linkTarget', index: number): void {
  form[field].splice(index, 1)
}

/** 判断上传文件是否为符合文档限制的图片或 MP4 视频。 */
function validateUpload(file: File, field: 'imageUrl' | 'videoUrl' | 'coverUrl'): string | null {
  const isVideo = field === 'videoUrl'
  const extension = file.name.toLowerCase().split('.').pop()
  if (isVideo && file.type !== 'video/mp4' && extension !== 'mp4') return '视频仅支持 MP4 格式'
  if (!isVideo && !file.type.startsWith('image/')) return '请上传图片文件'
  const maxSize = isVideo ? 50 : 10
  if (file.size > maxSize * 1024 * 1024) return `文件大小不能超过 ${maxSize}MB`
  return null
}

/** 上传文件成功后将 URL 追加到指定数组。 */
async function uploadFile(options: UploadRequestOptions, field: 'imageUrl' | 'videoUrl' | 'coverUrl'): Promise<void> {
  const file = options.file as File
  if ((field === 'imageUrl' || field === 'coverUrl') && form[field].length >= 5) {
    ElMessage.warning('最多上传5张图片')
    return
  }
  const validationMessage = validateUpload(file, field)
  if (validationMessage) {
    ElMessage.error(validationMessage)
    return
  }
  try {
    // 首屏轮播图统一裁剪到 750×960 后再上传，保证前端展示比例一致
    let target = file
    if (field === 'imageUrl') {
      target = await cropImageToSize(file, HERO_IMAGE_SIZE.width, HERO_IMAGE_SIZE.height)
    }
    form[field].push(await store.uploadFile(target))
    ElMessage.success('文件上传成功')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '文件上传失败')
  }
}

async function uploadImage(options: UploadRequestOptions): Promise<void> {
  await uploadFile(options, 'imageUrl')
}

/** 上传视频并写入视频地址字段。 */
async function uploadVideo(options: UploadRequestOptions): Promise<void> {
  await uploadFile(options, 'videoUrl')
}

/** 上传封面并写入封面地址字段。 */
async function uploadCover(options: UploadRequestOptions): Promise<void> {
  await uploadFile(options, 'coverUrl')
}

/** 上传品牌 logo（单个），写入 logoUrl 字段。 */
async function uploadLogo(options: UploadRequestOptions): Promise<void> {
  const file = options.file as File
  if (!file.type.startsWith('image/')) { ElMessage.error('请上传图片文件'); return }
  if (file.size > 10 * 1024 * 1024) { ElMessage.error('文件大小不能超过 10MB'); return }
  try {
    form.logoUrl = await store.uploadFile(file)
    ElMessage.success('logo 上传成功')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'logo 上传失败')
  }
}

/** 首次进入页面时加载真实主页配置。 */
onMounted(() => {
  store.loadConfigs().catch((error: unknown) => {
    ElMessage.error(error instanceof Error ? error.message : '主页配置加载失败')
  })
})
</script>

<template>
  <section class="page-container">
    <div class="page-heading">
      <div><h1>首屏与品牌</h1><p>管理商城首页媒体内容和跳转配置。</p></div>
      <div><el-button @click="store.loadConfigs">刷新</el-button><el-button type="primary" @click="openForm()">新增配置</el-button></div>
    </div>
    <el-card shadow="never" class="content-card">
      <el-table class="homepage-overview-table" v-loading="store.loading" :data="store.list" border table-layout="auto">
        <el-table-column prop="id" label="配置 ID" width="100" />
        <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip />
        <el-table-column label="图片" min-width="220">
          <template #default="{ row }">
            <div v-if="row.imageUrl.length" class="media-list">
              <el-image
                v-for="(url, index) in row.imageUrl"
                :key="`image-preview-${row.id}-${index}`"
                class="media-image"
                :src="url"
                :preview-src-list="row.imageUrl"
                :initial-index="index"
                fit="cover"
                preview-teleported
              />
            </div>
            <span v-else class="empty-media">暂无图片</span>
          </template>
        </el-table-column>
        <el-table-column label="视频" min-width="260">
          <template #default="{ row }">
            <div v-if="row.videoUrl.length" class="media-list media-list--column">
              <video v-for="(url, index) in row.videoUrl" :key="`video-preview-${row.id}-${index}`" class="media-video" :src="url" controls preload="metadata" />
            </div>
            <span v-else class="empty-media">暂无视频</span>
          </template>
        </el-table-column>
        <el-table-column label="视频封面" min-width="220">
          <template #default="{ row }">
            <div v-if="row.coverUrl.length" class="media-list">
              <el-image
                v-for="(url, index) in row.coverUrl"
                :key="`cover-preview-${row.id}-${index}`"
                class="media-image"
                :src="url"
                :preview-src-list="row.coverUrl"
                :initial-index="index"
                fit="cover"
                preview-teleported
              />
            </div>
            <span v-else class="empty-media">暂无封面</span>
          </template>
        </el-table-column>


        <el-table-column label="状态" width="100"><template #default="{ row }"><el-switch :model-value="normalizeEnabled(row.isEnabled) === 1" :loading="isStatusSaving(row)" :disabled="!isManagedConfig(row)" @change="toggleConfigStatus(row, $event)" /></template></el-table-column>
        <el-table-column label="操作" fixed="right" width="170"><template #default="{ row }"><div v-if="isManagedConfig(row)" class="operator-actions"><el-button size="small" type="primary" @click="openForm(row)"><el-icon><Edit /></el-icon>编辑</el-button><el-button size="small" type="danger" @click="removeConfig(row)"><el-icon><Delete /></el-icon>删除</el-button></div><span v-else class="readonly-text">只读</span></template></el-table-column>
      </el-table>
      <el-empty v-if="!store.loading && !store.list.length" description="暂无主页配置" />
    </el-card>

    <el-dialog v-model="formVisible" :title="editingId === null ? '新增主页配置' : `编辑主页配置（ID ${editingId}）`" width="680px" append-to-body>
      <el-form ref="formRef" class="homepage-config-form" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="配置描述" prop="description"><el-input v-model="form.description" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="品牌 logo"><div class="upload-block"><el-image v-if="form.logoUrl" :src="form.logoUrl" class="logo-preview" fit="contain" /><el-upload :show-file-list="false" :http-request="uploadLogo" accept="image/*"><el-button :loading="store.uploading">{{ form.logoUrl ? '重新上传' : '上传 logo' }}</el-button></el-upload><p class="upload-hint">建议尺寸 300×300px（正方形），小程序首页导航栏 logo</p></div></el-form-item>
        <el-form-item label="图片"><div class="upload-block"><ImageGridUpload v-model="form.imageUrl" :uploading="store.uploading" @upload="uploadImage" @remove="removeValue('imageUrl', $event)" /><p class="upload-hint">建议尺寸 750×960px（竖图），上传后自动裁剪为该尺寸</p></div></el-form-item>
        <el-form-item label="视频地址"><div v-for="(value, index) in form.videoUrl" :key="`video-${index}`" class="array-field"><el-input v-model="form.videoUrl[index]" /><el-button link type="danger" @click="removeValue('videoUrl', index)">删除</el-button></div><div class="array-actions"><el-upload :show-file-list="false" :http-request="uploadVideo" accept="video/mp4"><el-button :loading="store.uploading">上传 MP4</el-button></el-upload><el-button link type="primary" @click="addValue('videoUrl')">新增地址</el-button></div></el-form-item>
        <el-form-item label="视频封面"><ImageGridUpload v-model="form.coverUrl" :uploading="store.uploading" @upload="uploadCover" @remove="removeValue('coverUrl', $event)" /></el-form-item>
        <el-form-item label="跳转目标"><div v-for="(value, index) in form.linkTarget" :key="`link-${index}`" class="array-field"><el-input v-model="form.linkTarget[index]" placeholder="请输入小程序页面路径" /><el-button link type="danger" @click="removeValue('linkTarget', index)">删除</el-button></div><div class="array-actions"><el-button link type="primary" @click="addValue('linkTarget')">新增目标</el-button></div></el-form-item>
        <el-form-item label="启用状态"><el-switch v-model="form.isEnabled" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="formVisible = false">取消</el-button><el-button type="primary" :loading="store.saving" @click="submitForm">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
</style>

<style scoped>
.homepage-config-form .el-form-item__label { white-space: nowrap; }
.homepage-config-form .el-form-item__content { min-width: 0; }
.upload-block { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; width: 100%; }
.upload-hint { margin: 0; color: #909399; font-size: 12px; line-height: 1.5; }
.logo-preview { width: 56px; height: 56px; border: 1px solid var(--vben-border); border-radius: 8px; background: #fff; margin-bottom: 4px; }
.array-field { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; margin-bottom: 8px; }
.array-field .el-input { flex: 1 1 auto; min-width: 0; }
.array-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.homepage-overview-table :deep(.cell) { white-space: nowrap; word-break: keep-all; }
.homepage-overview-table :deep(.el-table__cell) { vertical-align: middle; }
.media-list { display: flex; flex-wrap: nowrap; gap: 8px; max-width: 100%; overflow-x: auto; }
.media-list--column { flex-direction: row; max-width: 260px; overflow-x: auto; }
.media-image { width: 72px; height: 48px; border-radius: 4px; }
.media-video { display: block; flex: 0 0 220px; width: 220px; max-height: 120px; border-radius: 4px; background: #111827; }
.empty-media { color: #9aa5b5; font-size: 13px; }
.readonly-text { color: #9aa5b5; font-size: 13px; }
</style>
