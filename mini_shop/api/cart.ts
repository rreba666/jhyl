import { ApiRequestError, request } from '@/utils/request'
import { getProductDetail, type ProductDetail } from '@/api/product'
import {
  DIVIDEND_PURCHASE_LIMIT,
  PURCHASE_LIMIT_ERROR_CODE,
  PURCHASE_LIMIT_MESSAGE,
  getDividendQuantity,
  isDividendEligible,
} from '@/utils/dividend-limit'

/** 购物车商品条目（对应 CartListVO） */
export interface CartItem {
  cartId: number
  productId: number
  skuId: number
  productName: string
  productImage: string
  skuName: string
  specs: string
  price: number
  /** 划线价/原价（订前价，元），纯展示不参与扣款，为空=无划线价。 */
  originalPrice?: number
  quantity: number
  checked: boolean
  stock: number
  /** 前端根据商品详情补齐的补贴周期资格，不是购物车接口原始字段。 */
  dividendEligible?: boolean
  /**
   * 商品级「是否支持线下自提」（后端 2026-09-22 新增，1=支持 / 0=不支持，**默认 1**）。
   * CartListVO 不返回这两个开关，由 getCartList({ resolveDeliverySwitch: true }) 用商品详情缓存补齐。
   */
  pickupEnabled?: 0 | 1
  /**
   * 商品级「是否支持物流(0)/同城配送(2)」（后端 2026-09-22 新增，1=支持 / 0=不支持，**默认 1**）。
   * 同上，由商品详情缓存补齐；缺失/非法值一律按 1 兜底。
   */
  deliveryEnabled?: 0 | 1
}

/** 加入购物车请求体（对应 CartAddDTO） */
export interface CartAddDTO {
  productId: number
  skuId?: number
  quantity?: number
}

/**
 * 归一化商品级配送开关（pickupEnabled / deliveryEnabled）：
 * 后端约定 1=支持、0=不支持，**字段缺失或下发非 0/1 的值时按 1（支持）兜底**，与后端默认值保持一致。
 * 取舍：宁可先把用户放到后端下单校验（13023/13024 拦），也不能把「字段缺失」误判成「不支持」而挡掉正常下单。
 */
export function normalizeDeliverySwitch(value: unknown): 0 | 1 {
  return value === 0 || value === '0' || value === false ? 0 : 1
}

/** getCartList 的可选补齐项：两者都复用商品详情缓存，不会额外放大请求量。 */
export interface CartListOptions {
  /** 是否补齐补贴周期资格 dividendEligible（红包商品购买限制需要）。 */
  resolveDividendEligibility?: boolean
  /** 是否补齐商品级配送开关 pickupEnabled / deliveryEnabled（结算页判断可选配送方式需要）。 */
  resolveDeliverySwitch?: boolean
}

/** 获取当前用户购物车列表，并把后端数值字段统一为 number。 */
export async function getCartList(options: CartListOptions = {}): Promise<CartItem[]> {
  const list = await request<CartItem[]>({ url: '/api/cart/list', method: 'GET' })
  const items = (Array.isArray(list) ? list : []).map((item) => ({
    ...item,
    cartId: Number(item.cartId),
    productId: Number(item.productId),
    skuId: Number(item.skuId),
    price: Number(item.price ?? 0),
    originalPrice: item.originalPrice == null ? undefined : Number(item.originalPrice),
    quantity: Math.max(1, Number(item.quantity ?? 1)),
    checked: item.checked === true || String(item.checked) === '1',
    stock: Math.max(0, Number(item.stock ?? 0)),
    // CartListVO 不带商品级配送开关：先按后端默认 1（支持）兜底，需要精确值时由下面补查商品详情覆盖
    pickupEnabled: normalizeDeliverySwitch(item.pickupEnabled),
    deliveryEnabled: normalizeDeliverySwitch(item.deliveryEnabled),
  }))
  if (!options.resolveDividendEligibility && !options.resolveDeliverySwitch) return items
  return resolveProductFlags(items, options.resolveDividendEligibility === true)
}

interface CachedProductDetail {
  detail: ProductDetail
  expiresAt: number
}

const productDetailCache = new Map<number, CachedProductDetail>()
const PRODUCT_DETAIL_CACHE_TTL = 30_000

async function getCachedProductDetail(productId: number): Promise<ProductDetail | null> {
  const cached = productDetailCache.get(productId)
  if (cached && cached.expiresAt > Date.now()) return cached.detail
  try {
    const detail = await getProductDetail(String(productId))
    productDetailCache.set(productId, { detail, expiresAt: Date.now() + PRODUCT_DETAIL_CACHE_TTL })
    return detail
  } catch {
    return null
  }
}

