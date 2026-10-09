<script setup lang="ts">
/**
 * 商家端 · 新增 / 编辑商品（对应设计稿「新增商品」未录入/已录入两态）
 * 契约：POST /api/merchant/products（新增）、PUT /api/merchant/products/{id}（编辑）
 * 请求体 MerchantProductSaveDTO：title* / mainImages*（≤5）/ description / skus*[{specName,skuName,price,stock}] / detailImages / status /
 * pickupEnabled / deliveryEnabled（商品级配送方式，2026-09-22 新增，不传 = 不修改）
 * commissionRate（**商品级让利比例**，2026-10-08 新增，不传 = 不修改，见下方硬规则第 4 条）
 * 范围结论：规格页是独立整页；商品核心是上下架；编辑因无单商品详情接口，仅能回填列表项已有字段（title/mainImage/skus）。
 * 图片上传走 POST /api/common/upload（utils/request 的 uploadFile）。
 *
 * ⚠️ 编辑态四条硬规则（2026-09-21 实测后定，详见 doSave / buildPayload 注释；2026-09-22 追加第 3 条；
 *    2026-10-08 追加第 4 条）：
 *   1. **不传 `status`** —— 后端一收到 status 就会连品牌级 `productStatus` 一起改（品牌下所有门店一起下线），
 *      本店上下架另走 `updateProductStatus()`（PUT /api/merchant/products/{id}/status）；
 *   2. **description / detailImages 回填不到就不提交** —— 整页覆盖语义下空值会清空线上内容；
 *   3. **`pickupEnabled` / `deliveryEnabled`（商品级配送方式）回填不到就不提交** ——
 *      语义是「不传 = 不修改」，提交默认值 1 会把商家已关掉的开关重新打开（后端下单拦截 13023/13024）；
 *   4. **`commissionRate`（商品级让利比例）留空就不提交** —— 语义同样是「不传 = 不修改」；
 *      清空输入框**绝不能**翻译成 `0` / `null`（那等于把比例清成 0，且 0 越界会被后端判 13018）。
 *   5. （2026-10-09 追加）**`skus[].skuId` 必须回显→原样提交** —— 后端优先按它定位规格行，
 *      没有 id 时退化为按 `specName` 文本匹配 ⇒ **改个规格名就会变成"新增规格"**（旧行留着重名）。
 *      这一条此前是**真 bug**：类型里没有 `skuId`、`fillFromEditCache` 与 `buildPayload` 两处
 *      `map` 都把它丢了（详见 `fillFromEditCache` / `mergeSkusFromSpecPage` 注释）。
 *   6. （2026-10-09 追加）**`skus[].skuImage` 只在"商家真的动过"或"详情确实回显到了"时才提交** ——
 *      更新语义是「**不传 / null = 不修改**」（**不会清空**已有图），与中控那个「清除」按钮
 *      不是一回事；见 `buildPayload` 里 `skuImageChanged(s)` 的三种状态说明。
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  saveMerchantProduct,
  updateMerchantProduct,
  updateProductStatus,
  type MerchantProductSaveDTO,
  type MerchantProductVO,
  type MerchantSkuItem,
  type MerchantSkuSaveItem,
  type MerchantSkuVO,
} from '@/api/merchant'
import { isApiRequestError, uploadFile } from '@/utils/request'
// ⚠️ 生鲜开关的提示语**取单一来源**（同城 48 小时 / 资金 3 天可提 + 「物流与自提不受影响」），
//    不要在本页硬编码 —— 口径一改，这里就会漂（契约 `timing-category-window.contract.ps1` 有反向断言）。
import { TIMING_CATEGORY_FRESH_SWITCH_HINT } from '@/utils/timing-category'
// ⚠️ 商品级让利比例的口径与文案也**取单一来源**（区间 / 13018 文案 / 「未设置」文案 / 估算声明）——
//    页面里各写一份必然与后端契约漂移（契约 `product-commission-rate.contract.ps1` 有断言）。
import {
  PRODUCT_COMMISSION_ESTIMATE_NOTE,
  PRODUCT_COMMISSION_INPUT_PLACEHOLDER,
  PRODUCT_COMMISSION_OMIT_NOTE,
  PRODUCT_COMMISSION_RATE_ERROR_CODE,
  PRODUCT_COMMISSION_RATE_RANGE_TEXT,
  PRODUCT_COMMISSION_SNAPSHOT_NOTE,
  estimateProductCommissionAmount,
  formatProductCommissionRate,
  parseProductCommissionRateInput,
  productCommissionPreviewText,
  validateProductCommissionRate,
} from '@/utils/product-commission'

/** 编辑数据暂存 key（商品列表页写入，本页读取回填）。 */
const EDIT_STORAGE_KEY = 'merchant_product_edit'
/** 规格页传回 key（规格页保存后写入，本页 onShow 读取）。 */
const SKUS_STORAGE_KEY = 'merchant_product_skus'

const statusBarHeight = ref(0)
const contentTop = computed(() => statusBarHeight.value + 44)

/** 编辑模式：productId 非空。 */
const productId = ref<number | null>(null)
const pageTitle = computed(() => (productId.value ? '编辑商品' : '新增商品'))

const title = ref('')
const mainImages = ref<string[]>([])
const description = ref('')
const skus = ref<MerchantSkuItem[]>([])
const detailImages = ref<string[]>([])
/**
 * 编辑态是否从列表项回显到了「详情描述 / 详情图」。
 *
 * ✅ 2026-09-27：后端已在 `MerchantProductVO` 补上这两个字段，列表行会带值 ⇒ 正常情况下恒为 `true`。
 * **仍保留这两个标志作为安全网**：`PUT /api/merchant/products/{id}` 是**整页覆盖**语义，
 * 万一日后字段又没下发（或列表缓存缺失），「拿不到就不提交」能避免**静默清空线上描述 / 详情图**。
 * （与 `pickupEchoed` 同一思路。）
 */
const descEchoed = ref(false)
const detailImagesEchoed = ref(false)
/**
 * 用户是否在本次编辑里**动过**「详情描述」输入框。
 *
 * 用途：回显拿不到（后端未下发 `description`）时区分两种"空"——
 * - **没碰过** → 用户只是想改别的，必须**跳过该字段**（否则空值会清空线上描述）；
 * - **主动填了内容** → 用户就是要把它改成这个，**应当提交**。
 *
 * ⚠️ 缺了它，用户在空框里新写的描述会被静默丢弃：界面提示"保存成功"，其实没落库。
 * 这比"显示一条限制说明"严重得多 —— 所以宁可多一个标志位，也不靠文字提示糊过去。
 */
const descTouched = ref(false)

