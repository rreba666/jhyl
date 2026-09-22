<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules, type UploadRequestOptions } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import ImageGridUpload from '@/components/ImageGridUpload.vue'
import { useProductStore } from '@/stores/product'
import { useAuthStore } from '@/stores/auth'
import { getStockDimensions } from '@/api/ledger'
import type { StockDimension } from '@/types/ledger'
import type { AdminProductSaveDTO, AdminProductSavePayload, CategoryNode, ProductDetail, ProductFundStatusValue, ProductListItem, ProductStatus, ProductSwitchStatusValue } from '@/types/product'
import { getDefaultDividendFund, getDefaultPromotionFund, isDefaultFundAmount } from '@/utils/productPricing'
import { DETAIL_IMAGE_MAX_COUNT, planDetailSliceForFile, sliceDetailImageToFiles } from '@/utils/detailImageSlice'
import { getAdminGoodsBrands } from '@/api/brand'
import { Delete, Edit, View } from '@element-plus/icons-vue'

const store = useProductStore()
const selected = ref<ProductListItem[]>([])
const formVisible = ref(false)
const detailVisible = ref(false)
const editingId = ref<string | undefined>()
const formRef = ref<FormInstance>()
const form = reactive<AdminProductSaveDTO>(createEmptyForm())
/** 推广资金是否使用默认比例自动计算（关闭则手动输入金额）。 */
const promotionUseDefault = ref(true)
/** 平台红包是否使用默认比例自动计算。 */
const dividendUseDefault = ref(true)
/**
 * 编辑回显是否拿到了商品级「配送方式」两个开关（`pickupEnabled` / `deliveryEnabled`）。
 *
 * 这两个字段的后端语义是「**不传 = 不修改**」（2026-09-22 上线），而详情接口是唯一回显来源：
 * 详情里没有这两个字段时（老后端 / 灰度期）**必须整个字段都不提交** ——
 * 若按 `normalizeBinary(undefined)` 得到 0 提交，会把已开启的开关关掉；按默认 1 提交则会反向打开。
 * 新增态没有回显，恒为 true（用默认值 1 显式提交）。
 */
const deliverySwitchEchoed = ref(true)
const detailUploadCount = ref(0)
const rules: FormRules = {
  name: [{ required: true, message: '请输入商品名称', trigger: 'blur' }],
  categoryId: [{ required: true, message: '请选择商品分类', trigger: 'change' }],
  mainImage: [{ required: true, message: '请上传商品主图', trigger: 'change' }],
}

const hasSelection = computed(() => selected.value.length > 0)
const categoryOptions = computed(() => flattenCategories(store.categories))
const mediaUploading = computed(() => store.uploading || detailUploadCount.value > 0)
/** 商品品牌选项（goods_brand，仅启用项；用于「品牌」下拉）。 */
const brandOptions = ref<Array<{ id: number; name: string }>>([])

/** 加载启用中的商品品牌（供商品挂品牌用）。 */
async function loadBrandOptions(): Promise<void> {
  try {
    const result = await getAdminGoodsBrands({ enabled: 1, page: 1, pageSize: 100 })
    brandOptions.value = (result?.list || []).map((item) => ({ id: item.id, name: item.name }))
  } catch {
    brandOptions.value = []
  }
}

/** 创建新增商品的默认表单。 */
function createEmptyForm(): AdminProductSaveDTO {
  // pickupEnabled / deliveryEnabled（商品级配送方式，2026-09-22 新增）后端默认 1：新增商品默认两种配送方式都支持
  return { id: undefined, name: '', categoryId: '', goodsBrandId: null, mainImage: '', images: [], videoUrl: '', description: '', descriptionTitle: '', originPlace: '', detailImages: [], promotionFund: 0, promotionEnabled: 1, dividendFund: 0, dividendEnabled: 1, status: 1, isRecommended: 0, recommendTextEnabled: 0, sortOrder: 0, skuList: [], pickupEnabled: 1, deliveryEnabled: 1 }
}

function getMinSkuPrice(skuList: AdminProductSaveDTO['skuList'] = form.skuList): number {
  const prices = skuList
    .map((sku) => Number(sku.price))
    .filter((price) => Number.isFinite(price) && price > 0)
  return prices.length ? Math.min(...prices) : 0
}

function getDefaultPromotionFundForSku(skuList: AdminProductSaveDTO['skuList'] = form.skuList): number {
  const minPrice = getMinSkuPrice(skuList)
  return getDefaultPromotionFund(minPrice)
}

function getDefaultDividendFundForSku(skuList: AdminProductSaveDTO['skuList'] = form.skuList): number {
  const minPrice = getMinSkuPrice(skuList)
  return getDefaultDividendFund(minPrice)
}

/** 开启「默认比例」时，SKU 价格变化自动重算对应资金金额。 */
function syncDefaultFunds(): void {
  if (promotionUseDefault.value) form.promotionFund = getDefaultPromotionFundForSku()
  if (dividendUseDefault.value) form.dividendFund = getDefaultDividendFundForSku()
}

/** 将分类树转换为下拉选项。 */
function flattenCategories(nodes: CategoryNode[], parent = ''): Array<{ id: string; label: string }> {
  return nodes.flatMap((node) => {
    const label = parent ? `${parent} / ${node.name}` : node.name
    return [{ id: String(node.id), label }, ...flattenCategories(node.children || [], label)]
  })
}

