<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadRequestOptions } from 'element-plus'
import {
  createAdminGoodsBrand,
  deleteAdminGoodsBrand,
  getAdminGoodsBrandDetail,
  getAdminGoodsBrands,
  toggleAdminGoodsBrand,
  updateAdminGoodsBrand,
  uploadGoodsBrandLogo,
  type AdminGoodsBrand,
  type AdminGoodsBrandSaveDTO,
} from '@/api/brand'
import { getAdminCategories } from '@/api/category'
import type { AdminCategory } from '@/types/category'

/** 列表筛选条件。 */
const filters = reactive<{ keyword: string; categoryId: string | number; enabled: string | number }>({
  keyword: '',
  categoryId: '',
  enabled: '',
})

/** 列表数据与分页。 */
const list = ref<AdminGoodsBrand[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const loading = ref(false)

/** 归属大类选项（品牌挂在某个分类下，如「非遗老号」）。 */
const categoryOptions = ref<Array<{ id: number; name: string }>>([])
/** 分类 id → 名称，用于列表展示。 */
const categoryNameMap = computed(() => {
  const map = new Map<number, string>()
  categoryOptions.value.forEach((item) => map.set(item.id, item.name))
  return map
})

/** 编辑弹窗。 */
const dialogVisible = ref(false)
const saving = ref(false)
const uploading = ref(false)
const editingId = ref<number | null>(null)
const formRef = ref()
const form = reactive<AdminGoodsBrandSaveDTO>({
  name: '',
  logo: '',
  categoryId: null,
  sortOrder: 0,
  enabled: 1,
  description: '',
  remark: '',
})

/** 校验规则：品牌名称必填（后端全局唯一，重复会返回错误信息）。 */
const rules = { name: [{ required: true, message: '请输入品牌名称', trigger: 'blur' }] }

/** 递归收集分类选项（含子分类）。 */
function collectCategories(nodes: AdminCategory[], acc: Array<{ id: number; name: string }>, parent = ''): void {
  nodes.forEach((node) => {
    const id = Number(node.id)
    if (Number.isFinite(id) && node.name) acc.push({ id, name: parent ? `${parent} / ${node.name}` : node.name })
    if (node.children?.length) collectCategories(node.children, acc, node.name)
  })
}

/** 加载归属大类下拉数据。 */
async function loadCategories(): Promise<void> {
  try {
    const nodes = await getAdminCategories()
    const options: Array<{ id: number; name: string }> = []
    collectCategories(nodes, options)
    categoryOptions.value = options
  } catch {
    categoryOptions.value = []
  }
}

/** 拉取品牌分页列表。 */
async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await getAdminGoodsBrands({
      keyword: filters.keyword || undefined,
      categoryId: filters.categoryId === '' ? undefined : filters.categoryId,
      enabled: filters.enabled === '' ? undefined : filters.enabled,
      page: page.value,
      pageSize: pageSize.value,
    })
    list.value = result?.list || []
    total.value = result?.total || 0
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '品牌列表加载失败')
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/** 重置为第一页后查询。 */
function search(): void {
  page.value = 1
  void load()
}

/** 重置筛选条件。 */
function reset(): void {
  filters.keyword = ''
  filters.categoryId = ''
  filters.enabled = ''
  search()
}

/** 打开新增弹窗。 */
function openCreate(): void {
  editingId.value = null
  Object.assign(form, { name: '', logo: '', categoryId: null, sortOrder: 0, enabled: 1, description: '', remark: '' })
  dialogVisible.value = true
}

/** 打开编辑弹窗并回显详情。 */
async function openEdit(row: AdminGoodsBrand): Promise<void> {
  editingId.value = row.id
  try {
    const detail = await getAdminGoodsBrandDetail(row.id)
    Object.assign(form, {
      name: detail.name || '',
      logo: detail.logo || '',
      categoryId: detail.categoryId ?? null,
      sortOrder: detail.sortOrder ?? 0,
      enabled: detail.enabled ?? 1,
      description: detail.description || '',
      remark: detail.remark || '',
    })
    dialogVisible.value = true
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '品牌详情加载失败')
  }
}

/** 上传品牌 logo。 */
async function handleUpload(options: UploadRequestOptions): Promise<void> {
  const file = options.file as File
  if (!file.type.startsWith('image/')) { ElMessage.error('请上传图片'); return }
  if (file.size > 10 * 1024 * 1024) { ElMessage.error('图片不能超过 10MB'); return }
  uploading.value = true
  try {
    form.logo = await uploadGoodsBrandLogo(file)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'logo 上传失败')
  } finally {
    uploading.value = false
  }
}

