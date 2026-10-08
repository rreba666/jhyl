<script setup lang="ts">
/**
 * 商家端 · 商品管理（对应设计稿「商品管理」页，30 画板中的在售中 / 库存预警 / 仓库中 + 批量操作收敛为一页）
 * 契约（api_doc.json /api/merchant/products/**，2026-09-18 已到位）：
 * - 列表：GET /api/merchant/products?keyword=&status=&page=&pageSize=（status: 1=已上架, 0=未上架, 空=全部）
 * - 单条上下架：PUT /api/merchant/products/{id}/status?status=0|1
 * - 单条改库存 / 改价：PUT /{id}/stock?stock= 、/{id}/price?price=
 * - 批量上下架：POST /api/merchant/products/batch  body { productIds: [], status: 0|1 }
 *
 * 范围结论（设计疑问清单）：商品核心是**上下架**；批量只做上/下架；订单只读不做。
 * 库存预警：后端无专用接口，取「已上架」商品在前端按阈值过滤（阈值待产品确认，暂 100）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  batchUpdateProducts,
  countMerchantProducts,
  getMerchantProducts,
  getMerchantSkuPrices,
  setMerchantSkuPrice,
  setMerchantSkuStock,
  updateProductPrice,
  updateProductStatus,
  updateProductStock,
  type MerchantProductVO,
  type MerchantSkuPriceVO,
} from '@/api/merchant'
import ProductCard from '@/components/merchant/ProductCard.vue'
// 空状态（设计稿 2026-09-22）：普通空态与「搜索无结果」是**两张不同插画**；插画放本分包 static
import EmptyState from '@/components/EmptyState.vue'

/** 库存预警阈值（设计稿示例 100；阈值来源待产品/后端确认）。 */
const LOW_STOCK_THRESHOLD = 100

const TABS = [
  { key: 'onSale', label: '在售中', status: 1 as 0 | 1 | '' },
  { key: 'warning', label: '库存预警', status: 1 as 0 | 1 | '' },
  { key: 'offSale', label: '仓库中', status: 0 as 0 | 1 | '' },
] as const
type TabKey = (typeof TABS)[number]['key']

/**
 * 空状态（设计稿 2026-09-22）：
 * - 普通空态：插画 `products.png` + 「暂无商品」；
 * - 搜索无结果：插画 `products-search.png` + 「暂无搜索商品」（**两张插画不同**，见下方 emptyImage / emptyText）。
 * ⚠️ 口径变化：原来按 Tab 分文案（暂无在售商品 / 暂无库存预警商品 / 仓库中暂无商品），设计稿统一为「暂无商品」。
 */

/** 状态栏高度（自定义导航需避开状态栏）。 */
const statusBarHeight = ref(0)
/** 页头高度 = 状态栏 + 44px 标题栏 + 46px Tab 栏（px）。 */
const HEADER_TITLE_H = 44
const HEADER_TAB_H = 46
const contentTop = computed(() => statusBarHeight.value + HEADER_TITLE_H + HEADER_TAB_H)

/**
 * `nav-row` 右侧需要预留的安全区宽度（px）—— 用来**避开微信右上角胶囊**。
 *
 * ⚠️ 2026-09-30 修（与商家端订单页同批，用户反馈胶囊遮挡）：
 *    本页 `nav-row` 里是「返回 + 搜索框」，而搜索框是 `flex: 1` ⇒ **会一直延伸到屏幕右边缘**，
 *    于是被右上角的微信胶囊盖住 —— 尤其是搜索框**右端的「×」清除按钮**，
 *    用户输入关键词后**根本点不到**（比视觉遮挡更严重）。
 * ⚠️ 项目里其它页面都用 `uni.getMenuButtonBoundingClientRect()` 取胶囊位置，本页此前漏了。
 * ⚠️ 取「屏幕宽 − 胶囊左边界 + 8px 间距」作为 `padding-right`；
 *    非微信环境取不到 rect 时保持 0，退回样式表里原有的 `23rpx`。
 */
const menuSafeRight = ref(0)

onMounted(() => {
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect && rect.left) {
      const windowWidth = uni.getSystemInfoSync().windowWidth || 0
      const safe = windowWidth - rect.left + 8
      if (safe > 0) menuSafeRight.value = safe
    }
  } catch { /* 非微信环境忽略 */ }
})

const activeTab = ref<TabKey>('onSale')
const keyword = ref('')

