import { request } from '@/utils/request'

/**
 * 门店档案（C 端公开）—— `/api/shop/all`、`/api/shop/deliverable` 与
 * `/api/shop/{shopId}`（S3，2026-10-10 新增）返回的是**同一份** `ShopVO`，因此三个接口共用本类型。
 *
 * ⚠️ 这里**只声明前端真正消费的字段**。管理口径字段（`deposit` / `commissionRate` / `groupId` /
 *    `boundUserCount` …）刻意不声明：尤其 `boundUserCount` 是「已绑定微信人数」，**不是粉丝数**，
 *    契约也**没有**任何地方说它可以当粉丝数用 ⇒ 全库禁止拿它顶 `fansCount`（2026-10-10 复核）。
 *
 * ⚠️ **S4（2026-10-10）之前**本类型只声明了 `name` / `businessName` 两个资质相关字段，
 *    并注明"营业执照 / 食品经营许可证的图片契约里没有"。**那句话现在不成立了**：
 *    `ShopVO` 已新增资质的 5 个字段、评分的 3 个、服务表现的 2 个、粉丝数 1 个
 *    （见下面各字段注释；全量 48 个字段）。
 *    ⇒ 旧缺口清单（`后端需求-店铺页数据缺口-2026-10-10.md` 的 R4 / R8）里那句
 *      「契约一个字段都没有」**已作废**，只剩"门店侧大都没录数据"这一条数据现实（运营补录）。
 *    📄 现行字段与口径 = `docs/26/10.10/前端对接文档-2026-10-10-全集.md` §12.1~§12.5
 *      （评分是**客观指标合成、非用户评价**；服务表现只有两个可计算项；关注/粉丝是新增能力）。
 */
