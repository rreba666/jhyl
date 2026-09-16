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
}

/** 加入购物车请求体（对应 CartAddDTO） */
export interface CartAddDTO {
  productId: number
  skuId?: number
  quantity?: number
}

/** 获取当前用户购物车列表，并把后端数值字段统一为 number。 */
export async function getCartList(options: { resolveDividendEligibility?: boolean } = {}): Promise<CartItem[]> {
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
  }))
  return options.resolveDividendEligibility ? resolveDividendEligibility(items) : items
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
 * CartListVO 没有 dividendEnabled，因此只在需要做购买限制时按商品 ID 补查详情。
 * 失败时保留后端购物车数据，最终订单创建仍由后端做资格和并发校验。
 */
export async function resolveDividendEligibility(items: CartItem[]): Promise<CartItem[]> {
  const productIds = Array.from(new Set(items.map((item) => Number(item.productId)).filter((id) => Number.isFinite(id) && id > 0)))
  const details = await Promise.all(productIds.map(async (id) => [id, await getCachedProductDetail(id)] as const))
  const detailMap = new Map(details)

  return items.map((item) => {
    const detail = detailMap.get(Number(item.productId))
    const sku = detail?.skuList?.find((candidate) => Number(candidate.id) === Number(item.skuId))
    return {
      ...item,
      dividendEligible: sku
        ? isDividendEligible({ dividendEnabled: detail?.dividendEnabled, price: sku.price })
        : Boolean(item.dividendEligible),
    }
  })
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