/**
 * 复制详情数据到编辑表单，避免弹窗修改列表原数据。
 *
 * ⚠️ 规格名回填：2026-09-22 起后端详情（`GET /api/admin/v2/product/detail/{id}`）会返回
 * `skuList[].skuName`，直接回传即可（保存时该字段已被后端 `@NotBlank` 强校验）。
 * 这里仍保留兜底：`skuName` 为空时读旧的 `specName`，单规格商品补默认名「默认」——
 * 多规格用户自填，前端不替用户编造名称；否则编辑任何商品都会卡在「请完善 SKU 名称」，
 * 看起来就像「保存按钮点了没反应」（2026-09-19 用户反馈，老后端详情不返回规格名）。
 */
function fillForm(detail?: ProductDetail): void {
  const status = normalizeBinary(detail?.status ?? 1)
  // 商品级配送方式（2026-09-22）：详情回显拿到原样回填；拿不到则显示默认 1，但提交阶段会跳过这两个字段
  const pickupEcho = detail ? normalizeSwitchOrNull(detail.pickupEnabled) : 1
  const deliveryEcho = detail ? normalizeSwitchOrNull(detail.deliveryEnabled) : 1
  deliverySwitchEchoed.value = pickupEcho !== null && deliveryEcho !== null
  Object.assign(form, detail ? { id: detail.id, name: detail.name, categoryId: detail.categoryId, mainImage: detail.mainImage, images: [...(detail.images || [])], videoUrl: detail.videoUrl || '', description: detail.description || '', descriptionTitle: detail.descriptionTitle || '', originPlace: detail.originPlace || '', goodsBrandId: detail.goodsBrandId ?? null, detailImages: [...(detail.detailImages || [])], promotionFund: detail.promotionFund ?? 0, promotionEnabled: normalizeBinary(detail.promotionEnabled), dividendFund: detail.dividendFund ?? 0, dividendEnabled: normalizeBinary(detail.dividendEnabled), pickupEnabled: pickupEcho ?? 1, deliveryEnabled: deliveryEcho ?? 1, status, isRecommended: status === 1 ? normalizeBinary(detail.isRecommended) : 0, recommendTextEnabled: status === 1 && normalizeBinary(detail.isRecommended) === 1 ? normalizeBinary(detail.recommendTextEnabled) : 0, sortOrder: detail.sortOrder || 0, skuList: (detail.skuList || []).map((sku) => ({ ...sku, skuName: sku.skuName || sku.specName || ((detail.skuList || []).length === 1 ? '默认' : ''), id: sku.id == null ? undefined : String(sku.id), enabled: normalizeBinary(sku.enabled) })) } : createEmptyForm())
  // 新增商品默认使用比例；编辑商品根据已保存金额恢复模式（后端暂无独立模式字段）。
  promotionUseDefault.value = detail ? isDefaultFundAmount(detail.promotionFund, detail.minPrice, getDefaultPromotionFund) : true
  dividendUseDefault.value = detail ? isDefaultFundAmount(detail.dividendFund, detail.minPrice, getDefaultDividendFund) : true
  if (!detail) {
    form.promotionFund = getDefaultPromotionFundForSku()
    form.dividendFund = getDefaultDividendFundForSku()
  }
}

/** 统一转换 0/1 状态值。 */
function normalizeBinary(value: number | string | boolean | null | undefined): ProductStatus {
  return value === 1 || value === '1' ? 1 : 0
}

/**
 * 商品级配送方式开关的回显归一化：`0/1`、数字字符串、布尔 → 0/1；**缺失 → null（未知）**。
 * ⚠️ 不要用 `normalizeBinary` 兜底 —— 它把缺失当 0，会把已开启的开关关掉。
 * （空串在 `api/product.ts` 的 `normalizeProductBinaryOrNull` 里已归一为 null，这里只会收到 0/1/'0'/'1'。）
 */
function normalizeSwitchOrNull(value: ProductSwitchStatusValue | undefined): ProductStatus | null {
  if (value === undefined || value === null) return null
  return normalizeBinary(value)
}

function formatFundEnabled(value: ProductFundStatusValue): string {
  if (value == null) return '待查询'
  return normalizeBinary(value) ? '启用' : '禁用'
}

/** 列表接口不返回资金金额时显示占位，避免用默认值误导。 */
function formatFundAmount(value: number | undefined): string {
  return value != null && Number.isFinite(value) ? `¥ ${value.toFixed(2)}` : '--'
}

/** 格式化商品所属门店名（取 shopList 的 shopName 拼接）。 */
function formatShopShopNames(shopList: { shopName?: string }[] | undefined): string {
  if (!shopList?.length) return '—'
  return shopList.map((item) => item.shopName).filter(Boolean).join('、')
}


/** 下架商品不允许继续推荐到首页。 */
watch(() => form.status, (status, previousStatus) => {
  if (normalizeBinary(status) === 0 && normalizeBinary(form.isRecommended) === 1) {
    form.isRecommended = 0
    if (normalizeBinary(previousStatus) === 1) ElMessage.info('商品下架后将自动取消首页推荐')
  }
})

/** 推荐文本依赖首页推荐，关闭首页推荐时同步隐藏文本。 */
watch(() => form.isRecommended, (isRecommended, previousIsRecommended) => {
  if (normalizeBinary(isRecommended) === 0 && normalizeBinary(form.recommendTextEnabled) === 1) {
    form.recommendTextEnabled = 0
    if (normalizeBinary(previousIsRecommended) === 1) ElMessage.info('关闭首页推荐后将自动隐藏推荐文本')
  }
})