// ===== 规格图（按规格上传，2026-10-09 W14 新增）=====
/**
 * 编辑态：商品详情（= 列表项 `MerchantProductVO`）里**有没有下发** `skus[].skuImage`。
 *
 * 与 `descEchoed` / `detailImagesEchoed` **同一思路**（拿不到回显就别拿空值去覆盖线上数据），
 * 只是作用面是**行级**的：
 * - `true`（详情确实带了这个字段，或新增态）：**逐行原样回传** `skuImage` ——
 *   空串就是"这行本来就没图"，原样提交不会改变任何东西（后端「不传/null = 不修改」，
 *   而空串提交的是"确实是空的"，两者在**已回显**的前提下等价）；
 * - `false`（老后端没下发该字段）⇒ **只提交商家本次真的动过的行**（设了图 or 点了清除）——
 *   否则会把"我们不知道有没有图"当成"没有图"提交，把线上已有的规格图抹掉。
 *
 * ⚠️ 判据是**键是否存在**（`'skuImage' in sku`），**不是值**：`''` 是完全合法的值
 * （该规格确实没配图），拿值判会把"确实没图"误判成"后端没下发"。
 */
const skuImageEchoed = ref(false)
/** 正在上传规格图的规格（用**行对象**而不是下标：上传期间用户可能又改了别处）。 */
const skuImageUploadingRow = ref<MerchantSkuItem | null>(null)

// ===== 商品级「配送方式」开关（2026-09-22 新增，§7b②） =====
/** 支持线下自提：1=支持, 0=不支持（新增态默认 1）。 */
const pickupEnabled = ref<0 | 1>(1)
/**
 * 支持**物流**配送：1=支持, 0=不支持（新增态默认 1）。
 * ⚠️ 2026-09-30 文案更正：第十二批起本开关**只管物流**，同城已独立为 `sameCityEnabled`。
 */
const deliveryEnabled = ref<0 | 1>(1)
/**
 * 支持**同城配送**：1=支持, 0=不支持（新增态默认 1）。
 *
 * ⚠️ 2026-09-30 新增：契约一直有该字段，C 端同城（`pickupType=2`）**只看它**，
 * 但商家端此前从未读写 ⇒ 商家关掉"物流/同城"后同城仍可下单、且**永远无法关闭同城**。
 */
const sameCityEnabled = ref<0 | 1>(1)
/**
 * 回显是否拿到了这些开关（来源：列表项 `MerchantProductVO.pickupEnabled` / `deliveryEnabled` / `sameCityEnabled`）。
 *
 * ⚠️ 语义是「**不传 = 不修改**」（2026-09-22 上线）：编辑态**拿不到回显就不提交该字段** ——
 * 若提交默认值 1，会把商家已经关掉的自提/物流/同城开关重新打开（下单侧会因此拦不住 13023/13024）。
 * 这与本页 `description` / `detailImages` 的防御原则同源（拿不到就不提交）。
 */
const pickupEchoed = ref(false)
const deliveryEchoed = ref(false)
const sameCityEchoed = ref(false)

// ===== 商品「时效档位」（Step1，2026-10-08 新增）=====
/**
 * 时效档位：`0`=普通（商超、日用等，默认）/ `1`=生鲜·鲜活易腐。
 *
 * ⚠️ 与上面三个配送开关**同组语义**（「**不传 = 不修改**」）：编辑态**拿不到回显就不提交**，
 * 否则会把商家的生鲜商品打回普通（后端只保证"不传就不改"，一旦传了 0 就是真的改成普通）。
 *
 * ⚠️ 与 `afterSaleType`（售后类型：仅退款 / 退货退款）**正交、互不推导** ——
 * 生鲜商品也可能是"退货退款"，普通商品也可能是"仅退款"，故做成两个独立表单项。
 *
 * ⚠️ 该档位的**行为差异只在同城配送单体现**（Step2 §三）：同城·生鲜售后窗口 = 送达次日 0 点 + 48 小时、
 * 资金释放 +3 天；**物流(0) 与自提(1) 的时效与资金口径不因它改变**。
 */
const timingCategory = ref<0 | 1>(0)
/** 回显是否拿到了 `timingCategory`（拿不到就不提交，见上）。 */
const timingEchoed = ref(false)
/** 切换时效档位（普通 ↔ 生鲜·鲜活易腐）。 */
function toggleTimingCategory(): void {
  timingCategory.value = timingCategory.value === 1 ? 0 : 1
}

// ===== 商品级「让利比例」（2026-10-08 新增，spec §1）=====
/**
 * 输入框原文（**空串 = 本次不修改** —— 提交时整个字段省略，见 `buildPayload`）。
 *
 * ⚠️ 三种值语义要分清（spec §1.1 / §1.2）：
 * - `''`（留空）⇒ **不传该字段** = 不修改（**不是**清成 0）；
 * - `'3'`~`'20'` ⇒ 设为商品级比例；
 * - 其它（越界 / 非数字）⇒ 本地拦下，文案 = 后端 `13018` 原文。
 * ⚠️ **绝不**把留空翻译成 `0`：`0` 既越界（3~20），又会把"不修改"变成"抽 0%"。
 */
const commissionRateText = ref('')
/**
 * 回显到的商品级比例（`null` = 后端明确说「未设置商品级」）。
 * ⚠️ 它只用于**展示**（「当前：未设置（按上级/平台默认 3%）」）与"是否改过"的判断，
 *    **不参与** payload 组装 —— payload 只看输入框（见 `buildPayload`）。
 */
const commissionRateEchoed = ref<number | null>(null)
/** 回显到的后端抽成预览（契约 `commissionPreviewAmount`；比例未设置时为 `null`）。 */
const commissionPreviewEchoed = ref<number | null>(null)
/** 回显到的品牌最低价（`MerchantProductVO.minPrice`）：商家改了比例时按它本地重算预览。 */
const commissionMinPrice = ref<number | null>(null)

const saving = ref(false)
const uploading = ref(false)

onLoad((options) => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '新增商品' })
  const id = Number(options?.productId)
  if (Number.isInteger(id) && id > 0) {
    productId.value = id
    uni.setNavigationBarTitle({ title: '编辑商品' })
    fillFromEditCache()
  }
})

onShow(() => {
  // 规格页保存后把 skus 写回 storage，这里读取。
  // ⚠️ 不能用「直接整体覆盖」：规格页只编辑 规格名/价格/库存，
  //    而 `skuId`（后端定位规格行用）与 `skuImage`（规格图，后端语义「不传 = 不修改」）
  //    都**不在它那一页的编辑范围**里 ⇒ 整体覆盖等于把两者一起丢掉。
  //    合并规则见 `mergeSkusFromSpecPage`。
  const cached = uni.getStorageSync(SKUS_STORAGE_KEY) as MerchantSkuItem[] | ''
  if (Array.isArray(cached)) {
    skus.value = mergeSkusFromSpecPage(skus.value, cached)
  }
})

/**
 * 把**规格页返回的**规格行合并回本页的规格行。
 *
 * 每一行以 specs 页返回的 **specName / price / stock** 为准（用户就是在那里编辑的），
 * 但 **`skuId` / `skuImage` 必须从本页原有行带过来**（见 `onShow`）：
 * 规格页的输入事件是 `{ ...skus[index], xxx }`（保留 skuId / skuImage），
 * 但它的 `onLoad` 只展开 `specName/price/stock`、`confirm()` 又 `filter` 增删行
 * ⇒ **顺序一对一匹配是不可靠的**（将来谁改了规格页就会静默错位）。
 * 这里按「先 id、再规格名、最后按下标」三级匹配，宁可保守也不乱配。
 *
 * ⚠️ 匹配不到的行（规格页新增的规格）没有 `skuId` ⇒ 后端会按 `specName` 新增/复用（正确行为）。
 */
