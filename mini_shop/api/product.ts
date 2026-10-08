import { request } from '@/utils/request'

export interface ProductDetail {
  id: string
  name: string
  mainImage: string
  /** 当前用户是否已收藏该商品（未登录恒为 false） */
  favorite?: boolean
  images?: string[]
  videoUrl?: string
  description: string
  descriptionTitle?: string
  detailImages?: string[]
  promotionFund?: number
  promotionEnabled?: 0 | 1 | '0' | '1' | boolean
  dividendFund?: number
  dividendEnabled?: 0 | 1 | '0' | '1' | boolean
  /**
   * 商品级「是否支持线下自提」（后端 2026-09-22 新增，默认 1=支持）。
   * 0 表示该商品不能走门店自提（pickupType=1），下单会被后端以 13023 拦下。
   */
  pickupEnabled?: 0 | 1 | '0' | '1' | boolean
  /**
   * 商品级「是否支持**物流（快递）**」（后端 2026-09-22 新增，默认 1=支持）。
   * ⚠️ **2026-09-29 第十二批语义收窄为「仅物流」**（原为"物流 + 同城"）：同城已拆到 `sameCityEnabled`。
   * 0 表示该商品不能走快递配送（pickupType=0），下单会被后端以 13024 拦下。
   */
  deliveryEnabled?: 0 | 1 | '0' | '1' | boolean
  /**
   * 商品级「是否支持**同城配送**」（后端 2026-09-29 第十二批新增，默认 1=支持）。
   * ⚠️ 下单校验：`pickupType=2` **只看本字段**（不再看 `deliveryEnabled`）。
   * 0 表示该商品不能走同城配送，下单会被后端以 13024 拦下（后端文案按三档精准化）。
   */
  sameCityEnabled?: 0 | 1 | '0' | '1' | boolean
  /**
   * **时效档位**（2026-10-08 Step1 新增，随 Step3 起 C 端详情也返回）：
   * **0 = 普通**（商超/日用等，默认）/ **1 = 生鲜 · 鲜活易腐**。
   *
   * ⚠️⚠️ **只影响同城配送单**的售后窗口与资金释放档位（同城·生鲜 = 送达次日 0 点起 48 小时）——
   *    物流与自提的时效**由配送方式决定、与档位无关**，不要在物流/自提文案里写"次日 0 点"或"48 小时"。
   * ⚠️ 与「售后类型」（`afterSaleType`：仅退款 / 退货退款）**正交、互不推导**。
   * ⇒ 售后说明文案统一走 `@/utils/timing-category`（单一来源），不要在页面里另拼一份（口径会漂）。
   */
  timingCategory?: 0 | 1 | '0' | '1' | boolean
  minPrice: number
  maxPrice: number
  /** 商品最低划线价/原价（订前价，元），纯展示不参与扣款，为 null 表示无划线价。 */
  minOriginalPrice?: number
  totalStock: number
  soldCount: number
  skuList: Array<{ id: string; skuName: string; specs: string; price: number; originalPrice?: number; stock: number; enabled: number }>
}

export interface ProductCard {
  id: string | number
  name: string
  descriptionTitle?: string
  mainImage: string
  price: number
  minPrice?: number
  /** 划线价/原价（订前价，元），纯展示，为 null 表示无划线价。 */
  originalPrice?: number
  /** 兼容字段：部分接口返回 minOriginalPrice。 */
  minOriginalPrice?: number
  tag?: string
  soldCount: number
  totalStock?: number
  originPlace?: string
  /**
   * 后台「推荐文本」开关（首页商品卡描述行）。
   * 后端可下发 0/1 或 '0'/'1'（也兼容 boolean）；**未下发时视为开启**。
   * 卡片组件据此决定是否渲染描述行 —— 此前该字段只声明未消费，导致后台关了也不生效。
   */
  recommendTextEnabled?: 0 | 1 | '0' | '1' | boolean
}

export interface ProductPageResult {
  total: number
  list: ProductCard[]
  page: number
  pageSize: number
}

/** 查询商品详情，为首页商品卡片提供真实跳转目标。 */
export function getProductDetail(productId: string): Promise<ProductDetail> {
  return request<ProductDetail>({ url: `/api/v2/product/detail/${productId}`, method: 'GET' })
}

/** 查询小程序商品列表，支持关键词、分类、产地和排序。 */
export async function getProductList(params: { keyword?: string; categoryId?: string | number; originPlace?: string; sortBy?: string; page?: number; pageSize?: number } = {}): Promise<ProductPageResult> {
  const query: string[] = [
    `page=${encodeURIComponent(String(params.page || 1))}`,
    `pageSize=${encodeURIComponent(String(params.pageSize || 10))}`,
  ]
  if (params.keyword?.trim()) query.push(`keyword=${encodeURIComponent(params.keyword.trim())}`)
  if (params.categoryId !== undefined && params.categoryId !== '') query.push(`categoryId=${encodeURIComponent(String(params.categoryId))}`)
  if (params.originPlace?.trim()) query.push(`originPlace=${encodeURIComponent(params.originPlace.trim())}`)
  if (params.sortBy) query.push(`sortBy=${encodeURIComponent(params.sortBy)}`)
  const result = await request<ProductPageResult>({ url: `/api/product/list?${query.join('&')}`, method: 'GET' })
  return {
    ...result,
    list: (result.list || []).map((item) => {
      const raw = item as ProductCard & { minPrice?: number }
      return {
        ...raw,
        id: String(raw.id),
        price: Number(raw.price ?? raw.minPrice ?? 0),
      }
    }),
  }
}