/** 是否处于「搜索无结果」：有关键词时用搜索专用插画与文案（设计稿里那是**另一张插画**）。 */
const isSearchEmpty = computed(() => Boolean(keyword.value.trim()))
const emptyImage = computed(() => (isSearchEmpty.value ? '/subpkg-merchant/static/empty/products-search.png' : '/subpkg-merchant/static/empty/products.png'))
const emptyText = computed(() => (isSearchEmpty.value ? '暂无搜索商品' : '暂无商品'))
const products = ref<MerchantProductVO[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const loadingMore = ref(false)
const acting = ref(false)

/** 各 Tab 商品数（在售中/仓库中取接口 total；库存预警取**全量扫描**计数）。 */
const tabCounts = reactive<Record<TabKey, number>>({ onSale: 0, warning: 0, offSale: 0 })

/**
 * 刷新「库存预警」计数（**全量口径**）。
 *
 * ⚠️ 2026-09-30 修（审计发现）：原先预警计数是
 * `products.value.filter(...)` —— 而 `products` **只含已加载的页**（pageSize = 10）
 * ⇒ **商品超过 10 件的店会漏报**，而且角标数字会随"用户上拉加载了几页"变化，
 * 与商家工作台的 `lowStockCount`（后端全量）对不上，商家会以为数据错了。
 *
 * ⚠️ 契约 `/api/merchant/products` **只返回分页列表、没有低库存计数字段**，
 * 所以这里沿用项目既有模式（见 `api/merchant.ts` 的 `countMerchantProducts`）：
 * **扫描最多 `PRODUCT_COUNT_SCAN_LIMIT` 条**自己统计。
 * ⚠️ 局限与 `countMerchantProducts` 一致：商品数 >100 时仍会偏小
 * （等后端修好 `total` 的过滤后，这里可改回读 `total`，已登记 `后端需求汇总-2026-09-19.md` §十三）。
 */
async function refreshLowStockCount(): Promise<void> {
  try {
    // ⚠️ 「在售中」是 **status=1**（对照同文件 `refreshTabCounts` 的 `countMerchantProducts(1)`）；
    //    仓库中（status=0）的商品不需要库存预警，故只扫在售中的。
    const result = await getMerchantProducts({ status: 1, page: 1, pageSize: PRODUCT_COUNT_SCAN_LIMIT })
    const list = Array.isArray(result?.list) ? result.list : []
    tabCounts.warning = list.filter((p) => effectiveStock(p) <= LOW_STOCK_THRESHOLD).length
  } catch (error) {
    // ⚠️ 计数失败不影响主流程（列表照常展示），只记日志不打扰用户
    console.error('库存预警计数刷新失败', error)
  }
}

/** 批量模式：勾选集合（productId）。 */
const batchMode = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const selectedCount = computed(() => selectedIds.value.size)
const allSelected = computed(() => products.value.length > 0 && products.value.every((p) => selectedIds.value.has(p.productId as number)))

/** 当前 Tab 是否为「库存预警」（本地过滤低库存）。 */
const isWarningTab = computed(() => activeTab.value === 'warning')

/** 当前列表渲染数据（预警 Tab 额外过滤低库存）。 */
const renderList = computed<MerchantProductVO[]>(() => {
  if (!isWarningTab.value) return products.value
  return products.value.filter((p) => effectiveStock(p) <= LOW_STOCK_THRESHOLD)
})

/**
 * 当前 Tab 左侧按钮文案：在售中/预警 = 「更多」（进详情做本店停售），仓库中 = 「恢复销售」。
 *
 * ⚠️ 2026-09-30 文案按后端答复调整：接口是**门店级**上下架（本店 `shop_product.status`），
 *    不是"从商城下架"，故不再用「上架商品」这种会引起误解的说法。
 */
const leftBtnText = computed(() => (activeTab.value === 'offSale' ? '恢复销售' : '更多'))

/** 批量操作方向：在售中/预警 → 本店停售(0)，仓库中 → 恢复销售(1)。 */
const batchTargetStatus = computed<0 | 1>(() => (activeTab.value === 'offSale' ? 1 : 0))
/** 批量按钮文案（⚠️ 判断一律用 `batchTargetStatus`，不要拿文案字符串比较）。 */
const batchActionLabel = computed(() => (batchTargetStatus.value === 1 ? '恢复销售' : '本店停售'))

/**
 * 本店有效库存（**优先用契约字段 `effectiveStock`**）。
 *
 * ⚠️ 2026-09-30 修（审计发现）：原先用 `shopStock ?? totalStock` **自造**"有效库存"，
 * 而契约 `MerchantProductVO` **本身就提供 `effectiveStock`**，且注释明确三者**不是同一个数**：
 * `effectiveStock` = 逐 SKU 三级回退后**减锁定**、下限 0 再求和；
 * `totalStock` = 品牌级、**不减锁定**；`shopStock` = SPU 级门店覆盖值。
 * ⇒ 用错值会让**商家看到的库存与 C 端可售库存不一致**（显示有货、用户下单无货），
 *   且「库存预警」也按错值过滤。
 * ⚠️ 回退链保留：老后端不下发 `effectiveStock` 时依次退到 `shopStock` → `totalStock`。
 */
function effectiveStock(p: MerchantProductVO): number {
  const v = p.effectiveStock ?? p.shopStock ?? p.totalStock
  return v == null ? 0 : Number(v)
}

// ===== 弹层状态 =====
/** 改价目标商品。 */
const priceTarget = ref<MerchantProductVO | null>(null)
const priceInput = ref('')
/** 改库存目标商品。 */
const stockTarget = ref<MerchantProductVO | null>(null)
const stockInput = ref('')
/** 上/下架确认（单条或批量）。 */
const confirmVisible = ref(false)
const confirmText = ref('')
const confirmFn = ref<null | (() => Promise<void>)>(null)

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '商品管理' })
})

onShow(() => {
  void refreshTabCounts()
  void loadList(true)
})

/**
 * 拉取在售中 / 仓库中的数量（用于 Tab 数字），失败静默置 0。
 *
 * ✅ 2026-09-30：`countMerchantProducts()` 已**改回读接口的 `total`** ——
 * 后端已修 `status` 过滤（`total` 与 `list` 口径一致，见 `api/merchant.ts` 的口径说明）。
 * ⚠️ 历史：此前因 `total` 未按 `status` 过滤而改为"按返回条数统计"，
 *    该绕过在商品 >100 条时偏小，后端修复后已弃用。
 */
async function refreshTabCounts(): Promise<void> {
  try {
    const [onSale, offSale] = await Promise.all([countMerchantProducts(1), countMerchantProducts(0)])
    tabCounts.onSale = onSale
    tabCounts.offSale = offSale
    // ⚠️ 2026-09-30：「库存预警」角标也必须用**全量扫描**口径 ——
    //    原先它只在 `loadList` 里按"已加载页"统计，商品 >10 件时漏报且数字随翻页变化。
    //    放在这里（而不是 `loadList`）是因为 `onShow` 与增删改后都会调用本函数，
    //    既覆盖了所有该刷新的时机，又不会每翻一页都多发一次请求。
    await refreshLowStockCount()
  } catch {
    // 忽略：Tab 数字不影响主流程
  }
}

