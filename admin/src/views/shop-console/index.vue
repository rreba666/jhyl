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
  getShopSkuPrices,
  saveBusinessSchedule,
  setBusinessManual,
  setShopProductPrice,
  setShopProductStatus,
  setShopProductStock,
  setShopSkuBatch,
  type ShopBusinessStatusVO,
  type ShopProductVO,
  type ShopSkuBatchItem,
  type ShopSkuPriceVO,
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

// ===== 门店 SKU 级设价 / 设库存（2026-10-08 新增）=====
/**
 * 多规格商品**必须**按规格设价/设库存 —— SPU 级入口（上面那两个弹窗）对多规格商品
 * 只能"统一作用于全部规格"，在多规格下是**不准确**的（例：500g ¥39 / 1kg ¥69 只能填一个值）。
 * ⚠️ 单规格商品**不显示**该入口（用 SPU 级就够，避免多余弹窗）。
 */
function isMultiSku(row: ShopProductVO): boolean {
  return Number(row.skuCount ?? 0) > 1
}

/** 弹窗内的一行：契约字段 + 本行编辑态（单独拷一份，不直接改列表数据）。 */
interface SkuEditRow extends ShopSkuPriceVO {
  editingPrice: number | null
  editingStock: number | null
  /** true = 本店不单独设价，跟随上一级（提交时传 null 清除 SKU 级设置）。 */
  usePriceDefault: boolean
  /** true = 本店不单独设库存，跟随上一级。 */
  useStockDefault: boolean
}

const skuDialogVisible = ref(false)
const skuLoading = ref(false)
/** 正在保存的**规格行**（按行 loading，避免"整表一起转"）。 */
const savingSkuId = ref<number | null>(null)
/** 底部「全部保存」整体提交中（一次批量请求；与按行 loading 分开）。 */
const skuAllSaving = ref(false)
/** 当前弹窗对应的商品。 */
const skuProduct = ref<ShopProductVO | null>(null)
const skuRows = ref<SkuEditRow[]>([])

/** 把契约行转成编辑行（null = 该级未设置 ⇒ 开关打开 = 用上一级；不要当成 0）。 */
function toEditRow(item: ShopSkuPriceVO): SkuEditRow {
  return {
    ...item,
    usePriceDefault: item.skuShopPrice == null,
    useStockDefault: item.skuShopStock == null,
    editingPrice: item.skuShopPrice ?? item.price ?? item.brandPrice ?? 0,
    editingStock: item.skuShopStock ?? item.stock ?? 0,
  }
}

/** 打开「按规格设价/设库存」弹窗：拉该店该商品各规格的生效价与来源。 */
async function openSkuDialog(row: ShopProductVO): Promise<void> {
  if (!row.productId) return
  skuProduct.value = row
  skuRows.value = []
  skuDialogVisible.value = true
  skuLoading.value = true
  try {
    const list = await getShopSkuPrices(row.productId, shopId.value || undefined)
    skuRows.value = list.map(toEditRow)
    if (!list.length) ElMessage.info('该商品暂无可设置的规格')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '规格查询失败')
  } finally {
    skuLoading.value = false
  }
}

/** 生效价来源文案（三级回退；`NONE` / 未知一律「—」，⛔ 不兜底成假数字）。 */
const PRICE_SOURCE_TEXT: Record<string, string> = { SKU: '按规格设价', SHOP: '按商品设价', PRODUCT: '商品原价' }
/** 生效库存来源文案（三级回退；`NONE` / 未知一律「—」）。 */
const STOCK_SOURCE_TEXT: Record<string, string> = { SKU: '按规格控', SHOP: '按商品控', PRODUCT: '商品总库存' }
function priceSourceText(source?: string): string {
  return (source && PRICE_SOURCE_TEXT[source]) || '—'
}
function stockSourceText(source?: string): string {
  return (source && STOCK_SOURCE_TEXT[source]) || '—'
}

/**
 * 「用上一级」实际跟到哪一级（对齐单 §四：`spuShopPrice` / `spuShopStock` 也要能看到，
 * 否则"用上一级"跟到商品级还是商品原价不透明）。
 * 拿不到就显示「—」—— ⛔ 不兜底成 0。
 */
function upperPriceText(row: SkuEditRow): string {
  if (row.spuShopPrice != null) return `商品级 ¥ ${Number(row.spuShopPrice).toFixed(2)}`
  if (row.brandPrice != null) return `商品原价 ¥ ${Number(row.brandPrice).toFixed(2)}`
  return '—'
}
function upperStockText(row: SkuEditRow): string {
  if (row.spuShopStock != null) return `商品级 ${row.spuShopStock}`
  if (row.brandStock != null) return `商品原价库存 ${row.brandStock}`
  return '—'
}

/**
 * 金额展示：**缺失 / 非法一律「—」**，⛔ 不用 `Number(x || 0)` 兜底成 ¥0.00。
 * 依据：CLAUDE.md §15.4 已登记「后台列表资金金额**不兜底假数字**」——
 * 后端漏字段/改名时渲染 ¥0.00，运营会照假数字对账（同 §15.3 #1）。
 */
