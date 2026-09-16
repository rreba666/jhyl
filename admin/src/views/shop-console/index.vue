<script setup lang="ts">
/**
 * 店铺运营（商户管理员 / 平台）
 * - 营业设置：当前营业状态看板、手动营业/休息切换、一周营业时段、休店区间、提醒提前量
 * - 门店商品：本店上架状态 / 门店价 / 门店库存（只影响本店，不动商品本体）
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getBusinessSchedule,
  getBusinessStatus,
  getShopProducts,
  saveBusinessSchedule,
  setBusinessManual,
  setShopProductPrice,
  setShopProductStatus,
  setShopProductStock,
  type ShopBusinessStatusVO,
  type ShopProductVO,
} from '@/api/shop-console'
import { getEnabledShops } from '@/api/shop'
import type { Shop } from '@/types/shop'

const activeTab = ref('business')
/** 门店下拉数据（默认仅启用门店；勾选后含禁用门店）。 */
const shops = ref<Shop[]>([])
/** 是否包含已禁用门店（给禁用门店配营业时间 / 门店商品时勾选）。 */
const includeDisabled = ref(false)
/** 当前操作的门店（留空=后端按登录者的商户上下文解析；平台账号不传会报 1000）。 */
const shopId = ref('')

/** 周几文案。 */
const WEEK_LABELS: Record<string, string> = { '1': '周一', '2': '周二', '3': '周三', '4': '周四', '5': '周五', '6': '周六', '7': '周日' }

// ===== 营业状态 =====
const status = ref<ShopBusinessStatusVO | null>(null)
const statusLoading = ref(false)
const manualLoading = ref(false)

async function loadStatus(): Promise<void> {
  statusLoading.value = true
  try {
    status.value = await getBusinessStatus(shopId.value || undefined)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '营业状态查询失败')
  } finally {
    statusLoading.value = false
  }
}

/** 手动切换营业状态（OPEN 立即营业 / REST 立即休息 / AUTO 回到规则）。 */
async function manualAction(action: 'OPEN' | 'REST' | 'AUTO'): Promise<void> {
  const label = action === 'OPEN' ? '立即营业' : action === 'REST' ? '立即休息' : '回到规则自动推导'
  try {
    await ElMessageBox.confirm(`确认${label}？`, '营业状态确认', { type: 'warning' })
  } catch {
    return
  }
  manualLoading.value = true
  try {
    await setBusinessManual(action, shopId.value || undefined)
    ElMessage.success('已更新营业状态')
    await loadStatus()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '营业状态切换失败')
  } finally {
    manualLoading.value = false
  }
}

// ===== 营业时间配置 =====
/** 每天一行文本：`08:00-12:00,14:00-18:00`；留空 = 当天休息。 */
const weekInput = reactive<Record<string, string>>({ '1': '', '2': '', '3': '', '4': '', '5': '', '6': '', '7': '' })
const restRanges = ref<Array<{ name?: string; startDate: string; endDate: string }>>([])
const openRemindMinutes = ref(30)
const closeRemindMinutes = ref(15)
const scheduleLoading = ref(false)
const scheduleSaving = ref(false)
const hasConfig = ref(false)

/** 时段数组 → 文本。 */
function formatSegments(list: Array<{ start: string; end: string }> | undefined): string {
  return (list || []).map((item) => `${item.start}-${item.end}`).join(',')
}
/** 文本 → 时段数组（非法片段忽略）。 */
function parseSegments(text: string): Array<{ start: string; end: string }> {
  return String(text || '')
    .split(',')
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const [start, end] = piece.split('-').map((item) => item.trim())
      return { start: start || '', end: end || '' }
    })
    .filter((item) => /^\d{1,2}:\d{2}$/.test(item.start) && /^\d{1,2}:\d{2}$/.test(item.end))
}

