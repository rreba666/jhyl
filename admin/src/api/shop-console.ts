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