function mergeSkusFromSpecPage(current: MerchantSkuItem[], incoming: MerchantSkuItem[]): MerchantSkuItem[] {
  const byId = new Map<number, MerchantSkuItem>()
  const byName = new Map<string, MerchantSkuItem>()
  for (const row of current) {
    if (typeof row.skuId === 'number' && Number.isFinite(row.skuId)) byId.set(row.skuId, row)
    const key = String(row.specName || '').trim()
    if (key && !byName.has(key)) byName.set(key, row)
  }
  return incoming.map((row, index) => {
    const idKey = typeof row.skuId === 'number' && Number.isFinite(row.skuId) ? row.skuId : null
    const nameKey = String(row.specName || '').trim()
    const origin =
      (idKey != null ? byId.get(idKey) : undefined) ??
      (nameKey ? byName.get(nameKey) : undefined) ??
      current[index]
    return {
      ...(origin && typeof origin.skuId === 'number' ? { skuId: origin.skuId } : {}),
      ...(origin && typeof origin.skuImage === 'string' ? { skuImage: origin.skuImage } : {}),
      specName: row.specName,
      price: row.price,
      stock: row.stock,
    }
  })
}

/**
 * 编辑模式：从列表页缓存（`EDIT_STORAGE_KEY`；列表页写入的是**整个列表行对象**）回填。
 *
 * ✅ 2026-09-27：后端已在 `MerchantProductVO` 补上 `mainImages` / `description` / `detailImages`，
 * 列表行直接带这些字段 ⇒ 这里能完整回填，**原先"借用 C 端商品详情"的临时兜底已删除**。
 */
function fillFromEditCache(): void {
  const cached = uni.getStorageSync(EDIT_STORAGE_KEY) as MerchantProductVO | ''
  if (!cached || typeof cached !== 'object') return
  title.value = cached.name || ''
  // ⚠️ 主图必须回填**数组** `mainImages`：提交是**整页覆盖**语义，
  //    只回填单张 `mainImage` 就等于保存后把线上第 2~5 张主图删掉
  //    （2026-09-27 线上实测：商家只改了个库存，C 端轮播从 2 张变 1 张）。
  const cachedMainImages = (cached as { mainImages?: unknown }).mainImages
  if (Array.isArray(cachedMainImages) && cachedMainImages.length) {
    mainImages.value = cachedMainImages.map((item) => String(item)).filter(Boolean)
  } else if (cached.mainImage) {
    // 兜底：万一后端未下发 mainImages（旧版本），至少保留单张，避免提交空数组
    mainImages.value = [cached.mainImage]
  }
  // ⚠️ `skuId`（2026-10-09 修）与 `skuImage`（2026-10-09 新增）**必须一起读进来**：
  //    · `skuId` 是后端**定位规格行**的依据，丢了它就只能按 `specName` 文本匹配
  //      ⇒ 商家改个规格名就变成"新增规格"（旧行还在，越改越多）。此前这里只 map 了三个字段，
  //      **skuId 被整批丢掉**：这是本次规格图功能暴露出来的**真实缺陷**（不只是本功能的问题）；
  //    · `skuImage` 决定"这行要不要原样回传"（见 `skuImageEchoed`）。
  // ⚠️ 判「后端有没有下发 skuImage」必须看**键是否存在**：`''` 也是合法值（该规格确实没图）。
  const cachedSkus: MerchantSkuVO[] = Array.isArray(cached.skus) ? cached.skus : []
  skuImageEchoed.value = !productId.value || cachedSkus.some((s) => 'skuImage' in s)
  skus.value = cachedSkus.map((s) => ({
    // 列表返回的规格名字段是 `specName`（不是 skuName）：读错会让编辑时规格名回填为空，一提交就报「请填写规格名称」
    ...(typeof s.skuId === 'number' && Number.isFinite(s.skuId) ? { skuId: s.skuId } : {}),
    // 统一归一成字符串：UI 里"空串 = 未上传"，与后端的 null 是同一个意思（都不是一张真图）
    ...(typeof s.skuImage === 'string' ? { skuImage: s.skuImage } : {}),
    specName: s.specName || '',
    price: Number(s.price) || 0,
    stock: Number(s.stock) || 0,
  }))
  // 详情描述 / 详情图：后端 2026-09-27 起已在 MerchantProductVO 下发 ⇒ 这里正常能回显到；
  // 两个标志仍保留作安全网（见 descEchoed 注释）：拿不到就不提交，避免清空线上内容。
  const cachedDesc = (cached as { description?: unknown }).description
  descEchoed.value = typeof cachedDesc === 'string'
  if (descEchoed.value) description.value = cachedDesc as string
  const cachedDetailImages = (cached as { detailImages?: unknown }).detailImages
  detailImagesEchoed.value = Array.isArray(cachedDetailImages)
  if (detailImagesEchoed.value) detailImages.value = cachedDetailImages as string[]
  // 商品级配送方式：只记「回显拿到了没有」，拿不到就不提交（见 buildPayload / pickupEchoed 注释）
  const pickup = normalizeSwitch(cached.pickupEnabled)
  pickupEchoed.value = pickup !== null
  if (pickup !== null) pickupEnabled.value = pickup
  const delivery = normalizeSwitch(cached.deliveryEnabled)
  deliveryEchoed.value = delivery !== null
  if (delivery !== null) deliveryEnabled.value = delivery
  // ⚠️ 2026-09-30 新增：**同城是独立字段**（第十二批从 `deliveryEnabled` 拆出），必须单独回填。
  //    不回填的后果：`sameCityEchoed` 恒为 false ⇒ 编辑页那个开关**永远点不动**，
  //    商家依旧关不掉同城（正是本次要修的缺陷）。
  const sameCity = normalizeSwitch((cached as { sameCityEnabled?: unknown }).sameCityEnabled)
  sameCityEchoed.value = sameCity !== null
  if (sameCity !== null) sameCityEnabled.value = sameCity
  // ⚠️ 2026-10-08 Step1 新增：**时效档位**同样「拿不到回显就不提交」——
  //    若拿不到却提交默认值 0，会把商家的生鲜商品**打回普通**（后端只保证"不传就不改"）。
  const timing = normalizeSwitch((cached as { timingCategory?: unknown }).timingCategory)
  timingEchoed.value = timing !== null
  if (timing !== null) timingCategory.value = timing
  // ⚠️ 2026-10-08 spec §1.2 新增：**商品级让利比例**回显。
  //    `commissionRate == null` = 后端说「未设置商品级」⇒ 输入框留空 + 展示「未设置（按上级/平台默认 3%）」，
  //    **绝不能**回填成 0（那会让保存把比例写成越界的 0，或让商家误以为平台抽 0%）。
  const rawRate = cached.commissionRate
  const rate = Number(rawRate)
  commissionRateEchoed.value = rawRate != null && Number.isFinite(rate) && rate > 0 ? rate : null
  commissionRateText.value = commissionRateEchoed.value == null ? '' : String(commissionRateEchoed.value)
  // 后端抽成预览（比例未设置时为 null ⇒ 整块不渲染，不展示 ¥0）
  const rawPreview = cached.commissionPreviewAmount
  const preview = Number(rawPreview)
  commissionPreviewEchoed.value = rawPreview != null && Number.isFinite(preview) ? preview : null
  // 预览基准价 = 品牌最低价（后端算法就是这个字段）；拿不到时才回退到已填规格里的最低价
  const rawMin = cached.minPrice
  const min = Number(rawMin)
  commissionMinPrice.value = rawMin != null && Number.isFinite(min) && min > 0 ? min : null
}

