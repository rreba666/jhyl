export type ProductStatus = 0 | 1
export type ProductStatusValue = ProductStatus | '0' | '1'
export type ProductFundStatusValue = ProductStatusValue | null
/**
 * 商品级开关（配送方式）的回显值：0/1 或数字字符串；**null = 详情接口没返回该字段**。
 * ⚠️ 不要当成 0 —— 后端这两个字段的语义是「不传 = 不修改」，把「没返回」当 0 提交会把已开的开关关掉。
 */
export type ProductSwitchStatusValue = ProductStatusValue | null

export interface ProductShopItem {
  shopId: string
  shopName: string
  /** 本店上架状态：0=下架, 1=上架。 */
  shopStatus: ProductStatusValue
  /** 门店价（null=用商品品牌价）。 */
  shopPrice: number | null
  /** 门店库存（null=用商品总库存）。 */
  shopStock: number | null
}

export interface ProductListItem {
  id: string
  name: string
  mainImage: string
  minPrice: number
  /** 商品最低划线价/原价（元），纯展示不参与扣款。 */
  minOriginalPrice?: number
  /** 推广资金（元）。列表接口可能不返回，此时为 undefined，需详情查看。 */
  promotionFund?: number
  promotionEnabled: ProductFundStatusValue
  /** 平台红包资金（元）。列表接口可能不返回，此时为 undefined。 */
  dividendFund?: number
  dividendEnabled: ProductFundStatusValue
  soldCount: number
  totalStock: number
  originPlace: string
  status: ProductStatusValue
  isRecommended: ProductStatusValue
  recommendTextEnabled: ProductStatusValue
  sortOrder: number
  /** 所属商户/门店归属（该商品被本商户哪些门店上架）。 */
  merchantId?: string
  merchantName?: string
  shopList?: ProductShopItem[]
}

export interface ProductSku {
  id?: string
  skuName: string
  /**
   * 规格名（与商家端接口字段名对齐）。
   * ⚠️ 后端 **v2 商品详情当前不返回规格名**（`skuList` 只有 `id/price/stock`），
   * 只有商家端 `GET /api/merchant/products` 返回 `specName`；这里保留可选字段，
   * 后端补齐后可直接使用（已登记为后端待补）。
   */
  specName?: string
  specs: string
  skuImage: string
  price: number
  /** 划线价/原价（元），纯展示不参与扣款，为空=无划线价。 */
  originalPrice?: number
  stock: number
  enabled: ProductStatusValue
}

export interface ProductDetail extends ProductListItem {
  categoryId: string
  /**
   * 所属分类（多值，2026-09-30 新增）。
   * ⚠️ `categoryId` 仍保留（后端取**传入数组的第一个**）作为老前端兜底；新代码请用本字段。
   * ⚠️ 后端**未部署**前该字段缺失 ⇒ 回填时回退到 `[categoryId]`（见 `fillForm`）。
   */
  categoryIds?: string[]
  /** 商品品牌 id（goods_brand.id）。 */
  goodsBrandId?: number | null
  /** 关联门店 id 列表（多门店）。 */
  shopIds?: number[] | null
  images: string[]
  videoUrl: string
  description: string
  descriptionTitle: string
  maxPrice: number
  detailImages: string[]
  skuList: ProductSku[]
  /**
   * 商品级「支持线下自提」（`pickupEnabled`，2026-09-22 新增）：1=支持, 0=不支持，默认 1。
   * 关闭后 C 端下单走自提会报 `13023`。
   */
  pickupEnabled?: ProductSwitchStatusValue
  /**
   * 商品级「支持**物流（快递）**」配送（`deliveryEnabled`，2026-09-22 新增）：1=支持, 0=不支持，默认 1。
   * ⚠️ **2026-09-29 语义已收窄为「仅物流」**（原为「物流 + 同城」）——
   * 同城已拆到独立字段 `sameCityEnabled`，下单校验随之拆分（`pickupType=0` 看本字段）。
   * 关闭后 C 端下单走物流会报 `13024`（错误码不变，后端文案已按"自提/同城/物流"三档精准化）。
   */
  deliveryEnabled?: ProductSwitchStatusValue
  /**
   * 商品级「支持**同城配送**」（`sameCityEnabled`，2026-09-29 新增）：1=支持（默认）, 0=不支持。
   * ⚠️ 下单校验：`pickupType=2` **只看本字段**（不再看 `deliveryEnabled`）。
   * ⚠️ 为 `undefined` = 详情接口未返回该字段（后端未部署/旧数据）⇒ 提交时**整个字段不提交**（不传 = 不修改）。
   */
  sameCityEnabled?: ProductSwitchStatusValue
  /**
   * **时效档位**（`timingCategory`，2026-10-08 Step1 新增）：**0=普通**（商超/日用等，默认）/ **1=生鲜·鲜活易腐**。
   *
   * ⚠️⚠️ 与 `pickupEnabled` / `deliveryEnabled` / `sameCityEnabled` 的语义**不同**：
   *    - 那三个是「开关」（1=开、0=关）；本字段是**档位**（0 和 1 都是合法业务值，不是"关"）。
   *    - 但**提交语义相同**：后端是「**不传 = 不修改**」⇒ 详情没回显到该字段时**整个不提交**，
   *      否则会把商家的生鲜商品**打回普通**（对应对接文档 §六 验收点 3）。
   * ⚠️ **不要与 `afterSaleType` 混**（售后类型：仅退款 / 退货退款）：两者**正交、互不推导**，
   *    是两个独立表单项（对接文档 §四）。生鲜商品也可能配成"退货退款"。
   * ⚠️ 适用边界：该档位**只对同城配送单（pickupType=2）产生行为差异**；
   *    物流(0) 与自提(1) 的售后窗口 / 资金释放口径**一律不变**（对接文档 §三）。
   */
  timingCategory?: ProductSwitchStatusValue
}

