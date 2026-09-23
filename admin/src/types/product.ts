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
  /** 商品品牌 id（goods_brand.id）。 */
  goodsBrandId?: number | null
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
   * 商品级「支持物流(0)/同城(2)配送」（`deliveryEnabled`，2026-09-22 新增）：1=支持, 0=不支持，默认 1。
   * 关闭后 C 端下单走物流/同城会报 `13024`。
   */
  deliveryEnabled?: ProductSwitchStatusValue
}

export interface AdminProductSaveDTO {
  id?: string
  name: string
  categoryId: string
  /** 商品品牌 id（goods_brand.id，如「海天」；与平台租户 brandId 无关）。 */
  goodsBrandId?: number | null
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
  /** 商品级「支持物流(0)/同城(2)配送」：1=支持, 0=不支持；新增商品默认 1。 */
  deliveryEnabled: ProductStatus
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
 * ⚠️ `pickupEnabled` / `deliveryEnabled` 语义是「**不传 = 不修改**」：详情接口没回显到这两个字段时
 * 整个字段都不提交（传默认值 1 会把商家已关掉的开关重新打开）。
 */
export interface AdminProductSavePayload extends Omit<AdminProductSaveDTO, 'categoryId' | 'goodsBrandId' | 'skuList' | 'pickupEnabled' | 'deliveryEnabled'> {
  categoryId?: number
  goodsBrandId?: number
  skuList: AdminSkuSaveItem[]
  /** 支持线下自提：1/0；undefined = 不提交（不修改）。 */
  pickupEnabled?: ProductStatus
  /** 支持物流(0)/同城(2)配送：1/0；undefined = 不提交（不修改）。 */
  deliveryEnabled?: ProductStatus
}

export interface CategoryNode {
  id: string
  name: string
  icon: string
  children: CategoryNode[]
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
   * ⚠️ 2026-09-25 核对 `api_doc.json`：`/api/admin/product/list` 的参数里**已有 `shopId`**
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
