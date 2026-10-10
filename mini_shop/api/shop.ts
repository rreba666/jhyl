import { request } from '@/utils/request'

/**
 * 门店档案（C 端公开）—— `/api/shop/all`、`/api/shop/deliverable` 与
 * `/api/shop/{shopId}`（S3，2026-10-10 新增）返回的是**同一份** `ShopVO`，因此三个接口共用本类型。
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
   * 前端**只**用它做「商品 → 门店」归属的交叉校验，不直接展示。
   * ⚠️ 2026-10-10 起 C 端详情**直接下发进店门店**（`ProductDetail.shopId`），
   * 这个交叉校验在 C 端已经没有调用方（原 {@link resolveProductShop} 已删除）；
   * 字段声明保留：它随 `ShopVO` 一起下发，且 B 端口径的消费方随时可能需要。
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
 * 而 `/api/shop/deliverable` 不带 `skuIds` 时会**返回全部门店**（等价 `/api/shop/all`）。
 */
function buildSkuIdsQuery(skuIds?: Array<number | string>): string {
  const ids = (skuIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
  return ids.length ? `?skuIds=${ids.join(',')}` : ''
}

/**
 * 按 `shopId` 取**单店档案**（C 端公开、**免登录**，游客可访问）。
 *
 * 实现 = `GET /api/shop/{shopId}` → `Result<ShopVO>`（**2026-10-10 S3 后端新增**，
 * 见《前端对接文档-2026-10-10-全集》§3.4；`ShopVO` 与 `/api/shop/all` **同构**，
 * 因此复用 {@link EnabledShop} 类型）。
 *
 * ⚠️ **2026-10-10 起不再"拉全量再前端过滤"**：此前本函数是 `getEnabledShops()` +
 * `find(id)` 的旁路（后端当时没有 C 端单店接口，缺口记在
 * `docs/26/10.09/店铺页-Figma实现说明-2026-10-09.md` §4.3 第 3 条）—— 那种写法
 * ① 多拉一份全量门店、② 把「门店不存在」与「请求失败」混成同一个空结果。
 * 现在直连接口即可，且**错误语义变得可区分**（见下）。
 *
 * @returns 命中返回门店档案。
 * @throws 门店**不存在 / 已停用 / 已软删** ⇒ 业务码 **`8000`**（`SHOP_NOT_FOUND`）的
 *   `ApiRequestError` —— 调用方**必须**把它渲染成「门店不存在或已停用」这一个**独立状态**，
 *   **不要**混进通用错误文案（契约 §七：8000 = 门店不存在（含停用/软删））。
 *   网络/其它业务异常同样照常抛出，由调用方按通用错误处理 ⇒ 两者天然可分。
 */
export function getShopDetail(shopId: string | number): Promise<EnabledShop> {
  const id = String(shopId ?? '').trim()
  if (!id) return Promise.reject(new Error('缺少门店 ID'))
  return request<EnabledShop>({ url: `/api/shop/${encodeURIComponent(id)}`, method: 'GET' })
}

/**
 * ⚠️ **2026-10-10 已删除 `resolveProductShop()`**（连同 `api/product.ts` 的旧注释一起清理）。
 *
 * 它曾经是进店卡片**唯一**的取数依据：当时 `ProductDetailV2VO` **没有** `shopId`
 * （只有 B 端语义的 `merchantId`；`shopIds` 是 B 端回填字段，2026-10-10 实测 C 端响应里
 * **根本没有这个键**），所以只能拿 `ProductDetail.skuList` 去问
 * `GET /api/shop/deliverable?skuIds=`「哪些门店能全部提供这些 SKU」，并且**只在候选唯一时**
 * 才认（0 家 = 没人在卖、多家 = 多门店商品，产品口径未定）⇒ **多门店商品一律不出卡片**。
 *
 * **为什么删而不是留作兜底**：
 * 1. **数据源已到位**：S1 起商品详情直接下发 `shopId` / `shopName` / `shopImage` / `shopList`，
 *    而且**给出了主门店口径**（"按最早加入在售关系排序的第一个"，见 §3.1）
 *    ⇒ 多门店商品**也**该出卡片，且目标门店由后端决定 —— 这正是旧旁路放弃的那一支；
 * 2. **留着会给出**与后端**不同的门店**：旁路候选唯一 ≠ 主门店，两套逻辑并存迟早分叉；
 * 3. **少一次请求**：旁路每次进详情页都要多打一个 `/api/shop/deliverable`；
 * 4. **诚实性不降级**：契约明写"无在售门店时 `shopId` 为 null、`shopList` 为空数组"
 *    ⇒ 字段真的缺失（老后端/灰度）时就该**不出卡片**，那正是页面现在的行为，
 *    不需要旁路去"再猜一次"（猜错 = 用编造的门店跳转，违反仓库硬原则）。
 *
 * 全库引用核查（2026-10-10，删除前）：`resolveProductShop` 只被
 * `subpkg-goods/detail/detail.vue` 一处引用；`getShopById` 只被 `subpkg-goods/shop/index.vue`
 * 一处引用 —— 两者均已改为直读/直连，故一并删除。
 *
 * 📄 缺口与口径来源：`docs/26/10.09/店铺页-Figma实现说明-2026-10-09.md` §4.3、
 *    `docs/26/10.10/前端对接文档-2026-10-10-全集.md` §3.1。
 */