/** 加载当前 Tab 列表。reset=true 重置到第一页。 */
/**
 * 请求竞态 token：快速连点 Tab / 改关键词时，**丢弃过期响应**。
 *
 * ⚠️ 2026-09-30 修（审计发现）：原先 `loadList` **完全没有请求归属校验**，
 * 先发后到的旧响应会直接覆盖新结果 ⇒ **Tab 已切、列表却是旧 Tab 的数据**，且无任何提示。
 * ⚠️ 本项目已有成熟写法（`subpkg-wallet/favorite/list.vue:18/55/62/68/71`），此处对齐即可。
 */
let listToken = 0

async function loadList(reset = false): Promise<void> {
  if (reset) {
    page.value = 1
    products.value = []
  }
  const isFirst = page.value === 1
  if (isFirst) loading.value = true
  else loadingMore.value = true
  // ⚠️ 发起前"占号"：此后所有 `token !== listToken` 的响应都是过期的
  const token = ++listToken

  try {
    const tab = TABS.find((t) => t.key === activeTab.value)!
    const result = await getMerchantProducts({
      keyword: keyword.value || undefined,
      status: tab.status,
      page: page.value,
      pageSize,
    })
    // ⚠️ 过期响应一律丢弃（含 total / tabCounts，避免用旧数据污染计数）
    if (token !== listToken) return
    const list = Array.isArray(result?.list) ? result.list : []
    products.value = isFirst ? list : [...products.value, ...list]
    total.value = Number(result?.total || 0)
    // 第一页为空 ⇒ 当前 Tab 确实没有商品：把 total 与 Tab 数字一起归零
    // ⚠️ 2026-09-30：后端已修 `total` 的 `status` 过滤（`total` 与 `list` 口径一致），
    //    所以这不再是"修正虚高"的必需动作，而是**防御异常数据**的兜底（列表空却 total 非 0）。
    if (isFirst && list.length === 0) {
      total.value = 0
      tabCounts[activeTab.value] = 0
    }
    if (isWarningTab.value) tabCounts.warning = products.value.filter((p) => effectiveStock(p) <= LOW_STOCK_THRESHOLD).length
    // ⚠️ 2026-09-30：上面这行只是"当前已加载页"的即时反馈；角标的**权威口径**由
    //    `refreshTabCounts()` → `refreshLowStockCount()` 全量扫描给出（见其注释），
    //    这里**不再**附带调用，避免每翻一页都多发一次请求。
  } catch (error) {
    if (token !== listToken) return
    if (isFirst) products.value = []
    uni.showToast({ title: error instanceof Error ? error.message : '加载失败', icon: 'none' })
  } finally {
    // ⚠️ 只有**最新**请求才能关 loading：否则旧请求结束时会提前关掉新请求的加载态
    if (token === listToken) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

/** 上拉加载更多。 */
function loadMore(): void {
  if (loading.value || loadingMore.value) return
  if (products.value.length >= total.value) return
  page.value += 1
  void loadList()
}

/** 切换 Tab（退出批量模式并重新加载）。 */
function switchTab(key: TabKey): void {
  if (activeTab.value === key) return
  activeTab.value = key
  exitBatchMode()
  void loadList(true)
}

/** 搜索（输入确认后按关键词过滤当前 Tab）。 */
function onSearchConfirm(): void {
  exitBatchMode()
  void loadList(true)
}

/** 清空搜索词。 */
function onClearSearch(): void {
  keyword.value = ''
  void loadList(true)
}

// ===== 批量模式 =====
function enterBatchMode(): void {
  batchMode.value = true
  selectedIds.value = new Set()
}

function exitBatchMode(): void {
  batchMode.value = false
  selectedIds.value = new Set()
}

/**
 * 批量模式下该商品是否被勾选。
 *
 * ⚠️ 2026-09-30：原模板写的是 `selectedIds.has(product.productId as number)` ——
 * **模板里写 TS 断言违反本项目自定规范**（`CLAUDE.md`：模板禁复杂表达式 / TS 断言，
 * 小程序端模板编译对复杂表达式支持有限）。类型收敛挪到这里，模板只留一次函数调用。
 * ⚠️ `productId` 可能是可选值（同文件多处用 `as number` 断言），故先 `Number()` 再判 `isFinite`，
 * 非法值一律视为"未勾选"，不会误命中集合。
 */
function isSelected(product: MerchantProductVO): boolean {
  const id = Number(product.productId)
  return Number.isFinite(id) && selectedIds.value.has(id)
}

function toggleSelect(product: MerchantProductVO): void {
  const id = product.productId as number
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function toggleAll(): void {
  if (allSelected.value) {
    selectedIds.value = new Set()
    return
  }
  selectedIds.value = new Set(renderList.value.map((p) => p.productId as number))
}

/** 批量上/下架：弹确认后调用批量接口。 */
function onBatchAction(): void {
  if (selectedCount.value === 0) {
    uni.showToast({ title: '请先选择商品', icon: 'none' })
    return
  }
  // ⚠️ 2026-09-30 确认文案按**新的 C 端可见性口径**订正（后端答复 §八）：
  //    原文案写「下架后用户无法购买」是**错的** —— 这是**门店级**停售，
  //    C 端是否可见取决于「是否还有**其他门店**在售」：
  //    单门店停售 ⇒ 商城不再展示；多门店且仍有门店在售 ⇒ 仍然可见。
  const tip = batchTargetStatus.value === 1
    ? '恢复销售后，只要商品本体仍上架，该商品会重新在商城可见'
    : '本店停售后：若没有其他门店在售，该商品将从商城隐藏；历史订单正常保留'
  openConfirm(`即将${batchActionLabel.value} ${selectedCount.value} 件商品，${tip}`, async () => {
    await batchUpdateProducts([...selectedIds.value], batchTargetStatus.value)
    exitBatchMode()
    await refreshTabCounts()
    await loadList(true)
  })
}

// ===== 单条操作 =====
function onCardAction(payload: { type: 'left' | 'price' | 'stock' | 'sku' | 'edit'; product: MerchantProductVO }): void {
  if (payload.type === 'price') openPrice(payload.product)
  else if (payload.type === 'stock') openStock(payload.product)
  else if (payload.type === 'sku') void openSkuDialog(payload.product)
  else if (payload.type === 'edit') openEdit(payload.product)
  else onLeftAction(payload.product)
}

/**
 * 左侧按钮：在售中/预警 = **本店停售**，仓库中 = **恢复销售**。
 *
 * ⚠️ 2026-09-30 文案按后端答复调整（《后端答复-商家端4项问题与附录-2026-09-30》§二/Q3）：
 *    该接口是**门店级**上下架（只改本店 `shop_product.status`，不动商品本体），
 *    原文案「上架/下架」会让商户误以为是**从商城下架**。
 */
function onLeftAction(product: MerchantProductVO): void {
  const target: 0 | 1 = activeTab.value === 'offSale' ? 1 : 0
  const label = target === 1 ? '恢复销售' : '本店停售'
  openConfirm(`确定${label}「${product.name || ''}」吗？`, async () => {
    await updateProductStatus(product.productId as number, target)
    await refreshTabCounts()
    await loadList(true)
  })
}

/** 编辑商品：把列表项暂存到 storage（无单商品详情接口，用列表项回填），跳编辑页。 */
function openEdit(product: MerchantProductVO): void {
  uni.setStorageSync('merchant_product_edit', product)
  uni.navigateTo({ url: `/subpkg-merchant/products/edit?productId=${product.productId}` })
}

/** 新增商品：跳编辑页（无 productId）。 */
function onAddProduct(): void {
  uni.navigateTo({ url: '/subpkg-merchant/products/edit' })
}

// ===== 改价 / 改库存弹层 =====
function openPrice(product: MerchantProductVO): void {
  priceTarget.value = product
  priceInput.value = ''
  // 已有门店价则回填，否则用品牌最低价
  const cur = product.shopPrice ?? product.minPrice
  if (cur != null) priceInput.value = String(cur)
}

function submitPrice(): void {
  const target = priceTarget.value
  if (!target) return
  const value = Number(priceInput.value)
  if (!Number.isFinite(value) || value <= 0) {
    uni.showToast({ title: '请输入正确的价格', icon: 'none' })
    return
  }
  void doSubmit(async () => {
    await updateProductPrice(target.productId as number, value)
    priceTarget.value = null
    await loadList(true)
  })
}

function openStock(product: MerchantProductVO): void {
  stockTarget.value = product
  stockInput.value = ''
  // ⚠️ 2026-09-30 同 `effectiveStock()`：改库存的**回填起点**也应优先用契约的「本店有效库存」，
  //    否则商家看到的"当前库存"与实际可售不一致 ⇒ 会基于错误的起点改库存。
  const cur = product.effectiveStock ?? product.shopStock ?? product.totalStock
  if (cur != null) stockInput.value = String(cur)
}

function submitStock(): void {
  const target = stockTarget.value
  if (!target) return
  const value = Number(stockInput.value)
  if (!Number.isInteger(value) || value < 0) {
    uni.showToast({ title: '请输入正确的库存', icon: 'none' })
    return
  }
  void doSubmit(async () => {
    await updateProductStock(target.productId as number, value)
    stockTarget.value = null
    await loadList(true)
  })
}

// ===== 按规格设价 / 设库存（多规格商品；SKU 级，2026-10-08 新增，对齐单 §四 #4 / B-5）=====
/**
 * 多规格商品**必须**按规格设价/设库存 —— SPU 级「改价 / 改库存」在多规格下只能
 * "统一作用于全部规格"（例：500g ¥39 / 1kg ¥69 只能填一个值）⇒ 多规格卡片改走本弹层
 * （`ProductCard` 用 `skuCount > 1` 判断，与后台 `shop-console` 同口径）。
 *
 * 契约（`GET/PUT /api/merchant/products/{productId}/skus|sku-price|sku-stock`）：
 * 与后台端点**逐字同构**，唯一差别是商家端**不带 `shopId`**（门店由登录态解析）。
 */
interface SkuEditRow extends MerchantSkuPriceVO {
  /** 门店价输入框（字符串；**空 = 跟随上一级**）。 */
  inputPrice: string
  /** 门店库存输入框（字符串；**空 = 跟随上一级**）。 */
  inputStock: string
}

const skuTarget = ref<MerchantProductVO | null>(null)
const skuRows = ref<SkuEditRow[]>([])
const skuLoading = ref(false)
/** 整表提交中（京东风格是底部「确定」**一次性提交所有改动行**，故用一个整体 loading）。 */
const skuSaving = ref(false)

/**
 * 契约行 → 编辑行：**只有"本店已按规格设置"才回填**，否则留空（= 跟随上一级）。
 * ⚠️ 不把生效值填进输入框 —— 否则商家一进弹层就有值，容易被"确定"误写成 SKU 级设置。
 */
function toSkuEditRow(item: MerchantSkuPriceVO): SkuEditRow {
  return {
    ...item,
    inputPrice: item.skuShopPrice != null ? String(item.skuShopPrice) : '',
    inputStock: item.skuShopStock != null ? String(item.skuShopStock) : '',
  }
}

/** 打开「按规格设价 / 设库存」弹层：拉该商品各规格的生效价与来源。 */
async function openSkuDialog(product: MerchantProductVO): Promise<void> {
  if (!product.productId) return
  skuTarget.value = product
  skuRows.value = []
  skuLoading.value = true
  try {
    const list = await getMerchantSkuPrices(product.productId)
    skuRows.value = list.map(toSkuEditRow)
    if (!list.length) uni.showToast({ title: '该商品暂无可设置的规格', icon: 'none' })
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '规格查询失败', icon: 'none' })
  } finally {
    skuLoading.value = false
  }
}

function closeSkuDialog(): void {
  skuTarget.value = null
  skuRows.value = []
}

/** 生效价来源文案（三级回退；`NONE` / 未知一律「—」）。 */
const SKU_PRICE_SOURCE_TEXT: Record<string, string> = { SKU: '按规格设价', SHOP: '按商品设价', PRODUCT: '商品原价' }
/** 生效库存来源文案（三级回退；`NONE` / 未知一律「—」）。 */
const SKU_STOCK_SOURCE_TEXT: Record<string, string> = { SKU: '按规格控', SHOP: '按商品控', PRODUCT: '商品总库存' }
function skuPriceSourceText(source?: string): string {
  return (source && SKU_PRICE_SOURCE_TEXT[source]) || '—'
}
function skuStockSourceText(source?: string): string {
  return (source && SKU_STOCK_SOURCE_TEXT[source]) || '—'
}

/** 金额展示：**缺失 / 非法一律「—」**，⛔ 不兜底成 ¥0.00（与后台同口径）。 */
function skuMoneyText(value?: number | null): string {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return `¥${num.toFixed(2).replace(/\.?0+$/, '')}`
}

/**
 * 该规格的**生效价 / 生效库存**，用作输入框 placeholder —— 让"留空会跟到哪一级"一目了然
 * （京东风格不做额外开关，靠"留空 = 跟随"表达，且**填 `0` 与没填能区分**：库存 0 是合法值）。
 */
function effectivePriceText(row: SkuEditRow): string {
  const text = skuMoneyText(row.price)
  return text === '—' ? '跟随上一级' : `跟随 ${text}`
}
function effectiveStockText(row: SkuEditRow): string {
  const stock = row.stock
  return stock === null || stock === undefined ? '跟随上一级' : `跟随 ${stock}`
}

/** 行内输入：小程序 `input` 用 `:value` + `@input` 才稳（直接 v-model 数组元素对象字段在真机上偶发不回写）。 */
function onSkuPriceInput(index: number, e: { detail: { value: string } }): void {
  const row = skuRows.value[index]
  if (row) row.inputPrice = e.detail.value
}
function onSkuStockInput(index: number, e: { detail: { value: string } }): void {
  const row = skuRows.value[index]
  if (row) row.inputStock = e.detail.value
}

/** 解析某行待提交值：**空串 = `null`（清除该规格的 SKU 级设置、回退上一级）**，否则转数字。 */
function parseSkuInput(raw: string): number | null {
  const text = String(raw ?? '').trim()
  return text === '' ? null : Number(text)
}

/**
 * 底部「确定」：**一次性提交所有变更行**（京东风格）。
 *
 * ⚠️ 只提交**真正改动过**的那一项 —— 无关改动也提交会放大失败面
 *   （只改价却把库存一并写回，第二步失败时价已落库、却只报"保存失败"）。
 * ⚠️ 先**逐行校验**，任何一行不合法就整体不提交（避免"存了一半"）。
 * ⚠️ 成功后**关闭弹层并刷新列表页** —— 弹层已关，不存在"整表重拉丢其它行编辑"的问题。
 */
async function submitSkuAll(): Promise<void> {
  const productId = skuTarget.value?.productId
  if (!productId) return
  // 1) 整体校验 + 收集变更（不合法直接 return，不发任何请求）
  const changes: Array<{ row: SkuEditRow; nextPrice: number | null; nextStock: number | null; priceChanged: boolean; stockChanged: boolean }> = []
  for (const row of skuRows.value) {
    const nextPrice = parseSkuInput(row.inputPrice)
    const nextStock = parseSkuInput(row.inputStock)
    if (nextPrice !== null && (!Number.isFinite(nextPrice) || nextPrice <= 0)) {
      uni.showToast({ title: `「${row.skuName || row.skuId}」价格需大于 0`, icon: 'none' })
      return
    }
    if (nextStock !== null && (!Number.isInteger(nextStock) || nextStock < 0)) {
      uni.showToast({ title: `「${row.skuName || row.skuId}」库存需为非负整数`, icon: 'none' })
      return
    }
    const priceChanged = (row.skuShopPrice ?? null) !== nextPrice
    const stockChanged = (row.skuShopStock ?? null) !== nextStock
    if (priceChanged || stockChanged) changes.push({ row, nextPrice, nextStock, priceChanged, stockChanged })
  }
  if (!changes.length) {
    uni.showToast({ title: '没有改动', icon: 'none' })
    return
  }
  // 2) 逐行提交（只发变更过的项）
  skuSaving.value = true
  let doneRows = 0
  try {
    for (const c of changes) {
      if (c.priceChanged) await setMerchantSkuPrice(productId, c.row.skuId, c.nextPrice)
      if (c.stockChanged) await setMerchantSkuStock(productId, c.row.skuId, c.nextStock)
      doneRows++
    }
    uni.showToast({ title: '保存成功', icon: 'success' })
    closeSkuDialog()
    await loadList(true)
  } catch (error) {
    // ⚠️ 半保存要说清楚：前面那些行**已经写进库**了，不能只报"保存失败"让用户以为都没动
    const note = doneRows > 0 ? `（前 ${doneRows} 个规格已保存成功，请重试其余）` : ''
    uni.showToast({ title: (error instanceof Error ? error.message : '保存失败') + note, icon: 'none' })
    if (doneRows > 0) await loadList(true)
  } finally {
    skuSaving.value = false
  }
}

// ===== 确认弹层 =====
function openConfirm(text: string, fn: () => Promise<void>): void {
  confirmText.value = text
  confirmFn.value = fn
  confirmVisible.value = true
}

function closeConfirm(): void {
  confirmVisible.value = false
  confirmFn.value = null
}

/** 提交动作统一包装：loading 态 + 错误 toast。 */
async function doSubmit(fn: () => Promise<void>): Promise<void> {
  if (acting.value) return
  acting.value = true
  try {
    await fn()
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
  } finally {
    acting.value = false
  }
}

async function onConfirm(): Promise<void> {
  const fn = confirmFn.value
  closeConfirm()
  if (!fn) return
  await doSubmit(fn)
}

function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <!-- 页头（白底）：返回 + 搜索框 + Tab -->
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <!--
        ⚠️ 2026-09-30：`paddingRight` 预留给微信胶囊的安全区，
        否则 `flex:1` 的搜索框（含右端「×」清除按钮）会被胶囊盖住、点不到。
      -->
      <view class="nav-row" :style="menuSafeRight ? { paddingRight: menuSafeRight + 'px' } : {}">
        <text class="nav-back" @click="goBack">‹</text>
        <view class="search-box">
          <text class="rider-icon rider-icon-sousuo search-icon" />
          <input
            class="search-input"
            v-model="keyword"
            placeholder="搜索商品"
            placeholder-class="search-ph"
            confirm-type="search"
            @confirm="onSearchConfirm"
          />
          <text v-if="keyword" class="search-clear" @click="onClearSearch">×</text>
        </view>
      </view>
      <view class="tabs">
        <view v-for="tab in TABS" :key="tab.key" class="tab" @click="switchTab(tab.key)">
          <text class="tab-text" :class="{ 'is-active': activeTab === tab.key }">{{ tab.label }}<text v-if="tabCounts[tab.key] > 0"> {{ tabCounts[tab.key] }}</text></text>
          <view class="tab-line" :class="{ 'is-active': activeTab === tab.key }" />
        </view>
      </view>
    </view>

    <!-- 列表 -->
    <scroll-view class="list" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false" @scrolltolower="loadMore">
      <view v-if="loading" class="state">加载中…</view>
      <EmptyState v-else-if="!renderList.length" :image="emptyImage" :text="emptyText" />
      <template v-else>
        <view v-for="product in renderList" :key="product.productId" class="list-card">
          <ProductCard
            :product="product"
            :mode="batchMode ? 'batch' : 'normal'"
            :selected="isSelected(product)"
            :left-btn="leftBtnText"
            @select="toggleSelect"
            @action="onCardAction"
          />
        </view>
        <view class="list-footer">{{ loadingMore ? '加载中…' : (products.length >= total ? '没有更多了' : '上拉加载更多') }}</view>
      </template>
    </scroll-view>

    <!-- 底部操作栏 -->
    <view class="footer">
      <!-- 普通模式 -->
      <view v-if="!batchMode" class="footer-row">
        <button class="footer-btn footer-btn-ghost" @click="enterBatchMode">批量管理</button>
        <button class="footer-btn footer-btn-primary" @click="onAddProduct">新增商品</button>
      </view>
      <!-- 批量模式 -->
      <view v-else class="footer-row footer-row-batch">
        <view class="select-all" @click="toggleAll">
          <view class="check" :class="{ 'is-checked': allSelected }">
            <text v-if="allSelected" class="rider-icon rider-icon-gouxuan_tianchong check-icon" />
          </view>
          <text class="select-all-text">全选</text>
          <text class="selected-count">已选 {{ selectedCount }} 个商品</text>
        </view>
        <button
          class="footer-btn footer-btn-ghost footer-btn-batch"
          :class="{ 'is-disabled': selectedCount === 0 }"
          :disabled="selectedCount === 0 || acting"
          @click="onBatchAction"
        >{{ batchTargetStatus === 1 ? '恢复销售' : '本店停售' }}</button>
      </view>
    </view>

    <!-- 改价弹层 -->
    <view v-if="priceTarget" class="mask mask-bottom" @click="priceTarget = null">
      <view class="sheet" @click.stop>
        <view class="sheet-title">
          <text class="sheet-title-text">修改价格</text>
          <text class="sheet-close" @click="priceTarget = null">×</text>
        </view>
        <view class="sheet-body">
          <text class="sheet-label">价格</text>
          <input class="sheet-input" v-model="priceInput" type="digit" placeholder="请输入价格" placeholder-class="sheet-ph" />
          <text class="sheet-unit">元</text>
        </view>
        <view class="sheet-actions">
          <button class="sheet-btn sheet-btn-cancel" @click="priceTarget = null">取消</button>
          <button class="sheet-btn sheet-btn-confirm" :disabled="acting" @click="submitPrice">确定</button>
        </view>
      </view>
    </view>

    <!-- 改库存弹层 -->
    <view v-if="stockTarget" class="mask mask-bottom" @click="stockTarget = null">
      <view class="sheet" @click.stop>
        <view class="sheet-title">
          <text class="sheet-title-text">修改库存</text>
          <text class="sheet-close" @click="stockTarget = null">×</text>
        </view>
        <view class="sheet-body">
          <text class="sheet-label">库存</text>
          <input class="sheet-input" v-model="stockInput" type="number" placeholder="请输入库存" placeholder-class="sheet-ph" />
          <text class="sheet-unit">件</text>
        </view>
        <view class="sheet-actions">
          <button class="sheet-btn sheet-btn-cancel" @click="stockTarget = null">取消</button>
          <button class="sheet-btn sheet-btn-confirm" :disabled="acting" @click="submitStock">确定</button>
        </view>
      </view>
    </view>

    <!-- 按规格设价 / 设库存（多规格商品；SKU 级，**京东风格紧凑列表**，2026-10-08） -->
    <view v-if="skuTarget" class="mask mask-bottom" @click="closeSkuDialog">
      <view class="sku-sheet" @click.stop>
        <view class="sku-title">
          <text class="sku-title-text">按规格设价 / 设库存</text>
          <text class="sku-close" @click="closeSkuDialog">×</text>
        </view>
        <view class="sku-tip">
          {{ skuTarget.name }} · 共 {{ skuRows.length }} 个规格 ·
          <text class="sku-tip-strong">留空 = 跟随上一级</text>（输入框里的灰色字是当前生效值）
        </view>
        <!-- 表头（与数据行同一套列宽，三列对齐） -->
        <view class="sku-thead">
          <text class="sku-col-name">规格</text>
          <text class="sku-col">门店价</text>
          <text class="sku-col">门店库存</text>
        </view>
        <scroll-view class="sku-list" scroll-y>
          <view v-if="skuLoading" class="sku-state">加载中…</view>
          <view v-else-if="!skuRows.length" class="sku-state">该商品暂无可设置的规格</view>
          <view v-for="(row, index) in skuRows" :key="row.skuId" class="sku-row">
            <text class="sku-col-name sku-name">{{ row.skuName || ('规格 ' + row.skuId) }}</text>
            <input
              class="sku-input"
              :value="row.inputPrice"
              type="digit"
              :placeholder="effectivePriceText(row)"
              placeholder-class="sku-ph"
              @input="onSkuPriceInput(index, $event)"
            />
            <input
              class="sku-input"
              :value="row.inputStock"
              type="number"
              :placeholder="effectiveStockText(row)"
              placeholder-class="sku-ph"
              @input="onSkuStockInput(index, $event)"
            />
          </view>
        </scroll-view>
        <!-- 底部统一提交（京东风格：一次确定提交所有改动行） -->
        <view class="sku-actions">
          <button class="sku-btn sku-btn-cancel" :disabled="skuSaving" @click="closeSkuDialog">取消</button>
          <button class="sku-btn sku-btn-ok" :disabled="skuSaving" @click="submitSkuAll">{{ skuSaving ? '保存中…' : '确定' }}</button>
        </view>
      </view>
    </view>

    <!-- 本店停售/恢复销售 确认对话框 -->
    <view v-if="confirmVisible" class="mask mask-center" @click="closeConfirm">
      <view class="dialog" @click.stop>
        <!-- ⚠️ 2026-09-30：原判断是 `batchActionLabel === '上架'` —— **拿文案当逻辑用**，
             改文案后它会恒为 false（标题永远显示"下架商品"）⇒ 改用状态值判断。 -->
        <text class="dialog-title">{{ batchTargetStatus === 1 ? '恢复销售' : '本店停售' }}</text>
        <text class="dialog-body">{{ confirmText }}</text>
        <view class="dialog-actions">
          <button class="dialog-btn" @click="closeConfirm">取消</button>
          <button class="dialog-btn dialog-btn-confirm" :disabled="acting" @click="onConfirm">确定</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  background: #f2f3f7;
}