function moneyText(value?: number | null): string {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  return Number.isFinite(num) ? `¥ ${num.toFixed(2)}` : '—'
}

/**
 * 编辑行 → 批量端点的一行（W8 §3.2）。
 * ⚠️ **两个字段都带**：批量端点每行都会应用 `price` 与 `stock`；
 *    `usePriceDefault`（跟随上一级）⇒ 传 `null`（**清除**该级设置、回退上一级），⛔ 不是 `0`（`0` 是"设成 0"）。
 */
function toBatchItem(row: SkuEditRow): ShopSkuBatchItem {
  return {
    skuId: row.skuId,
    price: row.usePriceDefault ? null : Number(row.editingPrice),
    stock: row.useStockDefault ? null : Number(row.editingStock),
  }
}

/** 本行相对后端 SKU 级现值是否真的改动过（未改动的行**不提交**，少写就少失败面）。 */
function isRowChanged(row: SkuEditRow): boolean {
  const nextPrice = row.usePriceDefault ? null : Number(row.editingPrice)
  const nextStock = row.useStockDefault ? null : Number(row.editingStock)
  return (row.skuShopPrice ?? null) !== nextPrice || (row.skuShopStock ?? null) !== nextStock
}

/**
 * 提交前的整体校验：**任一行不合法 ⇒ 一个请求都不发**。
 * （批量端点本身是单事务 —— 后端也会整批回滚；本地先拦一道只是为了不让用户白等一次往返。）
 */
function findSkuRowError(): string | null {
  for (const row of skuRows.value) {
    const label = row.skuName || row.skuId
    if (!row.usePriceDefault) {
      const price = Number(row.editingPrice)
      if (!Number.isFinite(price) || price < 0) return `规格「${label}」的门店价填写有误`
    }
    if (!row.useStockDefault) {
      const stock = Number(row.editingStock)
      if (!Number.isInteger(stock) || stock < 0) return `规格「${label}」的门店库存需为非负整数`
    }
  }
  return null
}

/**
 * 整表重拉规格（**只在批量提交成功后调用**，W8 §3.5「成功后重新拉 `GET …/skus` 刷新回显」）。
 * ⚠️ 批量成功后所有改动都已落库 ⇒ 重拉是安全的；按行保存路径**不得**整表重拉
 *    （会静默丢弃其它行未保存的编辑），那条路径用 {@link reloadSkuRow}。
 */
async function reloadSkuList(): Promise<void> {
  const productId = skuProduct.value?.productId
  if (!productId) return
  const list = await getShopSkuPrices(productId, shopId.value || undefined)
  skuRows.value = list.map(toEditRow)
}

/**
 * 保存**单个规格**（按行内联编辑）。
 *
 * ⚠️ 也走**批量端点、一次请求**同时落价与库存 —— 单规格端点连调两次会出现
 *   "价已落库、库存失败"的半保存（W8 §3.3 要求删掉的正是那套半保存提示与逐行重试）。
 * ⚠️ 保存后**只刷新本行**（不整表重拉）—— 整表重拉会**静默丢弃其它行未保存的编辑**。
 */
async function saveSkuRow(row: SkuEditRow): Promise<void> {
  const productId = skuProduct.value?.productId
  if (!productId) return
  const nextPrice = row.usePriceDefault ? null : Number(row.editingPrice)
  const nextStock = row.useStockDefault ? null : Number(row.editingStock)
  const priceChanged = (row.skuShopPrice ?? null) !== nextPrice
  const stockChanged = (row.skuShopStock ?? null) !== nextStock
  if (!priceChanged && !stockChanged) {
    ElMessage.info('本行没有改动')
    return
  }
  savingSkuId.value = row.skuId
  try {
    await setShopSkuBatch(productId, [toBatchItem(row)], shopId.value || undefined)
    ElMessage.success(`规格「${row.skuName || row.skuId}」已保存`)
    await reloadSkuRow(row)
  } catch (error) {
    // ⚠️ 一次请求 = 单事务：失败即**整行都没落库**，无需（也不许）再说"半保存"
    ElMessage.error(error instanceof Error ? error.message : '规格保存失败')
  } finally {
    savingSkuId.value = null
  }
}

/**
 * 底部「全部保存」：所有改动行**一次批量请求**搞定（W8 §3.5）。
 *
 * 背景：原先逐规格调单端点，`N` 个规格要 `N × 2` 次请求（3 规格 6 次、10 规格 20 次），
 * 第 7 次失败时前 6 次**已落库** ⇒ 半保存。批量端点是**单事务**：任一行不合法（规格不存在 /
 * 不属于该商品，`1002`）⇒ **整批回滚**，不会出现"前 N 个规格已保存成功"。
 */
