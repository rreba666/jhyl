import { request } from '@/utils/request'

/**
 * 门店档案（C 端公开）—— `/api/shop/all` 与 `/api/shop/deliverable` 返回的是**同一份** `ShopVO`
 * （`ResultListShopVO`），因此两个接口共用本类型。
 *
 * ⚠️ 这里**只声明前端真正消费的字段**。管理口径字段（`deposit` / `commissionRate` / `groupId` /
 *    `boundUserCount` …）刻意不声明：尤其 `boundUserCount` 是「已绑定微信人数」，**不是粉丝数** ——
 *    设计稿里的 `3484 粉丝` 在现有契约里**没有**任何对应字段（`ShopVO` 全字段逐条核对过）。
 */
export interface EnabledShop {
  id: number
  name: string
  address: string
  phone?: string
  status?: number
  createTime?: string
  /** 营业时间（如 06:00-23:00） */
  openTime?: string
  /** 纬度（点地图时调 uni.openLocation 导航） */
  latitude?: number
  /** 经度 */
  longitude?: number
  /**
   * 该门店是否开通同城配送（`/api/shop/all` 实际会返回，用于「同城配送」时过滤可发货门店）。
   * 注意可空：老接口/未配置时按「不排除」处理（`!== false` 才展示）。
   */
  deliveryEnabled?: boolean
  /**
   * 店铺图片 URL（门店头像/门头图）。
   * 契约建议尺寸是 690×345（≈2:1 横图，见 `ShopCreateDTO.shopImage`），而设计稿里这个位置是
   * **44×44 方形圆角 6** ⇒ 展示一律用 `mode="aspectFill"` 裁成方形，兼容「竖图 logo」与「横图门头」两种情况。
   * ⚠️ 未配置时后端下发空串/null ⇒ 调用方必须回退默认图，不得开天窗。
   */
  shopImage?: string
  /** 店铺介绍（`ShopVO.description`，设计稿未使用，供店铺页兜底展示） */
  description?: string
  /**
   * 所属品牌商家 ID（`null` = 平台自营单店）。
   * 前端**只**用它做「商品 → 门店」归属的交叉校验（见 {@link resolveProductShop}），不直接展示。
   */
  merchantId?: number | null
  /** 实时营业状态：`OPEN`=营业中 / `REST`=休息中（未配置营业时间 = OPEN 全天营业） */
  businessStatus?: string
  /** 今日营业时段文本（未配置营业时间 = null） */
  businessTodayText?: string
  /** 是否平台自营门店（恒不为 null） */
  platformOwned?: boolean
  /** 主营业务（下拉字典值） */
  mainBusiness?: string
  /** 均价（元） */
  avgPrice?: number
}

/** 查询 C 端可选的启用门店。 */
export function getEnabledShops(): Promise<EnabledShop[]> {
  return request<EnabledShop[]>({ url: '/api/shop/all', method: 'GET' })
}

/**
 * 按商品筛选**可配送门店**（C 端公开）。
 *
 * 后端摘要原文：「按商品筛选可配送门店（C端公开）」—— 依据是**门店-SKU 关联**，
 * 所以入参是 `skuIds` 而不是 `productId`（门店商品按 SKU 维护）。
 *
 * ⚠️ **自提（`pickupType=1`）与同城（`pickupType=2`）都必须用它** —— 两者都只能选
 * **有这批商品**的门店。
 * （2026-09-29 修：此前注释写着"自提仍用 `getEnabledShops()`"，导致自提把没有该商品的
 *   门店也列出来，真机反馈"商品只有 A 店有，自提却列出所有门店"。）
 * ⚠️ 两者**唯一的区别**是**要不要再按 `deliveryEnabled` 过滤**：
 *   · **同城要** —— `deliveryEnabled` 就是同城配送开关；
 *   · **自提不要** —— 门店没开通同城，照样可以让顾客上门自提它自己有的商品。
 *
 * @param skuIds 订单里商品的 SKU 集合；为空时不带该参数（退化为后端默认口径）。
 *   传参用逗号分隔：Spring 的 `@RequestParam List<Long>` 对
 *   `?skuIds=1,2` 与 `?skuIds=1&skuIds=2` 都收，逗号能让请求行更短。
 */
export function getDeliverableShops(skuIds?: Array<number | string>): Promise<EnabledShop[]> {
  const query = buildSkuIdsQuery(skuIds)
  return request<EnabledShop[]>({ url: `/api/shop/deliverable${query}`, method: 'GET' })
}

/**
 * 把 SKU 集合归一化成 `?skuIds=1,2` 查询串；**集合为空时返回空串**（= 完全不带该参数）。
 *
 * ⚠️ 空串与「传了但为空」语义完全不同：后者在后端等同于"没有筛选条件"，
 * 而 `/api/shop/deliverable` 不带 `skuIds` 时会**返回全部门店**（等价 `/api/shop/all`）
 * —— 见 {@link resolveProductShop} 的空集合守卫。
 */
