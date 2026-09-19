<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { useShopStore } from '@/stores/shop'
import { getMerchantShops, getMerchants } from '@/api/merchant'
import type { Shop } from '@/types/shop'
import type { ShopCreateDTO, ShopStatus } from '@/types/shop'
import { Delete, Edit, RefreshLeft } from '@element-plus/icons-vue'

const store = useShopStore()
const router = useRouter()
const selected = ref<Shop[]>([])
const deletableSelected = computed(() => selected.value.filter((shop) => shop.delFlag !== 1))
const restorableSelected = computed(() => selected.value.filter((shop) => shop.delFlag === 1))
const formVisible = ref(false)
const editingId = ref<string>()
const formRef = ref<FormInstance>()
const form = reactive<ShopCreateDTO>({ name: '', address: '', phone: '', merchantId: '' })
/**
 * 表单校验规则。
 * 「所属品牌」只在**新增**时必填 —— 漏选会让门店 `merchant_id` 为空，
 * 商家端商品管理会报 `7310 该门店未归属品牌商家`；
 * 编辑时留空表示「不传 merchantId = 不改归属」（契约见 `ShopUpdateDTO`）。
 */
const rules = computed<FormRules>(() => ({
  name: [{ required: true, message: '请输入门店名称', trigger: 'blur' }],
  address: [{ required: true, message: '请输入门店地址', trigger: 'blur' }],
  merchantId: editingId.value
    ? []
    : [{ required: true, message: '请选择所属品牌', trigger: 'change' }],
}))

// ===== 品牌（商户）维度 =====
/** 品牌下拉数据（`GET /api/admin/merchants/list`）。 */
const brandOptions = ref<Array<{ id: string; name: string }>>([])
/** 当前品牌筛选（空=全部品牌）。 */
const brandFilter = ref('')
/** 品牌筛选命中的门店（走 `GET /api/admin/merchants/{id}/shops`，服务端按品牌查全量）。 */
const brandShops = ref<Shop[]>([])
/** 是否处于"按品牌查看"模式。 */
const brandMode = computed(() => Boolean(brandFilter.value))
/** 表格数据：按品牌查看时用品牌下门店，否则用分页列表。 */
const visibleList = computed<Shop[]>(() => (brandMode.value ? brandShops.value : store.list))
/** 表格总数：按品牌查看时用品牌下门店数（该接口不分页，一次给全）。 */
const visibleTotal = computed(() => (brandMode.value ? brandShops.value.length : store.total))
/** 表格分页参数：按品牌查看时只有一页。 */
const visiblePage = computed(() => (brandMode.value ? 1 : store.page))
const visiblePageSize = computed(() => (brandMode.value ? Math.max(brandShops.value.length, 10) : store.pageSize))

/** 门店 → 品牌名（后端 ShopVO.merchantName；为空表示平台自营单店）。 */
function brandNameOf(shop: Shop): string {
  return shop.merchantName || (shop.merchantId ? `商户${shop.merchantId}` : '平台自营')
}

/** 加载品牌下拉（失败静默，不影响门店列表）。 */
async function loadBrands(): Promise<void> {
  try {
    const result = await getMerchants(1, 200)
    brandOptions.value = (result.list || []).map((item) => ({ id: String(item.id), name: item.brandName || `品牌${item.id}` }))
  } catch {
    brandOptions.value = []
  }
}

/** 切换品牌：选中品牌走品牌下门店接口（服务端全量），清空回到分页列表。 */
async function onBrandChange(): Promise<void> {
  selected.value = []
  if (!brandFilter.value) {
    brandShops.value = []
    void loadList()
    return
  }
  try {
    const list = (await getMerchantShops(brandFilter.value)) as Shop[]
    brandShops.value = list.map((shop) => ({ ...shop, id: String(shop.id || '') }))
  } catch (error) {
    brandShops.value = []
    ElMessage.error(error instanceof Error ? error.message : '品牌下门店查询失败')
  }
}

/** 清空并打开门店编辑表单（编辑时回显所属品牌，便于改归属）。 */
function openForm(shop?: Shop): void {
  editingId.value = shop?.id
  Object.assign(form, {
    name: shop?.name || '',
    address: shop?.address || '',
    phone: shop?.phone || '',
    // merchantId 为 null 表示平台自营单店 → 下拉按空串处理
    merchantId: shop?.merchantId ? String(shop.merchantId) : '',
  })
  formVisible.value = true
}

