export type ProductStatus = 0 | 1
export type ProductStatusValue = ProductStatus | '0' | '1'
export type ProductFundStatusValue = ProductStatusValue | null

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
}

/**
 * 提交给 `POST /api/admin/v2/product/save` 的规格项。
 * ⚠️ 后端 `SkuItem` **只接受 `{specName, price, stock}`**（2026-09-19 复核契约 + 实测）。
 * 表单模型 `ProductSku` 里的 `skuName` / `specs` / `skuImage` / `enabled` **直接透传会被后端丢弃**
 * —— 表现是「保存成功但规格名变空」，所以提交前必须映射字段名。
 */
export interface AdminSkuSaveItem {
  specName: string
  price: number
  stock: number
}

/**
 * 商品保存请求体（与后端 `AdminProductV2SaveDTO` 对齐）。
 * ⚠️ 后端 `categoryId` / `goodsBrandId` 是 **integer**：传非数字字符串会被 Jackson 判为
 * **「请求体格式错误」**（2026-09-19 实测复现：`categoryId="分类A"` → `code=1000 请求体格式错误`）。
 * 所以这里用 number 类型，空值一律**不传该字段**（而不是传空串）。
 */
export interface AdminProductSavePayload extends Omit<AdminProductSaveDTO, 'categoryId' | 'goodsBrandId' | 'skuList'> {
  categoryId?: number
  goodsBrandId?: number
  skuList: AdminSkuSaveItem[]
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
}

export type Product = ProductListItem
