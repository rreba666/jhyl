import { request } from '@/utils/request'

/**
 * 在售门店条目（契约 `ShopEntry`，随商品详情一起下发，2026-10-10 S1 新增）。
 *
 * 只声明前端消费的三个字段，与 `api/shop.ts` 的 `EnabledShop` 刻意分开：
 * `ShopEntry` **只有这三个字段**（门店档案的地址/电话/营业状态等一律不在这里）。
 */
export interface ShopEntry {
  /** 门店ID（`wx_shop.id`） */
  shopId: number | null
  shopName?: string | null
  /** 门头图 URL（**可能为 null** ⇒ 由调用方决定回退，本层不做任何编造） */
  shopImage?: string | null
}

export interface ProductDetail {
  id: string
  name: string
  mainImage: string
  /**
   * 归属品牌商家 ID（契约 `ProductDetailV2VO.merchantId`：null=未归属）。
   * ⚠️ 契约注释写的是「**B 端**编辑『所属商户』回填用」，但它是**公开响应里就有**的字段
   * （2026-10-10 实测 `/api/v2/product/detail/68` 返回 `merchantId: 3`）。
   * ⚠️ **2026-10-10 S1 起它不再是"进店卡片"的取数依据**：门店直接由下方的
   * `shopId` / `shopName` / `shopImage` 下发（见《前端对接文档-2026-10-10-全集》§3.1），
   * 本字段**只**用于「商品 → 门店」归属的交叉校验，**不展示**给用户、也不作为跳转目标。
   */
  merchantId?: number | null
  /**
   * **主在售门店**（2026-10-10 S1 新增；口径 = `shop_product.status=1` 的启用门店，
   * 多门店时取「最早加入在售关系」的第一家）。
   *
   * ⚠️ 这是"进店卡片"的**唯一**门店来源 —— 此前详情页拿不到门店，只能靠
   * `api/shop.ts` 的 `resolveProductShop()` 旁路解析（多门店商品一律不出卡片）；
   * 2026-10-10 后端补上这三个字段后，该旁路已删除。
   *
   * ⚠️ **无在售门店时后端下发 `shopId: null`**（键存在、值为 null）⇒ 调用方必须
   * "拿不到就不出卡片"，**绝不猜一个 id**（多门店该进哪家由后端的主门店口径决定，
   * 不再由前端推断）。
   */
  shopId?: number | null
  /** 主在售门店名称（无在售门店时为 null） */
  shopName?: string | null
  /**
   * 主在售门店门头图 URL（**可能为 null**，契约明写「前端需默认 logo 回退」）。
   * ⚠️ 这里的"回退"= **不渲染 `<image>`**，不是塞一张本地占位图/假图：
   * 仓库硬原则是绝不伪造数据，且 `ShopEntryCard` 的契约断言本就禁止 `/static/` 引用。
   */
  shopImage?: string | null
  /** 全部在售门店（按加入先后，**第一个即主门店**）；无在售门店时为空数组。 */
  shopList?: ShopEntry[] | null
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
   *    物流与自提的时效**由配送方式决定、与档位无关**，不要在物流/自提文案里写"48 小时""生鲜"。
   *    （⚠️ 「次日 0 点」**不再**属于同城专属措辞：2026-10-08 W8 §5 起物流的起算点也是"次日 0 点"，
   *      2026-10-10 §四 更扩为「确认收货 / 快递签收 / 完成」三者最晚者 —— 别把这条读成"物流不许写次日 0 点"。）
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
  /**
   * SKU 列表（C 端详情返回后端 `SkuVO`，B 端同 schema 含禁用 SKU）。
   *
   * ⚠️ `skuImage` 是后端 `SkuVO` **早已下发**的字段（契约 `api_doc.json` 逐字核对：
   * 「SKU 规格图片 URL（不同规格不同图）」），此前**类型里漏声明** ⇒ 规格弹层只能显示商品主图。
   * 未配置规格图时后端下发空串/null ⇒ 消费方一律**回退商品主图**（见 `components/goods/SkuSheet.vue`）。
   */
  skuList: Array<{ id: string; skuName: string; specs: string; skuImage?: string; price: number; originalPrice?: number; stock: number; enabled: number }>
}