watch(() => form.skuList.map((sku) => sku.price), syncDefaultFunds)

/** 切换到「默认比例」时立即按当前最低价重算金额。 */
watch(promotionUseDefault, (use) => { if (use) form.promotionFund = getDefaultPromotionFundForSku() })
watch(dividendUseDefault, (use) => { if (use) form.dividendFund = getDefaultDividendFundForSku() })

async function openForm(product?: ProductListItem): Promise<void> {
  editingId.value = product?.id
  try {
    if (product) await store.fetchDetail(product.id)
    fillForm(product ? store.detail || undefined : undefined)
    formVisible.value = true
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '商品详情加载失败')
  }
}

/** 转可选整数：空值 → undefined（提交时不带该字段）；非整数 → undefined（由调用方提示）。 */
function toOptionalInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const num = Number(value)
  return Number.isInteger(num) ? num : undefined
}

/** 保存商品并根据是否存在 ID 区分新增和编辑。 */
async function submitForm(): Promise<void> {
  // 校验失败的字段级红字可能在弹窗滚动区之外 → 用户会以为「点了没反应」，这里补一句可见反馈
  if (!(await formRef.value?.validate().catch(() => false))) {
    ElMessage.warning('还有必填项未填写，请检查表单中标红的字段')
    return
  }
  if (!form.skuList.length) {
    ElMessage.error('至少需要一条 SKU')
    return
  }
  const invalidSku = form.skuList.find((sku) => !sku.skuName.trim() || sku.price < 0.01 || sku.stock < 0)
  if (invalidSku) {
    // 明确指到 SKU 表格（规格名可能因回显为空需用户补填，用户不看表格会一头雾水）
    ElMessage.error('请补全 SKU 表格里的「规格名称 / 价格 / 库存」后再保存')
    return
  }
  if (normalizeBinary(form.status) === 0 && normalizeBinary(form.isRecommended) === 1) {
    form.isRecommended = 0
    ElMessage.info('下架商品不能推荐到首页，已自动取消推荐')
  }
  // 后端 categoryId / goodsBrandId 是 integer：传非数字字符串会被 Jackson 判为「请求体格式错误」
  // （2026-09-19 实测复现：categoryId="分类A" → code=1000 请求体格式错误）。
  // 这里提前拦下来给出可读提示，空值则整个字段都不提交。
  const { categoryId: rawCategoryId, goodsBrandId: rawBrandId, skuList: rawSkuList, pickupEnabled: rawPickupEnabled, deliveryEnabled: rawDeliveryEnabled, ...rest } = form
  const categoryId = toOptionalInteger(rawCategoryId)
  if (String(rawCategoryId ?? '') !== '' && categoryId === undefined) {
    ElMessage.error('商品分类参数不合法，请重新选择分类')
    return
  }
  const goodsBrandId = toOptionalInteger(rawBrandId)
  if (String(rawBrandId ?? '') !== '' && goodsBrandId === undefined) {
    ElMessage.error('商品品牌参数不合法，请重新选择品牌')
    return
  }
  try {
    const payload: AdminProductSavePayload = {
      ...rest,
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(goodsBrandId === undefined ? {} : { goodsBrandId }),
      status: normalizeBinary(form.status),
      promotionEnabled: normalizeBinary(form.promotionEnabled),
      dividendEnabled: normalizeBinary(form.dividendEnabled),
      isRecommended: normalizeBinary(form.status) === 1 ? normalizeBinary(form.isRecommended) : 0,
      recommendTextEnabled: normalizeBinary(form.status) === 1 && normalizeBinary(form.isRecommended) === 1 ? normalizeBinary(form.recommendTextEnabled) : 0,
      ...(editingId.value ? { id: editingId.value } : { id: undefined }),
      // 商品级配送方式（2026-09-22）：语义「不传 = 不修改」——
      // 只有详情回显确实拿到了这两个字段时才按回显值原样提交；拿不到就整个字段不提交。
      ...(deliverySwitchEchoed.value
        ? { pickupEnabled: normalizeBinary(rawPickupEnabled), deliveryEnabled: normalizeBinary(rawDeliveryEnabled) }
        : {}),
      // 规格名必须**两个字段名都带同值**：后端 2026-09-22 起对 `skuList[].skuName` 强校验（@NotBlank，
      // 缺失/空串 → 1000 skuList[0].skuName: SKU 名称不能为空），而写库历史上用的是 `specName`（2026-09-19 实测）。
      // 后端 Jackson 忽略未知字段，所以两个都带上可同时兼容两套字段名。
      skuList: rawSkuList.map((sku) => {
        const skuName = sku.skuName.trim()
        // ⚠️⚠️ 2026-09-22 修（生产已造成数据重复）——**必须把已有 SKU 的 id 带上**：
        // 后端只按 **id** 匹配已有 SKU（不按名字），原来这里不带 id → 每次保存都被当成"新增规格"，
        // 于是**每保存一次就追加一批同规格 SKU**。生产实测后果：商品 id=5 已累积 **37** 条「一罐」、
        // id=6 累积 **18** 条「一盒」（用户截图里看到的 4 行重复就是这个现象）。
        // 新增商品时 `sku.id` 本就是 undefined → 不传该字段，后端据此插入新 SKU。
        const id = sku.id === null || sku.id === undefined || String(sku.id).trim() === '' ? undefined : Number(sku.id)
        return {
          ...(id === undefined ? {} : { id }),
          skuName,
          specName: skuName,
          price: Number(sku.price),
          stock: Number(sku.stock),
        }
      }),
    }
    await store.saveProduct(payload)
    formVisible.value = false
    ElMessage.success(editingId.value ? '商品修改成功' : '商品新增成功')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '商品保存失败')
  }
}