/** 保存品牌（新增 / 修改）。 */
async function submit(): Promise<void> {
  if (!(await formRef.value?.validate().catch(() => false))) return
  saving.value = true
  try {
    const payload: AdminGoodsBrandSaveDTO = {
      name: form.name.trim(),
      logo: form.logo || '',
      categoryId: form.categoryId ?? null,
      sortOrder: Number(form.sortOrder) || 0,
      enabled: form.enabled ?? 1,
      description: form.description || '',
      remark: form.remark || '',
    }
    if (editingId.value) await updateAdminGoodsBrand(editingId.value, payload)
    else await createAdminGoodsBrand(payload)
    ElMessage.success(editingId.value ? '品牌修改成功' : '品牌创建成功')
    dialogVisible.value = false
    void load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '品牌保存失败')
  } finally {
    saving.value = false
  }
}

/** 启用 / 禁用品牌。 */
async function toggleEnabled(row: AdminGoodsBrand): Promise<void> {
  try {
    await toggleAdminGoodsBrand(row.id, row.enabled === 1 ? 0 : 1)
    ElMessage.success('品牌状态已更新')
    void load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '品牌状态修改失败')
  }
}

/** 删除品牌（软删，C 端品牌条不再返回）。 */
async function remove(row: AdminGoodsBrand): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除品牌「${row.name}」吗？删除后小程序品牌条不再显示该品牌。`, '删除确认')
    await deleteAdminGoodsBrand(row.id)
    ElMessage.success('品牌已删除')
    void load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error instanceof Error ? error.message : '品牌删除失败')
  }
}

onMounted(() => {
  void loadCategories()
  void load()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div>
        <h1>商品品牌</h1>
        <p>维护「非遗老号」等大类下的品牌（名称 + logo）。小程序品牌条按大类读取这里启用的品牌。</p>
      </div>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="search">
        <el-form-item label="品牌名称"><el-input v-model="filters.keyword" clearable placeholder="模糊搜索品牌名" /></el-form-item>
        <el-form-item label="归属大类">
          <el-select v-model="filters.categoryId" clearable placeholder="全部大类" style="width: 200px">
            <el-option v-for="c in categoryOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.enabled" clearable placeholder="全部" style="width: 120px">
            <el-option label="启用" :value="1" />
            <el-option label="禁用" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
          <el-button type="primary" plain @click="openCreate">+ 新增品牌</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="content-card">
      <el-table v-loading="loading" :data="list" border size="small">
        <el-table-column prop="id" label="品牌 ID" width="100" />
        <el-table-column label="Logo" width="90">
          <template #default="{ row }">
            <el-image v-if="row.logo" :src="row.logo" :preview-src-list="[row.logo]" fit="cover" class="brand-logo-thumb" preview-teleported />
            <span v-else class="muted">未配置</span>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="品牌名称" min-width="140" />
        <el-table-column label="归属大类" min-width="150">
          <template #default="{ row }">
            <span v-if="row.categoryId">{{ categoryNameMap.get(Number(row.categoryId)) || row.categoryId }}</span>
            <span v-else class="muted">未归类</span>
          </template>
        </el-table-column>
        <el-table-column prop="sortOrder" label="排序" width="80" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.enabled === 1 ? 'success' : 'info'">{{ row.enabled === 1 ? '启用' : '禁用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" link type="warning" @click="toggleEnabled(row)">{{ row.enabled === 1 ? '禁用' : '启用' }}</el-button>
            <el-button size="small" link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="(p: number) => { page = p; load() }"
          @size-change="(s: number) => { pageSize = s; page = 1; load() }"
        />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑品牌' : '新增品牌'" width="560px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px" size="small">
        <el-form-item label="品牌名称" prop="name"><el-input v-model="form.name" placeholder="如：海天（全局唯一）" /></el-form-item>
        <el-form-item label="Logo">
          <div class="array-row">
            <el-image v-if="form.logo" :src="form.logo" :preview-src-list="[form.logo]" fit="cover" class="brand-logo-thumb" preview-teleported />
            <el-upload :show-file-list="false" :http-request="handleUpload" accept="image/*">
              <el-button :loading="uploading">上传 Logo</el-button>
            </el-upload>
            <span class="muted">建议方形透明底图（品牌条圆形图标）</span>
          </div>
        </el-form-item>
        <el-form-item label="归属大类">
          <el-select v-model="form.categoryId" clearable placeholder="选择品牌归属的大类（如非遗老号）" style="width: 100%">
            <el-option v-for="c in categoryOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sortOrder" :min="0" :step="1" controls-position="right" /><span class="muted" style="margin-left: 8px">越小越靠前</span></el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" /></el-form-item>
        <el-form-item label="品牌简介"><el-input v-model="form.description" placeholder="对外展示（可选）" /></el-form-item>
        <el-form-item label="后台备注"><el-input v-model="form.remark" placeholder="仅后台可见（可选）" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.filter-card { margin-bottom: 16px; }
.content-card { margin-bottom: 16px; }
.brand-logo-thumb { width: 40px; height: 40px; border-radius: 50%; background: #f2f3f5; }
.array-row { display: flex; align-items: center; gap: 8px; }
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }
.muted { color: var(--vben-muted); font-size: 13px; }
</style>