export interface ProductCard {
  id: string | number
  name: string
  descriptionTitle?: string
  /**
   * 卡片说明文字（列表接口**实际已下发**，见 2026-10-10 实测 `/api/product/list` 响应字段；
   * 契约描述「详情描述（卡片说明文字，最多一行）」）—— 店铺页商品网格的「卖点」行用它。
   * 未下发时该行不渲染。
   */
  description?: string
  mainImage: string
  /**
   * 展示价（元）。
   * ⚠️ **列表 VO 没有 `price` 字段**：后端只下发 `minPrice`（最低价，取自所有 SKU 最低价），
   * 由 `mapProductPage()` 统一归一化到这里 ⇒ 页面只读 `price` 即可，不必各自判 `minPrice`。
   */
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

/**
 * 商品**列表** VO（契约 `ProductListVO`）→ `ProductCard` 的**共用**归一化。
 *
 * ⚠️ 归一化只做两件事，且**两个列表接口必须完全一致**（`/api/product/list` 与
 * `/api/shop/{shopId}/products` 后端明写"端上必然一致"）：`id` → string（防大整数精度）、
 * `price` ← `minPrice`（列表 VO **没有** `price` 字段，只有 `minPrice`）。
 * 其余字段原样透传，**不补任何默认值**（缺字段就是缺，由消费方决定渲不渲染）。
 */
function mapProductPage(result: ProductPageResult): ProductPageResult {
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
  return mapProductPage(result)
}

/** `sortBy` 的合法枚举（契约逐字：`sold_desc / price_asc / price_desc / new_desc / sort_order`）。 */
export type ShopProductSort = 'sold_desc' | 'price_asc' | 'price_desc' | 'new_desc' | 'sort_order'

/**
 * **按门店**查在售商品（`GET /api/shop/{shopId}/products`，2026-10-10 S2b 新增，C 端公开免登录）。
 *
 * ## 为什么单独一个函数（而不是 `getProductList({ shopId })`）
 * 两者后端口径**完全一致**（契约：「与 `/api/product/list?shopId=` 同一查询口径，结果必然一致」），
 * 但**契约明写这是两条接口**，且 S2b 这条是**门店维度**的正式入口：
 * ① 它的错误码语义是门店维度的 —— **门店不存在/已停用 ⇒ `8000`**（`SHOP_NOT_FOUND`），
 *    而 `/api/product/list` 对不存在的 `shopId` 返回的是「`200` + `total=0`」；
 * ② 用错接口会把"门店没了"显示成"这家店没有在售商品"，正是本仓库最忌的**静默失真**。
 * ⇒ 店铺页用本函数，并**必须**把 `8000` 渲染成独立状态（见 `subpkg-goods/shop/index.vue`）。
 *
 * ## 分页与排序
 * `page` 从 **1** 开始；`pageSize` 契约限 **1~100**（默认 10，本页取 10，与首页/搜索页同档）。
 * `sortBy` **不传 = 后端默认排序**（契约里它是可选参数）—— 所以默认排序项刻意不下发该参数，
 * 而不是自己编一个 `sort_order` 当默认值。
 *
 * @param shopId 门店 ID（`wx_shop.id`）。
 * @returns `total` / `list` / `page` / `pageSize`；**门店存在但没有在售商品 ⇒ `total=0` + 空 `list`**
 *   （这不是错误，调用方按诚实空态渲染）。
 * @throws 门店不存在/停用 ⇒ 业务码 **`8000`** 的 {@link ApiRequestError}
 *   （判定用 `isApiRequestError(error) && error.code === 8000`）。
 */
export function getShopProducts(params: {
  shopId: string | number
  sortBy?: ShopProductSort
  page?: number
  pageSize?: number
}): Promise<ProductPageResult> {
  const query: string[] = [
    `page=${encodeURIComponent(String(params.page || 1))}`,
    `pageSize=${encodeURIComponent(String(params.pageSize || 10))}`,
  ]
  if (params.sortBy) query.push(`sortBy=${encodeURIComponent(params.sortBy)}`)
  return request<ProductPageResult>({
    url: `/api/shop/${encodeURIComponent(String(params.shopId))}/products?${query.join('&')}`,
    method: 'GET',
  }).then(mapProductPage)
}