export interface EnabledShop {
  id: number
  name: string
  address: string
  /**
   * 工商名称（`ShopVO.businessName`，契约原文注释「工商名称」）。
   * 店铺页**经营资质**页的「商家主体」用它 —— 这是契约里**唯一**真有的主体字段。
   * ⚠️ 可为空串（2026-10-10 实测 `GET /api/shop/all`：14 家门店里只有 1 家填了）⇒
   *    调用方必须按「未公示」处理，**不得**用 `merchantName` / 主题配置里的平台公司名顶替。
   */
  businessName?: string
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
  /**
   * 营业执照编号（`ShopVO.licenseNo`，契约注释「营业执照编号（资质；C 端店铺页展示）」）。
   * ⚠️ 与 `licenseImage` **各自独立可空**（`non_null` 序列化 ⇒ 没录就没有这个键）
   *    ⇒ 消费方（经营资质页）按"有编号没图"也能单独渲染编号处理。
   */
  licenseNo?: string
  /** 营业执照图片 URL（`ShopVO.licenseImage`，契约注释「营业执照图片 URL（资质；C 端店铺页展示）」）。 */
  licenseImage?: string
  /** 食品经营许可证编号（`ShopVO.foodPermitNo`）。 */
  foodPermitNo?: string
  /** 食品经营许可证图片 URL（`ShopVO.foodPermitImage`）。 */
  foodPermitImage?: string
  /**
   * 食品经营许可证有效期至（`ShopVO.foodPermitExpireDate`，`yyyy-MM-dd`）。
   * 契约注释：`null` = **未填或长期有效** ⇒ 前端**不得**把它渲染成"已过期"或"无有效期"结论，
   * 没有值就整行不渲染（不能断言"长期有效"—— 契约把两种含义合并了，前端分不出来）。
   */
  foodPermitExpireDate?: string
  /**
   * 店铺评分（`ShopVO.rating`）。
   * ⚠️ **契约原文：由客观指标合成，非用户评价**（完成率 + 无售后率 + 准时送达率加权，每日重算；
   *    最少订单数默认 5）⇒ 任何 UI 文案**不得**写成"用户评价 / 用户评分 / xx 人评价"。
   * ⚠️ **样本不足时为 `null`**（契约明写"前端隐藏评分区"）⇒ 判据必须用 `!= null`，**不得**兜底成 0。
   */
  rating?: number | null
  /**
   * 评分明细 JSON（`ShopVO.ratingDetailJson`，字符串）。
   * 契约：供**中控自查 / 客服解释**用（`complete` / `noAfterSale` / `onTime` / `avgAcceptSeconds` /
   * `weights` / 窗口与单量）⇒ C 端**不解析、不展示**（别把内部口径搬到用户面前）。
   */
  ratingDetailJson?: string
  /** 评分最近计算时间（`ShopVO.ratingUpdatedAt`，`null` = 从未计算）。C 端不展示。 */
  ratingUpdatedAt?: string
  /**
   * 准时送达率 0~1（`ShopVO.onTimeRate`，**客观指标**：`delivery_tasks.delivered_at - accepted_at
   * ≤ estimated_minutes`，每日重算）。
   * ⚠️ **无配送单时为 `null`** ⇒ 这一格**不渲染**（不补 0、不补「—」）。
   */
  onTimeRate?: number | null
  /**
   * 平均接单时长（秒，`ShopVO.avgAcceptSeconds`，契约口径 `assigned_at → accepted_at`）。
   * ⚠️ **无数据时 `null`** ⇒ 不渲染。契约**没有**"客服响应/回复时长"字段
   * （那项设计文案属 §12.3 未提供项）⇒ 不许拿本字段冒名成"客服响应"。
   */
  avgAcceptSeconds?: number | null
  /**
   * 粉丝数（`ShopVO.fansCount`）—— 契约明写「关注该门店的用户数；**恒不为 null**，0 表示暂无粉丝」。
   * ⚠️ 与 `boundUserCount`（已绑定微信人数，且本类型刻意不声明）**是两个不同的数**，
   *    任何地方都不得互相顶替。
   */
  fansCount?: number
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
 * `docs/26/10.09/前端对接文档-2026-10-10-全集.md` §4.3 第 3 条）—— 那种写法
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
 * 门店**关注状态 + 粉丝数**（`GET /api/shop/{shopId}/follow-status`，2026-10-10 S4 **新增能力**）。
 *
 * 契约原文（`api_doc.json` 该 path 的 `description`）：
 * 「返回当前用户是否已关注该门店 + 该店粉丝数（供店铺页「关注」按钮与粉丝数展示）。」
 *
 * ⚠️ **必须登录**：契约明写这三个 follow 接口**不在公开白名单**（白名单只放行
 *    `/api/shop/all`、`/api/shop/*`、`/api/shop/*/products`）⇒ **无 token 得到 401**
 *    （后端已实测 ✔）。而且 `utils/request.ts` 的"公开浏览降级重试"白名单**只覆盖 GET 只读接口**，
 *    本接口也**不在**那份白名单里 —— 是刻意的：未登录直接调只会拿到 401,
 *    所以调用方**必须先用 {@link isLoggedIn} 判断**，未登录就**不要发这个请求**
 *    （店铺页对游客只显示 `ShopVO.fansCount`，不显示"已关注"态）。
 *
 * ⚠️ 响应是 `ResultMapStringObject`（**契约里没有字段级 schema**，只有 summary/description
 *    的 `{ followed: bool, fansCount: number }` 文字说明）。按仓库 §十 的教训，这里**只做保守解析**：
 *    取到才用、取不到就当"未知"（不默认 false、不默认 0）。
 */
export interface ShopFollowStatus {
  /** 当前用户是否已关注该门店；`undefined` = 响应里没有这个键（契约无字段级 schema）。 */
  followed?: boolean
  /** 该店粉丝数；`undefined` = 响应里没有这个键（此时不要用 0 顶替）。 */
  fansCount?: number
}

/** 关注状态/粉丝数的请求路径（三个 follow 接口共用，避免三处各拼一遍字符串）。 */
function shopFollowUrl(shopId: string | number, suffix = ''): string {
  const id = String(shopId ?? '').trim()
  if (!id) return ''
  return `/api/shop/${encodeURIComponent(id)}/follow${suffix}`
}

/**
 * 关注门店（`POST /api/shop/{shopId}/follow`）。
 * 契约原文：「关注该门店（**幂等**：已关注再调返回成功）。粉丝数冗余在 `wx_shop.fans_count`
 * 同步 +1，并由每日任务校准。」⇒ 重复调用**不是错误**，前端不需要先查状态再决定调不调。
 * ⚠️ 必须登录（未登录 401，见 {@link getShopFollowStatus} 的说明）。
 */
export function followShop(shopId: string | number): Promise<boolean> {
  const url = shopFollowUrl(shopId)
  if (!url) return Promise.reject(new Error('缺少门店 ID'))
  return request<boolean>({ url, method: 'POST' })
}

/**
 * 取消关注门店（`DELETE /api/shop/{shopId}/follow`）。
 * 契约原文：「取消关注（**幂等**：未关注再调返回成功）。粉丝数同步 -1（**按实际行数校准**）。」
 * ⚠️ 必须登录。
 */
export function unfollowShop(shopId: string | number): Promise<boolean> {
  const url = shopFollowUrl(shopId)
  if (!url) return Promise.reject(new Error('缺少门店 ID'))
  return request<boolean>({ url, method: 'DELETE' })
}

/**
 * 查询当前用户对该门店的关注状态 + 该店粉丝数。
 * ⚠️ **调用方必须先确认已登录**（见上方三个 follow 接口共用的 401 说明）；
 *    本函数不做登录判断，也不吞 401 —— 由页面决定"未登录时根本不调"。
 */
export function getShopFollowStatus(shopId: string | number): Promise<ShopFollowStatus> {
  const url = shopFollowUrl(shopId, '-status')
  if (!url) return Promise.reject(new Error('缺少门店 ID'))
  return request<ShopFollowStatus>({ url, method: 'GET' })
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
 * 📄 缺口与口径来源：`docs/26/10.09/前端对接文档-2026-10-10-全集.md` §4.3、
 *    `docs/26/10.10/前端对接文档-2026-10-10-全集.md` §3.1。
 */