/**
 * 配送方式开关回显归一化：`1/'1'/true → 1`，`0/'0'/false → 0`，**缺失 → null（= 拿不到回显）**。
 * ⚠️ 缺失既不能当 0 也不能当 1 —— 它代表「后端没下发这个字段」，提交时必须整个跳过。
 */
function normalizeSwitch(value: unknown): 0 | 1 | null {
  if (value === undefined || value === null || value === '') return null
  return value === 1 || value === '1' || value === true ? 1 : 0
}

/** 编辑态是否已回显到该开关（新增态恒为 true，按默认值 1 提交）。 */
function switchEditable(echoed: boolean): boolean {
  return !productId.value || echoed
}

/** 点击切换「支持线下自提」；拿不到回显时禁止切换（避免显示与线上不一致）。 */
function togglePickup(): void {
  if (!switchEditable(pickupEchoed.value)) {
    uni.showToast({ title: '未读取到该项当前设置，本次保存不会修改它', icon: 'none' })
    return
  }
  pickupEnabled.value = pickupEnabled.value === 1 ? 0 : 1
}

/** 点击切换「支持物流配送」；拿不到回显时禁止切换。 */
function toggleDelivery(): void {
  if (!switchEditable(deliveryEchoed.value)) {
    uni.showToast({ title: '未读取到该项当前设置，本次保存不会修改它', icon: 'none' })
    return
  }
  deliveryEnabled.value = deliveryEnabled.value === 1 ? 0 : 1
}

/**
 * 点击切换「支持同城配送」；拿不到回显时禁止切换。
 * ⚠️ 2026-09-30 新增（同城是独立字段 `sameCityEnabled`，不能复用物流那个开关）。
 */
function toggleSameCity(): void {
  if (!switchEditable(sameCityEchoed.value)) {
    uni.showToast({ title: '未读取到该项当前设置，本次保存不会修改它', icon: 'none' })
    return
  }
  sameCityEnabled.value = sameCityEnabled.value === 1 ? 0 : 1
}

/** 规格 chip 展示：前 2 个 + 共 N 个。 */
const specChips = computed(() => skus.value.slice(0, 2).map((s) => s.specName).filter(Boolean))

// ===== 商品级让利比例：回显文案 / 抽成预览（spec §1.2）=====

/** 输入框解析结果（`unset` 留空 / `invalid` 越界 / `value` 有效值）。 */
const commissionParsed = computed(() => parseProductCommissionRateInput(commissionRateText.value))

/**
 * 预览用的「最低价」：优先**后端下发的品牌最低价**（与后端预览算法同源）；
 * 新增态没有回显时，回退到商家已填规格里的最低价（仍是最低价口径，不编数据）。
 */
const commissionMinPriceForPreview = computed<number | null>(() => {
  if (commissionMinPrice.value != null) return commissionMinPrice.value
  const prices = skus.value
    .map((s) => Number(s.price))
    .filter((p) => Number.isFinite(p) && p > 0)
  return prices.length ? Math.min(...prices) : null
})

/**
 * 抽成预览金额（元）。
 *
 * - 输入框留空 / 越界 ⇒ `null`（模板不渲染预览，**不展示 ¥0**）；
 * - 输入值 == 回显值且后端给了 `commissionPreviewAmount` ⇒ **直接用后端的值**（权威）；
 * - 商家改了比例 ⇒ 按契约同公式 `round(最低价 × 比例 / 100, 2)` 本地估算（预览只是估算，已带声明）。
 */
const commissionPreviewAmount = computed<number | null>(() => {
  const parsed = commissionParsed.value
  if (parsed.kind !== 'value') return null
  if (
    commissionRateEchoed.value != null &&
    parsed.value === commissionRateEchoed.value &&
    commissionPreviewEchoed.value != null
  ) {
    return commissionPreviewEchoed.value
  }
  return estimateProductCommissionAmount(commissionMinPriceForPreview.value, parsed.value)
})

/** 编辑态「当前：…」的回显文案（`null` ⇒ 「未设置（按上级/平台默认 3%）」，绝不显示 0%）。 */
const commissionRateEchoText = computed(() => formatProductCommissionRate(commissionRateEchoed.value))

/** 预览整句（空串 ⇒ 模板整块不渲染）。 */
const commissionPreviewText = computed(() =>
  productCommissionPreviewText(commissionPreviewAmount.value, commissionMinPriceForPreview.value),
)

// ===== 图片上传 =====
async function chooseMainImages(): Promise<void> {
  const remaining = 5 - mainImages.value.length
  if (remaining <= 0) {
    uni.showToast({ title: '最多上传 5 张主图', icon: 'none' })
    return
  }
  const res = await uni.chooseImage({ count: remaining, sizeType: ['compressed'] })
  await uploadImages(res.tempFilePaths, mainImages.value)
}

async function chooseDetailImages(): Promise<void> {
  const remaining = 5 - detailImages.value.length
  if (remaining <= 0) {
    uni.showToast({ title: '最多上传 5 张详情图', icon: 'none' })
    return
  }
  const res = await uni.chooseImage({ count: remaining, sizeType: ['compressed'] })
  await uploadImages(res.tempFilePaths, detailImages.value)
}

async function uploadImages(paths: string[], target: string[]): Promise<void> {
  if (!paths.length) return
  uploading.value = true
  try {
    for (const p of paths) {
      const url = await uploadFile(p)
      target.push(url)
    }
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '上传失败', icon: 'none' })
  } finally {
    uploading.value = false
  }
}

function removeImage(target: string[], index: number): void {
  target.splice(index, 1)
}

/**
 * 某规格行是否**被商家动过图**（设过图，或点过「清除」）—— 决定这行要不要提交 `skuImage`。
 *
 * 三种状态必须分清（本页与中控的差别就在第 1 条）：
 * 1. **没动过 ⇒ 整个字段不出现**。后端语义是「不传 / null = **不修改**」（不会清空已有图），
 *    而中控那个「清除」按钮是**显式传空串**去清空 —— 本页的「清除」走的也是第 2 条，
 *    与中控同口径。**没动过就绝不发空串**：那会变成"清空"，正好搞反。
 * 2. **设/换过图 ⇒ 发 URL**（是空串以外的真 URL）。
 * 3. **点过清除 ⇒ 发空串 `''`**（唯一能清空已有图的写法）。
 *
 * ⚠️ 判据只看**本行当前值是不是非空字符串**：本页所有写入口只有
 * `onSkuImageChange`（写真实上传结果）与 `clearSkuImage`（写空串）——
 * 因此"值非空" ⟺ "商家设过图"，不需要再加一个 touched 标志位
 * （`clearSkuImage` 把值写回**原值**时确实是"清了个寂寞"，但那种情况只在已回显且原本就无图时出现，
 *  此时该行**必然**已走上 `skuImageEchoed` 的逐行原样回传分支，结果一致）。
 */