export interface AdminProductSaveDTO {
  id?: string
  name: string
  /**
   * 所属分类（**多选**）—— 2026-09-30 由单个 `categoryId` 改为数组。
   *
   * ⚠️ 后端契约（`AdminProductSaveDTO.categoryIds`）是 `number[]`；
   *    这里在**表单内**存字符串（与既有 `categoryId` 一样，避免 el-select 的 value 类型混乱），
   *    **提交前**再统一转成数字（见 `submitForm`）。
   * ⚠️ 后端口径：多个分类**平等、无主分类**；保存为**全量覆盖**；
   *    **空数组会报错**（前端 rules 已拦「至少选一个」）；上限 **10 个**；不存在的分类 ID 也报错。
   */
  categoryIds: string[]
  /** 商品品牌 id（goods_brand.id，如「海天」；与平台租户 brandId 无关）。 */
  goodsBrandId?: number | null
  /** 所属商户 id（long）。 */
  merchantId?: number | null
  /** 关联门店 id 列表（多门店；空数组 = 不关联任何门店）。 */
  shopIds?: number[] | null
  mainImage: string
  images: string[]
  videoUrl: string
  description: string
  descriptionTitle: string
  originPlace: string
  detailImages: string[]
  promotionFund: number
  promotionEnabled: ProductStatus
  dividendFund: number
  dividendEnabled: ProductStatus
  status: ProductStatus
  isRecommended: ProductStatus
  recommendTextEnabled: ProductStatus
  sortOrder: number
  skuList: ProductSku[]
  /** 商品级「支持线下自提」：1=支持, 0=不支持；新增商品默认 1。 */
  pickupEnabled: ProductStatus
  /** 商品级「支持**物流（快递）**」：1=支持, 0=不支持；新增商品默认 1（⚠️ 语义已收窄为"仅物流"）。 */
  deliveryEnabled: ProductStatus
  /** 商品级「支持**同城配送**」（2026-09-29 新增）：1=支持（默认）, 0=不支持。 */
  sameCityEnabled: ProductStatus
  /**
   * **时效档位**（2026-10-08 Step1 新增）：0=普通（默认）/ 1=生鲜·鲜活易腐。
   * ⚠️ 语义是「**不传 = 不修改**」（新增商品不传则取后端默认 0）——
   * 想把生鲜商品改回普通**必须显式传 0**，而回显拿不到时必须**整个不提交**。
   */
  timingCategory: ProductStatus
}

/**
 * 提交给 `POST /api/admin/v2/product/save` 的规格项。
 *
 * ⚠️ 后端 `SkuItem` 的规格名字段名**两个都要带同值**：
 * - `skuName`：2026-09-22 起后端对该字段加了 `@NotBlank` 强校验，缺失/空串 →
 *   `1000 skuList[0].skuName: SKU 名称不能为空`（见《商户提现-前端开发文档-2026-09-22》§7b①）；
 * - `specName`：2026-09-19 实测后端写库用的字段名（当时只传 `skuName` 会「保存成功但规格名变空」）。
 *
 * 后端 Jackson 会**忽略未知字段**（2026-09-19 实测：多传 `specs`/`skuImage`/`enabled` 仍 `code=0`），
 * 所以两个名字都带上即可同时满足两套字段名，互不干扰。
 */