async function loadSchedule(): Promise<void> {
  scheduleLoading.value = true
  try {
    const config = await getBusinessSchedule(shopId.value || undefined)
    hasConfig.value = Boolean(config?.hasConfig)
    Object.keys(WEEK_LABELS).forEach((day) => { weekInput[day] = formatSegments(config?.week?.[day]) })
    restRanges.value = (config?.restRanges || []).map((item) => ({ ...item }))
    openRemindMinutes.value = config?.openRemindMinutes ?? 30
    closeRemindMinutes.value = config?.closeRemindMinutes ?? 15
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '营业时间查询失败')
  } finally {
    scheduleLoading.value = false
  }
}

function addRestRange(): void {
  restRanges.value.push({ name: '', startDate: '', endDate: '' })
}
function removeRestRange(index: number): void {
  restRanges.value.splice(index, 1)
}

async function submitSchedule(): Promise<void> {
  const week: Record<string, Array<{ start: string; end: string }>> = {}
  Object.keys(WEEK_LABELS).forEach((day) => { week[day] = parseSegments(weekInput[day]) })
  const invalid = Object.entries(restRanges.value).find(([, item]) => !item.startDate || !item.endDate)
  if (invalid) {
    ElMessage.warning('休店区间需要填写开始与结束日期')
    return
  }
  scheduleSaving.value = true
  try {
    await saveBusinessSchedule(shopId.value || undefined, {
      week,
      restRanges: restRanges.value.filter((item) => item.startDate && item.endDate),
      manualMode: status.value?.manualMode || 'AUTO',
      openRemindMinutes: openRemindMinutes.value,
      closeRemindMinutes: closeRemindMinutes.value,
    })
    ElMessage.success('营业时间已保存')
    await Promise.all([loadStatus(), loadSchedule()])
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '营业时间保存失败')
  } finally {
    scheduleSaving.value = false
  }
}

// ===== 门店商品 =====
const productFilters = reactive<{ keyword: string; status: string }>({ keyword: '', status: '' })
const products = ref<ShopProductVO[]>([])
const productTotal = ref(0)
const page = ref(1)
const pageSize = ref(10)
const productLoading = ref(false)

async function loadProducts(): Promise<void> {
  productLoading.value = true
  try {
    const result = await getShopProducts({
      shopId: shopId.value || undefined,
      keyword: productFilters.keyword,
      status: productFilters.status,
      page: page.value,
      pageSize: pageSize.value,
    })
    products.value = result.list
    productTotal.value = result.total
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '门店商品查询失败')
    products.value = []
    productTotal.value = 0
  } finally {
    productLoading.value = false
  }
}

function searchProducts(): void {
  page.value = 1
  void loadProducts()
}

// ===== 改价 / 改库存 =====
const priceDialogVisible = ref(false)
const priceSaving = ref(false)
const priceForm = reactive<{ product: ShopProductVO | null; price: number | null; useDefault: boolean }>({ product: null, price: null, useDefault: true })
const stockDialogVisible = ref(false)
const stockSaving = ref(false)
const stockForm = reactive<{ product: ShopProductVO | null; stock: number | null; useDefault: boolean }>({ product: null, stock: null, useDefault: true })

function openPriceDialog(row: ShopProductVO): void {
  priceForm.product = row
  priceForm.useDefault = row.shopPrice == null
  priceForm.price = row.shopPrice ?? row.minPrice ?? 0
  priceDialogVisible.value = true
}

async function submitPrice(): Promise<void> {
  if (!priceForm.product?.productId) return
  priceSaving.value = true
  try {
    await setShopProductPrice(priceForm.product.productId, priceForm.useDefault ? null : Number(priceForm.price), shopId.value || undefined)
    ElMessage.success(priceForm.useDefault ? '已恢复使用品牌价' : '门店价已保存')
    priceDialogVisible.value = false
    await loadProducts()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '门店价保存失败')
  } finally {
    priceSaving.value = false
  }
}

function openStockDialog(row: ShopProductVO): void {
  stockForm.product = row
  stockForm.useDefault = row.shopStock == null
  stockForm.stock = row.shopStock ?? row.totalStock ?? 0
  stockDialogVisible.value = true
}