function skuImageChanged(row: MerchantSkuItem): boolean {
  return typeof row.skuImage === 'string' && row.skuImage !== ''
}

/**
 * 上传某规格的规格图（走既有通用上传通道 `POST /api/common/upload`，C 端 token 有效）。
 *
 * - 成功：写回**该行**的 `skuImage`（用行对象引用，不用下标：上传期间列表可能已被改动）；
 * - 失败：**不改动**原值（宁可没有图，也不留一个来路不明的 URL）；
 * - ⛔ **空图 = 没有图**：不上传、也不填占位图 URL（未上传时界面显示「未上传」文案）。
 */
async function onSkuImageChange(row: MerchantSkuItem): Promise<void> {
  // 全局只允许一个上传在跑（`uploading` 同时驱动底部保存按钮的 disabled）
  if (uploading.value) {
    uni.showToast({ title: '有图片正在上传，请稍候', icon: 'none' })
    return
  }
  let paths: string[] = []
  try {
    const res = await uni.chooseImage({ count: 1, sizeType: ['compressed'] })
    paths = res.tempFilePaths || []
  } catch {
    // 用户取消选图：**静默返回**（不是错误）
    return
  }
  const tempPath = paths[0]
  if (!tempPath) return
  skuImageUploadingRow.value = row
  uploading.value = true
  try {
    const url = await uploadFile(tempPath)
    // ⛔ 上传成功但拿到空串：**不写**。空串会被后端理解成"清空该行规格图"，
    //    而这次动作明明是"上传"，语义正好相反（拿不到真 URL 就该如实报错，不伪造也不误清）。
    if (!url) {
      uni.showToast({ title: '上传未返回图片地址，请重试', icon: 'none' })
      return
    }
    row.skuImage = url
    uni.showToast({ title: '规格图已上传，保存商品后生效', icon: 'none' })
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '规格图上传失败', icon: 'none' })
  } finally {
    skuImageUploadingRow.value = null
    uploading.value = false
  }
}

/**
 * 清除某规格的规格图 —— 置为**空串**（= 没有规格图），走的是后端「不传/null = 不修改」之外
 * 的**显式清空**语义（与中控「清除」按钮同口径）。
 * ⛔ 不填占位图 / 默认图；真正落库发生在点保存时。
 */
function clearSkuImage(row: MerchantSkuItem): void {
  row.skuImage = ''
}

// ===== 规格入口 =====
function goSpec(): void {
  // 把当前 skus 传给规格页
  uni.setStorageSync(SKUS_STORAGE_KEY, skus.value)
  uni.navigateTo({ url: '/subpkg-merchant/products/spec' })
}

// ===== 保存 =====
function validate(): string | null {
  if (!title.value.trim()) return '请填写商品标题'
  if (mainImages.value.length === 0) return '请上传商品主图'
  if (skus.value.length === 0) return '请添加商品规格'
  for (const s of skus.value) {
    if (!s.specName.trim()) return '请填写规格名称'
    if (!Number.isFinite(s.price) || s.price <= 0) return `规格「${s.specName || ''}」价格需大于 0`
    if (!Number.isInteger(s.stock) || s.stock < 0) return `规格「${s.specName || ''}」库存需为非负整数`
  }
  // 商品级让利比例：留空 = 不修改（合法）；填了就必须在 3~20（文案与后端 13018 逐字一致）
  const commissionError = validateProductCommissionRate(commissionRateText.value)
  if (commissionError) return commissionError
  return null
}

/**
 * 组装保存请求体。
 *
 * ⚠️ 防御性处理（2026-09-21）：后端**没有单商品详情 GET 接口**，编辑页只能从列表项缓存回填
 * `title` / 第 1 张主图 / `skus`，拿不到 `description` 与 `detailImages`；而
 * `PUT /api/merchant/products/{id}` 是**整页覆盖**语义 —— 把空值放进去会静默清空描述与详情图
 * （用户反馈：每次编辑都会把描述、详情图清掉，主图从 N 张退化成 1 张）。
 * 所以**编辑态这两个字段为空就不放进 payload**（不传 = 不修改）。补上后端详情接口后，
 * 应改回「正常回填 + 正常提交」并删掉这里的条件。
 */
function buildPayload(): MerchantProductSaveDTO {
  const payload: MerchantProductSaveDTO = {
    title: title.value.trim(),
    mainImages: mainImages.value,
    skus: skus.value.map((s) => {
      const specName = s.specName.trim()
      // 规格名两个字段名都带同值：商家端生效的是 specName（2026-09-19 实测），
      // 平台端 2026-09-22 起对 skuName 加了 @NotBlank 强校验（§7b①）；后端忽略未知字段，多带同值不影响
      const row: MerchantSkuSaveItem = { specName, skuName: specName, price: s.price, stock: s.stock }
      // ⚠️ `skuId`（2026-10-09 修）：后端**优先按它定位规格行**；不带就只能按 `specName` 文本匹配
      //    ⇒ 改了规格名的行会被当成**新增规格**（旧行留着，越改越多）。回显到了就原样带上，
      //    新增规格（本就没有 id）自然不带。
      if (typeof s.skuId === 'number' && Number.isFinite(s.skuId)) row.skuId = s.skuId
      // ⚠️ `skuImage`（2026-10-09 新增）：三种状态 —— 没动过（**整个字段不出现**）/ 设了图（发 URL）
      //    / 点过清除（发**空串**）。见 `skuImageChanged` 的注释。
      //    `skuImageEchoed` 分支：详情**确实回显到了**该字段 ⇒ 逐行原样回传（空串也是原样，
      //    语义上"这行本来就没图"，不会清掉任何东西）；详情**没回显**时只发商家真动过的行，
      //    免得把"我们不知道有没有图"当成"没有图"提交、抹掉线上已有的规格图。
      if (skuImageChanged(s) || skuImageEchoed.value) row.skuImage = String(s.skuImage ?? '')
      return row
    }),
  }
  const desc = description.value.trim()
  // 新建态：用户看得到输入框，空就是真的不要描述；
  // 编辑态三种情况：
  //   ① 回显拿到了 → 一律提交（此时空 = 用户主动清空，应当生效）；
  //   ② 回显拿不到、但用户**主动填了内容** → 提交，让用户的输入真正落库（否则是白填）；
  //   ③ 回显拿不到、用户也没碰过 → 跳过，绝不能拿空值覆盖线上描述。
  if (!productId.value || descEchoed.value || (descTouched.value && desc)) payload.description = desc
  // 详情图维持「回显拿到才提交」：用户看不到原有图时提交会**静默删掉线上图**，风险更大，
  // 只能等后端补 `detailImages`（见需求稿第 6 条）后自然解决。
  if (!productId.value || detailImagesEchoed.value) payload.detailImages = detailImages.value
  // 商品级配送方式（2026-09-22）：语义「不传 = 不修改」——
  // 新增态没有回显，按默认值 1 显式提交；编辑态**只有回显确实拿到了才提交**，
  // 否则提交 1 会把商家已关掉的自提/物流开关重新打开。
  if (!productId.value || pickupEchoed.value) payload.pickupEnabled = pickupEnabled.value
  if (!productId.value || deliveryEchoed.value) payload.deliveryEnabled = deliveryEnabled.value
  // ⚠️ 2026-09-30 新增：同城独立字段，同样遵守「拿不到回显就不提交」
  if (!productId.value || sameCityEchoed.value) payload.sameCityEnabled = sameCityEnabled.value
  // ⚠️ 2026-10-08 Step1 新增：时效档位。新增态显式提交（0=普通，与后端默认一致）；
  //    编辑态**只有回显拿到了才提交** —— 否则会把生鲜商品打回普通。
  if (!productId.value || timingEchoed.value) payload.timingCategory = timingCategory.value
  // ⚠️ 2026-10-08 spec §1.1 新增：商品级让利比例（语义「**不传 = 不修改**」）。
  //    这里**只**在解析出有效值时才写字段：
  //      · 留空（`unset`）⇒ 字段**整个不出现** = 后端不修改，**绝不能**补 0 / null 当值
  //        （传 0 会被 3~20 的校验判越界报 13018，且语义上等于"抽 0%"）；
  //      · 越界（`invalid`）⇒ validate() 已拦下，这里同样不写（防漏网时把脏值发出去）。
  //    因此 `payload.commissionRate` 的类型是 `number | undefined`，**永远不是** `0` / `null`。
  const commissionParsedForSave = parseProductCommissionRateInput(commissionRateText.value)
  if (commissionParsedForSave.kind === 'value') payload.commissionRate = commissionParsedForSave.value
  return payload
}