/* 页头（白底，含状态栏 + 标题栏 + Tab） */
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  background: #ffffff;
}
.nav-row {
  display: flex;
  align-items: center;
  gap: 23rpx;
  height: 85rpx; /* 44px */
  padding: 0 23rpx;
}
.nav-back {
  flex: none;
  color: #1d2129;
  font-size: 46rpx;
  line-height: 1;
}
.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 69rpx; /* 36px */
  padding: 0 23rpx;
  border-radius: 9999rpx;
  background: #f1f2f4;
}
.search-icon {
  flex: none;
  color: #86909c;
  font-size: 30rpx;
}
.search-input {
  flex: 1;
  min-width: 0;
  color: #1d2129;
  font-size: 28rpx;
}
.search-ph {
  color: #86909c;
}
.search-clear {
  flex: none;
  color: #86909c;
  font-size: 36rpx;
  line-height: 1;
  padding: 0 4rpx;
}

/* Tab 栏 */
.tabs {
  display: flex;
  align-items: center;
  height: 88rpx; /* 46px */
  padding: 0 8rpx;
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 31rpx;
}
.tab-text {
  color: #1d2129;
  font-size: 27rpx;
  font-weight: 400;
  line-height: 42rpx;
}
.tab-text.is-active {
  color: #ff5500;
  font-weight: 500;
}
.tab-line {
  width: 100%;
  height: 4rpx;
  margin-top: 10rpx;
  border-radius: 2rpx;
  background: transparent;
}
.tab-line.is-active {
  background: #ff5500;
}