/** 校验并保存门店。 */
async function submitForm(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  try {
    // 编辑时「不传 merchantId = 不改归属」：只有真的选了品牌才带上，避免冲掉已有归属
    const payload: ShopCreateDTO = { name: form.name, address: form.address, phone: form.phone }
    if (form.merchantId) payload.merchantId = form.merchantId
    await store.save(editingId.value, payload)
    formVisible.value = false
    ElMessage.success(editingId.value ? '门店已更新' : '门店已新增')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '门店保存失败') }
}

/** 切换门店状态，失败时重新加载服务端状态。 */
async function changeStatus(shop: Shop, value: boolean | string | number): Promise<void> {
  const next: ShopStatus = value ? 1 : 0
  try {
    await ElMessageBox.confirm(`确认${next ? '启用' : '禁用'}门店“${shop.name}”吗？`, '门店状态确认')
    await store.setStatus(shop, next)
    ElMessage.success(next ? '门店已启用' : '门店已禁用')
  } catch (error) {
    shop.status = next ? 0 : 1
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '门店状态更新失败')
  }
}

/** 判断门店是否已经软删除。 */
function isDeleted(shop: Shop): boolean {
  return shop.delFlag === 1
}

/** 删除单个门店，并在确认后刷新列表。 */
async function removeShop(shop: Shop): Promise<void> {
  if (isDeleted(shop)) return
  try {
    await ElMessageBox.confirm(`确认删除门店“${shop.name}”吗？`, '删除门店确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    await store.remove(shop.id)
    selected.value = []
    ElMessage.success('门店已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '门店删除失败')
  }
}

/** 批量软删除当前页选中的正常门店。 */
async function removeSelected(): Promise<void> {
  if (!deletableSelected.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${deletableSelected.value.length} 个门店吗？`, '批量删除门店确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    const result = await store.removeBatch(deletableSelected.value.map((shop) => shop.id))
    selected.value = []
    if (result.failedIds.length) ElMessage.warning(`删除成功 ${result.successIds.length} 个，失败 ${result.failedIds.length} 个`)
    else ElMessage.success(`已删除 ${result.successIds.length} 个门店`)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}

/** 恢复单个已删除门店。 */
async function restoreShop(shop: Shop): Promise<void> {
  if (!isDeleted(shop)) return
  try {
    await ElMessageBox.confirm(`确认恢复门店“${shop.name}”吗？`, '恢复门店确认', { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' })
    await store.restore(shop.id)
    selected.value = []
    ElMessage.success('门店已恢复')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '门店恢复失败')
  }
}

/** 批量恢复当前页选中的已删除门店。 */
async function restoreSelected(): Promise<void> {
  if (!restorableSelected.value.length) return
  try {
    await ElMessageBox.confirm(`确认恢复选中的 ${restorableSelected.value.length} 个门店吗？`, '批量恢复门店确认', { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' })
    const result = await store.restoreBatch(restorableSelected.value.map((shop) => shop.id))
    selected.value = []
    if (result.failedIds.length) ElMessage.warning(`恢复成功 ${result.successIds.length} 个，失败 ${result.failedIds.length} 个`)
    else ElMessage.success(`已恢复 ${result.successIds.length} 个门店`)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量恢复失败')
  }
}

async function loadList(): Promise<void> {
  try { await store.fetchList() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '门店列表查询失败') }
}

/** 按关键词搜索门店（ID/名称），回车或点击触发；品牌模式下在品牌门店内过滤。 */
function searchShops(): void {
  store.page = 1
  if (brandMode.value) void onBrandChange()
  else void loadList()
}

/** 跳转「店员管理」并按本门店过滤（商户管理员查看本店人员/店长/骑手）。 */
function goStaff(shop: Shop): void {
  router.push({ path: '/staff', query: { shopId: shop.id, shopName: shop.name } })
}

onMounted(() => {
  void loadBrands()
  void loadList()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading"><div><h1>门店管理</h1><p>维护自提门店的基础信息和营业状态；列表按【所属品牌】展示，可切换品牌只看该品牌门店。</p></div><el-button type="primary" @click="openForm()">新增门店</el-button></div>
    <el-card shadow="never" class="content-card">
      <div class="toolbar"><div><strong>门店列表</strong><span class="toolbar-count">共 {{ visibleTotal }} 条</span></div><div class="toolbar-actions"><el-select v-model="brandFilter" clearable filterable placeholder="全部品牌" style="width: 200px" @change="onBrandChange"><el-option v-for="brand in brandOptions" :key="brand.id" :label="brand.name" :value="brand.id" /></el-select><el-input v-model="store.keyword" placeholder="门店ID/名称" clearable class="search-input" @keyup.enter="searchShops" @clear="searchShops" /><el-button type="primary" @click="searchShops">搜索</el-button><span v-if="selected.length" class="selection-tip">已选择 {{ selected.length }} 项</span><el-button size="small" type="danger" plain :disabled="!deletableSelected.length || store.actionLoading" :loading="store.actionLoading" @click="removeSelected"><el-icon><Delete /></el-icon>批量删除</el-button><el-button size="small" type="success" plain :disabled="!restorableSelected.length || store.actionLoading" :loading="store.actionLoading" @click="restoreSelected"><el-icon><RefreshLeft /></el-icon>批量恢复</el-button><el-button :loading="store.loading" @click="loadList">刷新</el-button></div></div>
      <p v-if="brandMode" class="muted brand-tip">按品牌查看：数据来自「品牌下门店」接口（该品牌全部门店，不分页）；要回到全部门店请清空品牌。</p>
      <DataTable :data="visibleList" :loading="store.loading" :total="visibleTotal" :page="visiblePage" :page-size="visiblePageSize" empty-text="暂无门店数据" @selection-change="selected = $event" @page-change="store.page = $event; selected = []; void loadList()" @size-change="store.pageSize = $event; store.page = 1; selected = []; void loadList()">
        <el-table-column label="所属品牌" min-width="170">
          <template #default="{ row }">
            <el-tag v-if="row.merchantName" type="warning" effect="light">{{ row.merchantName }}</el-tag>
            <el-tag v-else type="info" effect="plain">{{ brandNameOf(row) }}</el-tag>
            <span v-if="row.merchantId" class="muted brand-id">{{ row.merchantId }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="id" label="门店 ID" min-width="180" />
        <el-table-column prop="name" label="门店名称" min-width="180" />
        <el-table-column prop="address" label="地址" min-width="260" />
        <el-table-column prop="phone" label="联系电话" width="140" />
        <el-table-column label="人员（店长/骑手/已绑微信）" min-width="190">
          <template #default="{ row }">
            <span v-if="row.managerCount != null || row.riderCount != null || row.boundUserCount != null">
              {{ row.managerCount ?? 0 }} / {{ row.riderCount ?? 0 }} / {{ row.boundUserCount ?? 0 }}
            </span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag v-if="isDeleted(row)" type="info">已删除</el-tag><el-switch v-else :model-value="row.status === 1" :loading="store.actionLoading" @change="changeStatus(row, $event)" /></template></el-table-column>
        <el-table-column prop="createTime" label="创建时间" min-width="170" />
        <el-table-column label="操作" width="250" fixed="right"><template #default="{ row }"><div class="operator-actions"><el-button v-if="isDeleted(row)" size="small" type="success" :loading="store.actionLoading" @click="restoreShop(row)"><el-icon><RefreshLeft /></el-icon>恢复</el-button><template v-else><el-button size="small" @click="goStaff(row)">查看人员</el-button><el-button size="small" type="primary" @click="openForm(row)"><el-icon><Edit /></el-icon>编辑</el-button><el-button size="small" type="danger" :loading="store.actionLoading" @click="removeShop(row)"><el-icon><Delete /></el-icon>删除</el-button></template></div></template></el-table-column>
      </DataTable>
    </el-card>
    <el-dialog v-model="formVisible" :title="editingId ? '编辑门店' : '新增门店'" width="520px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px"><el-form-item label="所属品牌" prop="merchantId"><el-select v-model="form.merchantId" clearable filterable placeholder="请选择所属品牌" style="width: 100%"><el-option v-for="brand in brandOptions" :key="brand.id" :label="brand.name" :value="brand.id" /></el-select><div class="field-hint">品牌即入驻商户。漏选会让门店没有归属、商家端商品管理报 7310；编辑时留空 = 不改归属。</div></el-form-item><el-form-item label="门店名称" prop="name"><el-input v-model="form.name" /></el-form-item><el-form-item label="门店地址" prop="address"><el-input v-model="form.address" /></el-form-item><el-form-item label="联系电话" prop="phone"><el-input v-model="form.phone" /></el-form-item></el-form>
      <template #footer><el-button @click="formVisible = false">取消</el-button><el-button type="primary" :loading="store.saving" @click="submitForm">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; }
.search-input { width: 200px; }
.muted { color: var(--el-text-color-secondary); }
.selection-tip { color: var(--el-text-color-secondary); font-size: 13px; }
/* 品牌维度 */
.brand-tip { margin: 0 0 10px; font-size: 13px; }
.brand-id { margin-left: 6px; font-size: 12px; }
.field-hint { margin-top: 4px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
</style>