export interface AdminSkuSaveItem {
  /**
   * 已有 SKU 的主键 id（**编辑商品时必须带**）。
   *
   * ⚠️⚠️ 2026-09-22 补：后端**只按 id 匹配已有 SKU**（不按名字/规格名），
   * 提交里缺少 id 会被当成"新增规格" → **每保存一次就追加一批同规格 SKU**。
   * 生产上已因此写脏数据（商品 id=5 累积 37 条、id=6 累积 18 条同名 SKU）。
   * 新增商品时该字段为 undefined（不传），后端据此插入。
   */
  id?: number
  skuName: string
  specName: string
  price: number
  stock: number
}

/**
 * 商品保存请求体（与后端 `AdminProductV2SaveDTO` 对齐）。
 * ⚠️ 后端 `categoryId` / `goodsBrandId` 是 **integer**：传非数字字符串会被 Jackson 判为
 * **「请求体格式错误」**（2026-09-19 实测复现：`categoryId="分类A"` → `code=1000 请求体格式错误`）。
 * 所以这里用 number 类型，空值一律**不传该字段**（而不是传空串）。
 * ⚠️ `timingCategory`（2026-10-08 Step1 新增）与上面三个开关**同样是「不传 = 不修改」**，
 * 但它**承载业务档位而非开关语义**（0=普通 / 1=生鲜），也必须纳入"回显不到就不提交"的守卫，
 * 否则保存一次就会把生鲜商品打回普通。
 * ⇒ 四个字段**各自独立**判断，不要"一个没回显就全都不提交"（那会导致明明回显到的开关也保存不了）。
 */
export interface AdminProductSavePayload extends Omit<AdminProductSaveDTO, 'categoryIds' | 'goodsBrandId' | 'skuList' | 'merchantId' | 'shopIds' | 'pickupEnabled' | 'deliveryEnabled' | 'sameCityEnabled' | 'timingCategory'> {
  /** 所属分类（**多选**，long[]）。⚠️ 空数组不提交（后端会报错）。 */
  categoryIds?: number[]
  goodsBrandId?: number
  /** 所属商户 id（long；undefined = 不提交/不修改）。 */
  merchantId?: number | null
  /** 关联门店 id 列表（多门店；undefined = 不提交，空数组 = 清空关联）。 */
  shopIds?: number[]
  skuList: AdminSkuSaveItem[]
  /** 支持线下自提：1/0；undefined = 不提交（不修改）。 */
  pickupEnabled?: ProductStatus
  /** 支持**物流（快递）**：1/0；undefined = 不提交（不修改）。 */
  deliveryEnabled?: ProductStatus
  /** 支持**同城配送**（2026-09-29 新增）：1/0；undefined = 不提交（不修改）。 */
  sameCityEnabled?: ProductStatus
  /**
   * **时效档位**（2026-10-08 Step1 新增）：0=普通 / 1=生鲜·鲜活易腐；undefined = **不提交（不修改）**。
   * ⚠️ 0 是**合法业务值**，不是"不传"——想把生鲜改回普通必须显式传 0。
   */
  timingCategory?: ProductStatus
}

/**
 * 商品表单用的分类节点（**扁平一层**）。
 *
 * ⚠️ **2026-09-30 扁平化**：删除了原先的 `children` ——
 *    后端已确认「分类是扁平一层、实测无 `parent_id`」（《前端统一报告-2026-09-30》§五-8）。
 */
export interface CategoryNode {
  id: string
  name: string
  icon: string
}

export type ProductSortBy = 'sold_desc' | 'price_asc' | 'price_desc' | 'new_desc' | 'sort_order'

export interface ProductQueryParams {
  page: number
  pageSize: number
  categoryId?: string
  keyword?: string
  sortBy?: ProductSortBy
  originPlace?: string
  /**
   * 按门店过滤。
   * ⚠️ 2026-09-23 核对 `api_doc.json`：`/api/admin/product/list` 的参数里**已有 `shopId`**
   * （与 `categoryId`/`merchantId`/`keyword`/`originPlace`/`sortBy` 并列）⇒ 此前"等后端支持"的阻塞已解除。
   */
  shopId?: string
  /** 按商户（品牌）过滤。同样来自 api_doc 的既有参数。 */
  merchantId?: string
}

export interface ProductPageResult {
  total: number
  list: ProductListItem[]
  page: number
  pageSize: number
}

export interface ProductResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

export interface ProductFilters {
  keyword: string
  categoryId: string
  originPlace: string
  sortBy: ProductSortBy | ''
  /** 门店 ID（空串 = 不限门店）。 */
  shopId: string
}

export type Product = ProductListItem