async function submitSkuAll(): Promise<void> {
  const productId = skuProduct.value?.productId
  if (!productId) return
  const invalid = findSkuRowError()
  if (invalid) {
    ElMessage.warning(invalid)
    return
  }
  // ⚠️ 每行都带上**两个**字段（批量端点逐行应用 price + stock）—— 只改价时也带当前期望库存
  const items = skuRows.value.filter(isRowChanged).map(toBatchItem)
  if (!items.length) {
    ElMessage.info('没有改动')
    return
  }
  skuAllSaving.value = true
  try {
    await setShopSkuBatch(productId, items, shopId.value || undefined)
    ElMessage.success('已保存')
    await reloadSkuList()
    await loadProducts()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '规格保存失败')
  } finally {
    skuAllSaving.value = false
  }
}

/**
 * 只把**本行**的后端真实结果合并回来（生效价/生效库存/来源由后端三级回退算出，不本地猜），
 * 其它行**保持原编辑态**（不整表重拉）。
 */
async function reloadSkuRow(row: SkuEditRow): Promise<void> {
  const productId = skuProduct.value?.productId
  if (!productId) return
  const list = await getShopSkuPrices(productId, shopId.value || undefined)
  const fresh = list.find((item) => item.skuId === row.skuId)
  if (!fresh) return
  Object.assign(row, toEditRow(fresh))
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
            <el-table-column label="操作" width="300" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="openPriceDialog(row)">改门店价</el-button>
                <el-button size="small" @click="openStockDialog(row)">改门店库存</el-button>
                <!-- ⚠️ 只有多规格商品才显示：SPU 级改价/改库存对多规格是"统一作用于全部规格"，不准确 -->
                <el-button v-if="isMultiSku(row)" size="small" type="primary" plain @click="openSkuDialog(row)">按规格设价</el-button>
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

    <!-- 按规格设价 / 设库存（多规格商品；SKU 级，2026-10-08 新增） -->
    <el-dialog v-model="skuDialogVisible" title="按规格设价 / 设库存" width="1100px" append-to-body>
      <div class="sku-tip">
        商品：{{ skuProduct?.name }}（共 {{ skuRows.length }} 个规格）。
        「生效价 / 生效库存」是按 <strong>规格 → 商品 → 商品原价</strong> 三级回退算出的最终值；
        开关打开 = 本店不单独设置、跟随上一级（「上一级」列显示实际会跟到哪一级）。
        <br />
        「全部保存」把改动过的规格<strong>一次性提交</strong>（一次请求、单事务：任一行不合法则整批不落库）；也可用行尾「保存」只提交本行。
      </div>
      <el-table v-loading="skuLoading" :data="skuRows" border size="small" row-key="skuId">
        <el-table-column prop="skuName" label="规格" min-width="120" />
        <el-table-column label="商品原价" width="100"><template #default="{ row }">{{ moneyText(row.brandPrice) }}</template></el-table-column>
        <el-table-column label="价用上一级" width="95"><template #default="{ row }"><el-switch v-model="row.usePriceDefault" size="small" /></template></el-table-column>
        <el-table-column label="上一级（价）" width="130"><template #default="{ row }"><span class="muted">{{ row.usePriceDefault ? upperPriceText(row) : '—' }}</span></template></el-table-column>
        <el-table-column label="门店价" width="150">
          <template #default="{ row }">
            <el-input-number v-if="!row.usePriceDefault" v-model="row.editingPrice" :min="0" :precision="2" :step="0.1" size="small" controls-position="right" />
            <span v-else class="muted">跟随上一级</span>
          </template>
        </el-table-column>
        <el-table-column label="生效价" width="150">
          <template #default="{ row }">{{ moneyText(row.price) }}<span class="muted">{{ priceSourceText(row.priceSource) }}</span></template>
        </el-table-column>
        <el-table-column label="库存用上一级" width="105"><template #default="{ row }"><el-switch v-model="row.useStockDefault" size="small" /></template></el-table-column>
        <el-table-column label="上一级（库存）" width="130"><template #default="{ row }"><span class="muted">{{ row.useStockDefault ? upperStockText(row) : '—' }}</span></template></el-table-column>
        <el-table-column label="门店库存" width="140">
          <template #default="{ row }">
            <el-input-number v-if="!row.useStockDefault" v-model="row.editingStock" :min="0" :step="1" size="small" controls-position="right" />
            <span v-else class="muted">跟随上一级</span>
          </template>
        </el-table-column>
        <el-table-column label="生效库存" width="160">
          <template #default="{ row }">{{ row.stock ?? '—' }}<span class="muted">{{ stockSourceText(row.stockSource) }}</span></template>
        </el-table-column>
        <el-table-column label="可售" width="80"><template #default="{ row }">{{ row.effectiveStock ?? '—' }}</template></el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }"><el-button size="small" type="primary" :loading="savingSkuId === row.skuId" @click="saveSkuRow(row)">保存</el-button></template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="skuDialogVisible = false">关闭</el-button>
        <el-button type="primary" :loading="skuAllSaving" @click="submitSkuAll">全部保存</el-button>
      </template>
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
/* 「按规格设价」弹窗顶部说明（三级回退口径，2026-10-08） */
.sku-tip { margin-bottom: 10px; color: var(--vben-muted); font-size: 13px; line-height: 20px; }
@media (max-width: 1000px) { .week-grid { grid-template-columns: 1fr; } }
</style>