/** 打开商品详情弹窗。 */
async function showDetail(product: ProductListItem): Promise<void> {
  detailVisible.value = true
  try { await store.fetchDetail(product.id) } catch (error) { detailVisible.value = false; ElMessage.error(error instanceof Error ? error.message : '商品详情查询失败') }
}

// ===== 库存动态四维（平台级接口 GET /api/admin/stock-dimension?skuIds=） =====
const authStore = useAuthStore()
/** 库存四维为平台级接口（仅超管/客服/财务），商户管理员不可用 → 对 ADMIN 隐藏入口。 */
const canViewStockDimension = computed(() => Boolean(authStore.role) && authStore.role !== 'ADMIN')
const dimensionVisible = ref(false)
const dimensionLoading = ref(false)
const dimensionRows = ref<StockDimension[]>([])

/** 库存四维数值展示：⚠️ 字段缺失（不存在的 SKU）显示 "—"，不要当 0。 */
function dimensionNumber(value?: number | null): string {
  return value === null || value === undefined ? '—' : String(value)
}

/** 四维字段是否整体缺失（不存在的 SKU 只回 skuId）。 */
function dimensionMissing(row: StockDimension): boolean {
  return row.available === undefined && row.locked === undefined && row.inTransit === undefined && row.total === undefined
}

/** 校验后端口径：total = available + locked（**不含 inTransit**）。 */
function dimensionTotalMismatch(row: StockDimension): boolean {
  if (dimensionMissing(row) || row.total === undefined || row.available === undefined || row.locked === undefined) return false
  return Number(row.total) !== Number(row.available) + Number(row.locked)
}

/** 查询当前商品全部 SKU 的库存动态四维（可售/锁定/在途/合计）。 */
async function openStockDimensions(): Promise<void> {
  const skuIds = (store.detail?.skuList || []).map((sku) => sku.id).filter((id): id is string => Boolean(id))
  if (!skuIds.length) { ElMessage.warning('该商品暂无可查询的 SKU'); return }
  dimensionVisible.value = true
  dimensionRows.value = []
  dimensionLoading.value = true
  try { dimensionRows.value = await getStockDimensions(skuIds) }
  catch (error) { dimensionVisible.value = false; ElMessage.error(error instanceof Error ? error.message : '库存四维查询失败') }
  finally { dimensionLoading.value = false }
}

/** 确认并软删除商品。 */
async function removeProduct(product: ProductListItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除商品“${product.name}”吗？删除后 B 端和 C 端都不可见。`, '删除确认')
    await store.removeProduct(product.id)
    ElMessage.success('商品删除成功')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '商品删除失败')
  }
}

async function removeSelected(): Promise<void> {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selected.value.length} 个商品吗？删除后 B 端和 C 端都不可见。`, '批量删除确认')
    const result = await store.removeProducts(selected.value.map((item) => item.id))
    selected.value = []
    if (result.failedIds.length) ElMessage.warning(`成功删除 ${result.successIds.length} 个商品，${result.failedIds.length} 个商品删除失败`)
    else ElMessage.success(`成功删除 ${result.successIds.length} 个商品`)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}

function addSku(): void { form.skuList.push({ skuName: '', specs: '', skuImage: '', price: 0.01, originalPrice: 0, stock: 0, enabled: 1 }) }

/** 删除 SKU 编辑行。 */
function removeSku(index: number): void { form.skuList.splice(index, 1) }

/** 上传媒体文件并追加到指定数组或写入视频字段（详情图先做「超长切片」，见 uploadDetailImages）。 */
async function uploadFile(options: UploadRequestOptions, field: 'mainImage' | 'images' | 'videoUrl' | 'detailImages'): Promise<void> {
  const file = options.file as File
  const isVideo = field === 'videoUrl'
  const isDetailImage = field === 'detailImages'
  if (field === 'mainImage' && form.mainImage) { ElMessage.warning('主图最多上传1张'); return }
  if (field === 'images' && form[field].length >= 5) { ElMessage.warning('商品轮播图最多上传5张图片'); return }
  if (isDetailImage && form[field].length + detailUploadCount.value >= 15) { ElMessage.warning('商品详情图最多上传15张图片'); return }
  if (isVideo ? file.type !== 'video/mp4' && !file.name.toLowerCase().endsWith('.mp4') : !file.type.startsWith('image/')) { ElMessage.error(isVideo ? '商品视频仅支持 MP4' : '请上传图片文件'); return }
  // 详情图走「超长图自动切片」链路（2026-09-22 新增，见下）；主图 / 轮播图 / 视频保持原逻辑完全不变
  if (isDetailImage) { await uploadDetailImages(file); return }
  try {
    const url = await store.uploadFile(file)
    if (field === 'mainImage' || field === 'videoUrl') form[field] = url
    else form[field].push(url)
    ElMessage.success('文件上传成功')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '文件上传失败') }
}