/* 列表（flex:1 占据页头与底部栏之间的空间，底部留 padding 避免被固定栏遮挡） */
.list {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 15rpx 15rpx 204rpx;
}
.list-card {
  margin-bottom: 15rpx;
}
.state {
  padding: 200rpx 0;
  text-align: center;
  color: #86909c;
  font-size: 28rpx;
}
.list-footer {
  padding: 24rpx 0;
  text-align: center;
  color: #86909c;
  font-size: 24rpx;
}

/* 底部操作栏 */
.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  background: #ffffff;
  padding-bottom: env(safe-area-inset-bottom);
}
.footer-row {
  display: flex;
  align-items: center;
  gap: 15rpx;
  height: 138rpx; /* 72px */
  padding: 23rpx;
  box-sizing: border-box;
}
.footer-btn {
  margin: 0;
  padding: 0;
  height: 92rpx; /* 48px */
  border-radius: 24rpx;
  font-size: 31rpx;
  font-weight: 600;
  line-height: 92rpx;
}
.footer-btn::after {
  border: 0;
}
.footer-btn-ghost {
  flex: 112;
  background: #f6f7f9;
  color: #1d2129;
}
.footer-btn-primary {
  flex: 246;
  background: linear-gradient(90deg, #ff9301 0%, #ff6a01 50%, #ff4202 100%);
  color: #ffffff;
}
.footer-row-batch {
  justify-content: space-between;
}
.select-all {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38rpx;
  height: 38rpx;
  border-radius: 50%;
  border: 3rpx solid #d7dbe0;
  background: #ffffff;
}
.check.is-checked {
  border-color: transparent;
}
.check-icon {
  color: #ff5500;
  font-size: 34rpx;
}
.select-all-text {
  color: #1d2129;
  font-size: 27rpx;
}
.selected-count {
  color: #86909c;
  font-size: 27rpx;
}
.footer-btn-batch {
  flex: none;
  width: 216rpx;
}
.footer-btn-batch.is-disabled {
  opacity: 0.5;
}

/* 遮罩（底部弹层贴底、对话框居中） */
.mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
}
.mask-bottom {
  align-items: flex-end;
}
.mask-center {
  align-items: center;
  justify-content: center;
}
.sheet {
  width: 100%;
  padding: 31rpx 23rpx calc(31rpx + env(safe-area-inset-bottom));
  border-radius: 24rpx 24rpx 0 0;
  background: #ffffff;
}
.sheet-title {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  height: 46rpx;
}
.sheet-title-text {
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
}
.sheet-close {
  position: absolute;
  right: 0;
  top: 0;
  color: #1d2129;
  font-size: 40rpx;
  line-height: 1;
  padding: 0 4rpx;
}
.sheet-body {
  display: flex;
  align-items: center;
  gap: 23rpx;
  margin-top: 23rpx;
}
.sheet-label {
  flex: none;
  color: #1d2129;
  font-size: 27rpx;
}
.sheet-input {
  flex: 1;
  min-width: 0;
  height: 77rpx;
  padding: 0 23rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
  color: #1d2129;
  font-size: 27rpx;
}
.sheet-ph {
  color: #c1c5cc;
}
.sheet-unit {
  flex: none;
  color: #1d2129;
  font-size: 27rpx;
}
.sheet-actions {
  display: flex;
  gap: 15rpx;
  margin-top: 38rpx;
}
.sheet-btn {
  margin: 0;
  padding: 0;
  flex: 1;
  height: 77rpx;
  border-radius: 15rpx;
  font-size: 27rpx;
  font-weight: 500;
  line-height: 77rpx;
}
.sheet-btn::after {
  border: 0;
}
.sheet-btn-cancel {
  background: #f6f7f9;
  color: #1d2129;
}
.sheet-btn-confirm {
  background: #fff4e8;
  color: #ff5500;
}