function buildSkuIdsQuery(skuIds?: Array<number | string>): string {
  const ids = (skuIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
  return ids.length ? `?skuIds=${ids.join(',')}` : ''
}

/**
 * 按 `shopId` 取**单店档案**（C 端）。
 *
 * ⚠️ **后端目前没有 C 端「单店详情」接口**（`api_doc.json` 全量枚举：C 端公开侧只有
 * `/api/shop/all` 与 `/api/shop/deliverable`；单店详情只有 B 端的 `GET /api/merchant/shop/{id}`，
 * 需要商家 token）。所以这里退化为「拉全量启用门店再按 id 过滤」。
 *
 * ⇒ **后端需求**：`GET /api/shop/{shopId}`（公开、无需登录，返回店铺档案）。
 *    缺口清单与优先级见 `docs/26/10.09/店铺页-Figma实现说明-2026-10-09.md` §4.3 第 3 条。
 *
 * @returns 命中返回门店档案；**未命中（门店已停用/被删除/不存在）返回 `null`**。
 *   网络或业务异常**照常抛出** —— 「店铺不存在」与「请求失败」必须能被调用方区分，
 *   不得把网络故障显示成"店铺已停业"。
 */
export async function getShopById(shopId: string | number): Promise<EnabledShop | null> {
  const id = String(shopId ?? '').trim()
  if (!id) return null
  const shops = await getEnabledShops()
  return (shops || []).find((shop) => String(shop?.id) === id) || null
}

/**
 * 解析「某个商品挂在**哪一家**门店」—— 进店卡片唯一的取数依据。
 *
 * ## 为什么需要它（数据现实）
 * `ProductDetailV2VO`（C 端商品详情）**没有 `shopId`**：契约里与门店相关的字段只有
 * `merchantId` / `merchantName` / `shopIds`，而 `shopIds` 的注释明写是
 * 「**B 端**「关联门店」多选回填用」—— 2026-10-10 用**真实响应**复核过
 * `GET /api/v2/product/detail/68`：响应里**根本没有 `shopIds` 这个键**。
 * ⇒ 商品详情**无法**直接给出门店。
 *
 * ## 这里用的口径（全部是 C 端公开契约，无推断字段）
 * `GET /api/shop/deliverable?skuIds=` 的契约原文：「给出购物车 SKU 集合，返回**能全部提供**
 * 这些商品的门店列表」「判定口径与下单拦截、试算**同一份实现**（`shop_product.status=1` 上架关系）」
 * ⇒ 它回答的正是「哪些门店真的在卖这个商品」。
 *
 * ## fail-closed 规则（宁可不出卡片，也绝不猜门店）
 * 1. **没有可用 SKU ⇒ 直接放弃**（`getDeliverableShops()` 空集合会退化成"全部门店"，那不是归属）；
 * 2. **候选 ≠ 1 家 ⇒ 放弃**：0 家 = 没有门店在卖（品牌级/纯物流商品），多家 = 多门店商品，
 *    到底该进哪一家**产品未定**（见实现说明 §5 第 11/16 条）⇒ 不猜；
 * 3. **品牌交叉校验**：唯一候选的品牌与商品品牌都能拿到且**不一致** ⇒ 放弃（数据异常，不放行）。
 *
 * ⇒ 解析不出来时返回 `null`，调用方**不渲染进店卡片**（不导航、不占位）。
 *    后端补上 C 端 `shopId`（实现说明 §4.3 第 2 条，P0）后，本函数应改为直接读该字段。
 *
 * ⚠️ 本函数**吞掉取数异常并返回 `null`**：卡片是详情页的**可选**增强块，
 *    接口抖动时"少一张卡片"远好过"详情页弹错误"（详情页自身的错误态仍由商品详情接口负责）。
 *
 * @param skuIds 该商品的全部 SKU（`ProductDetail.skuList`）——「能全部提供」才算是它的门店。
 * @param merchantId 商品归属品牌（`ProductDetail.merchantId`），仅用于上面的交叉校验。
 */
export async function resolveProductShop(
  skuIds: Array<number | string>,
  merchantId?: number | string | null,
): Promise<EnabledShop | null> {
  if (!buildSkuIdsQuery(skuIds)) return null
  let shops: EnabledShop[] = []
  try {
    shops = await getDeliverableShops(skuIds)
  } catch {
    return null
  }
  if (!Array.isArray(shops) || shops.length !== 1) return null
  const shop = shops[0]
  const productMerchant = merchantId === null || merchantId === undefined ? '' : String(merchantId).trim()
  const shopMerchant = shop?.merchantId === null || shop?.merchantId === undefined ? '' : String(shop.merchantId).trim()
  if (productMerchant && shopMerchant && productMerchant !== shopMerchant) return null
  return shop
}