/**
 * 详情图上传：读真实尺寸 → 超长则按 3000px 自动切片（宽度收敛到 1200px）→ **逐段顺序**上传。
 *
 * 为什么在**上传侧**切：`detailImages` 本来就是 URL 数组、C 端 `v-for` 顺序渲染，切片后 C 端**零改动**；
 * 而实测那张 790 × 21222px / 9.0MB 的详情图，解码位图约需 `790×21222×4 ≈ 671MB` 内存，
 * 移动端必然解码失败（小程序 `<image>` 一片灰，`@error` 也未必触发）。
 *
 * 三种结果：
 * 1. 高度 ≤ 3000px：**不切片**，按原逻辑直接上传（既有行为完全不变）；
 * 2. 超长且「段数 + 已占用张数 ≤ 15」：切片后逐段上传，**按顺序** push 进 `form.detailImages`；
 * 3. 超长但会突破 15 张上限：**拒绝并提示**（不让用户白等一轮上传）。
 * 任何读取/切片异常：回退为「原图直接上传」+ 警告提示（保持旧行为，不阻断业务）。
 */
async function uploadDetailImages(file: File): Promise<void> {
  /** 已占用张数 = 表单里已有的 + 正在上传中的（并发多选多张长图时靠它兜住上限） */
  const occupied = form.detailImages.length + detailUploadCount.value
  let files: File[] = [file]
  let sliced = false
  try {
    const plan = await planDetailSliceForFile(file)
    if (plan.needSlice) {
      // 切片后总张数会超上限 → 直接拒绝，并说明「需切几段 / 已有几张」
      if (occupied + plan.totalSegments > DETAIL_IMAGE_MAX_COUNT) {
        ElMessage.warning(`该详情图过长，需切成 ${plan.totalSegments} 段，加上已有 ${occupied} 张会超过 ${DETAIL_IMAGE_MAX_COUNT} 张上限；请减少图片或缩短详情图`)
        return
      }
      files = await sliceDetailImageToFiles(file, plan)
      sliced = true
    }
  } catch {
    ElMessage.warning('详情图切片失败，已按原图上传，可能在小程序端显示异常')
    files = [file]
    sliced = false
  }
  // 先按**实际段数**占位，避免并发上传时各算各的、突破 15 张上限
  detailUploadCount.value += files.length
  try {
    // 严格串行上传：详情图有阅读顺序，只能顺序 push（并发会打乱段序）
    for (const segment of files) {
      const url = await store.uploadFile(segment)
      form.detailImages.push(url)
    }
    ElMessage.success(sliced ? `详情图过长，已自动切成 ${files.length} 段并上传成功` : '文件上传成功')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '文件上传失败') }
  finally { detailUploadCount.value = Math.max(detailUploadCount.value - files.length, 0) }
}

async function loadList(): Promise<void> { try { await store.fetchList() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '商品列表查询失败') } }
function formatPrice(product: ProductDetail): string { return product.minPrice === product.maxPrice ? `¥ ${product.minPrice.toFixed(2)}` : `¥ ${product.minPrice.toFixed(2)} - ¥ ${product.maxPrice.toFixed(2)}` }
function search(): void { store.page = 1; loadList() }
function reset(): void { store.resetFilters(); loadList() }
function onPageChange(value: number): void { store.page = value; loadList() }
function onSizeChange(value: number): void { store.pageSize = value; store.page = 1; loadList() }
function onUpload(options: UploadRequestOptions, field: 'mainImage' | 'images' | 'videoUrl' | 'detailImages'): void { void uploadFile(options, field) }
function onMainImageUpload(options: UploadRequestOptions): void { onUpload(options, 'mainImage') }
function onImagesUpload(options: UploadRequestOptions): void { onUpload(options, 'images') }
function onVideoUpload(options: UploadRequestOptions): void { onUpload(options, 'videoUrl') }
function onDetailImagesUpload(options: UploadRequestOptions): void { onUpload(options, 'detailImages') }
/** 首次进入页面时同时加载商品列表和启用分类树。 */
onMounted(() => {
  void loadList()
  void loadBrandOptions()
  store.fetchCategories().catch((error: unknown) => ElMessage.error(error instanceof Error ? error.message : '分类查询失败'))
})

</script>