/* ===== 按规格设价 / 设库存弹层（多规格商品；**京东风格紧凑列表**，2026-10-08）===== */
/* 比普通底部弹层高（要容纳多行规格），故单独一套容器样式（不直接用 .sheet） */
.sku-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 80vh;
  padding-bottom: env(safe-area-inset-bottom);
  border-radius: 24rpx 24rpx 0 0;
  background: #ffffff;
}
.sku-title {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  border-bottom: 2rpx solid #f2f3f7;
}
.sku-title-text {
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
}
.sku-close {
  position: absolute;
  right: 31rpx;
  top: 50%;
  transform: translateY(-50%);
  padding: 0 8rpx;
  color: #86909c;
  font-size: 40rpx;
  line-height: 1;
}
.sku-tip {
  padding: 19rpx 31rpx;
  background: #f7f8fa;
  color: #86909c;
  font-size: 23rpx;
  line-height: 34rpx;
}
.sku-tip-strong {
  color: #ff5500;
  font-size: 23rpx;
}
/* 表头与数据行共用同一套列宽（规格 150rpx + 价格/库存各 flex:1），保证三列对齐 */
.sku-thead {
  display: flex;
  align-items: center;
  gap: 15rpx;
  padding: 19rpx 31rpx;
}
.sku-thead .sku-col {
  flex: 1;
  color: #86909c;
  font-size: 23rpx;
}
.sku-thead .sku-col-name {
  flex: none;
  width: 150rpx;
  color: #86909c;
  font-size: 23rpx;
}
.sku-list {
  flex: 1;
  min-height: 0;
  max-height: 52vh;
}
.sku-state {
  padding: 80rpx 0;
  text-align: center;
  color: #86909c;
  font-size: 27rpx;
}
.sku-row {
  display: flex;
  align-items: center;
  gap: 15rpx;
  padding: 19rpx 31rpx;
  border-top: 2rpx solid #f2f3f7;
}
.sku-col-name {
  flex: none;
  width: 150rpx;
}
.sku-name {
  color: #1d2129;
  font-size: 27rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sku-input {
  flex: 1;
  min-width: 0;
  height: 69rpx;
  padding: 0 19rpx;
  border-radius: 12rpx;
  background: #f6f7f9;
  color: #1d2129;
  font-size: 27rpx;
  text-align: right;
}
.sku-ph {
  color: #c1c5cc;
  font-size: 23rpx;
}
.sku-actions {
  display: flex;
  gap: 15rpx;
  padding: 23rpx 31rpx;
  border-top: 2rpx solid #f2f3f7;
}
.sku-btn {
  margin: 0;
  padding: 0;
  flex: 1;
  height: 88rpx;
  border-radius: 16rpx;
  font-size: 31rpx;
  font-weight: 600;
  line-height: 88rpx;
}
.sku-btn::after {
  border: 0;
}
.sku-btn[disabled] {
  opacity: 0.6;
}
.sku-btn-cancel {
  background: #f6f7f9;
  color: #1d2129;
}
.sku-btn-ok {
  background: linear-gradient(90deg, #ff9301 0%, #ff6a01 50%, #ff4202 100%);
  color: #ffffff;
}

/* 居中对话框 */
.dialog {
  width: 577rpx; /* 300px */
  border-radius: 24rpx;
  background: #ffffff;
  overflow: hidden;
}
.dialog-title {
  display: block;
  padding: 46rpx 38rpx 0;
  text-align: center;
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
}
.dialog-body {
  display: block;
  padding: 31rpx 38rpx;
  color: #1d2129;
  font-size: 27rpx;
  line-height: 46rpx;
}
.dialog-actions {
  display: flex;
  border-top: 2rpx solid #e5e6eb;
}
.dialog-btn {
  margin: 0;
  padding: 0;
  flex: 1;
  height: 108rpx; /* 56px */
  border-radius: 0;
  background: #ffffff;
  color: #1d2129;
  font-size: 31rpx;
  line-height: 108rpx;
}
.dialog-btn::after {
  border: 0;
}
.dialog-btn + .dialog-btn {
  border-left: 2rpx solid #e5e6eb;
}
.dialog-btn-confirm {
  color: #ff5500;
  font-weight: 600;
}
</style>
