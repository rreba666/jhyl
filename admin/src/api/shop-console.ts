import { request } from './request'

/** 店铺运营域统一响应包装。 */
interface ShopConsoleResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

function unwrap<T>(response: { data: ShopConsoleResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 营业状态（`ShopBusinessStatusVO`）。 */
export interface ShopBusinessStatusVO {
  /** false = 未配置（按全天营业）。 */
  hasConfig?: boolean
  /** 当前状态：OPEN 营业 / REST 休息。 */
  status?: string
  /** 今日营业时段文本（如 "08:00-12:00、14:00-18:00"；未配置为 null）。 */
  todayText?: string | null
  /** 下次开店时刻（手动营业/全天营业=null）。 */
  nextOpenTime?: string | null
  /** 手动模式：AUTO / OPEN / REST。 */
  manualMode?: string
  openRemindMinutes?: number
  closeRemindMinutes?: number
}

/** 营业时间配置（`ShopBusinessConfigVO`）。 */
export interface ShopBusinessConfigVO {
  hasConfig?: boolean
  /** 一周营业段：键 1-7（周一~周日），值 = 当日营业段列表。 */
  week?: Record<string, Array<{ start: string; end: string }>>
  /** 预设日期区间休店。 */
  restRanges?: Array<{ name?: string; startDate: string; endDate: string }>
  manualMode?: string
  openRemindMinutes?: number
  closeRemindMinutes?: number
}

/** 营业时间保存入参（`ShopBusinessScheduleDTO`）。 */
export interface ShopBusinessScheduleDTO {
  week: Record<string, Array<{ start: string; end: string }>>
  restRanges: Array<{ name?: string; startDate: string; endDate: string }>
  manualMode?: string
  openRemindMinutes?: number
  closeRemindMinutes?: number
}

/** 门店商品（`MerchantProductVO`：本品牌商品 + 本店上架状态）。 */
export interface ShopProductVO {
  productId?: number
  name?: string
  mainImage?: string
  /** 品牌价（最低/最高）。 */
  minPrice?: number
  maxPrice?: number
  /** 商品总库存（品牌维护）。 */
  totalStock?: number
  /** 商品全局状态：0 下架 / 1 上架（品牌/中控维护，门店不可改）。 */
  productStatus?: number
  /** 本店上架状态：0 下架 / 1 上架（门店控制）。 */
  shopStatus?: number
  /** 门店价（覆盖品牌价；null=用品牌价）。 */
  shopPrice?: number | null
  /** 门店库存（null=用商品总库存）。 */
  shopStock?: number | null
  /**
   * 启用规格数（2026-10-08 补）：`=1` 单规格 / `>1` **多规格商品**。
   * ⚠️ 多规格商品**必须**用 SKU 级设价/设库存（本页的 SPU 级入口会「统一作用于全部规格」，
   *    对多规格商品是不准确的）⇒ 用它来决定是否显示「按规格设价」入口。
   */
  skuCount?: number
}

/** 门店商品分页结果。 */
export interface ShopProductPage {
  total: number
  list: ShopProductVO[]
  page: number
  pageSize: number
}

// ===== 营业状态 / 时间 =====

/** 读取当前营业状态（可指定门店；不传=默认门店）。 */
export async function getBusinessStatus(shopId?: number | string): Promise<ShopBusinessStatusVO> {
  const params = shopId === undefined || shopId === '' ? undefined : { shopId }
  return unwrap(await request.get<ShopConsoleResponse<ShopBusinessStatusVO>>('/api/admin/business/status', { params }), '营业状态查询失败')
}

/** 读取营业时间配置。 */
export async function getBusinessSchedule(shopId?: number | string): Promise<ShopBusinessConfigVO> {
  const params = shopId === undefined || shopId === '' ? undefined : { shopId }
  return unwrap(await request.get<ShopConsoleResponse<ShopBusinessConfigVO>>('/api/admin/business/schedule', { params }), '营业时间查询失败')
}

/** 保存营业时间配置（week 缺键=当天休息；week 空对象=全天营业）。 */
export async function saveBusinessSchedule(shopId: number | string | undefined, payload: ShopBusinessScheduleDTO): Promise<void> {
  const params = shopId === undefined || shopId === '' ? undefined : { shopId }
  unwrap(await request.put<ShopConsoleResponse<null>>('/api/admin/business/schedule', payload, { params }), '营业时间保存失败')
}

/** 手动营业/休息切换：OPEN=立即营业 / REST=立即休息 / AUTO=回到规则推导。 */
export async function setBusinessManual(action: 'OPEN' | 'REST' | 'AUTO', shopId?: number | string): Promise<void> {
  const params = shopId === undefined || shopId === '' ? undefined : { shopId }
  unwrap(await request.post<ShopConsoleResponse<null>>('/api/admin/business/manual', { action }, { params }), '营业状态切换失败')
}

// ===== 门店商品 =====

/** 查询门店商品目录（含本店上架状态/门店价/门店库存）。 */
export async function getShopProducts(params: { shopId?: number | string; keyword?: string; status?: number | string; page?: number; pageSize?: number } = {}): Promise<ShopProductPage> {
  const query: Record<string, string | number> = { page: params.page ?? 1, pageSize: params.pageSize ?? 10 }
  if (params.shopId !== undefined && params.shopId !== '') query.shopId = params.shopId
  if (params.keyword && params.keyword.trim()) query.keyword = params.keyword.trim()
  if (params.status !== undefined && params.status !== '') query.status = params.status
  const data = unwrap(await request.get<ShopConsoleResponse<ShopProductPage>>('/api/admin/shop-product', { params: query }), '门店商品查询失败')
  return { total: Number(data?.total || 0), list: Array.isArray(data?.list) ? data.list : [], page: Number(data?.page || 1), pageSize: Number(data?.pageSize || 10) }
}

/** 设置门店价（不传 price = 恢复用品牌价）。 */
export async function setShopProductPrice(productId: number | string, price: number | null, shopId?: number | string): Promise<void> {
  const params: Record<string, string | number> = {}
  if (shopId !== undefined && shopId !== '') params.shopId = shopId
  if (price !== null) params.price = price
  unwrap(await request.put<ShopConsoleResponse<null>>(`/api/admin/shop-product/${productId}/price`, null, { params }), '门店价保存失败')
}

/** 设置门店库存（不传 stock = 恢复用商品总库存）。 */
export async function setShopProductStock(productId: number | string, stock: number | null, shopId?: number | string): Promise<void> {
  const params: Record<string, string | number> = {}
  if (shopId !== undefined && shopId !== '') params.shopId = shopId
  if (stock !== null) params.stock = stock
  unwrap(await request.put<ShopConsoleResponse<null>>(`/api/admin/shop-product/${productId}/stock`, null, { params }), '门店库存保存失败')
}

/** 本店上架/下架（只影响本店）。 */
export async function setShopProductStatus(productId: number | string, status: 0 | 1, shopId?: number | string): Promise<void> {
  const params: Record<string, string | number> = { status }
  if (shopId !== undefined && shopId !== '') params.shopId = shopId
  unwrap(await request.put<ShopConsoleResponse<null>>(`/api/admin/shop-product/${productId}/status`, null, { params }), '本店上下架失败')
}

// ===== 门店 SKU 级设价 / 设库存（2026-10-08 新增，对齐单 §四 #4 / B-5；弹层批量见 W8 §3）=====

/**
 * 本店某商品**各规格**的生效价 / 生效库存（**含三级回退来源**）。
 *
 * 契约 `ShopSkuPriceVO`：
 * - `price` = 生效门店价、`priceSource` = `SKU`（按规格设价）/ `SHOP`（按商品设价）/ `PRODUCT`（商品原价）
 *   / `NONE`（无可回退价，**页面展示为「—」**）—— ⚠️ 契约 enum 是**这 4 个值**（对齐单正文只列了前 3 个）；
 * - `stock` = 生效门店库存、`stockSource` 取上面同 4 个值（`NONE` 同样展示为「—」）；
 * - `spuShopPrice` / `skuShopPrice` / `spuShopStock` / `skuShopStock` **为 `null` 表示该级未设置**
 *   —— ⚠️ **不要当成 0**（0 是"设成了 0"，null 是"没设、在回退"）；
 * - `effectiveStock` = 可售 = 生效门店库存 − 已锁定（下限 0）。
 */
export interface ShopSkuPriceVO {
  skuId: number
  skuName?: string
  /** 商品原价（回退链最末级）。 */
  brandPrice?: number
  /** SPU 级门店价；null = 该门店未按商品设价。 */
  spuShopPrice?: number | null
  /** SKU 级门店价；null = 该门店未按规格设价。 */
  skuShopPrice?: number | null
  /** 生效门店价（三级回退结果）。 */
  price?: number
  /** 生效价来源：SKU / SHOP / PRODUCT / NONE（NONE 页面展示为「—」）。 */
  priceSource?: string
  brandStock?: number
  spuShopStock?: number | null
  skuShopStock?: number | null
  stock?: number
  /** 生效库存来源：SKU / SHOP / PRODUCT / NONE（NONE 页面展示为「—」）。 */
  stockSource?: string
  lockedStock?: number
  effectiveStock?: number
}

/** 查询本店该商品各规格的生效价/生效库存（含三级来源）。 */
export async function getShopSkuPrices(productId: number | string, shopId?: number | string): Promise<ShopSkuPriceVO[]> {
  const params: Record<string, string | number> = {}
  if (shopId !== undefined && shopId !== '') params.shopId = shopId
  const data = unwrap(await request.get<ShopConsoleResponse<unknown>>(`/api/admin/shop-product/${productId}/skus`, { params }), '门店规格查询失败')
  // ⚠️ 后端约定无数据时返回空数组（可能为 null）⇒ 两种都兼容，页面据此显示空态
  return Array.isArray(data) ? (data as ShopSkuPriceVO[]) : []
}

/** 设置 **SKU 级**门店价（`price` 不传 = 恢复该规格用上一级价）。 */
export async function setShopSkuPrice(productId: number | string, skuId: number | string, price: number | null, shopId?: number | string): Promise<void> {
  const params: Record<string, string | number> = { skuId }
  if (shopId !== undefined && shopId !== '') params.shopId = shopId
  if (price !== null) params.price = price
  unwrap(await request.put<ShopConsoleResponse<null>>(`/api/admin/shop-product/${productId}/sku-price`, null, { params }), '规格门店价保存失败')
}

/** 设置 **SKU 级**门店库存（`stock` 不传 = 恢复该规格用上一级库存）。 */
export async function setShopSkuStock(productId: number | string, skuId: number | string, stock: number | null, shopId?: number | string): Promise<void> {
  const params: Record<string, string | number> = { skuId }
  if (shopId !== undefined && shopId !== '') params.shopId = shopId
  if (stock !== null) params.stock = stock
  unwrap(await request.put<ShopConsoleResponse<null>>(`/api/admin/shop-product/${productId}/sku-stock`, null, { params }), '规格门店库存保存失败')
}

/**
 * 批量端点的一行（`SkuBatchDTO.items[]`，W8 §3.2/§3.5）。
 * ⚠️ `price`/`stock` 传 `null` = **清除**该级设置（回退 SPU 门店值 → 商品本体值），
 * **不是**设成 `0`；`0` 是合法值（"真的设成 0"）。
 */
export interface ShopSkuBatchItem {
  skuId: number
  price: number | null
  stock: number | null
}

/**
 * **批量**设置 SKU 级门店价 + 门店库存（W8 §3，`PUT /api/admin/shop-product/{productId}/sku-batch`）。
 *
 * 为什么要它：弹层逐规格调单端点要 `N × 2` 次请求（3 规格 6 次、10 规格 20 次），
 * 第 7 次失败时前 6 次**已落库** ⇒ 半保存。批量端点是**单事务**：任一行不合法（规格不存在 /
 * 不属于该商品）⇒ 整批回滚（`1002`），**不会出现"前 N 个已保存"**。
 *
 * ⚠️ **每行的两个字段都会被应用**：只改价时该行也要带上当前期望的 `stock`（反之同理）。
 * ⚠️ 门店：商户管理员可不传（后端取本商户唯一门店）；**多门店 / 平台岗必须传 `shopId`**。
 * ⚠️ 单规格端点（`setShopSkuPrice` / `setShopSkuStock`）**保留不变**（W8 §3.6），
 *    可继续用于单行内联编辑；弹层"一次性确定"走本函数。
 */
export async function setShopSkuBatch(productId: number | string, items: ShopSkuBatchItem[], shopId?: number | string): Promise<void> {
  const params: Record<string, string | number> = {}
  if (shopId !== undefined && shopId !== '') params.shopId = shopId
  unwrap(await request.put<ShopConsoleResponse<null>>(`/api/admin/shop-product/${productId}/sku-batch`, { items }, { params }), '规格批量保存失败')
}