async function submitStock(): Promise<void> {
  if (!stockForm.product?.productId) return
  stockSaving.value = true
  try {
    await setShopProductStock(stockForm.product.productId, stockForm.useDefault ? null : Number(stockForm.stock), shopId.value || undefined)
    ElMessage.success(stockForm.useDefault ? '已恢复使用商品总库存' : '门店库存已保存')
    stockDialogVisible.value = false
    await loadProducts()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '门店库存保存失败')
  } finally {
    stockSaving.value = false
  }
}

/** 本店上架 / 下架（只影响本店）。 */
async function toggleShopStatus(row: ShopProductVO, value: boolean | string | number): Promise<void> {
  if (!row.productId) return
  const next: 0 | 1 = value ? 1 : 0
  try {
    await setShopProductStatus(row.productId, next, shopId.value || undefined)
    row.shopStatus = next
    ElMessage.success(next ? '本店已上架' : '本店已下架')
  } catch (error) {
    row.shopStatus = next ? 0 : 1
    ElMessage.error(error instanceof Error ? error.message : '本店上下架失败')
  }
}

/** 门店价展示文案。 */
function priceText(row: ShopProductVO): string {
  if (row.shopPrice == null) return '用品牌价'
  return `¥ ${Number(row.shopPrice).toFixed(2)}`
}
/** 门店库存展示文案。 */
function stockText(row: ShopProductVO): string {
  if (row.shopStock == null) return '用总库存'
  return String(row.shopStock)
}

/** 店铺 ID 变化：重新拉营业与商品（留空=后端默认门店）。 */
function reloadAll(): void {
  page.value = 1
  void Promise.all([loadStatus(), loadSchedule(), loadProducts()])
}

const statusTagType = computed(() => (status.value?.status === 'OPEN' ? 'success' : 'info'))
const statusText = computed(() => (status.value?.status === 'OPEN' ? '营业中' : '休息中'))
/** 手动模式中文（OPEN 手动营业 / REST 手动休息 / AUTO 按规则自动推导）。 */
const manualModeText = computed(() => {
  const mode = String(status.value?.manualMode || '').trim()
  if (mode === 'OPEN') return '手动营业'
  if (mode === 'REST') return '手动休息'
  if (mode === 'AUTO') return '按规则自动'
  return '—'
})

/** 拉取门店下拉；未选门店时默认选中第一个（平台账号不传 shopId 会返回 1000）。 */
async function loadShops(): Promise<void> {
  try {
    shops.value = await getEnabledShops(includeDisabled.value)
  } catch {
    shops.value = []
  }
  if (!shopId.value && shops.value.length) shopId.value = String(shops.value[0].id)
}

/** 勾选/取消「含禁用门店」后重新拉取下拉并刷新数据。 */
async function onIncludeDisabledChange(): Promise<void> {
  await loadShops()
  reloadAll()
}