<template>
  <section class="page-container">
    <div class="page-heading"><div><h1>商品管理</h1><p>管理商品信息、SKU、上下架和首页推荐状态。</p></div><el-button type="primary" @click="openForm()">新增商品</el-button></div>
    <el-card shadow="never" class="filter-card"><el-form inline @submit.prevent="search"><el-form-item label="关键词"><el-input v-model="store.filters.keyword" clearable placeholder="商品ID/名称/产地" /></el-form-item><el-form-item label="分类"><el-select v-model="store.filters.categoryId" clearable placeholder="全部分类"><el-option v-for="option in categoryOptions" :key="option.id" :label="option.label" :value="option.id" /></el-select></el-form-item><el-form-item label="产地"><el-input v-model="store.filters.originPlace" clearable placeholder="精确匹配产地" /></el-form-item><el-form-item label="排序"><el-select v-model="store.filters.sortBy" clearable placeholder="综合排序"><el-option label="销量降序" value="sold_desc" /><el-option label="价格升序" value="price_asc" /><el-option label="价格降序" value="price_desc" /><el-option label="新品降序" value="new_desc" /><el-option label="后台排序" value="sort_order" /></el-select></el-form-item><el-form-item><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button></el-form-item></el-form></el-card>
    <el-card shadow="never" class="content-card"><div class="toolbar"><span>商品列表</span><span v-if="hasSelection" class="selection-tip">已选择 {{ selected.length }} 项</span><el-button type="danger" plain :disabled="!hasSelection || store.deleteLoading" :loading="store.deleteLoading" @click="removeSelected">批量删除</el-button></div><DataTable :data="store.list" :loading="store.loading" :total="store.total" :page="store.page" :page-size="store.pageSize" @selection-change="selected = $event" @page-change="onPageChange" @size-change="onSizeChange"><el-table-column prop="id" label="商品 ID" width="120" /><el-table-column label="主图" width="80"><template #default="{ row }"><el-image v-if="row.mainImage" :src="row.mainImage" :preview-src-list="[row.mainImage]" class="product-image" preview-teleported /><span v-else>暂无</span></template></el-table-column><el-table-column prop="name" label="商品名称" min-width="180" /><el-table-column label="所属商户/门店" min-width="180"><template #default="{ row }"><div class="shop-list-cell"><span v-if="row.merchantName" class="merchant-name">{{ row.merchantName }}</span><span>{{ formatShopShopNames(row.shopList) }}</span></div></template></el-table-column><el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="normalizeBinary(row.status) ? 'success' : 'info'">{{ normalizeBinary(row.status) ? '上架' : '下架' }}</el-tag></template></el-table-column><el-table-column label="推荐" width="90"><template #default="{ row }"><el-tag :type="normalizeBinary(row.isRecommended) ? 'warning' : 'info'">{{ normalizeBinary(row.isRecommended) ? '推荐' : '不推荐' }}</el-tag></template></el-table-column><el-table-column label="最低价" width="110"><template #default="{ row }">¥ {{ row.minPrice?.toFixed(2) }}</template></el-table-column><el-table-column label="推广资金" width="125"><template #default="{ row }"><span>{{ formatFundAmount(row.promotionFund) }}</span><el-tag size="small" :type="row.promotionEnabled == null ? 'warning' : normalizeBinary(row.promotionEnabled) ? 'success' : 'info'">{{ formatFundEnabled(row.promotionEnabled) }}</el-tag></template></el-table-column><el-table-column label="平台红包" width="125"><template #default="{ row }"><span>{{ formatFundAmount(row.dividendFund) }}</span><el-tag size="small" :type="row.dividendEnabled == null ? 'warning' : normalizeBinary(row.dividendEnabled) ? 'success' : 'info'">{{ formatFundEnabled(row.dividendEnabled) }}</el-tag></template></el-table-column><el-table-column prop="totalStock" label="库存" width="90" /><el-table-column prop="soldCount" label="销量" width="90" /><el-table-column prop="originPlace" label="产地" min-width="130" /><el-table-column label="操作" fixed="right" width="230"><template #default="{ row }"><div class="operator-actions"><el-button size="small" type="primary" @click="showDetail(row)"><el-icon><View /></el-icon>详情</el-button><el-button size="small" @click="openForm(row)"><el-icon><Edit /></el-icon>编辑</el-button><el-button size="small" type="danger" @click="removeProduct(row)"><el-icon><Delete /></el-icon>删除</el-button></div></template></el-table-column></DataTable></el-card>

    <el-dialog v-model="detailVisible" title="商品详情" width="900px" append-to-body><el-skeleton v-if="store.detailLoading" :rows="8" animated /><template v-else-if="store.detail"><el-descriptions :column="2" border><el-descriptions-item label="商品名称">{{ store.detail.name }}</el-descriptions-item><el-descriptions-item label="状态">{{ normalizeBinary(store.detail.status) ? '上架' : '下架' }}</el-descriptions-item><el-descriptions-item label="价格">{{ formatPrice(store.detail) }}</el-descriptions-item><el-descriptions-item label="库存">{{ store.detail.totalStock }}</el-descriptions-item><el-descriptions-item label="销量">{{ store.detail.soldCount }}</el-descriptions-item><el-descriptions-item label="产地">{{ store.detail.originPlace }}</el-descriptions-item><el-descriptions-item label="推广资金">¥ {{ store.detail.promotionFund?.toFixed(2) || '0.00' }} / {{ normalizeBinary(store.detail.promotionEnabled) ? '启用' : '禁用' }}</el-descriptions-item><el-descriptions-item label="平台红包">¥ {{ store.detail.dividendFund?.toFixed(2) || '0.00' }} / {{ normalizeBinary(store.detail.dividendEnabled) ? '启用' : '禁用' }}</el-descriptions-item></el-descriptions><el-image v-if="store.detail.mainImage" :src="store.detail.mainImage" class="detail-main-image" fit="contain" /><el-carousel v-if="store.detail.images.length" height="260px"><el-carousel-item v-for="image in store.detail.images" :key="image"><el-image :src="image" fit="contain" class="carousel-image" /></el-carousel-item></el-carousel><video v-if="store.detail.videoUrl" :src="store.detail.videoUrl" controls class="detail-video" /><el-divider>SKU 列表</el-divider><el-button v-if="canViewStockDimension" size="small" :loading="dimensionLoading" @click="openStockDimensions">库存四维</el-button><el-table :data="store.detail.skuList" border><el-table-column prop="skuName" label="规格" /><el-table-column prop="specs" label="属性" /><el-table-column prop="price" label="价格" /><el-table-column prop="stock" label="库存" /><el-table-column label="状态"><template #default="{ row }">{{ normalizeBinary(row.enabled) ? '启用' : '禁用' }}</template></el-table-column></el-table><el-divider>商品描述</el-divider><div v-if="store.detail.description" class="product-description" v-html="store.detail.description" /><el-divider v-if="store.detail.detailImages.length">详情图片</el-divider><div class="detail-images"><el-image v-for="image in store.detail.detailImages" :key="image" :src="image" fit="contain" class="detail-image" /></div></template><el-empty v-else description="暂无商品详情" /></el-dialog>

    <el-dialog v-model="formVisible" class="product-form-dialog" :title="editingId ? '编辑商品' : '新增商品'" width="min(1100px, calc(100vw - 32px))" top="2vh" append-to-body>
      <el-form ref="formRef" class="product-form" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="商品名称" prop="name"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="描述标题"><el-input v-model="form.descriptionTitle" placeholder="首页卡片商品描述文字" /></el-form-item>
        <el-form-item label="商品分类" prop="categoryId"><el-select v-model="form.categoryId" placeholder="请选择分类"><el-option v-for="option in categoryOptions" :key="option.id" :label="option.label" :value="option.id" /></el-select></el-form-item>
        <el-form-item label="主图" prop="mainImage" class="form-item-full media-form-item">
          <ImageGridUpload :model-value="form.mainImage ? [form.mainImage] : []" :max="1" :uploading="mediaUploading" @upload="onMainImageUpload" @remove="form.mainImage = ''" />
          <p class="upload-hint">建议尺寸 750×750px（1:1 正方形），首页卡片中图片将撑满显示，文字叠于底部</p>
        </el-form-item>
        <el-form-item label="轮播图" class="form-item-full">
          <ImageGridUpload v-model="form.images" :max="5" :uploading="mediaUploading" @upload="onImagesUpload" @remove="form.images.splice($event, 1)" />
        </el-form-item>
        <el-form-item label="视频" class="form-item-full media-form-item">
          <div class="media-edit"><el-input v-model="form.videoUrl" /><el-upload :show-file-list="false" :http-request="onVideoUpload" accept="video/mp4"><el-button :loading="mediaUploading">上传 MP4</el-button></el-upload></div>
        </el-form-item>
        <el-form-item label="详情图" class="form-item-full">
          <ImageGridUpload v-model="form.detailImages" :max="15" :multiple="true" :display-limit="3" thumbnail-mode="long" :uploading="mediaUploading" @upload="onDetailImagesUpload" @remove="form.detailImages.splice($event, 1)" />
          <p class="upload-hint">超长详情图（单张高度 &gt; 3000px）会自动切成多段依次上传：宽度收敛到 1200px、单段高 ≤ 3000px、单段体积 ≤ 2MB（超了自动降质量）。切片段数计入 15 张上限 —— 手机端无法解码 2 万像素高的整图，不切会在小程序里显示空白。</p>
        </el-form-item>
        <el-form-item label="产地"><el-input v-model="form.originPlace" /></el-form-item>
        <el-form-item label="品牌">
          <el-select v-model="form.goodsBrandId" clearable filterable placeholder="选择商品品牌（如海天，用于非遗老号品牌条）" style="width: 100%">
            <el-option v-for="brand in brandOptions" :key="brand.id" :label="brand.name" :value="brand.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序权重"><el-input-number v-model="form.sortOrder" :min="0" /></el-form-item>
        <div class="fund-config-row form-item-full"><el-form-item label="推广资金"><div class="fund-control"><el-switch v-model="promotionUseDefault" active-text="默认比例" inactive-text="手动金额" /><el-input-number v-model="form.promotionFund" :min="0" :precision="2" :disabled="promotionUseDefault" /><el-switch v-model="form.promotionEnabled" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="禁用" /></div></el-form-item><el-form-item label="平台红包"><div class="fund-control"><el-switch v-model="dividendUseDefault" active-text="默认比例" inactive-text="手动金额" /><el-input-number v-model="form.dividendFund" :min="0" :precision="2" :disabled="dividendUseDefault" /><el-switch v-model="form.dividendEnabled" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="禁用" /></div></el-form-item></div>
        <el-form-item label="商品状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" active-text="上架" inactive-text="下架" /></el-form-item>
        <!-- 商品级配送方式（2026-09-22）：与「模块开关」「门店是否上架」三重叠加；关闭后 C 端下单会报 13023 / 13024 -->
        <el-form-item label="配送方式" class="form-item-full">
          <div class="delivery-switch-row">
            <el-switch v-model="form.pickupEnabled" :active-value="1" :inactive-value="0" active-text="支持线下自提" inactive-text="不支持线下自提" />
            <el-switch v-model="form.deliveryEnabled" :active-value="1" :inactive-value="0" active-text="支持物流/同城配送" inactive-text="不支持物流/同城配送" />
          </div>
          <p class="upload-hint">关闭后用户下单不能选择该配送方式（自提 13023、物流/同城 13024）；按详情回显值原样提交，详情未返回时不提交（后端语义：不传 = 不修改）。</p>
        </el-form-item>
        <el-form-item label="首页推荐"><el-switch v-model="form.isRecommended" :disabled="normalizeBinary(form.status) === 0" :active-value="1" :inactive-value="0" /></el-form-item>
        <el-form-item label="推荐文本"><el-switch v-model="form.recommendTextEnabled" :disabled="normalizeBinary(form.status) === 0 || normalizeBinary(form.isRecommended) === 0" :active-value="1" :inactive-value="0" /></el-form-item>
        <el-form-item label="详情描述" class="form-item-full"><el-input v-model="form.description" type="textarea" :rows="5" placeholder="请输入 HTML 商品描述" /></el-form-item>
        <el-form-item label="SKU" class="form-item-full"><div class="sku-editor"><el-button size="small" @click="addSku">新增 SKU</el-button><el-table :data="form.skuList" border><el-table-column label="规格名称"><template #default="{ row }"><el-input v-model="row.skuName" /></template></el-table-column><el-table-column label="价格"><template #default="{ row }"><el-input-number v-model="row.price" :min="0.01" :precision="2" /></template></el-table-column><el-table-column label="划线价"><template #default="{ row }"><el-input-number v-model="row.originalPrice" :min="0" :precision="2" /></template></el-table-column><el-table-column label="库存"><template #default="{ row }"><el-input-number v-model="row.stock" :min="0" /></template></el-table-column><el-table-column label="启用"><template #default="{ row }"><el-switch v-model="row.enabled" :active-value="1" :inactive-value="0" /></template></el-table-column><el-table-column label="操作" width="90"><template #default="{ $index }"><el-button size="small" type="danger" @click="removeSku($index)"><el-icon><Delete /></el-icon>删除</el-button></template></el-table-column></el-table></div></el-form-item>
      </el-form>
      <template #footer><el-button @click="formVisible = false">取消</el-button><el-button type="primary" :loading="store.saveLoading" @click="submitForm">保存</el-button></template>
    </el-dialog>

    <!-- 库存动态四维（平台级）：⚠️ 合计 = 可售 + 锁定，不含在途；不存在的 SKU 只有 skuId -->
    <el-dialog v-model="dimensionVisible" title="库存动态四维" width="680px" append-to-body>
      <el-alert type="info" :closable="false" show-icon title="合计 = 可售 + 锁定（不含在途）；在途为实时聚合（已支付未签收且未退款成功），刻意不落列。" />
      <el-table v-loading="dimensionLoading" :data="dimensionRows" border class="sku-table">
        <el-table-column prop="skuId" label="SKU ID" width="120" />
        <el-table-column label="可售"><template #default="{ row }">{{ dimensionNumber(row.available) }}</template></el-table-column>
        <el-table-column label="锁定"><template #default="{ row }">{{ dimensionNumber(row.locked) }}</template></el-table-column>
        <el-table-column label="在途"><template #default="{ row }">{{ dimensionNumber(row.inTransit) }}</template></el-table-column>
        <el-table-column label="合计"><template #default="{ row }">{{ dimensionNumber(row.total) }}</template></el-table-column>
        <el-table-column label="核对" min-width="180">
          <template #default="{ row }">
            <el-tag v-if="dimensionMissing(row)" size="small" type="warning">SKU 不存在（字段缺失）</el-tag>
            <el-tag v-else-if="dimensionTotalMismatch(row)" size="small" type="danger">合计与「可售+锁定」不符</el-tag>
            <el-tag v-else size="small" type="success">口径一致</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <p class="dimension-hint">如需查某 SKU 的历史库存变动，可在留痕台账按「目标类型=商品 SKU + SKU ID」或时间线查询。</p>
    </el-dialog>
  </section>