/**
 * 用商品详情缓存补齐购物车条目上「只有商品详情接口才下发」的字段：
 * - pickupEnabled / deliveryEnabled：商品级配送开关（CartListVO 不带）；
 * - dividendEligible：红包商品购买资格（需要详情里的 dividendEnabled + SKU 价格）。
 *
 * 为什么补在**购物车这条链路**上：结算页要按「整批已选商品」判断能不能自提、能不能物流/同城，
 * 如果放到结算页逐条现查详情，一次结算就会多打 N 个请求；购物车里本来就要为红包资格查详情，
 * 这里复用同一个 getCachedProductDetail 缓存（TTL 30s）一次拿全，两种字段共用同一批请求。
 * 详情查不到时（网络失败 / 商品下架）保留原值 —— 也就是按默认 1（支持）兜底，绝不静默放行错误订单：
 * 真不支持时后端下单会以 13023（不支持自提）/ 13024（不支持物流、同城）拦下并给出文案。
 */
async function resolveProductFlags(items: CartItem[], withDividendEligibility: boolean): Promise<CartItem[]> {
  const productIds = Array.from(new Set(items.map((item) => Number(item.productId)).filter((id) => Number.isFinite(id) && id > 0)))
  const details = await Promise.all(productIds.map(async (id) => [id, await getCachedProductDetail(id)] as const))
  const detailMap = new Map(details)

  return items.map((item) => {
    const detail = detailMap.get(Number(item.productId))
    const sku = detail?.skuList?.find((candidate) => Number(candidate.id) === Number(item.skuId))
    return {
      ...item,
      pickupEnabled: detail ? normalizeDeliverySwitch(detail.pickupEnabled) : item.pickupEnabled,
      deliveryEnabled: detail ? normalizeDeliverySwitch(detail.deliveryEnabled) : item.deliveryEnabled,
      ...(withDividendEligibility
        ? {
            dividendEligible: sku
              ? isDividendEligible({ dividendEnabled: detail?.dividendEnabled, price: sku.price })
              : Boolean(item.dividendEligible),
          }
        : {}),
    }
  })
}

/**
 * CartListVO 没有 dividendEnabled，因此只在需要做购买限制时按商品 ID 补查详情。
 * 失败时保留后端购物车数据，最终订单创建仍由后端做资格和并发校验。
 * 注意：这条路径顺带会把商品级配送开关一起补齐（同一批详情请求，不额外发请求）。
 */
export async function resolveDividendEligibility(items: CartItem[]): Promise<CartItem[]> {
  return resolveProductFlags(items, true)
}

/** 切换单条购物车商品的选中状态 */
export function toggleChecked(cartId: number): Promise<void> {
  return request<void>({ url: `/api/cart/${cartId}/toggle`, method: 'PUT' })
}

/** 修改购物车商品数量 */
export function updateQuantity(cartId: number, quantity: number): Promise<void> {
  return request<void>({ url: `/api/cart/${cartId}/quantity/${quantity}`, method: 'PUT' })
}

/** 全选或取消全选购物车商品 */
export function checkAll(checked: boolean): Promise<void> {
  return request<void>({ url: `/api/cart/check-all?checkAll=${checked}`, method: 'PUT' })
}

/** 删除单条购物车记录 */
export function removeCartItem(cartId: number): Promise<void> {
  return request<void>({ url: `/api/cart/${cartId}`, method: 'DELETE' })
}

/** 批量删除购物车记录（传入 cartId 数组） */
export function removeCartBatch(cartIds: number[]): Promise<void> {
  return request<void>({ url: '/api/cart/batch', method: 'DELETE', data: cartIds })
}

/** 加入购物车（商品详情页使用） */
export function addToCart(dto: CartAddDTO): Promise<void> {
  return request<void>({ url: '/api/cart/add', method: 'POST', data: dto })
}

export interface StockGuardedAddOptions {
  productId: number
  skuId: number
  stock: number
  quantity?: number
  dividendEnabled?: 0 | 1 | '0' | '1' | boolean
  price?: number
}

/**
 * 在提交加购前校验当前用户购物车数量，后端仍需用原子库存校验作为最终依据。
 * 该检查只负责提前提示，不能替代服务端并发控制。
 */
export async function addSkuToCartWithStock(options: StockGuardedAddOptions): Promise<void> {
  const quantity = Math.floor(Number(options.quantity ?? 1))
  const stock = Math.floor(Number(options.stock))
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new ApiRequestError('购买数量无效', 1000)
  }
  if (!Number.isFinite(stock) || stock < quantity) {
    throw new ApiRequestError('库存不足', 3001)
  }

  const candidateIsDividend = isDividendEligible({
    dividendEnabled: options.dividendEnabled,
    price: options.price,
  })
  const cartItems = await getCartList({ resolveDividendEligibility: candidateIsDividend })
  const existing = cartItems.find((item) => (
    Number(item.productId) === Number(options.productId)
      && Number(item.skuId) === Number(options.skuId)
  ))
  const existingQuantity = Number(existing?.quantity ?? 0)
  if (existingQuantity + quantity > stock) {
    throw new ApiRequestError(`库存不足，当前库存仅剩 ${stock} 件`, 3001)
  }

  if (candidateIsDividend && getDividendQuantity(cartItems) + quantity > DIVIDEND_PURCHASE_LIMIT) {
    throw new ApiRequestError(PURCHASE_LIMIT_MESSAGE, PURCHASE_LIMIT_ERROR_CODE)
  }

  await addToCart({
    productId: Number(options.productId),
    skuId: Number(options.skuId),
    quantity,
  })
}