onMounted(async () => {
  await loadShops()
  reloadAll()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div>
        <h1>店铺运营</h1>
        <p>营业状态与时间、门店商品（门店价 / 门店库存 / 本店上下架）——只影响本店，不改动商品本体。</p>
      </div>
      <div class="heading-actions">
        <span class="muted">门店</span>
        <el-select v-model="shopId" clearable placeholder="请选择门店" style="width: 200px" @change="reloadAll">
          <el-option v-for="shop in shops" :key="shop.id" :label="shop.name" :value="shop.id" />
        </el-select>
        <el-checkbox v-model="includeDisabled" @change="onIncludeDisabledChange">含禁用门店</el-checkbox>
        <el-button @click="reloadAll">刷新</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab">
      <!-- 营业设置 -->
      <el-tab-pane label="营业设置" name="business">
        <el-card shadow="never" class="content-card" v-loading="statusLoading">
          <div class="status-row">
            <el-tag :type="statusTagType" size="large">{{ statusText }}</el-tag>
            <span class="muted">手动模式：{{ manualModeText }}</span>
            <span class="muted">今日时段：{{ status?.todayText || (status?.hasConfig ? '今日休息' : '全天营业') }}</span>
            <span class="muted">下次开店：{{ status?.nextOpenTime || '—' }}</span>
            <span class="muted">已配置营业时间：{{ status?.hasConfig ? '是' : '否' }}</span>
          </div>
          <div class="action-row">
            <el-button type="success" :loading="manualLoading" @click="manualAction('OPEN')">立即营业</el-button>
            <el-button type="warning" :loading="manualLoading" @click="manualAction('REST')">立即休息</el-button>
            <el-button :loading="manualLoading" @click="manualAction('AUTO')">回到规则自动</el-button>
          </div>
        </el-card>

        <el-card shadow="never" class="content-card" v-loading="scheduleLoading">
          <div class="toolbar"><strong>营业时间（每周）</strong><span class="muted">格式：08:00-12:00,14:00-18:00；留空表示当天休息</span></div>
          <div class="week-grid">
            <div v-for="(label, day) in WEEK_LABELS" :key="day" class="week-row">
              <span class="week-label">{{ label }}</span>
              <el-input v-model="weekInput[day]" :placeholder="'如 08:00-12:00,14:00-18:00（留空=休息）'" />
            </div>
          </div>

          <el-divider>休店区间（含边界，整天休）</el-divider>
          <el-table :data="restRanges" border size="small">
            <el-table-column label="名称" width="180"><template #default="{ row }"><el-input v-model="row.name" placeholder="如：中秋节" /></template></el-table-column>
            <el-table-column label="开始日期" width="200"><template #default="{ row }"><el-date-picker v-model="row.startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始" style="width: 100%" /></template></el-table-column>
            <el-table-column label="结束日期" width="200"><template #default="{ row }"><el-date-picker v-model="row.endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束" style="width: 100%" /></template></el-table-column>
            <el-table-column label="操作" width="90"><template #default="{ $index }"><el-button size="small" type="danger" link @click="removeRestRange($index)">删除</el-button></template></el-table-column>
          </el-table>
          <el-button link type="primary" @click="addRestRange">+ 添加休店区间</el-button>

          <el-divider>提醒设置</el-divider>
          <el-form label-width="150px" size="small" class="remind-form">
            <el-form-item label="开店提前提醒（分钟）"><el-input-number v-model="openRemindMinutes" :min="0" :max="600" controls-position="right" /><span class="muted">0 = 关闭提醒</span></el-form-item>
            <el-form-item label="打烊提前提醒（分钟）"><el-input-number v-model="closeRemindMinutes" :min="0" :max="600" controls-position="right" /><span class="muted">0 = 关闭提醒</span></el-form-item>
          </el-form>

          <el-button type="primary" :loading="scheduleSaving" @click="submitSchedule">保存营业时间</el-button>
        </el-card>
      </el-tab-pane>

      <!-- 门店商品 -->
      <el-tab-pane label="门店商品" name="products">
        <el-card shadow="never" class="content-card">
          <el-form inline @submit.prevent="searchProducts">
            <el-form-item label="关键词"><el-input v-model="productFilters.keyword" clearable placeholder="商品名称" style="width: 180px" /></el-form-item>
            <el-form-item label="本店状态">
              <el-select v-model="productFilters.status" clearable placeholder="全部" style="width: 140px">
                <el-option label="本店已上架" :value="1" /><el-option label="本店未上架" :value="0" />
              </el-select>
            </el-form-item>
            <el-form-item><el-button type="primary" :loading="productLoading" @click="searchProducts">查询</el-button></el-form-item>
          </el-form>

          <el-table v-loading="productLoading" :data="products" border size="small">
            <el-table-column label="主图" width="80"><template #default="{ row }"><el-image v-if="row.mainImage" :src="row.mainImage" :preview-src-list="[row.mainImage]" fit="cover" class="thumb" preview-teleported /></template></el-table-column>
            <el-table-column prop="name" label="商品名称" min-width="180" />
            <el-table-column label="品牌价" width="120"><template #default="{ row }">¥ {{ Number(row.minPrice || 0).toFixed(2) }}<span v-if="row.maxPrice && row.maxPrice !== row.minPrice"> ~ {{ Number(row.maxPrice).toFixed(2) }}</span></template></el-table-column>
            <el-table-column label="门店价" width="130"><template #default="{ row }"><span :class="{ muted: row.shopPrice == null }">{{ priceText(row) }}</span></template></el-table-column>
            <el-table-column prop="totalStock" label="总库存" width="100" />
            <el-table-column label="门店库存" width="120"><template #default="{ row }"><span :class="{ muted: row.shopStock == null }">{{ stockText(row) }}</span></template></el-table-column>
            <el-table-column label="商品全局" width="110"><template #default="{ row }"><el-tag :type="row.productStatus === 1 ? 'success' : 'info'" size="small">{{ row.productStatus === 1 ? '上架' : '下架' }}</el-tag></template></el-table-column>
            <el-table-column label="本店状态" width="110"><template #default="{ row }"><el-switch :model-value="row.shopStatus === 1" @change="toggleShopStatus(row, $event)" /></template></el-table-column>
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="openPriceDialog(row)">改门店价</el-button>
                <el-button size="small" @click="openStockDialog(row)">改门店库存</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination :current-page="page" :page-size="pageSize" :total="productTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="(p: number) => { page = p; loadProducts() }" @size-change="(s: number) => { pageSize = s; page = 1; loadProducts() }" />
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 改门店价 -->
    <el-dialog v-model="priceDialogVisible" title="设置门店价" width="460px" append-to-body>
      <el-form label-width="120px" size="small">
        <el-form-item label="商品">{{ priceForm.product?.name }}</el-form-item>
        <el-form-item label="品牌价">¥ {{ Number(priceForm.product?.minPrice || 0).toFixed(2) }}</el-form-item>
        <el-form-item label="使用品牌价"><el-switch v-model="priceForm.useDefault" /></el-form-item>
        <el-form-item v-if="!priceForm.useDefault" label="门店价"><el-input-number v-model="priceForm.price" :min="0" :precision="2" :step="0.1" controls-position="right" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="priceDialogVisible = false">取消</el-button><el-button type="primary" :loading="priceSaving" @click="submitPrice">保存</el-button></template>
    </el-dialog>

    <!-- 改门店库存 -->
    <el-dialog v-model="stockDialogVisible" title="设置门店库存" width="460px" append-to-body>
      <el-form label-width="120px" size="small">
        <el-form-item label="商品">{{ stockForm.product?.name }}</el-form-item>
        <el-form-item label="商品总库存">{{ stockForm.product?.totalStock ?? '—' }}</el-form-item>
        <el-form-item label="使用总库存"><el-switch v-model="stockForm.useDefault" /></el-form-item>
        <el-form-item v-if="!stockForm.useDefault" label="门店库存"><el-input-number v-model="stockForm.stock" :min="0" :step="1" controls-position="right" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="stockDialogVisible = false">取消</el-button><el-button type="primary" :loading="stockSaving" @click="submitStock">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.heading-actions { display: flex; align-items: center; gap: 10px; }
.content-card { margin-bottom: 16px; }
.status-row { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-bottom: 16px; }
.action-row { display: flex; gap: 10px; }
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.week-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px 20px; margin-bottom: 8px; }
.week-row { display: flex; align-items: center; gap: 12px; }
.week-label { width: 48px; flex-shrink: 0; color: var(--vben-text); font-size: 14px; }
.remind-form { margin-bottom: 8px; }
.remind-form :deep(.el-form-item) { margin-bottom: 12px; }
.thumb { width: 44px; height: 44px; border-radius: 6px; background: #f2f3f5; }
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }
.muted { color: var(--vben-muted); font-size: 13px; margin-left: 8px; }
@media (max-width: 1000px) { .week-grid { grid-template-columns: 1fr; } }
</style>