</template>

<style scoped>
.product-image { width: 52px; height: 52px; border-radius: 4px; }
.detail-main-image { display: block; width: 180px; height: 180px; margin: 24px auto; }
.carousel-image { width: 100%; height: 260px; }
.detail-video { display: block; width: 100%; max-height: 360px; margin: 20px 0; background: #111827; }
.product-description { line-height: 1.7; overflow-wrap: anywhere; }
:deep(.product-form-dialog) { width: min(1100px, calc(100vw - 32px)); }
:deep(.product-form-dialog .el-dialog__body) { max-height: min(78vh, 880px); overflow-y: auto; padding: 20px 24px 8px; }
.product-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 24px; row-gap: 0; }
.product-form .form-item-full { grid-column: 1 / -1; }
.product-form .media-form-item { grid-column: 1 / -1; }
.product-form > .el-form-item { align-self: start; min-width: 0; }
.product-form :deep(.el-form-item__content) { min-width: 0; }
.product-form :deep(.el-select) { width: 100%; }
.detail-images { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.detail-image { display: block; width: 100%; height: auto; max-height: none; }
.detail-image :deep(.el-image__inner) { display: block; width: 100%; height: auto; max-height: none; object-fit: contain; }
.media-edit-list, .sku-editor { width: 100%; min-width: 0; }
.media-edit { display: flex; gap: 8px; width: 100%; margin-bottom: 8px; }
.media-edit .el-input { min-width: 0; flex: 1; }
.product-form :deep(.image-grid-upload) { width: 100%; min-width: 0; }
.product-form :deep(.image-grid) { max-width: 100%; }
.upload-hint { margin: 4px 0 0; color: #909399; font-size: 12px; line-height: 1.5; }
.form-hint { margin-left: 8px; color: #909399; font-size: 12px; }
.fund-config-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; }
.fund-config-row :deep(.el-form-item) { min-width: 0; }
.fund-control { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; min-width: 0; }
/* 商品级配送方式两个开关并排，窄屏自动换行 */
.delivery-switch-row { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 28px; min-width: 0; }
.fund-control .form-hint { margin-left: 0; }
.selection-tip { color: #8492a6; font-size: 13px; }
.shop-list-cell { display: flex; flex-direction: column; line-height: 1.4; }
.shop-list-cell .merchant-name { color: #a07c1f; font-weight: 600; }
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.dimension-hint { margin: 12px 0 0; color: #909399; font-size: 12px; line-height: 1.6; }
@media (max-width: 760px) {
  .product-form { grid-template-columns: minmax(0, 1fr); }
  .product-form .form-item-full { grid-column: auto; }
  .fund-config-row { grid-template-columns: minmax(0, 1fr); }
}
</style>