/**
 * 保存商品。
 *
 * ⚠️ 2026-09-21 真实接口实测：`PUT /api/merchant/products/901155 { status: 0 }` →
 * 品牌级 `productStatus` 1 → 0（**品牌下所有门店的这件商品一起下线**），且 `skuId` 被重建
 * （801166 → 801167，SKU 关联漂移）。结论：**编辑态一律不传 `status`**（不传 = 上架状态完全不变）。
 *
 * 编辑态的上下架改走**本店专用接口** `updateProductStatus(id, status)`
 * （`PUT /api/merchant/products/{id}/status`，只改本店 shopStatus）：
 * 「保存到仓库」= 保存内容 + 本店下架(0)，「保存并上架」= 保存内容 + 本店上架(1)。
 * 新建态（无 productId）保持原行为：`saveMerchantProduct(payload)` 带 status 建商品。
 */
async function doSave(status: 0 | 1): Promise<void> {
  if (saving.value) return
  const err = validate()
  if (err) {
    uni.showToast({ title: err, icon: 'none' })
    return
  }
  saving.value = true
  const editingId = productId.value
  try {
    if (!editingId) {
      // 新建态：status 决定建出来的商品在售还是入仓库（原行为不变）
      await saveMerchantProduct({ ...buildPayload(), status })
    } else {
      // 编辑态：先存内容（不带 status），再单独改本店上下架状态
      await updateMerchantProduct(editingId, buildPayload())
      try {
        await updateProductStatus(editingId, status)
      } catch (error) {
        // 内容已存成功、只有上下架没生效：既不能说「保存失败」（用户会重复提交内容），
        // 也不能说「保存成功」（状态其实没变）—— 给一句明确文案并留在本页让用户重试。
        uni.showToast({ title: '内容已保存，但上下架状态未生效，请重试', icon: 'none' })
        return
      }
    }
    uni.removeStorageSync(SKUS_STORAGE_KEY)
    uni.removeStorageSync(EDIT_STORAGE_KEY)
    uni.showToast({ title: '保存成功', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 600)
  } catch (error) {
    // ⚠️ 13018：商品级让利比例越界（前端已本地拦一次，这里是**后端兜底**）。
    //    统一映射成契约原文，避免后端只回码时前端弹出英文/空白。
    if (isApiRequestError(error) && Number(error.code) === PRODUCT_COMMISSION_RATE_ERROR_CODE) {
      uni.showToast({ title: PRODUCT_COMMISSION_RATE_RANGE_TEXT, icon: 'none' })
      return
    }
    uni.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <text class="nav-back" @click="goBack">‹</text>
      <text class="nav-title">{{ pageTitle }}</text>
    </view>

    <scroll-view class="content" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false">
      <!-- ⚠️ 这里原本有一条「编辑态诚实提示」（不许改描述/详情图…），2026-09-24 按用户要求**删除**：
           不该把后端缺口变成给用户"立规则"的说明书 —— 用户只在乎好不好用，能做的只有把问题解决掉。
           功能层面的解法见 buildPayload 的 descTouched / descEchoed，以及
           docs/后端接口需求-商品SKU与门店商品-2026-09-24.md 第 6 条（请后端补 VO 字段）。 -->

      <!-- 卡 1：主图 + 标题 + 描述 -->
      <view class="card">
        <!-- 主图上传 -->
        <view class="main-upload">
          <view
            v-for="(img, index) in mainImages"
            :key="'m' + index"
            class="upload-box has-image"
          >
            <image class="upload-img" :src="img" mode="aspectFill" />
            <view class="upload-remove" @click.stop="removeImage(mainImages, index)">×</view>
          </view>
          <view v-if="mainImages.length < 5" class="upload-box add" @click="chooseMainImages">
            <text class="add-icon">+</text>
            <text class="add-count">{{ mainImages.length + 1 }}/5</text>
          </view>
        </view>
        <view class="main-tip">
          <text class="tip-strong">5 张主图尺寸一致</text>
          <text class="tip-sub">建议尺寸 800x800px（1:1正方形）</text>
        </view>

        <!-- 商品标题 -->
        <view class="field">
          <view class="field-label">
            <text class="label-text">商品标题</text>
            <text class="label-star">*</text>
          </view>
          <textarea
            class="field-input title-input"
            v-model="title"
            :maxlength="60"
            placeholder="最多输入 60 字符（30 个汉字）"
            placeholder-class="field-ph"
          />
        </view>

        <!-- 详情描述 -->
        <view class="field">
          <view class="field-label">
            <text class="label-text">详情描述</text>
            <text class="label-sub">（可描述商品亮点）</text>
          </view>
          <textarea
            class="field-input desc-input"
            v-model="description"
            :maxlength="200"
            placeholder="最多输入 200 字"
            placeholder-class="field-ph"
            @input="descTouched = true"
          />
        </view>
      </view>

      <!-- 卡 2：规格 + 详情页 -->
      <view class="card">
        <view class="spec-row" @click="goSpec">
          <view class="field-label">
            <text class="label-text">规格</text>
            <text class="label-star">*</text>
          </view>
          <view class="spec-right">
            <view v-if="specChips.length" class="spec-chips">
              <text v-for="(chip, index) in specChips" :key="index" class="spec-chip">{{ chip }}</text>
              <text v-if="skus.length > 2" class="spec-more">共{{ skus.length }}个</text>
            </view>
            <text class="arrow">›</text>
          </view>
        </view>

        <view class="field">
          <view class="field-label">
            <text class="label-text">详情页</text>
          </view>
          <view class="detail-upload">
            <view
              v-for="(img, index) in detailImages"
              :key="'d' + index"
              class="upload-box small has-image"
            >
              <image class="upload-img" :src="img" mode="aspectFill" />
              <view class="upload-remove" @click.stop="removeImage(detailImages, index)">×</view>
            </view>
            <view v-if="detailImages.length < 5" class="upload-box small add" @click="chooseDetailImages">
              <text class="add-icon">+</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 卡 2b：**按规格上传规格图**（2026-10-09 W14 新增）
           契约：读 `MerchantProductSkuVO.skuImage` / 写 `MerchantProductSkuItem.skuImage`，
           与中控写的是**同一列** `product_sku.sku_image`（中控写、商家写、C 端详情读的是同一张图）。
           ⚠️ 三条口径（写进模板注释，防止后人"顺手"改坏）：
             ① 后端更新语义是「**不传 / null = 不修改**」（不会清空已有图）
                ⇒ 没动过的行**整个字段不出现**（见 `skuImageChanged` / `buildPayload`）；
             ② 本页「清除」= 显式传**空串**（与中控「清除」按钮同口径），没点过清除绝不发空串；
             ③ 空图 = **没有图** ⇒ 只显示「未上传」文案，⛔ 绝不填占位图 / 默认图 URL。 -->
      <view class="card">
        <view class="field-label">
          <text class="label-text">规格图</text>
          <text class="label-sub">（按规格上传，可留空）</text>
        </view>
        <view v-if="!skus.length" class="sku-image-note">
          <text>请先添加规格，再为每个规格上传图片</text>
        </view>
        <view v-for="(sku, index) in skus" :key="'skuimg-' + (sku.skuId ?? index)" class="sku-image-row">
          <view class="sku-image-box">
            <image v-if="sku.skuImage" class="sku-image-thumb" :src="sku.skuImage" mode="aspectFill" />
            <text v-else class="sku-image-empty">未上传</text>
          </view>
          <view class="sku-image-copy">
            <text class="sku-image-name">{{ sku.specName || '未命名规格' }}</text>
            <text class="sku-image-hint">未设置时 C 端规格弹框回退商品主图</text>
          </view>
          <view class="sku-image-actions">
            <view class="sku-image-btn" @click="onSkuImageChange(sku)">
              <text>{{ skuImageUploadingRow === sku ? '上传中' : sku.skuImage ? '更换' : '上传' }}</text>
            </view>
            <view v-if="sku.skuImage" class="sku-image-clear" @click="clearSkuImage(sku)">
              <text>清除</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 卡 3：商品级「让利比例」（2026-10-08 spec §1 新增）
           ⚠️ 三条口径（写进模板注释，防止后人"顺手"改成默认 0 / 0%）：
             ① 留空 = **本次不修改**（提交时字段整个省略），绝不是清成 0；
             ② 回显 `null` = 未设置商品级 ⇒ 「未设置（按上级/平台默认 3%）」，**不显示 0%**；
             ③ 预览按**最低价**估算，必须带「按当前最低价估算，实际以订单结算为准」。 -->
      <view class="card">
        <view class="field-label">
          <text class="label-text">商品让利比例</text>
          <text class="label-sub">（可选，3%~20%）</text>
        </view>
        <input
          v-model="commissionRateText"
          class="field-input rate-input"
          type="digit"
          :maxlength="5"
          :placeholder="PRODUCT_COMMISSION_INPUT_PLACEHOLDER"
          placeholder-class="field-ph"
        />
        <text v-if="productId" class="commission-echo">当前：{{ commissionRateEchoText }}</text>
        <text v-if="commissionPreviewText" class="commission-preview">{{ commissionPreviewText }}</text>
        <text v-if="commissionPreviewText" class="commission-note">{{ PRODUCT_COMMISSION_ESTIMATE_NOTE }}</text>
        <text class="commission-note">{{ PRODUCT_COMMISSION_SNAPSHOT_NOTE }}</text>
        <text class="commission-note">{{ PRODUCT_COMMISSION_OMIT_NOTE }}</text>
      </view>

      <!-- 卡 4：商品级「配送方式」开关（2026-09-22 新增，§7b②）
           与「模块开关」「门店是否上架」三重叠加：关闭后 C 端下单会报 13023（自提）/ 13024（物流·同城）。 -->
      <view class="card">
        <view class="switch-row">
          <view class="switch-copy">
            <text class="label-text">支持线下自提</text>
            <text class="switch-hint">关闭后用户下单不能选择到店自提</text>
          </view>
          <view
            class="toggle"
            :class="{ on: pickupEnabled === 1, disabled: !switchEditable(pickupEchoed) }"
            @click="togglePickup"
          >
            <view class="toggle-knob" />
          </view>
        </view>
        <view class="switch-row">
          <view class="switch-copy">
            <text class="label-text">支持物流配送</text>
            <!-- ⚠️ 2026-09-30 文案更正：第十二批起本开关**只管物流**，同城已独立成下面那一项 -->
            <text class="switch-hint">关闭后用户下单不能选择快递物流</text>
          </view>
          <view
            class="toggle"
            :class="{ on: deliveryEnabled === 1, disabled: !switchEditable(deliveryEchoed) }"
            @click="toggleDelivery"
          >
            <view class="toggle-knob" />
          </view>
        </view>
        <!--
          ⚠️ 2026-09-30 新增：**同城配送**独立开关。
          契约里 `sameCityEnabled` 一直存在，且 C 端同城（pickupType=2）**只看它**，
          但商家端此前从未读写 ⇒ 商家关掉"物流/同城"后同城仍可下单、且**永远无法关闭同城**。
        -->
        <view class="switch-row">
          <view class="switch-copy">
            <text class="label-text">支持同城配送</text>
            <text class="switch-hint">关闭后用户下单不能选择同城配送</text>
          </view>
          <view
            class="toggle"
            :class="{ on: sameCityEnabled === 1, disabled: !switchEditable(sameCityEchoed) }"
            @click="toggleSameCity"
          >
            <view class="toggle-knob" />
          </view>
        </view>
        <!-- ⚠️ 2026-10-08 Step1 新增：商品「时效档位」（普通 / 生鲜·鲜活易腐）。
             用开关形态与上面三个配送开关保持一致：开启 = 1（生鲜）、关闭 = 0（普通）。
             ⚠️ 该档位的**行为差异只在同城配送单**体现，故 hint 明确"物流与自提不受影响"——
             否则商家会误以为物流单的售后窗口也变成 48 小时。
             ⚠️ 与「售后类型」（仅退款 / 退货退款）是**两个独立项**，不要合并或互相推导。 -->
        <view class="switch-row">
          <view class="switch-copy">
            <text class="label-text">生鲜 · 鲜活易腐</text>
            <text class="switch-hint">{{ TIMING_CATEGORY_FRESH_SWITCH_HINT }}</text>
          </view>
          <view
            class="toggle"
            :class="{ on: timingCategory === 1, disabled: !switchEditable(timingEchoed) }"
            @click="toggleTimingCategory"
          >
            <view class="toggle-knob" />
          </view>
        </view>
        <!-- 诚实告知：列表接口没下发这些字段时保存会跳过它们（后端语义「不传 = 不修改」） -->
        <view v-if="productId && (!pickupEchoed || !deliveryEchoed || !sameCityEchoed || !timingEchoed)" class="switch-notice">
          <text>本次未能读取到商品级配送方式或时效档位，保存不会修改未读取到的项</text>
        </view>
      </view>
      <view class="content-pad" />
    </scroll-view>

    <!-- 底部保存栏 -->
    <view class="footer">
      <button class="save-btn save-btn-ghost" :disabled="saving || uploading" @click="doSave(0)">保存到仓库</button>
      <button class="save-btn save-btn-primary" :disabled="saving || uploading" @click="doSave(1)">保存并上架</button>
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
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 85rpx; /* 44px */
}
.nav-back {
  position: absolute;
  left: 23rpx;
  color: #1d2129;
  font-size: 46rpx;
  line-height: 1;
  top: auto;
  bottom: 0;
  display: flex;
  height: 88rpx;
  align-items: center;
}
.nav-title {
  color: #1d2129;
  font-size: 33rpx;
  font-weight: 600;
}
.content {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 15rpx 15rpx 40rpx;
}
.content-pad {
  height: 120rpx;
}
.card {
  margin-bottom: 15rpx;
  padding: 31rpx;
  border-radius: 24rpx;
  background: #ffffff;
}

/* 主图上传 */
.main-upload {
  display: flex;
  gap: 15rpx;
}
.upload-box {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  width: 123rpx;
  height: 123rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
  overflow: hidden;
}
.upload-box.small {
  width: 119rpx;
  height: 119rpx;
}
.upload-img {
  width: 100%;
  height: 100%;
}
.upload-remove {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38rpx;
  height: 38rpx;
  background: rgba(0, 0, 0, 0.5);
  color: #ffffff;
  font-size: 30rpx;
  line-height: 1;
  border-radius: 0 0 0 15rpx;
}
.add-icon {
  color: #1d2129;
  font-size: 40rpx;
  line-height: 1;
}
.add-count {
  color: #86909c;
  font-size: 27rpx;
}
.main-tip {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 15rpx;
}
.tip-strong {
  color: #86909c;
  font-size: 25rpx;
  font-weight: 500;
}
.tip-sub {
  color: #86909c;
  font-size: 23rpx;
}

/* 字段 */
.field {
  margin-top: 38rpx;
}
.field-label {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.label-text {
  color: #1d2129;
  font-size: 29rpx;
  font-weight: 500;
}
.label-star {
  color: #f53f3f;
  font-size: 29rpx;
}
.label-sub {
  color: #86909c;
  font-size: 29rpx;
}
.field-input {
  box-sizing: border-box;
  width: 100%;
  margin-top: 15rpx;
  color: #1d2129;
  font-size: 27rpx;
  line-height: 42rpx;
}
.title-input {
  height: 123rpx; /* 64px */
}
.desc-input {
  height: 231rpx; /* 120px */
}
.field-ph {
  color: #c1c5cc;
}

/* 规格行 */
.spec-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.spec-right {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
  margin-left: 31rpx;
}
.spec-chips {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.spec-chip {
  padding: 8rpx 19rpx;
  border-radius: 12rpx;
  background: #f6f7f9;
  color: #000000;
  font-size: 27rpx;
}
.spec-more {
  color: #1d2129;
  font-size: 27rpx;
}
.arrow {
  color: #86909c;
  font-size: 40rpx;
  line-height: 1;
}

/* 详情图上传 */
.detail-upload {
  display: flex;
  gap: 15rpx;
  margin-top: 15rpx;
  flex-wrap: wrap;
}

/* 规格图（按规格上传，2026-10-09 新增）：一行一规格，左侧缩略图 / 未上传文案 */
.sku-image-note {
  margin-top: 15rpx;
  color: #86909c;
  font-size: 25rpx;
}
.sku-image-row {
  display: flex;
  align-items: center;
  gap: 19rpx;
  margin-top: 23rpx;
}
.sku-image-box {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 119rpx;
  height: 119rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
  overflow: hidden;
}
.sku-image-thumb {
  width: 100%;
  height: 100%;
}
.sku-image-empty {
  color: #86909c;
  font-size: 23rpx;
}
.sku-image-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.sku-image-name {
  color: #1d2129;
  font-size: 27rpx;
  font-weight: 500;
}
.sku-image-hint {
  color: #86909c;
  font-size: 23rpx;
  line-height: 34rpx;
}
.sku-image-actions {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}
.sku-image-btn {
  padding: 10rpx 23rpx;
  border-radius: 12rpx;
  background: #f6f7f9;
  color: #1d2129;
  font-size: 25rpx;
}
.sku-image-clear {
  padding: 4rpx 23rpx;
  color: #f53f3f;
  font-size: 25rpx;
}

/* 商品级「让利比例」（2026-10-08 新增）：输入框做出可见的框，与纯文本字段区分开 */
.rate-input {
  height: 84rpx;
  padding: 0 22rpx;
  border: 1rpx solid #e5e6eb;
  border-radius: 12rpx;
  background: #fafbfc;
}
.commission-echo {
  display: block;
  margin-top: 15rpx;
  color: #1d2129;
  font-size: 25rpx;
}
.commission-preview {
  display: block;
  margin-top: 15rpx;
  color: #ff6a01;
  font-size: 25rpx;
  font-weight: 600;
}
.commission-note {
  display: block;
  margin-top: 8rpx;
  color: #86909c;
  font-size: 23rpx;
  line-height: 34rpx;
}

/* 商品级「配送方式」开关行（自绘开关，与本页其余表单项风格一致） */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 23rpx;
}
.switch-row + .switch-row {
  margin-top: 31rpx;
}
.switch-copy {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  min-width: 0;
  flex: 1;
}
.switch-hint {
  color: #86909c;
  font-size: 23rpx;
  line-height: 34rpx;
}
.toggle {
  position: relative;
  flex-shrink: 0;
  width: 88rpx;
  height: 50rpx;
  border-radius: 25rpx;
  background: #e5e6eb;
  transition: background 0.2s;
}
.toggle.on {
  background: linear-gradient(90deg, #ff9301 0%, #ff6a01 100%);
}
.toggle.disabled {
  opacity: 0.5;
}
.toggle-knob {
  position: absolute;
  top: 4rpx;
  left: 4rpx;
  width: 42rpx;
  height: 42rpx;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.2s;
}
.toggle.on .toggle-knob {
  transform: translateX(38rpx);
}
.switch-notice {
  margin-top: 23rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid #f2f3f7;
  color: #ff6a01;
  font-size: 23rpx;
  line-height: 36rpx;
}

/* 底部保存栏 */
.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: flex;
  gap: 15rpx;
  padding: 23rpx;
  background: #ffffff;
  padding-bottom: calc(23rpx + env(safe-area-inset-bottom));
}
.save-btn {
  margin: 0;
  padding: 0;
  flex: 1;
  height: 92rpx;
  border-radius: 24rpx;
  font-size: 31rpx;
  font-weight: 600;
  line-height: 92rpx;
}
.save-btn::after {
  border: 0;
}
.save-btn[disabled] {
  opacity: 0.6;
}
.save-btn-ghost {
  background: #f6f7f9;
  color: #1d2129;
}
.save-btn-primary {
  background: linear-gradient(90deg, #ff9301 0%, #ff6a01 50%, #ff4202 100%);
  color: #ffffff;
}
</style>
