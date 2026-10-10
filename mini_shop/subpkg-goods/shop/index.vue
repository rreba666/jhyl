<script setup lang="ts">
/**
 * C 端 · 店铺页（Figma 节点 `4045:5815`，`店铺_首页_两项`，390×1007）。
 *
 * ## 设计口径（2026-10-10 **重新从 Figma 节点树逐元素取**，不眼估、不沿用旧规格）
 *
 * 逐项「设计值 → 我们现值 → 差异 → 是否已修」的对照表：
 * `docs/26/10.10/店铺页与进店卡片-设计稿逐项复核与修复-2026-10-10.md`。
 * 原始节点树 / @2x 渲染图：`docs/_ref/shop-page/figma-recheck-2026-10-10/`。
 *
 * | 区块 | 设计 y 区间 | 高 | 度量（节点树原值） |
 * |---|---|---|---|
 * | 渐变头图 | 0 → 248 | 248 | `GRADIENT_LINEAR [0%:#704138 100%:#9A674D] handles=(0.5,0)→(0.5,1)` ⇒ `180deg` 同值（渲染图逐点取色一致） |
 * | 导航栏 | 0 → 92 | 48+44 | 白色返回箭头（矢量 9×17，`#FFFFFF@90%`）+ 居中白标题 17px/600；设计假设状态栏 48 |
 * | 店铺卡 | 92 → 235 | 143 | ⚠️ **透明卡**（节点 `fills` 是 `visible:false` 的 `#FFFFFF`，不画成白卡），白字压渐变；`r=12`、`pad=T12 R12 B16 L12` |
 * | 资质条 | 235 → 291 | 56 | `#FFF4E8`，圆角 **12/12/0/0**，`pad=T12 R12 B24 L12`（下 24 是给白卡压叠留的） |
 * | 白内容区 | 279 → 1007 | 728 | 圆角 12/12/0/0，`pad-bottom 40`；与资质条**重叠 12**（父 `Frame 130` 的 `gap=-12`） |
 * | Tab 栏 | 279 → 321 | 42 | 底部 **0.5px** `#F1F2F4`（INSIDE）；选中 `#FF5500` + 28×2 下划线；文案顶距 10、下划线贴底 |
 * | 筛选行 | 321 → 369 | 48 | `pad=12`、`gap=8`；选中 `#FFF4E8` + 1px INSIDE `#FF5500` 描边；未选中 `#F6F7F9` |
 * | 商品网格 | 369 → 967 | 598 | `pad=T0 R12 B0 L12`、**行间距 24 / 列间距 12**、卡宽 177、**末行后无间距**（容器止于末行底） |
 *
 * ## 与设计的差异（都要显式说明，不许"看起来差不多"）
 * 1. **负间距**：`Frame 130` 用 `itemSpacing = -12` 做「白卡压住资质条 12px」。
 *    小程序 flex 的 `gap` **不支持负值** ⇒ 这里改成 `margin-top: -23rpx`（= -12 设计 px）
 *    加在白内容区上，并用**文档顺序**保证层级（资质条在前 = 在下层，白卡在后 = 压在上面）。
 *    没有用 `z-index`：两条都不带定位，顺序即层级，少一个魔法值。
 * 2. **导航栏**：设计里它在渐变头图内部（48 系统栏 + 44 标题栏，共 92）。
 *    实现取「真实状态栏高度 + 44px」并**固定**在顶部（否则滚下去就没有返回入口了），
 *    背景用同一渐变的 **0→92 切片**（`#704138 → #804F40`；`#804F40` 是 `#704138`→`#9A674D`
 *    在 t=92/248 的线性插值，也与渲染图在 y=92 的实测色 `#805041` 一致），
 *    这样未滚动时与 477rpx 的头图渐变**视觉连续**，滚动后返回箭头依然在。
 * 3. **无阴影**：设计里白卡那条 `DROP_SHADOW #E56A00@20% off(0,-8) r16` 是 `visible:false`
 *    ⇒ 实现**不加阴影**（且 `clips` 也会裁掉向上偏移的阴影）。
 * 4. **收藏按钮的渐变角度 = 104.7deg**（⚠️ 2026-10-10 第三轮**改了**；旧值 113deg 是错的）。
 *    节点是 `handles=(0,0)→(1,1)→(-0.5,4.5)` —— **第三个 handle 不能丢**：Figma 三个 handle 定义的是
 *    仿射变换 `p = h0 + u·(h1−h0) + v·(h2−h0)`，而渐变颜色**只随 u 变化** ⇒ 等色线沿 `(h2−h0)`，
 *    **不是**沿包围盒对角线。把 u 在像素空间的梯度解出来：`∇u = (0.9/66, 0.1/28) ∝ (126, 33)`，
 *    方向比 **dx/dy = 3.818**（"只看 h0/h1"会得到 66/28 = 2.357 ⇒ 那是错的来源）。
 *    等价 CSS 角度 = `180deg − atan(3.818)` = **104.7deg**。
 *    实测（从 `card-4045-5826-x4.png` 抠出按钮内部、按 3×3 邻域腐蚀掉抗锯齿边后剩 **1131 点**）：
 *    · `104.7deg` 的 t 误差 rms **0.0063** / 中位 **0.0050** / 最大 **0.0197**（与仿射模型逐点相同）；
 *    · 旧的 `113deg` 是 rms **0.0241** / 中位 **0.0181** / 最大 **0.0565**（**3.9 倍**）⇒ 确证 113deg 错。
 * 5. **认证徽标是真实切图**（本轮修正）：设计是 18×18 实例内的 **14.83 描边「扇贝形」徽章**
 *    （绿描边 + 绿对勾），既不是实心绿圆、也不是"描边圆 + ✓ 字形"能近似的 —— 本轮**直接从 Figma 导出**
 *    （节点 `4045:5862`）⇒ `static/shop/cert-badge.png`（18×18 @3x = 54×54，透明底；
 *    实测 584 个不透明像素**全部**是 `#00B42A`，四角 alpha=0）。旧的 CSS 圆 + 字形已删除。
 * 6. **切图总口径（第三轮）**：能导出的矢量艺术**导出**，其余**明确**保留字形/CSS：
 *    ① 导出：`cert-badge.png`（认证徽章）、`fav-star.png`（收藏按钮的**空心**白星，14×14 @3x = 42×42，
 *       透明底，实测中心像素 alpha=0 ⇒ 空心）；两者都放**分包** `subpkg-goods/static/shop/`（不占主包额度）。
 *    ② 保留 CSS：右箭头 / 返回箭头（"正方形两边旋转 45°"的折线，墨迹 `0.707·(B+t) × 1.414·B`；
 *       收藏按钮那颗 B=11rpx/t=3rpx ⇒ 5.15×8.09px，设计 4.58×8.11px，差 12%；单色、可随状态改色、
 *       任意 DPR 下都锐利）、排序双三角（CSS 三角 5.2×3.12px vs 设计 5.18×3.31px）、
 *       评分实心星 `★`（见下：只在有真实评分时按分值渲染）。
 *    ③ **不导出设计稿的 logo**：它是 IMAGE 填充（平台自己的品牌图），拿它当"门店门头图"= 给没有
 *       logo 的门店安一个别人的 logo ⇒ 未配置 `shopImage` 时只画 10% 白的中性方块（无图无字）。
 *
 * ## 数据来源（2026-10-10 S2b / S3 / **S4** 已全部落地，本页不再有"无接口"的占位逻辑）
 * 本页**三个真实数据源**（前两个免登录、游客可访问；第三个必须登录）：
 * | 区块 | 接口 | 说明 |
 * |---|---|---|
 * | 店铺档案 | `GET /api/shop/{shopId}`（S3，新增） | `Result<ShopVO>`，与 `/api/shop/all` 同构；S4 起**多带 11 个字段** |
 * | 商品网格 | `GET /api/shop/{shopId}/products`（S2b，新增） | `sortBy` + `page` / `pageSize`；S4 起多一个 `recommended` 布尔筛选 |
 * | 关注状态 | `GET /api/shop/{shopId}/follow-status`（S4，**新增能力，需登录**） | `{ followed, fansCount }` |
 *
 * ⚠️ **两种"没有"必须分开渲染**（混在一起就是静默失真）：
 * - 门店不存在 /**已停用** / 软删 ⇒ 上面第一个接口返回业务码 **`8000`**（不是 500、不是 401）
 *   ⇒ 渲染 `shopUnavailable` 那一档：「门店不存在或已停用」（契约 §七 建议文案）；
 * - 门店存在但**无在售商品** ⇒ 接口 `200` + `total=0` ⇒ 渲染网格的空态，
 *   **绝不能**把它显示成"店铺不见了"，也**绝不能**用别的商品顶上。
 * ⚠️ 商品网格此前是**故意不取数**的：`/api/product/list` 的 `shopId` 当时契约写着
 *    「PC 后台按门店筛选」+ 一句已作废的限制（说小程序端不下发该参数）—— 若后端忽略它，
 *    页面会把**全商城商品**显示成"这家店的商品"（= 伪造归属关系）。该限制**已被后端删除**
 *    （S2a 起 `shopId` 真正生效，S2b 又补了门店维度的正式接口）⇒ 本页现在走 S2b 的
 *    **门店专属**入口，走不到"全量商品冒充本店商品"那条路。
 * ⚠️ 负间距与设计值断言注意：网格为空时**不渲染** `.goods-grid`（连同它的 `padding`），
 *    否则空态下面会多出一条白的空隙。
 *
 * ## 新节点 `4045:5826`（= 本页店铺卡 `Frame 114`）**里三块展示位的数据（2026-10-10 S4 已补齐）**
 * 2026-10-10 第三轮重取该节点（390×143，`docs/_ref/shop-card-4045-5826/`）时，卡内的评分行 /
 * 服务表现三格在契约里**一个字段都没有**，当时按"契约没有该字段"整块不渲染。
 * **第四轮（S4）起后端补齐了这些字段**（`ShopVO` 48 字段），本页**接线渲染真实值**：
 * - 店铺**评分** → `ShopVO.rating`（⚠️ 契约原文「由**客观指标合成，非用户评价**」⇒ 文案见 `RATING_LABEL`；
 *   **样本不足时为 null** ⇒ 整块不渲染，不补 `0`、不补 `—`）；
 * - 店铺**粉丝数** → `ShopVO.fansCount`（契约：恒不为 null，`0` = 暂无粉丝 ⇒ 0 也照实渲染）；
 *   ⛔ **不得**用 `boundUserCount`（已绑定微信人数，语义不同）；
 * - **服务表现** → `ShopVO.onTimeRate`（准时送达率）+ `ShopVO.avgAcceptSeconds`（平均接单时长）
 *   —— 这是契约里**仅有的两个可计算项** ⇒ 两格就两格（不足三格**不补空格**）；
 *   ⛔ 设计稿的「口碑品质 / 商品品质」「平均满意度」「平均 12 小时发货」「客服响应 14 秒」
 *   **契约里都没有**，一律不编（尤其不许把"平均接单"改叫"客服响应"）。
 *   字段清单与口径（含"评分是客观合成、非用户评价"）见
 *   `docs/26/10.10/前端对接文档-2026-10-10-全集.md` §12.2 / §12.3 / §12.4 / §12.5。
 * - **「收藏」按钮** → S4 的 `POST/DELETE /api/shop/{shopId}/follow`（详见 `onFavoriteTap`）。
 * 展示口径（文案 / 单位 / 缺省）统一走 `utils/shop-metrics.ts`，与商品详情页的进店卡片**同源**。
 *
 * ## 滚动形态（节点 `4050:6387` `店铺_首页_滚动`，2026-10-10 补充；同日追加**吸顶**决定）
 * 该节点**整棵树每个元素都标了 `scrollBehavior=SCROLLS`**（设计侧**没有** FIXED/sticky 标记）。
 * 它与首屏帧 `4045:5815` 的差异是"滚到某处"的一帧：渐变头图仍 248 高但被 92 高的父框裁掉、
 * 店铺卡从 143 压到 72（服务表现整块不在这一帧里）、Tab 选中态换成「商品」、
 * 筛选行多了个「新品」。逐帧对照与推断见
 * `docs/26/10.10/店铺页滚动形态-4050-6387-推断与实现-2026-10-10.md`。
 *
 * 用户 2026-10-10 对三条开放问题的答复 = 本节的口径：
 * 1. **吸顶（答「2. 吸顶」）**：设计没给吸顶标记，但用户要吸顶 ⇒ 吸的是**内容区的控制带**
 *    （Tab 栏 + 筛选行，模板里的 `.shop-head`）。顶层导航栏本来就是 `position: fixed`
 *    （返回 + 标题一直可点）⇒ 该吸的就只剩这一条；偏移量与取舍见 `headStuck` 与 `.shop-head`。
 * 2. **筛选行第 4 个 chip「新品」（答「3. 加」）**：按节点几何插在「价格」与「口碑优品」
 *    **之间**（不是追加到末尾），映射 `sortBy=new_desc`。
 * 3. 服务表现三项的后端需求另立文档：`docs/26/10.10/后端需求-店铺服务表现三项-2026-10-10.md`。
 *
 * ## 2026-10-10 第五轮（用户四条修改意见，全部只动本页）
 * (1) **导航栏标题 = 「店铺」**（用户逐字：「页面标题改为店铺」）。此前标题是**店铺名**
 *     （会显示成「今华有官方旗舰店」）⇒ 现固定为常量 `NAV_TITLE`；店名照旧在**卡内**渲染。
 * (2) **卡片上方那根白线**：实测用户的真机截图，是**固定导航栏底边**处一条 1 设备像素的
 *     浅色缝（把渐变色与 `page`/`.shop-page` 的 `#F2F3F7` 按 ~34% 混合，逐通道解出的覆盖率
 *     0.345/0.344/0.344 完全一致）—— 设计稿里那一段是**一条连续渐变**，没有这道缝。
 *     两处一起治：① 导航栏高度**向上对齐到整设备像素**并**多画 1 设备像素**（盖住内容首行）；
 *     ② `.shop-page` 的背景在头图区间**接着渐变**（`#704138 → #9A674D 477rpx`，之后才是
 *     `#F2F3F7`）⇒ 万一还有亚像素缝，混到的也是同色渐变色而不是浅色底。见 `navHeight`。
 * (3) **评分/粉丝/服务表现为什么是空的**：不是渲染漏了 —— 线上/内网后端对这三项**一个键都不下发**
 *     （`ShopVO` 契约里 48 个字段含 `rating` / `onTimeRate` / `avgAcceptSeconds`，但真实响应里
 *     **没有这三个键**；`fansCount` 恒下发，实测 `0` ⇒ 页面如实显示「0 粉丝」）。
 *     ⇒ 属于「后端没数据」，页面**不编数字**（详见文件尾部 `RATING_LABEL` / `shop-metrics.ts`）。
 * (4) **随滚动收起的是「评分/粉丝行 + 服务表现」这一块**（用户逐字：「吸顶是除了星级评分，
 *     粉丝，口碑配置，发货时效，客服响应这块，卡片之前其他的都显示」）⇒ 收起的块 = 模板里的
 *     `shop-metrics-block`（评分/粉丝行 + 解释文案）与 `shop-service-row`（服务表现格），
 *     其余（导航栏 / logo+店名 / 收藏 / 资质条 / Tab / 筛选 / 网格）一律不动。
 *     ⚠️ 设计稿的**滚动帧**（`4050:6387`）只删了「服务表现」，仍保留 `Frame 117`（评分/粉丝行）
 *        —— 这一点以**用户口径**为准（用户把评分/粉丝也点进了那一块），见 `COLLAPSE_BLOCK_IDS`。
 */
import { computed, nextTick, ref } from 'vue'
import { onLoad, onPageScroll, onReachBottom } from '@dcloudio/uni-app'
import { followShop, getShopDetail, getShopFollowStatus, unfollowShop, type EnabledShop } from '@/api/shop'
// ⚠️ 用 `getShopProducts`（= `GET /api/shop/{shopId}/products`，S2b）而**不是**
//    `getProductList({ shopId })`：后者是"商品维度"的接口，对不存在的门店回 `200` + `total=0`，
//    会把"这家店没了"渲染成"这家店没商品"（本仓库最忌的静默失真）。
import { getShopProducts, type ProductCard } from '@/api/product'
// 评分 / 粉丝 / 服务表现的**共用口径**（与商品详情页进店卡片同源，见该模块头部注释）。
import { RATING_LABEL, fansText, ratingStars, ratingText, shopServiceMetrics } from '@/utils/shop-metrics'
import { isLoggedIn } from '@/utils/auth'
import LoginGuide from '@/components/LoginGuide.vue'
import { isApiRequestError } from '@/utils/request'

/**
 * 门店不存在的业务码（契约 §七：`8000` = 门店不存在（含停用/软删））。
 * ⚠️ 它是**业务码**（HTTP 仍是 200），由 `utils/request.ts` 转成 `ApiRequestError.code`。
 */
const SHOP_NOT_FOUND_CODE = 8000

/**
 * 页面入参：`/subpkg-goods/shop/index?shopId=…&shopName=…&shopImage=…`
 * （进店卡片跳转过来；后两个是**可选的"已知信息"**，见 `knownShopName`）。
 */
const shopId = ref('')
/** 店铺档案；`null` = 未加载/未命中。 */
const shop = ref<EnabledShop | null>(null)
const loading = ref(true)
/** 取数失败（网络/接口异常）——与「门店不存在」必须分开显示。 */
const errorMessage = ref('')
/** 门店**不存在 / 已停用 / 已被删除**（接口业务码 `8000`，或页面压根没带 `shopId`）。 */
const shopUnavailable = ref(false)

/**
 * **进店时就已经知道**的店名 / 门头图（由进店卡片随 URL 带过来，来源是商品详情 S1 下发的
 * `ProductDetailV2VO.shopName` / `shopImage` —— **真实字段，不是编的**）。
 *
 * ## 为什么要带
 * 用户 2026-10-10 的原话：「**就算是没有相应的字段也是有内容的啊**」——
 * 门店档案（`GET /api/shop/{shopId}`）慢、失败、或门店已停用时，整页**不该变成一片渐变空白**：
 * 店名是**进店那一刻就已经拿到的真实数据**，没有任何理由因为"档案没取到"而丢掉。
 * ⇒ 这两个值只做**占位/回退**：档案一旦到达，`shop.value` 的字段**永远优先**（见下面两个 computed）。
 * ⚠️ 它们是**回退**，不是兜底造数：拿不到就为空，绝不编一个店名/一张图。
 */
const knownShopName = ref('')
const knownShopImage = ref('')

/**
 * 解一个 URL 查询参数（进店卡片那边用 `encodeURIComponent` 编的）。
 * ⚠️ 小程序**不会**自动解码 query（仓库既有口径，见 `subpkg-goods/category/index.vue`）⇒ 必须显式解；
 *    非法编码时保持原值（不抛错、不把页面搞挂）。
 */
function decodeParam(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    return decodeURIComponent(raw).trim()
  } catch {
    return raw
  }
}

/**
 * 「收藏」= **关注门店**（S4 §12.4 新增能力）。
 *
 * ⚠️ **设计文案是「收藏」，契约能力是「关注」**：设计节点 `4045:5826` 的按钮文字逐字为
 *    「收藏」（`api_doc.json` 的三个接口则是 `follow` / `unfollow` / `follow-status`，
 *    描述里写「关注门店」「该店粉丝数」「供店铺页「**关注**」按钮与粉丝数展示」）。
 *    两者是同一个动作（收藏这家店 = 关注这家店，粉丝数因此 +1）⇒
 *    **按设计渲染「收藏」文案**（不擅自改设计文案），
 *    但**状态与文案的语义按契约走**（`followed` 驱动实心/空心星，见 `favText`）。
 *
 * ⚠️ **必须登录**（契约：这三个接口不在公开白名单 ⇒ 无 token 得 **401**，已实测 ✔）。
 *    ⇒ 未登录**根本不发**这两个请求：按钮是"去登录"的入口（`loginGuideVisible`），
 *    而不是"操作失败"的报错。`null` = 还不知道（未登录 / 状态请求失败）⇒
 *    **不显示"已收藏"**（不伪造状态），只显示中性的「收藏」。
 */
const followed = ref<boolean | null>(null)
/** 关注/取关请求进行中：防连点（幂等接口也挡一下，避免来回点出一串请求）。 */
const followLoading = ref(false)
/** 登录引导弹层（与商品详情页同一组件、同一口径）。 */
const loginGuideVisible = ref(false)

/** 「收藏」按钮文案：**已关注**才作「已收藏」，未关注/未知一律「收藏」（不伪造已关注态）。 */
const favText = computed(() => (followed.value === true ? '已收藏' : '收藏'))

/**
 * 真实状态栏高度（px）；导航栏「内容让位高度」= 状态栏 + 设计稿的 **44px 标题栏**。
 * ⚠️ 两个值都**向上对齐到整设备像素**（见 `navHeight`），否则固定层底边会落在半个物理像素上，
 *    与内容首行之间出现一条亚像素浅色缝（就是用户报的那根「白线」）。
 */
const statusBarHeight = ref(0)

/** 设备像素比（`uni.getSystemInfoSync().pixelRatio`）；非微信环境拿不到时按 1 处理。 */
const dpr = ref(1)

/** 设计稿的标题栏高度（状态栏之下 44px）—— 设计值，不是可调参。 */
const NAV_BAR_HEIGHT = 44

/**
 * 固定导航栏**底边与内容起始之间的重叠量**（设备像素）。
 *
 * 为什么要有它：实测那根「白线」是**亚像素缝** —— 固定层底边与内容首行各按自己的方式取整后
 * 差不到 1 个物理像素，缝里露出的是页面底色（`#F2F3F7` 一族），压在深色渐变上就成了一条白线。
 * 让它多画 **1 个设备像素**，这条缝就落在**导航栏自己的不透明渐变**下面（那块是店铺卡的上内边距，
 * 本来就没有内容），视觉上零代价。
 * ⇒ 真机上要调的**第一个值**就是它（0 = 不重叠，也就是改回原来的行为）。
 */
const NAV_SEAM_OVERLAP_DEVICE_PX = 1

/**
 * 内容让位高度（px）= 状态栏 + 44，**向上取整到整设备像素**。
 * 内容层（`.shop-body` 的 `padding-top`）与吸顶带 `top` 都用它 ⇒ 卡片起点与导航栏底边对齐。
 */
const navHeight = computed(() => {
  const raw = statusBarHeight.value + NAV_BAR_HEIGHT
  const ratio = dpr.value > 0 ? dpr.value : 1
  return Math.ceil(raw * ratio) / ratio
})

/**
 * 固定导航栏**实际绘制高度**（px）= 内容让位高度 + `NAV_SEAM_OVERLAP_DEVICE_PX` 个设备像素。
 * ⚠️ 它**只**用在 `.nav` 的高度上：比内容起点多出这一丝，正是用来盖住那条亚像素缝的。
 */
const navBarHeight = computed(() => navHeight.value + NAV_SEAM_OVERLAP_DEVICE_PX / (dpr.value > 0 ? dpr.value : 1))

/**
 * 卡片上的店名：**档案优先**，取不到时退回进店时已知的店名（见 `knownShopName`）。
 * ⚠️ 拿不到就渲染空串（白字占位由卡片自己的版式决定），**不编一个店名**。
 */
const shopNameText = computed(() => String(shop.value?.name || '').trim() || knownShopName.value)

/**
 * 导航栏标题：**固定「店铺」**（用户 2026-10-10 逐字：「页面标题改为店铺」）。
 *
 * ⚠️ 2026-10-10 第五轮**改掉了**旧行为：旧实现是 `computed(() => shopNameText.value || '非遗老号')`
 *    —— 标题会变成**店铺名**（用户截图里就是「今华有官方旗舰店」），与设计不一致。
 *    店名本身照旧渲染在**卡内**（`.shop-name`，`shopNameText`），导航栏只放页面标题。
 */
const NAV_TITLE = '店铺'

/** 门头图：档案优先，其次进店时已知的图；都没有 ⇒ 模板画**中性方块**（不塞占位图）。 */
const logo = computed(() => String(shop.value?.shopImage || '').trim() || knownShopImage.value)


/**
 * 当前 Tab（`首页` / `商品`）。
 * ⚠️ 设计只给了「首页」选中态的示例，**两个 Tab 的内容差异仍未定义**（实现说明 §5 第 7 条）。
 *    现在两档共用同一份「店铺档案 + 筛选行 + 商品网格」—— 这不是"没做"，
 *    而是**产品口径未定时刻意不分叉**（同一份数据，分叉只会凭空造出两套行为）。
 *    后端已具备分叉能力（S2b 的 `sortBy` 含 `new_desc` / `sort_order`），等口径确定再拆。
 */
const activeTab = ref<'home' | 'goods'>('home')

/**
 * 当前筛选档（设计给了四个 chip，映射关系见 `sortByParam` / `recommendedParam`）：
 * - `销量` → `sortBy=sold_desc` ✅；
 * - `价格` → `sortBy=price_asc|price_desc` ✅（图标上三角=升序、下三角=降序）；
 * - `新品` → **`sortBy=new_desc`** ✅（用户 2026-10-10 答「3. 加」；
 *   取材：节点 `4050:6387` 的筛选行有 4 个 chip，第 3 个逐字为「新品」，
 *   几何 `x=612`（在 `价格` x=550 与 `口碑优品` x=660 **之间**）、未选中态 `#F6F7F9` + `#1D2129`；
 *   取值：契约 `sortBy` 的 `new_desc` 逐字描述是「**新品**降序（按创建时间）」⇒ 与设计文案同义）；
 * - `口碑优品` → **`recommended=true`**（✅ 2026-10-10 S4 §12.5 起支持）。
 *   ⚠️ 口径变了：它**不是** `sortBy` 的新枚举，而是**"只看推荐商品"的布尔筛选**
 *   （契约原文「是否只看推荐商品（店铺页「口碑优品」栏位用）：true ⇒ isRecommended=1 的在售商品」）
 *   ⇒ 因此它**可以**进选中态（旧实现在这里"只给一句中性提示、不切换选中态"，
 *   理由是"契约没有对应枚举"—— 那个理由**已作废**，见 §12.5）。
 */
const activeSort = ref<'sold' | 'price' | 'new' | 'reputation'>('sold')
/** 价格排序方向：`asc` = 从低到高（设计稿渲染图里**上三角为深色** ⇒ 默认升序）。 */
const priceOrder = ref<'asc' | 'desc'>('asc')

/**
 * 传给 S2b 的 `sortBy`。
 *
 * ⚠️ `sortBy` 在契约里是**可选**参数（`sold_desc / price_asc / price_desc / new_desc / sort_order`），
 *    不传 = 后端默认排序。两个价格档**各自**给出自己的枚举值（升/降序不可互相顶替）；
 *    「销量」档给出 `sold_desc`（设计里「销量」= 销量倒序，映射关系见 `activeSort` 注释）；
 *    「新品」档给出 `new_desc`（契约逐字：「`new_desc` — **新品**降序（按创建时间）」）。
 *    「口碑优品」档**沿用 `sold_desc`**：契约明写该接口带 `recommended` 时
 *    「排序与分页与不带该参数一致」⇒ 改的只有筛选，不另编一个排序值。
 */
const sortByParam = computed<'sold_desc' | 'price_asc' | 'price_desc' | 'new_desc'>(() => {
  if (activeSort.value === 'price') return priceOrder.value === 'desc' ? 'price_desc' : 'price_asc'
  if (activeSort.value === 'new') return 'new_desc'
  return 'sold_desc'
})

/**
 * 是否只看推荐商品（「口碑优品」档 ⇒ `recommended=true`；其余档**不传该参数**）。
 * ⚠️ 只在 `true` 时下发：不传 = 后端默认（不筛选），多写一个 `false` 语义相同、只是 URL 变长。
 */
const recommendedParam = computed(() => activeSort.value === 'reputation')

/**
 * 店铺卡内的「服务表现」格（真实数据，见 `utils/shop-metrics.ts`）；没有可计算项时是空数组。
 * ⚠️ 它属于**滚动收起**的那一块（见 `COLLAPSE_BLOCK_IDS`）。
 */
const serviceMetrics = computed(() => shopServiceMetrics(shop.value))

/**
 * ===== 随滚动收起的两块（用户 2026-10-10 第四条）=====
 *
 * 用户逐字：「**吸顶是除了星级评分，粉丝，口碑配置，发货时效，客服响应这块，卡片之前其他的都显示**」
 * ⇒ 收起的 = 店铺卡里的**评分/粉丝行**（含「综合服务分（非用户评价）」那行解释文案）
 *    与**服务表现格**这两块；其余一律不动：
 *   导航栏 / logo + 店名 / 收藏 / 「店铺资质 · 经营资质」条 / Tab 栏 / 筛选行（后两者是吸顶带）/ 商品网格。
 *
 * ⚠️ **块 id 必须与模板里的 `id="…"` 逐字一致**（`uni.createSelectorQuery` 按 id 量高；
 *    契约 `shop-page.contract.ps1` §11e 会把两边的字面量都钉住，改一处不改另一处会红）。
 * ⚠️ 设计稿的**滚动帧**（节点 `4050:6387`，店铺卡 390×72）只删了「服务表现」，
 *    仍保留 `Frame 117`（评分/粉丝行）—— 这一条**以用户口径为准**（用户把评分/粉丝也点进了那一块）；
 *    若要回到设计稿的滚动帧，只需把 `'shop-metrics-block'` 从本数组里去掉（一处即可）。
 */
const COLLAPSE_BLOCK_IDS = ['shop-metrics-block', 'shop-service-row'] as const

/**
 * 滚动折叠阈值（px，页面纵向滚动距离）。
 * **这是推断值，不是节点标称值** —— 节点 `4050:6387` 只给了"滚到底"那一帧的几何
 * （渐变头 248→被 92 的父框裁掉、店铺卡 143→72、Tab 选中态换「商品」），
 * **Figma 帧只表达状态、不表达时序**，所以阈值只能由"这一帧对应的滚动量"反推：
 * 头图可折叠量 = 248 − 92 = **156px**，取整到 60 是为了让过渡在**首屏就看得见**
 * （156 太靠后：网格已经滚过一屏，用户会以为卡里那块"本来就没了"）。
 * ⇒ 真机上手要调的**第一个值**就是它（变大 = 更晚收起）。
 */
const METRICS_COLLAPSE_THRESHOLD = 60

/**
 * 折叠的**缓冲带**（px）：只有在 `阈值 − 40` 以下才恢复，避免在阈值附近来回抖动。
 * 真机要调的**第二个值**（见 `onPageScroll` 注释）。
 */
const METRICS_COLLAPSE_HYSTERESIS = 40

/** 是否已滚过阈值 ⇒ 收起 `COLLAPSE_BLOCK_IDS` 里的两块（**可逆**：滚回去会恢复，见 `onPageScroll`）。 */
const metricsCollapsed = ref(false)

/**
 * 量高度的**重试上限**（**按块各算一份**：模板渲染完之前量不到，量到就停、量不到也要停）。
 * ⚠️ 门店没有任何可计算指标 / 没有评分也没有粉丝时，对应的块**根本不存在**
 *    （`v-if`）⇒ `createSelectorQuery` 永远返回 null；没有这个上限，
 *    `onPageScroll` 每触发一次就发一次查询（= 每帧一次布局读取）。
 */
const COLLAPSE_MEASURE_MAX_TRIES = 5
const collapseTries: Record<string, number> = {}

/**
 * ===== 吸顶（用户 2026-10-10 答复「2. 吸顶」）=====
 *
 * ## 吸什么、为什么不吸别的
 * - **吸顶对象 = 内容区的控制带**：Tab 栏（首页 / 商品）+ 筛选行（销量 / 价格 / 新品 / 口碑优品），
 *   模板里包成 `.shop-head`。它是本页**唯一的控制面** —— 往下滚之后还要能换 Tab、换筛选，
 *   否则只能滚回顶部才能操作（"吸顶"要解决的正是这件事）。
 * - **顶层导航栏不在这里做**：它本来就是 `position: fixed`（见 `.nav`），返回与标题**一直可点**；
 *   再叠一层 sticky 只会和 fixed 打架。
 * - **不吸店铺卡 / 资质条**：设计那一帧里店铺卡是被**裁到 72** 的（服务表现整块不在帧内）
 *   ⇒ 头部本来就该随滚动让位；把 143 高的卡常驻会在 667px 屏上吃掉约 22% 的高度。
 *
 * ## 与"两块收起"为什么不打架（三条硬约束）
 * 1. **偏移量只有一个来源 `navBarHeight`**（模板里绑成 `top`）：折叠块在吸顶带的**上方**，
 *    它收起只会把吸顶带**更早**顶到吸住位置，**不改变吸住后的位置**
 *    （`top` 是相对滚动视口的常量 ⇒ 折叠前后吸住位置逐像素相同）。
 * 2. **不切 `position`**：`.shop-head` 恒为 `sticky`，滚动只切阴影（可过渡）——
 *    `relative ↔ sticky` 切换会重算位置并抖动（见 `CLAUDE.md` §十二）。
 * 3. **判据同步折叠量**：两个折叠块的累计高度是**量出来的**（`collapseHeights`），它只把
 *    "什么时候算吸住"的判据上移同样的像素数（见 `syncHeadStuck`），**不参与布局、不写回样式**。
 *
 * ⚠️ **偏移量必须是"真实状态栏高 + 44"**（`navBarHeight`）：固定导航栏盖住的正是这一段，
 *    写死一个"看起来差不多"的值 ⇒ 刘海屏 / 不同状态栏高度下 Tab 被压在导航栏底下（**点不到**）。
 */

/** 吸顶带的**页面坐标**顶边（px）；`0` = 还没量到（量不到就不显示"已吸住"的阴影，绝不猜一个阈值）。 */
const headTopPx = ref(0)
/** 是否已吸在导航栏下方 —— **只驱动阴影**，不参与定位（定位恒由 `sticky` + `top` 决定）。 */
const headStuck = ref(false)
/**
 * 吸顶带 `top` 的内联样式：**固定导航栏的真实下沿**（`navBarHeight`，含那 1 个设备像素的重叠）。
 * ⚠️ 这里**不能**用 `navHeight`（内容让位高度）：它比导航栏下沿少 1 个设备像素 ⇒
 *    吸住时 Tab 栏顶部那一丝会被导航栏盖住，看起来像"吸顶带上方又有一条深色缝"。
 */
const headStyle = computed(() => ({ top: `${navBarHeight.value}px` }))
/** 量吸顶带位置的重试上限（`onLoad` 时模板可能还没渲染完；量到就停）。 */
const HEAD_MEASURE_MAX_TRIES = 5
let headMeasureTries = 0
/** 最近一次 `onPageScroll` 的纵向滚动量（px）—— 视口坐标换算成页面坐标要靠它。 */
let lastScrollTop = 0

/**
 * 量一次吸顶带的**页面坐标**顶边（量到就缓存，之后**零开销**）。
 *
 * ⚠️ `uni.createSelectorQuery().boundingClientRect` 给的是**视口坐标** ⇒ 要加回当前滚动量
 *    （`lastScrollTop`）才是页面坐标。
 * ⚠️ **已经吸住时不能量**：那时视口坐标恒等于导航栏下沿，加回去得到的是"吸住位置"而不是
 *    "自然位置" ⇒ 用它算判据永远算不出吸住点。这一档直接丢弃（下次在非吸住位置再量）。
 * @see https://uniapp.dcloud.net.cn/api/ui/nodes-info.html
 */
function measureHeadTop(): void {
  if (headTopPx.value > 0 || headMeasureTries >= HEAD_MEASURE_MAX_TRIES) return
  headMeasureTries++
  uni.createSelectorQuery()
    .select('#shop-head')
    .boundingClientRect((rect) => {
      const top = Number((rect as { top?: number } | null)?.top)
      if (!Number.isFinite(top) || top <= navBarHeight.value + 1) return
      headTopPx.value = top + lastScrollTop
    })
    .exec()
}

/**
 * 两个折叠块的**累计真实高度**（px）：全部收起后，吸顶带整体上移这么多。
 * ⚠️ 只对**已经量到**的块求和（量不到 = 那块根本不存在/还没量到 ⇒ 当作 0，绝不猜一个高度）。
 */
const collapsedShiftPx = computed(() => COLLAPSE_BLOCK_IDS.reduce(
  (sum, id) => sum + (collapseHeights.value[id] || 0),
  0
))

/**
 * 更新"是否已吸住"（**只影响阴影**）。
 *
 * 判据 = `scrollTop + 导航栏下沿 ≥ 吸顶带的页面顶边`；吸顶带在**折叠态**下整体上移了
 * `collapsedShiftPx`（两块都在它上方）⇒ 判据同步上移同样的像素数，折叠动画与吸顶**同源同量**，
 * 不会出现"折叠完阴影滞后 / 提前"。
 * 量不到顶边（`headTopPx === 0`）⇒ 恒 `false`：**不猜阈值**，宁可没有阴影。
 */
function syncHeadStuck(scrollTop: number): void {
  if (headTopPx.value <= 0) return
  const headTop = headTopPx.value - (metricsCollapsed.value ? collapsedShiftPx.value : 0)
  headStuck.value = scrollTop + navBarHeight.value >= headTop
}

/**
 * 店铺客观指标的展示值（真实字段，口径见 `utils/shop-metrics.ts`）：
 * 评分 / 星串 / 粉丝 / 服务表现，四项**各自独立**地在没有真实值时为空。
 */
const rating = computed(() => ratingText(shop.value?.rating))
const stars = computed(() => ratingStars(shop.value?.rating))
const fans = computed(() => fansText(shop.value?.fansCount))

/**
 * 滚动监听（uni-app 页面级滚动用 `onPageScroll`，不猜 DOM `window`）。
 *
 * ## 为什么是"可逆"（而不是单向收起）
 * 节点只是**一帧静态图**，本身**不表达**单向还是双向。这里选**可逆**，理由有两条硬的：
 * ① 顺滑度：单向收起后往回滚会出现"内容**再也回不来**"的观感 —— 那更像 bug 而不是设计；
 * ② 一致性：`CLAUDE.md` §十二 的既有口径是"吸顶元素恒定 sticky、只过渡可过渡属性"，
 *    可逆的、由同一个布尔驱动的过渡与它同构，不会出现"回滚时另一个分支又跳一下"。
 * ⚠️ **脱离阈值加缓冲带（60 / 40）**：阈值处手指微抖会反复穿越 ⇒ 过渡被反复打断（视觉上像抖动）。
 *    要真机上调的**第二个值**就是这个缓冲带（本文件取 `METRICS_COLLAPSE_HYSTERESIS`）。
 * ⚠️ 顺手在这里**量一次两个折叠块的真实高度**（`measureCollapseBlock`）：`onLoad` 时模板还没渲染完，
 *    量到的会是 0 ⇒ 必须在每次滚动里试着量，量到就记下、之后不再量。
 * ⚠️ **本回调要便宜**：每帧只做「几个缓存判空 + 两次数值比较」，**没有布局读取** ——
 *    每个 `createSelectorQuery` 都在量到之后立即短路（各自还有重试上限兜底，见那两个常量）。
 */
onPageScroll((event) => {
  const top = Number(event?.scrollTop) || 0
  lastScrollTop = top
  for (const id of COLLAPSE_BLOCK_IDS) measureCollapseBlock(id)
  // 吸顶带的页面坐标只在"还没吸住"时量得到（见 `measureHeadTop`）；量到即缓存，之后零开销。
  if (headTopPx.value <= 0) measureHeadTop()
  if (!metricsCollapsed.value && top >= METRICS_COLLAPSE_THRESHOLD) {
    metricsCollapsed.value = true
  } else if (metricsCollapsed.value && top <= METRICS_COLLAPSE_THRESHOLD - METRICS_COLLAPSE_HYSTERESIS) {
    metricsCollapsed.value = false
  }
  // 放在折叠判定**之后**：同一帧里折叠与吸顶判据用的是同一份几何（见 `syncHeadStuck`）。
  syncHeadStuck(top)
})

/**
 * 两个折叠块上绑定的一次性内联高度（`Record<块 id, px>`）。
 *
 * ⚠️ 为什么不用 CSS 里的固定高度：块高由内容决定（设计是 HUG）——
 *    服务表现格按实际存在的格数走，评分/粉丝行还可能是 0 行（没有真实评分又没有粉丝时整块不存在）。
 *    写死一个"看起来差不多"的数就是**在样式里编数据**。这里改为**首帧量一次真实高度**，
 *    之后 `height: 0 / N px` 的过渡两端都是**真实几何**。
 *    量不到（非微信环境 / 节点未渲染）时留空 ⇒ 模板退化为"不折叠"，**绝不用假高度顶上**。
 * @see https://uniapp.dcloud.net.cn/api/ui/nodes-info.html
 */
const collapseHeights = ref<Record<string, number>>({})

/**
 * 量一次某个折叠块的真实高度（量过就不重复量）。
 * ⚠️ **量不到也要停**（`COLLAPSE_MEASURE_MAX_TRIES`）：块本身可能不存在（`v-if`）⇒
 *    查询恒返回 null；不加预算就会**每个滚动事件发一次查询**（每帧一次布局读取）。
 */
function measureCollapseBlock(id: string): void {
  if (collapseHeights.value[id] !== undefined) return
  const tried = collapseTries[id] || 0
  if (tried >= COLLAPSE_MEASURE_MAX_TRIES) return
  collapseTries[id] = tried + 1
  uni.createSelectorQuery()
    .select(`#${id}`)
    .boundingClientRect((rect) => {
      const height = Number((rect as { height?: number } | null)?.height) || 0
      if (height > 0) collapseHeights.value = { ...collapseHeights.value, [id]: height }
    })
    .exec()
}

/**
 * 根据折叠状态与已量到的高度，给出该块的内联样式。
 * - 没量到真实高度 ⇒ **返回空对象**（即不折叠：宁可不动，也不用假高度把布局搞坏）；
 * - 未折叠 ⇒ 显式高度 = 真实高度（过渡的起点）；
 * - 已折叠 ⇒ 高度 0 + `opacity: 0`（配合 `overflow: hidden` 收干净，不留空档）。
 *
 * ⚠️ 用**显式高度**而不是 `max-height`：`max-height` 从一个大值收到 0 时，
 *    感知速度是非线性的（前 80% 的动画时间只走了很小的视觉变化），看起来"先卡一下再突然收完"。
 * ⚠️ 也**不能**用 `display: none` —— 它不可过渡，会变成硬切。
 * ⚠️ 内边距**必须在块自己身上**（`.shop-metrics-block` / `.shop-service-row` 的 `padding-top`），
 *    不能写成 `margin-top`：`boundingClientRect().height` 是**边框盒**、**不含外边距** ⇒
 *    用 margin 时量到的高度比实际占位少一截，收起后会留下一条空隙。
 */
function collapseBlockStyle(id: string): Record<string, string> {
  const measured = collapseHeights.value[id]
  if (measured === undefined) return {}
  return metricsCollapsed.value
    ? { height: '0px', opacity: '0' }
    : { height: `${measured}px`, opacity: '1' }
}

/** 每页条数（契约限 1~100；取 10 —— 与首页/搜索页同档，网格一小屏约 4 张）。 */
const PAGE_SIZE = 10

/**
 * 店铺商品列表（`GET /api/shop/{shopId}/products`，S2b）。
 * 空数组的含义由 `productsLoaded` / `productsError` 一起决定，不要单看它。
 */
const products = ref<ProductCard[]>([])
const productsLoading = ref(false)
const productsLoadingMore = ref(false)
/** 首页商品请求是否**已经成功返回过一次**（决定空态能不能说"暂无在售商品"）。 */
const productsLoaded = ref(false)
/** 商品列表取数失败（网络/业务异常）——与"空"必须分开，避免把故障说成"没有商品"。 */
const productsError = ref('')
const page = ref(1)
/** 本页实际返回条数 —— 判"还有没有下一页"用它，**不看 `total`**（见下）。 */
const lastPageSize = ref(0)

/**
 * 是否还有下一页。
 * ⚠️ 判据是「**本页条数 < pageSize**」，与 `subpkg-merchant/orders/list.vue` 同一口径：
 *    本仓库已知后端 `total` 在部分接口上不可信，用"本页是否满页"判断不会漏也不会死循环。
 */
const hasMore = computed(() => lastPageSize.value >= PAGE_SIZE)

/**
 * 网格卡片的**视图模型**：把后端价格拆成「整数段 / 小数段」两截（外加符号段）。
 *
 * ⚠️ 设计稿的 `¥ 299.00` 是**一个** TEXT 节点配 `characterStyleOverrides`：
 *    `¥ ` = 12px/**500**、整数 `299` = **18px/500**、小数 `.00` = 14px/500 —— 三段**字号不同**。
 *    旧规格只记了"`¥` 与数字字号不同"，把数字整段按 14px/600 渲染 ⇒ 价格比设计小一圈、还粗了一档；
 *    2026-10-10 重新解析节点树才发现整数位是 **18px**（见文首对照表第 20 条）。
 *    WXML 模板里没法对同一条目反复调函数拆分，所以在这里一次算好。
 */
const gridProducts = computed(() => products.value.map((product) => {
  const text = formatAmount(Number(product.price))
  const dot = text.indexOf('.')
  return {
    ...product,
    priceInt: dot < 0 ? text : text.slice(0, dot),
    priceDec: dot < 0 ? '' : text.slice(dot),
  }
}))

/**
 * 请求竞态 token：切换排序后**在飞的旧请求必须作废**（与 `subpkg-wallet/flows/flows.vue` 同款）。
 * ⚠️ 这里**只**在排序切换（`reset`）时由用户触发发请求：没有输入框、没有滚动联动，
 *    所以不需要防抖 —— 连点同一个排序项由 `selectSort` 的"值相同就 return"挡住。
 */
let productsToken = 0

/**
 * 拉取店铺商品。`reset=true` = 换排序后从第 1 页重查。
 *
 * ⚠️ 防重入只挡"加载更多"：切换排序**必须放行**（否则上一次请求没回来时切排序会被静默丢弃，
 *    表现为"点了排序没反应"）。
 */
async function loadProducts(reset = true): Promise<void> {
  if (!reset && (productsLoading.value || productsLoadingMore.value)) return
  if (!reset && !hasMore.value) return
  if (reset) {
    productsLoading.value = true
    productsError.value = ''
  } else {
    productsLoadingMore.value = true
  }
  const token = ++productsToken
  const targetPage = reset ? 1 : page.value + 1
  try {
    const result = await getShopProducts({
      shopId: shopId.value,
      sortBy: sortByParam.value,
      // 「口碑优品」档：只看推荐商品（S4 §12.5）；其余档不传该参数。
      recommended: recommendedParam.value,
      page: targetPage,
      pageSize: PAGE_SIZE,
    })
    // 过期响应丢弃：旧排序的结果不能盖掉新排序的列表。
    if (token !== productsToken) return
    const list = result?.list || []
    products.value = reset ? list : products.value.concat(list)
    page.value = Number(result?.page) || targetPage
    // ⚠️ 用**本页实际条数**判"还有没有下一页"（不用 total，见 hasMore 注释）。
    lastPageSize.value = list.length
    productsLoaded.value = true
  } catch (error) {
    if (token !== productsToken) return
    productsError.value = error instanceof Error ? error.message : '商品加载失败，请重试'
  } finally {
    // 只有最新请求能关 loading。
    if (token === productsToken) {
      productsLoading.value = false
      productsLoadingMore.value = false
    }
  }
}

/** 触底加载下一页（页面级滚动由微信触发，与搜索页/首页同款）。 */
onReachBottom(() => {
  void loadProducts(false)
})

/**
 * 取门店档案（S3）。
 *
 * ⚠️ **失败不擦页面**（用户 2026-10-10：「就算是没有相应的字段也是有内容的啊」）：
 *    档案拿不到时只把**状态行**点亮（加载中 / 8000 / 加载失败 + 重试），
 *    卡片主体（logo 槽 / 店名 / 收藏 / 资质条）照常渲染 —— 店名还是**进店时就已知**的那个（`knownShopName`）。
 * ⚠️ `8000` 是**独立状态**（门店不存在/停用/软删），不是通用错误：契约 §七 给的建议文案就是
 *    「门店不存在或已停用」；其余异常（网络/5xx/其它业务码）走通用失败分支（可重试）。
 */
async function loadShop(): Promise<void> {
  if (!shopId.value) {
    // 没带 shopId 就没法定位门店：如实说"门店不存在"，不编一个默认店。
    shopUnavailable.value = true
    loading.value = false
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    shop.value = await getShopDetail(shopId.value)
  } catch (error) {
    if (isApiRequestError(error) && Number(error.code) === SHOP_NOT_FOUND_CODE) {
      shopUnavailable.value = true
    } else {
      errorMessage.value = error instanceof Error ? error.message : '店铺信息加载失败'
    }
  } finally {
    loading.value = false
  }
}

/**
 * 读页面参数 → 取门店档案（S3）→ 再取该门店的在售商品（S2b）。
 *
 * ⚠️ 两个接口**串行**：商品接口对停用门店同样返回 `8000`，但"门店没了"这个结论应当由
 *    门店档案接口给出（它是门店维度的事实来源）；先档案后商品，语义最直白。
 * ⚠️ 商品请求**只在档案真的取到时**才发（门店已停用 ⇒ 问了也只有 `8000`）。
 */
onLoad(async (options) => {
  try {
    const info = uni.getSystemInfoSync()
    statusBarHeight.value = Number(info?.statusBarHeight) || 0
    // 设备像素比：导航栏高度要靠它**向上对齐到整设备像素**（见 `navHeight` / `NAV_SEAM_OVERLAP_DEVICE_PX`）。
    dpr.value = Number(info?.pixelRatio) || 1
  } catch {
    // 非微信环境拿不到系统信息：退化为仅 44px 标题栏、倍率按 1 算（对齐仍成立）。
    statusBarHeight.value = 0
    dpr.value = 1
  }
  const params = (options || {}) as Record<string, unknown>
  shopId.value = String(params.shopId || '').trim()
  // 进店卡片带来的"已知信息"（真实字段，只作回退）：见 `knownShopName`。
  knownShopName.value = decodeParam(params.shopName)
  knownShopImage.value = decodeParam(params.shopImage)
  await loadShop()
  // 门店不存在 ⇒ 不再去问商品（问了也只有 8000）。
  if (shop.value) {
    // ⚠️ 吸顶带的**页面坐标**要趁"页面还在顶部、且还没吸住"时量一次（见 `measureHeadTop`）：
    //    等一拍让模板把 `loading=false` 后的真实内容（含吸顶带）渲染出来，否则节点还不存在。
    //    量一次就缓存；万一这次没量到，`onPageScroll` 里还有限次兜底（不猜阈值、也不每帧读布局）。
    await nextTick()
    measureHeadTop()
    await loadProducts(true)
    // ⚠️ 关注状态**必须登录**才查（未登录时该接口 401，见 `followed` 注释）：
    //    放在商品之后、且不 await 进关键路径 —— 它只影响按钮上的一个词，不该拖慢首屏。
    void loadFollowStatus()
  }
})

/**
 * 查当前用户的关注状态（S4 §12.4）。
 *
 * ⚠️ **未登录直接跳过**：契约明写这三个接口不在公开白名单 ⇒ 无 token 得 **401**
 *    （而且 `utils/request.ts` 的"游客降级重试"白名单只覆盖 GET 只读公开接口，
 *    本接口**不在**那份白名单里 ⇒ 未登录发出去只会拿到 401 并清一次会话）。
 * ⚠️ 失败**不打扰用户**：状态拿不到就保持 `null`（按钮显示中性的「收藏」），
 *    不弹错、不改页面为错误态 —— 粉丝数本身走 `ShopVO.fansCount`（公开），不受影响。
 */
async function loadFollowStatus(): Promise<void> {
  if (!shopId.value || !isLoggedIn()) return
  try {
    const status = await getShopFollowStatus(shopId.value)
    // ⚠️ 契约里该响应**没有字段级 schema**（`ResultMapStringObject`）⇒ 只做保守解析：
    //    键存在且是布尔才认，否则保持"未知"（不把 undefined 当 false）。
    followed.value = typeof status?.followed === 'boolean' ? status.followed : null
  } catch {
    followed.value = null
  }
}

/**
 * 「收藏」按钮：**关注 / 取关门店**（`POST` / `DELETE /api/shop/{shopId}/follow`，S4 §12.4）。
 *
 * - 未登录 ⇒ 打开登录引导（**不发请求**，见 `followed` 注释）；
 * - 已关注 ⇒ `DELETE`（取关）；否则 ⇒ `POST`（关注）。两者契约都写明**幂等**
 *   （「已关注再调返回成功」/「未关注再调返回成功」）⇒ 连点/重试都不会报错。
 * - 成功后**只翻转本地状态**：粉丝数由后端「按实际行数校准」，前端**不自己 ±1**
 *   （那会和后端的校准口径分叉；下次进店拿到的 `fansCount` 才是权威值）。
 * - 失败 ⇒ 中性提示 + **状态不变**（不回滚成假的"已收藏"，也不假装成功）。
 */
async function onFavoriteTap(): Promise<void> {
  if (!shopId.value || followLoading.value) return
  if (!isLoggedIn()) {
    loginGuideVisible.value = true
    return
  }
  followLoading.value = true
  const target = followed.value !== true
  try {
    if (target) {
      await followShop(shopId.value)
    } else {
      await unfollowShop(shopId.value)
    }
    followed.value = target
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '操作失败，请重试', icon: 'none' })
  } finally {
    followLoading.value = false
  }
}

/** 返回上一级；没有历史页面时回首页。 */
function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1 })
    return
  }
  uni.switchTab({ url: '/pages/index/index' })
}

/** 切换到指定 Tab（内容差异未定义，见 `activeTab` 注释）。 */
function switchTab(tab: 'home' | 'goods'): void {
  activeTab.value = tab
}

/**
 * 选择筛选档并**立即按新筛选重查第 1 页**（S2b 的 `sortBy` + S4 的 `recommended`）。
 *
 * - 点「销量」：切到销量档（已在该档则什么都不做，两个参数都不变 ⇒ 不发重复请求）；
 * - 点「价格」：未在价格档 ⇒ 切过去并回到**升序**（设计默认）；已在价格档 ⇒ **反转升降序**；
 * - 点「新品」：切到该档（`sortBy=new_desc`）；已在该档则什么都不做（同一档没有第二种含义）；
 * - 点「口碑优品」：切到该档（`recommended=true`，S4 §12.5）；已在该档则什么都不做。
 * ⚠️ 重查走 `loadProducts(true)`：它会用 token 作废在飞的旧请求（见该函数注释），
 *    所以连着点也不会出现"列表回到上一个排序"。
 */
function selectSort(sort: 'sold' | 'price' | 'new' | 'reputation'): void {
  if (sort === activeSort.value) {
    // 「价格」是唯一"同一档再点有第二种含义"的档（反转升降序）；其余两档再点即无操作。
    if (sort !== 'price') return
    priceOrder.value = priceOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    activeSort.value = sort
    if (sort === 'price') priceOrder.value = 'asc'
  }
  void loadProducts(true)
}

/**
 * 「经营资质」：打开**经营资质页**（本分包 `subpkg-goods/shop/qualification`）。
 *
 * ⚠️ 设计稿里**没有**这张页面的节点（2026-10-10 把 Figma 文件「店铺」页整棵树按
 *    `资质 / 营业执照 / 许可证 / 证照` 四个词扫过一遍，只命中这条入口本身，
 *    没有任何画板）⇒ 页面按用户给的**真实小程序参考页**（别家店铺的「经营资质」）排版。
 * ✅ 2026-10-10 S4 起 `ShopVO` **已经有**门店级资质字段（`licenseNo/licenseImage` /
 *    `foodPermitNo/foodPermitImage/foodPermitExpireDate`）⇒ 资质页渲染**真实证照**，
 *    某店没录时仍走"暂未公示"的诚实空态（见该页头部注释）。
 */
function onQualificationTap(): void {
  // 没带 shopId 时不跳：资质页同样以 shopId 为唯一取数依据，空手跳过去只能显示错误。
  if (!shopId.value) return
  uni.navigateTo({ url: `/subpkg-goods/shop/qualification?shopId=${encodeURIComponent(shopId.value)}` })
}

/** 打开商品详情（网格做出来后的既有跳转口径）。 */
function openProduct(product: ProductCard): void {
  if (!product?.id) return
  uni.navigateTo({ url: `/subpkg-goods/detail/detail?id=${encodeURIComponent(String(product.id))}` })
}

/** 价格展示：去掉整数金额后多余的 `.00`（与详情页 `formatAmount` 同口径）。 */
function formatAmount(value: number): string {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '')
}
</script>

<template>
  <view class="shop-page">
    <!-- 渐变头图层：设计里它是 `layoutPositioning=ABSOLUTE` 的**背景层**，
         不能进 flex 流（否则会占位把内容顶下去 —— 实现说明 §7.5）。
         高度 248 设计 px = 477rpx；y≥246 的部分会被资质条/白卡盖住，留出圆角处的渐变。 -->
    <view class="hero-gradient" />

    <!-- 导航栏：固定在最上方（滚下去也要能返回），背景取同一渐变的 0→92 切片。
         ⚠️ 高度绑的是 `navBarHeight`（= 内容让位高度 + 1 个设备像素的重叠），**不是** `navHeight`：
            多出的这一丝用来盖住"固定层底边 ↔ 内容首行"之间那条亚像素浅色缝（用户报的白线）。 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px`, height: `${navBarHeight}px` }">
      <!-- 返回箭头：设计是 9×17 白色折线（`#FFFFFF@90%`）；用两根边框旋转画，零切图。 -->
      <view class="nav-back" @click="goBack">
        <view class="nav-back-arrow" />
      </view>
      <!-- 标题：**固定「店铺」**（用户 2026-10-10 逐字要求）；店名只出现在下面的卡片里。 -->
      <text class="nav-title">{{ NAV_TITLE }}</text>
    </view>

    <!-- 内容层：顶部让出导航栏高度（= 设计里店铺卡的起点 y=92）。
         ⚠️ `position: relative; z-index: 1`（见样式表 `.shop-body`）：**压住上面的绝对定位渐变层**，
            否则整页内容会被渐变盖住 —— 2026-10-10 实机就是这样（只有渐变 + 资质条那枚 `›`）。 -->
    <view class="shop-body" :style="{ paddingTop: `${navHeight}px` }">
      <!-- ① 店铺卡：**无论数据到没到都渲染**（用户 2026-10-10：「就算是没有相应的字段也是有内容的啊」）。
           ⚠️ 这里**没有** `v-if`/`v-else`：卡里**不依赖后端字段**的部分（logo 槽 / 店名 / 收藏按钮 /
              资质条）必须恒在；只有**数据位**（评分行 / 粉丝 / 服务表现三格）各自判空不渲染。
           ⚠️ 档案取不到时，店名退回**进店时就已知**的那个（`shopNameText` ← `knownShopName`），
              并在卡内用一行**如实的状态**说明（加载中 / 门店不存在 / 加载失败可重试）。 -->
      <view class="shop-card">
        <view class="shop-card-head">
          <image v-if="logo" class="shop-logo" :src="logo" mode="aspectFill" />
          <!-- 没有 `shopImage` 时画**中性方块**（`.shop-logo` 自带的 10% 白底），不塞占位图：
               设计稿的 logo 是 IMAGE 填充（平台自己的品牌图），拿它顶 = 伪造门店归属。 -->
          <view v-else class="shop-logo" />
          <view class="shop-card-main">
            <text class="shop-name">{{ shopNameText }}</text>
            <!-- **折叠块 ①**：评分行 / 粉丝数（含下面那行解释文案）—— 用户 2026-10-10 第四条要
                 「随滚动收起」的两块之一（见脚本 `COLLAPSE_BLOCK_IDS` / `collapseBlockStyle`）。
                 ⚠️ `id` 必须与脚本里那个字面量**逐字一致**（契约 §11e 会把两边都钉住）。
                 ⚠️ 内边距写在**本块自己**的 `padding-top` 上，不能用 `margin-top`：
                    `boundingClientRect().height` 是边框盒、不含外边距 ⇒ 用 margin 会漏量一截。
                 数据（**S4 起为真实字段**，2026-10-10 第四轮接线）：
                 评分 ← `ShopVO.rating`（⚠️ 契约原文「由客观指标合成，**非用户评价**」⇒ 下面那行
                 解释文案 `RATING_LABEL` 就是为此而加；设计稿只画了「★★★★★ 5.0」没有任何解释，
                 光看星串用户会默认理解成"用户评分"）；**样本不足时后端给 null** ⇒ 星串与分值
                 一起不渲染（不补 0、不补 `—`）；粉丝 ← `ShopVO.fansCount`
                 （契约：恒不为 null，`0` = 暂无粉丝 ⇒ 0 也照实渲染 —— 2026-10-10 实测线上
                 `GET /api/shop/5` 就是 `"fansCount": 0`，而 `rating` / `onTimeRate` /
                 `avgAcceptSeconds` **三个键后端一个都不下发** ⇒ 那一行按"没有数据"如实留空）。
                 ⛔ 任何情况下都不得改用 `boundUserCount`（已绑定微信人数）或
                    `MerchantOverviewVO.serviceScore`（恒 null 占位）顶替这两项。 -->
            <view
              id="shop-metrics-block"
              class="shop-metrics-block"
              :class="{ 'shop-metrics-block-collapsed': metricsCollapsed }"
              :style="collapseBlockStyle('shop-metrics-block')"
            >
              <view v-if="rating || fans" class="shop-metrics-row">
                <view v-if="rating" class="shop-rating">
                  <text class="shop-stars">{{ stars }}</text>
                  <text class="shop-score">{{ rating }}</text>
                </view>
                <!-- 分隔竖线：设计 `Frame 122` 1×8 `#FFFFFF@70%`（节点 opacity 0.8）；
                     只有两边都有值时才画（单边时不出现一根悬空的竖线）。 -->
                <view v-if="rating && fans" class="shop-divider" />
                <text v-if="fans" class="shop-fans">{{ fans }}</text>
              </view>
              <text v-if="rating" class="shop-rating-note">{{ RATING_LABEL }}</text>
            </view>
          </view>
            <!-- 「收藏」按钮：设计 66×28 圆角 4，填充是**渐变** `#FF9900 → #FF3C00`
                 （三个 handle 的仿射变换 ⇒ CSS `104.7deg`，见样式表注释），
                 内边距 上4/右12/下4/左12、元素间距 4，星形 14×14 **空心**白星（真实切图，
                 `static/shop/fav-star.png`），文案白字 12px。
                 ✅ 2026-10-10 S4 起**可用**：点击 = 关注/取关门店（`/api/shop/{shopId}/follow`），
                    未登录则弹登录引导；文案「收藏」是设计原文，已关注时作「已收藏」（见 `favText`）。 -->
            <view class="shop-fav" :class="{ 'shop-fav-on': followed === true }" @click="onFavoriteTap">
              <image class="shop-fav-star" src="/subpkg-goods/static/shop/fav-star.png" mode="aspectFit" />
              <text class="shop-fav-text">{{ favText }}</text>
            </view>
          </view>

          <!-- **状态行**（如实、且**不再擦掉整张卡**）：
               档案没到 / 门店不存在 / 档案取失败时，用一种**互斥**的说法点明"现在缺的是什么"，
               而不是把卡片换成一句提示（旧实现在这里会整块消失 ⇒ 实机看着像"这页坏了"）。
               ⚠️ 顺序与判据与原实现一致（加载中 → 通用失败 → 8000）；
               ⚠️ `8000` 文案是契约 §七 的建议文案，逐字保留。 -->
          <view v-if="loading" class="shop-status"><text>店铺信息加载中…</text></view>
          <view v-else-if="errorMessage" class="shop-status">
            <text>店铺信息加载失败：{{ errorMessage }}</text>
            <!-- 重试：档案请求是幂等的只读 GET，重试不产生任何副作用（否则这个错误态是死路）。 -->
            <text class="shop-status-retry" @click="loadShop">重试</text>
          </view>
          <view v-else-if="shopUnavailable" class="shop-status"><text>店铺不存在或已停用</text></view>

          <!-- **服务表现**（设计 `服务表现` 390×55：三格 `#FFFFFF@10%`、圆角 6、
               名 12px `#FFFFFF@80%` / 值 13px `#FFFFFF`）——
               数据只接契约真有的两项（`onTimeRate` 准时送达率、`avgAcceptSeconds` 平均接单时长），
               见 `utils/shop-metrics.ts`。
               ⚠️ 这里**没有**设计稿的「口碑品质 / 商品品质」「平均满意度」「平均 12 小时发货」
                  「客服响应 14 秒」：契约里一个都没有，一律不编。
                  ⚠️ **本次核对**：节点 `4045:5815` 里这三格写的是
                  「口碑品质 / 发货时效 / 客服响应」，而**进店卡片**节点（`4029:5751`）第一格写
                  「商品品质」—— 两张卡的设计文案本身不一致（旧需求单 §4-4 已记）。
                  因为服务表现的三项在契约里**都不存在**，我们改用契约真有的两项指标名，
                  这个不一致**不影响本页**（不再沿用设计填充文案）。
               ⚠️ **滚动收起（折叠块 ②）**：用户 2026-10-10 第四条的答复是「吸顶是除了**星级评分，
                  粉丝，口碑配置，发货时效，客服响应**这块，卡片之前其他的都显示」
                  ⇒ 收起的就是**评分/粉丝行**（折叠块 ①）与**本块**（见脚本 `COLLAPSE_BLOCK_IDS`），
                  其余（导航栏 / logo+店名 / 收藏 / 资质条 / Tab / 筛选 / 网格）保持不动。
                  过渡机制 = 显式 `height` + `opacity`（`display` 不可过渡），
                  高度取**首帧量到的真实值**（见 `measureCollapseBlock`）。
                  ⚠️ 设计稿的**滚动帧**（`4050:6387`）其实只删了「服务表现」、保留了评分行
                     （`Frame 117`），即折叠块 ① 是**按用户口径**加的；要去掉它只需从
                     `COLLAPSE_BLOCK_IDS` 里删掉 `'shop-metrics-block'` 一处。 -->
          <view
            id="shop-service-row"
            v-if="serviceMetrics.length"
            class="shop-service-row"
            :class="{ 'shop-service-row-collapsed': metricsCollapsed }"
            :style="collapseBlockStyle('shop-service-row')"
          >
            <view v-for="metric in serviceMetrics" :key="metric.name" class="shop-metric">
              <text class="shop-metric-name">{{ metric.name }}</text>
              <text class="shop-metric-value">{{ metric.value }}</text>
            </view>
          </view>
        </view>

        <!-- ② 资质条：`#FFF4E8`，只有上圆角 12，内边距 上12/右12/下24/左12（下 24 是给白卡压叠留的）。 -->
        <view class="qualification-bar">
          <!-- 「店铺资质」在设计稿里是**转曲矢量**（节点 `4045:5860`，ink 66.86×14，`#8C5D2A`）
               ⇒ 节点树里没有文字节点，但 **@2x 渲染图里字是清楚的**：把该区域放大到 6× 后可读为
               「店铺资质」（4 字，ink 宽 66.86 ⇒ 字身 ≈ 16.7px，ink 高 14 ⇒ 字号 ≈ 17px；笔画偏粗 ⇒ 600）。
               ⚠️ 旧实现按"文案待设计提供"渲染了虚线占位 —— 那是**看漏了渲染图**，已按实测改为真文案。 -->
          <text class="qualification-label">店铺资质</text>
          <view class="qualification-link" @click="onQualificationTap">
            <!-- 认证徽章：设计 `4045:5862` 是 18×18 实例内的 14.83 描边**扇贝形**绿章 + 绿勾，
                 整枚是**一个绿色矢量**（`#00B42A`）—— 扇贝的 8 瓣波浪边 WXSS 画不出来，
                 所以**直接导出切图**（`static/shop/cert-badge.png`，18×18 @3x，透明底，
                 实测 584 个不透明像素全部为 `#00B42A`）。旧实现是"描边圆 + ✓ 字形"，已删除。 -->
            <image class="cert-badge" src="/subpkg-goods/static/shop/cert-badge.png" mode="aspectFit" />
            <text class="qualification-text">经营资质</text>
            <!-- 箭头：`箭头_右` 实例 **14×14**（矢量 ink 4.58×8.11）——外层盒子必须占满 14×14，
                 否则整条"经营资质"会右移（设计里 `Frame 124` 无 gap：18 + 4 + 52 + 14 = 88）。 -->
            <view class="qualification-arrow-box"><view class="qualification-arrow" /></view>
          </view>
        </view>

        <!-- ③ 白内容区：圆角 12/12/0/0，`padding-bottom` 40px（设计值），
             ⚠️ `margin-top: -23rpx` 就是 `Frame 130` 的 **`gap: -12`**（负间距）在本平台的等价实现：
               小程序 flex 的 `gap` 不支持负值，只能用负外边距让白卡压住资质条 12 设计 px。
               层级靠**文档顺序**（资质条先渲染 = 在下层）。
             ⚠️ **门店不存在/已停用时整块不渲染**：Tab / 筛选 / 网格都是"这家店的商品"的操作面，
               店都没了还画一排能点的筛选器是**假装有内容**（状态行已经如实说了原因）。 -->
        <view v-if="!shopUnavailable" class="shop-content">
          <!-- **吸顶带**（用户 2026-10-10 答「2. 吸顶」）：Tab 栏 + 筛选行**包成一个**元素吸顶。
               ⚠️ 它**恒为 `position: sticky`**（`.shop-head`），滚动只切 `.shop-head-stuck`（阴影，可过渡）：
                  `relative ↔ sticky` 切换会重算位置并抖动（`CLAUDE.md` §十二）。
               ⚠️ `top` 由 `headStyle` 绑成**真实状态栏高 + 44**（固定导航栏盖住的正是这一段），
                  写死数值会在刘海屏/不同状态栏高度下把 Tab 压到导航栏底下。
               ⚠️ `id` 是给 `measureHeadTop` 量"页面坐标顶边"用的（用它算"什么时候算吸住"）。 -->
          <view id="shop-head" class="shop-head" :class="{ 'shop-head-stuck': headStuck }" :style="headStyle">
            <!-- Tab 栏：390×42，底部 1px `#F1F2F4`（INSIDE）；两个等宽 195。 -->
            <view class="tab-bar">
              <view class="tab" @click="switchTab('home')">
                <text class="tab-text" :class="{ 'tab-text-active': activeTab === 'home' }">首页</text>
                <view v-if="activeTab === 'home'" class="tab-underline" />
              </view>
              <view class="tab" @click="switchTab('goods')">
                <text class="tab-text" :class="{ 'tab-text-active': activeTab === 'goods' }">商品</text>
                <view v-if="activeTab === 'goods'" class="tab-underline" />
              </view>
            </view>

            <!-- 筛选行：390×48，内边距 12，横向间距 8；**四个** chip，顺序 = 设计节点 `4050:6387` 的几何顺序
                 （销量 x=502 / 价格 x=550 / **新品 x=612** / 口碑优品 x=660 —— 新品在**中间**，不是末尾）。 -->
            <view class="filter-row">
              <!-- 选中态：`#FFF4E8` 底 + 1px `#FF5500` 描边，文案 `#FF5500` -->
              <view class="filter-chip" :class="{ 'filter-chip-active': activeSort === 'sold' }" @click="selectSort('sold')">
                <text class="filter-text" :class="{ 'filter-text-active': activeSort === 'sold' }">销量</text>
              </view>
              <!-- 未选中态：`#F6F7F9` 底、无描边；`价格` 带 12×12 排序双三角
                   （上三角 `#1D2129` = 升序生效中，下三角 `#86909C` = 未生效）。 -->
              <view class="filter-chip" :class="{ 'filter-chip-active': activeSort === 'price' }" @click="selectSort('price')">
                <text class="filter-text" :class="{ 'filter-text-active': activeSort === 'price' }">价格</text>
                <view class="sort-arrows">
                  <view class="sort-arrow-up" :class="{ 'sort-arrow-on': activeSort === 'price' && priceOrder === 'asc' }" />
                  <view class="sort-arrow-down" :class="{ 'sort-arrow-on': activeSort === 'price' && priceOrder === 'desc' }" />
                </view>
              </view>
              <!-- **新品**（用户 2026-10-10 答「3. 加」）：节点 `4050:6387` 的第 3 个 chip，
                   逐字文案「新品」、40×24（= 8 + 24 + 8，与「销量」同宽）、未选中态 `#F6F7F9` + `#1D2129`
                   ⇒ 与既有 chip 完全同一套处理，不新增样式。
                   取值 `sortBy=new_desc`：契约逐字「`new_desc` — **新品**降序（按创建时间）」，
                   且 `GET /api/shop/{shopId}/products` 的 `sortBy` 取值枚举里就有它（契约已核）。 -->
              <view class="filter-chip" :class="{ 'filter-chip-active': activeSort === 'new' }" @click="selectSort('new')">
                <text class="filter-text" :class="{ 'filter-text-active': activeSort === 'new' }">新品</text>
              </view>
              <view class="filter-chip" :class="{ 'filter-chip-active': activeSort === 'reputation' }" @click="selectSort('reputation')">
                <text class="filter-text" :class="{ 'filter-text-active': activeSort === 'reputation' }">口碑优品</text>
              </view>
            </view>
          </view>

          <!-- ④ 商品网格（设计：左右内边距 12、列间距 12、行间距 24、卡宽 177）。
               ✅ 数据源：`GET /api/shop/{shopId}/products`（S2b）—— 按 `sortBy` + `page`/`pageSize`
                  取该门店**在售**商品；触底由 `onReachBottom` 追加下一页（见 script 注释）。
               ⚠️ 三种状态互斥且**如实**（绝不互相顶替）：
                  · 取数失败 → `productsError`（不谎报"没有商品"）；
                  · 取数成功但 `total=0` → 空态「该店铺暂无在售商品」；
                  · 网格为空时**不渲染** `.goods-grid`（连它的 padding 都不出现）。 -->
          <view v-if="gridProducts.length" class="goods-grid">
            <view v-for="product in gridProducts" :key="product.id" class="goods-card" @click="openProduct(product)">
              <view class="goods-image-wrap">
                <!-- 设计里图片容器是 177×177 圆角 8，内层图 `scaleMode=FILL` 被裁成方形。 -->
                <image class="goods-image" :src="product.mainImage" mode="aspectFill" />
              </view>
              <view class="goods-info">
                <text class="goods-title">{{ product.descriptionTitle || product.name }}</text>
                <text v-if="product.description" class="goods-selling">{{ product.description }}</text>
                <!-- 价格：设计里 `¥ 299.00` 是**一个 TEXT 节点 + `characterStyleOverrides`**，
                     `¥ ` = 12px/500、整数 = **18px**/500、小数 = 14px/500（三段**字号不同、字重都是 500**）
                     ⇒ 这里必须用嵌套 text 保持同一条行内基线，不能拼成一整串。 -->
                <text class="goods-price">
                  <text class="goods-price-symbol">¥</text>
                  <text class="goods-price-int">{{ product.priceInt }}</text>
                  <text v-if="product.priceDec" class="goods-price-dec">{{ product.priceDec }}</text>
                </text>
              </view>
            </view>
          </view>
          <view v-else-if="productsError" class="goods-empty">
            <text class="goods-empty-text">{{ productsError }}</text>
          </view>
          <view v-else-if="productsLoading || loading" class="goods-empty">
            <text class="goods-empty-text">加载中...</text>
          </view>
          <!-- 诚实空态：门店**真实存在**但没有任何在售商品（`total=0`）——
               与「门店不存在/停用」（上面 `shopUnavailable`）是两件事，不要合并。 -->
          <view v-else-if="productsLoaded" class="goods-empty">
            <text class="goods-empty-text">该店铺暂无在售商品</text>
          </view>
          <!-- ⚠️ 翻页中：网格已有内容时追加下一页的提示（不遮挡、不重置列表）。 -->
          <view v-if="productsLoadingMore" class="goods-more">
            <text class="goods-more-text">加载更多...</text>
          </view>
          <view v-else-if="products.length && !hasMore && !productsError" class="goods-more">
            <text class="goods-more-text">没有更多了</text>
          </view>
        </view>
    </view>

    <!-- 登录引导（未登录点「收藏」时打开）——与商品详情页同一组件、同一口径：
         关注门店的三个接口都要登录（无 token 得 401），所以未登录时**不发请求**、只引导去登录。 -->
    <LoginGuide v-model="loginGuideVisible" />
  </view>
</template>

<style>
/* 页面根：底色 `#F2F3F7`（设计值），并给渐变头图层一个**定位上下文**（`position: relative`），
   否则绝对定位的背景层会挂到初始包含块上、行为依赖平台实现。
   ⚠️ 横向溢出兜底在 `page` 上（本文件 + `App.vue` 各一条），**不放在 `.shop-page`**：
      `overflow-x: hidden` 会让该元素成为"滚动容器"（另一轴由 visible 计算成 auto）⇒
      里面的 `position: sticky` 会**静默失效**（吸顶带不再吸顶，且不报错）。
      本页没有超宽元素（无负 left/right、无固定宽度、无 100vw）⇒ 兜底放 `page` 已足够。 */
page { background: #F2F3F7; overflow-x: hidden; }
/* ⚠️ 2026-10-10 第五轮：本层背景**在头图区间接着那条渐变**（`#704138 → #9A674D`，到 477rpx 为止），
   之后才回到设计底色 `#F2F3F7`。
   为什么：实机在**固定导航栏底边**处有一条 1 设备像素的浅色缝（实测把渐变色与 `#F2F3F7` 按
   ~34% 混合，逐通道解出的覆盖率 0.345/0.344/0.344 一致）⇒ 缝里露的就是**本层/页面底色**。
   让本层在头图区间也是同一渐变，缝里混到的就是**同色**，白线消失。
   视觉上与原来**逐像素相同**：`0 → 477rpx` 这段本来就被 `.hero-gradient` 完全盖住（同为 477rpx、
   同色、同 180deg），477rpx 以下仍是 `#F2F3F7`（设计底色）。 */
.shop-page { position: relative; min-height: 100vh; background: linear-gradient(180deg, #704138 0rpx, #9A674D 477rpx, #F2F3F7 477rpx); }

/* ① 渐变头图层（设计 0→248 设计 px）。色值 = 节点树的 GRADIENT_LINEAR 端点，
   且与渲染图逐点取色核对一致（实现说明 §1.2 表）。
   ⚠️ **这层是绝对定位（`z-index: auto`）⇒ 它在绘制顺序里高于"流内静态内容"**
      （CSS 2.1 附录 E：定位/带 transform 的后代晚于流内块与行内内容绘制）——
      所以内容层 `.shop-body` **必须自己成为定位层**（见下），否则整张店铺卡被这层盖住。
      2026-10-10 实机现象：卡里**什么都看不见**、只有渐变，唯一的例外是资质条那枚 `›`
      （`.qualification-arrow` 带 `transform` ⇒ 自成层 ⇒ 它是当时**唯一**能画到渐变之上的墨迹）。 */
.hero-gradient { position: absolute; top: 0; left: 0; right: 0; height: 477rpx; background: linear-gradient(180deg, #704138 0%, #9A674D 100%); }

/* 内容层：既要给导航栏高度让位（内联 `paddingTop`），也要**压住上面那层渐变**。
   ⚠️ `position: relative` + `z-index: 1` 不是装饰、是**必需**：
      `z-index` 必须是正数（`-1` 会被 `.shop-page` 的背景盖住），且必须**小于导航栏的 100**
      （导航栏要盖在内容之上，否则返回键会被卡片压住）。
   ⚠️ 这一层一旦漏掉 `position`，全页内容会**静默消失**（不报错、只是被渐变盖住）。 */
.shop-body { position: relative; z-index: 1; }

/* ② 导航栏（固定）：背景是上面那条渐变的 **0→92 切片**，
   终点 `#804F40` = `#704138`→`#9A674D` 在 t=92/248 的线性插值（渲染图实测 #805041，差 1 为抗锯齿）。 */
.nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, #704138 0%, #804F40 100%); box-sizing: border-box; }
/* 返回热区 40×44，右内边距 12 / 左内边距 16（设计值 → 23rpx / 31rpx） */
.nav-back { position: absolute; left: 0; bottom: 0; display: flex; align-items: center; width: 77rpx; height: 85rpx; padding-left: 31rpx; box-sizing: content-box; }
/* 箭头：9×17 的白色折线（#FFFFFF@90%）—— 边框旋转 45° 画法，不引入切图。 */
.nav-back-arrow { width: 17rpx; height: 17rpx; border-left: 4rpx solid rgba(255, 255, 255, 0.9); border-bottom: 4rpx solid rgba(255, 255, 255, 0.9); transform: rotate(45deg); }
/* 标题：17px/600/行高 23.8，`#FFFFFF`，水平居中（实现说明 §1.3 导航栏） */
.nav-title { max-width: 420rpx; overflow: hidden; color: #FFFFFF; font-size: 33rpx; font-weight: 600; line-height: 46rpx; white-space: nowrap; text-overflow: ellipsis; }

/* 卡片内的**状态行**（加载中 / 门店不存在 / 档案加载失败 + 重试）：压在同一层渐变上的白字，
   与店名同一族配色（不引入新色值）。它只在真的"缺东西"时出现，
   而且**不再把整张卡换掉**（旧实现在这里让卡片整块消失 ⇒ 实机看着像"这页坏了"）。 */
.shop-status { display: flex; align-items: center; flex-wrap: wrap; margin-top: 15rpx; color: rgba(255, 255, 255, 0.75); font-size: 23rpx; line-height: 34rpx; }
/* 重试：可点，且给一个**看得见的点击面**（不靠"这行字大概能点"这种猜）。
   低透明白底与 `.shop-logo` 的中性方块同一手法，不新增色值。 */
.shop-status-retry { margin-left: 15rpx; padding: 2rpx 15rpx; border-radius: 8rpx; background: rgba(255, 255, 255, 0.18); color: #FFFFFF; font-size: 23rpx; line-height: 34rpx; }

/* ③ 店铺卡：**透明**（产品决策，设计稿的白填充 visible:false 不画）。
   内边距 上12/右12/下16/左12（23/23/31/23rpx），纵向间距 16（31rpx）。 */
.shop-card { padding: 23rpx 23rpx 31rpx; }
.shop-card-head { display: flex; align-items: center; }
/* logo 44×44 圆角 6 */
.shop-logo { width: 85rpx; height: 85rpx; flex: none; border-radius: 12rpx; background: rgba(255, 255, 255, 0.1); }
/* 左组与 logo 间距 12（设计 Frame 130 gap=12 → 23rpx），与按钮间距 20（→ 38rpx） */
.shop-card-main { flex: 1; min-width: 0; margin-left: 23rpx; margin-right: 38rpx; display: flex; flex-direction: column; justify-content: center; }
/* 店名 16px/600/行高 24，白色 */
.shop-name { color: #FFFFFF; font-size: 31rpx; font-weight: 600; line-height: 46rpx; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
/* 「收藏」按钮 66×28 圆角 4，渐变 #FF9900 → #FF3C00，内边距 上4/右12/下4/左12，间距 4。
   ⚠️ 角度是 **104.7deg**：节点的三个 handle 是 (0,0) → (1,1) → (-0.5,4.5)，
   仿射变换 `p = h0 + u·(h1−h0) + v·(h2−h0)` 里**只有 u 决定颜色** ⇒ 等色线沿 (h2−h0)，
   像素空间梯度 `∇u = (0.9/66, 0.1/28) ∝ (126,33)` ⇒ dx/dy = 3.818 ⇒ CSS 角度 = 180 − atan(3.818)。
   （旧值 113deg 只看 h0/h1、丢了第三个 handle；渲染图 1131 点实测 rms 0.0241 vs 104.7deg 的 0.0063。） */
.shop-fav { display: flex; align-items: center; flex: none; height: 54rpx; padding: 8rpx 23rpx; border-radius: 8rpx; background: linear-gradient(104.7deg, #FF9900 0%, #FF3C00 100%); box-sizing: border-box; }
/* 星形：设计是 14×14 的**空心（描边）**白星（节点 `4045:5845`，`Star 1 (Stroke)`）
   —— 真机字号下的 `☆` 字形笔画比设计细很多，故**用导出的切图**（14×14 @3x = 42×42，透明底、
   纯白、中心 alpha=0 即空心）。宽度 27rpx = 14.04px，与文字间距 8rpx = 4.16px（设计 gap 4）
   ⇒ 按钮总宽 12 + 14 + 4 + 24 + 12 = 66 ✓。 */
.shop-fav-star { width: 27rpx; height: 27rpx; flex: none; }
.shop-fav-text { margin-left: 8rpx; color: #FFFFFF; font-size: 23rpx; line-height: 38rpx; }
/* 已关注态：**只改透明度**，不改尺寸/颜色 —— 渐变填充与星形都是设计值，
   加个环或换色都属于"设计稿没有的视觉声明"；文案已由「收藏」变「已收藏」表达状态。 */
.shop-fav-on { opacity: 0.72; }

/* **折叠块 ①**（评分/粉丝行 + 解释文案）：与「服务表现」同属随滚动收起的两块（见脚本
   `COLLAPSE_BLOCK_IDS` / `collapseBlockStyle`）。
   ⚠️ 与店名的间距写成**本块的 `padding-top`**（4rpx = 设计的 `margin-top` 4rpx），不是 `margin-top`：
      `boundingClientRect().height` 是边框盒、**不含外边距** ⇒ 用 margin 时收起后会留下 4rpx 空隙。
   ⚠️ 正因为间距变成了**内边距**，本块必须 `box-sizing: border-box`：
      内联高度写的是**量到的边框盒高度**（已含内边距），content-box 下会把内边距再加一遍 ⇒
      未折叠时会突然高一截、折叠后又会剩一条 4rpx 的空档。
   ⚠️ `overflow: hidden` 把内容裁干净；过渡只用 `height` + `opacity`（见下面那段总注释）。 */
.shop-metrics-block { box-sizing: border-box; padding-top: 4rpx; overflow: hidden; transition: height 240ms ease-out, opacity 240ms ease-out; }
/* 折叠态：高度 0 + 完全透明（真实高度由 `collapseBlockStyle` 内联给出，两端都是真实几何）。 */
.shop-metrics-block-collapsed { opacity: 0; }

/* 评分行 / 粉丝数（设计 `Frame 117` 160×20，`gap=8`；星块 `Frame 116` 62×10 `gap=3`；
   分值 12px `#FFB200` 与星块间距 6；竖线 1×8 `#FFFFFF@70%`；粉丝 12px `#FFFFFF@80%`）。
   ⚠️ 只有真实字段有值时才渲染（见模板），这里只管排版。
   ⚠️ 与店名的间距 4rpx 已挪到外面 `.shop-metrics-block` 的 `padding-top`（折叠时才会一起收掉）。 */
.shop-metrics-row { display: flex; align-items: center; }
.shop-rating { display: flex; align-items: center; }
/* 星串：设计每颗 10×10、间距 3 ⇒ 整块 62px。`★`/`☆` 字身都是 1em ⇒ 20rpx + 4rpx 字距
   ≈ 62px（与进店卡片同一算法，见 `ShopEntryCard.vue` 的注释）。 */
.shop-stars { color: #FFB200; font-size: 20rpx; letter-spacing: 4rpx; line-height: 38rpx; }
.shop-score { margin-left: 12rpx; color: #FFB200; font-size: 23rpx; line-height: 38rpx; }
/* 分隔竖线 1×8（`#FFFFFF@70%` + 节点 `opacity=0.8` ⇒ 白 0.56 最接近实测观感）。 */
.shop-divider { width: 2rpx; height: 15rpx; margin: 0 15rpx; background: rgba(255, 255, 255, 0.56); }
.shop-fans { color: rgba(255, 255, 255, 0.8); font-size: 23rpx; line-height: 38rpx; }
/* 评分的解释文案（`RATING_LABEL`）：契约明写评分是**客观指标合成、非用户评价**，
   而设计只画了「★★★★★ 5.0」⇒ 不加这一行，用户会把它读成"用户评分"（被动误导）。
   12px、白 60%（压在渐变上的次要文字；比粉丝那行更弱，不抢店名与分值）。 */
.shop-rating-note { display: block; margin-top: 2rpx; color: rgba(255, 255, 255, 0.6); font-size: 23rpx; line-height: 32rpx; }

/* 服务表现（设计 `服务表现` 390×55，`gap=8`，三格 `#FFFFFF@10%`、圆角 6、
   内边距 上下6 左右12、格内间距 1；名 12px `#FFFFFF@80%`、值 13px `#FFFFFF`）。
   ⚠️ 设计是三格 `sizingH=HUG`（宽由内容撑开）；契约只给两项可计算指标 ⇒ 这里用
    `flex: 1` 让**实际存在的格数**均分（两格就两格，不补一个空格假装是三格）。
   ⚠️ 与上方内容的间距 23rpx 同样是**本块的 `padding-top`**（不是 `margin-top`）——
      理由见 `.shop-metrics-block`：量到的是边框盒高度，margin 收不掉会留空隙。
      视觉等价：原来 `margin-top: 23rpx` + 内容居中于 55 高的行，现在 `padding-top: 23rpx` +
      内容居中于内容盒（55）⇒ 第一格的位置与总占位逐像素相同。
   ⚠️ 同样必须 `box-sizing: border-box`（内联高度 = 量到的边框盒高度，已含 23rpx 内边距）。 */
.shop-service-row { display: flex; align-items: center; box-sizing: border-box; padding-top: 23rpx; }
.shop-metric { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; padding: 12rpx 23rpx; border-radius: 12rpx; background: rgba(255, 255, 255, 0.1); box-sizing: border-box; }
.shop-metric + .shop-metric { margin-left: 15rpx; }
.shop-metric-name { color: rgba(255, 255, 255, 0.8); font-size: 23rpx; line-height: 38rpx; }
.shop-metric-value { margin-top: 2rpx; color: #FFFFFF; font-size: 25rpx; line-height: 42rpx; }

/* ===== 滚动折叠（用户 2026-10-10 第四条） =====
   「吸顶是除了**星级评分，粉丝，口碑配置，发货时效，客服响应**这块，卡片之前其他的都显示」
   ⇒ 随滚动**收起**的是**两块**：① 店铺卡里的评分/粉丝行（含解释文案，`.shop-metrics-block`）；
     ② 服务表现格（`.shop-service-row`）。见脚本 `COLLAPSE_BLOCK_IDS`。
     另外一条随滚动**吸顶**的是 `.shop-head`（Tab 栏 + 筛选行，见那条注释），两者互不干涉：
     两个折叠块都在吸顶带**上方**，收起只会让吸顶带更早顶到吸住位置，不改变吸住后的位置。

   ⚠️ 过渡只用**可过渡属性**：`height` + `opacity`（外加 `overflow: hidden` 把内容裁干净）。
      · **不能**用 `display: none` —— 不可过渡，会变成硬切；
      · **不能**用 `max-height` —— 从一个大值收到 0 的**感知速度是非线性的**
        （前 80% 动画时间只走很小的视觉变化，看起来"先卡一下再突然收完"）；
      · 高度取**首帧量到的真实值**（`measureCollapseBlock` 用 `uni.createSelectorQuery`），
        量不到就不折叠 —— 不用一个"看起来差不多"的假高度（那是样式里编数据）；
      · 间距写在块的 `padding-top` 上（**不是** `margin-top`）—— 量到的是边框盒高度，见上两条规则。
      · **不切 `position`**：两块自始至终都是普通流内元素（`position` 不可过渡，切换必抖，
        见 `CLAUDE.md` §十二）；页面级滚动由 `onPageScroll` 驱动一个布尔，不换滚动容器。 */
.shop-service-row { overflow: hidden; transition: height 240ms ease-out, opacity 240ms ease-out; }
/* 折叠态：高度 0 + 完全透明（真实高度由 `collapseBlockStyle` 内联给出，两端都是真实几何）。 */
.shop-service-row-collapsed { opacity: 0; }

/* ④ 资质条：390×56（108rpx），`#FFF4E8`，**只有上圆角 12**，左右两侧 space-between、垂直居中。 */
.qualification-bar { display: flex; align-items: center; justify-content: space-between; height: 108rpx; padding: 23rpx 23rpx 46rpx; border-radius: 23rpx 23rpx 0 0; background: #FFF4E8; box-sizing: border-box; }
/* 「店铺资质」：转曲矢量渲染图实测 ink 66.86×14、`#8C5D2A` ⇒ 字号 ≈17px（4 字 × 16.7）、字重 600。 */
.qualification-label { color: #8C5D2A; font-size: 33rpx; font-weight: 600; line-height: 35rpx; }
.qualification-link { display: flex; align-items: center; }
/* 认证徽标：设计是 18×18 实例内的 **14.83 描边扇贝形**徽章（节点 `4045:5862`，整枚一个绿色矢量）。
   扇贝边 WXSS 画不出来 ⇒ **直接用导出的切图**，盒子 = 实例的 18px（35rpx）。
   （旧实现是"描边圆 + ✓ 字形"：圆 ≠ 扇贝、字形笔画也与设计不同，已删除。） */
.cert-badge { width: 35rpx; height: 35rpx; flex: none; }
/* 「经营资质」13px/400/行高 20，`#86909C`；与徽标间距 4（8rpx）。 */
.qualification-text { margin-left: 8rpx; color: #86909C; font-size: 25rpx; line-height: 38rpx; }
/* 箭头：`箭头_右` 实例 **14×14** 内的矢量 ink 4.58×8.11（`#86909C`）。
   外层盒子必须占满实例的 14px（27rpx）—— 设计里 `Frame 124` **无 gap**（18 + 4 + 52 + 14 = 88），
   只画墨迹会让整条链接比设计窄 8px、箭头贴到最右。
   折线仍用「正方形两边旋转 45°」画：墨迹 = 0.707·(B+t) × 1.414·B，B = 8rpx + 3rpx 边框
   ⇒ ≈ 5.15×8.09px，设计 4.58×8.11px（宽 12%；单色、可随状态改色、任意 DPR 都锐利 ⇒ 不切图）。 */
.qualification-arrow-box { display: flex; align-items: center; justify-content: center; width: 27rpx; height: 27rpx; flex: none; }
.qualification-arrow { width: 8rpx; height: 8rpx; border-top: 3rpx solid #86909C; border-right: 3rpx solid #86909C; transform: rotate(45deg); }

/* ⑤ 白内容区：圆角 12/12/0/0 + 底部留白 40px（77rpx）。
   ⚠️ `margin-top: -23rpx` = 设计里 `Frame 130` 的 `gap: -12`（小程序 gap 不支持负值）。 */
.shop-content { margin-top: -23rpx; padding-bottom: 77rpx; border-radius: 23rpx 23rpx 0 0; background: #FFFFFF; }

/* **吸顶带**（用户 2026-10-10 答「2. 吸顶」）：Tab 栏 + 筛选行合成一条控制带吸在导航栏下。
   ⚠️ **恒定 `position: sticky`**：`position` 不可过渡，按滚动在 `relative ↔ sticky` 之间切会重算位置、
      必然抖（`CLAUDE.md` §十二）⇒ 滚动**只**切 `.shop-head-stuck`（阴影）。
   ⚠️ `top` **不写在这里**：由模板绑定 `headStyle`（= 真实状态栏高 + 44），见脚本里那段注释。
   ⚠️ 必须有**不透明底**：吸顶后内容从它下面滑过，透明底会透出商品图。
   ⚠️ `z-index: 20` 必须**小于导航栏的 100**（否则吸顶带会盖住返回键与标题）；商品网格没有定位，
      所以它会被这条带子正常压住。
   ⚠️ 祖先链上不能有 `overflow: hidden`：那会成为 sticky 的"滚动容器"、让吸顶**静默失效**
      （见 `.shop-page` 那条注释）。 */
.shop-head { position: sticky; z-index: 20; background: #FFFFFF; transition: box-shadow 200ms ease-out; }
/* 已吸住时给一条**可过渡**的分隔：用 `box-shadow` 而不是 `border-bottom` —— 边框会占布局，
   切换时整条带子跳 1px。取值沿用仓库既有的吸顶口径（`pages/index/index.vue` 的 `.top-shell.scrolled`）：
   设计稿没有吸顶状态（节点 `4050:6387` 全部 `SCROLLS`），这里只为"内容从下面滑过去"提供边界感，
   不引入新配色、也不动任何设计值。 */
.shop-head-stuck { box-shadow: 0 2rpx 16rpx rgba(29, 33, 41, 0.08); }

/* Tab 栏：390×42（81rpx），底部 **0.5px** `#F1F2F4`（INSIDE，0.5 设计 px = 1rpx）；两个等宽。 */
.tab-bar { display: flex; align-items: stretch; height: 81rpx; border-bottom: 1rpx solid #F1F2F4; box-sizing: border-box; }
/* ⚠️ 内容**顶对齐**、不是垂直居中：设计里文案距 tab 顶 10px（`Component 4` 的 `pad-top 10`），
   下划线 28×2 贴到 tab 底（y 319..321 = tab 底 321），文案与下划线间距 8。
   旧实现用 `justify-content: center` ⇒ 整组上移约 5px。19+42+15+4 = 80rpx = 内容盒高（81 - 1rpx 描边）。 */
.tab { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 19rpx; box-sizing: border-box; }
/* 选中：14px/500 `#FF5500`；未选中：`#1D2129`。 */
.tab-text { color: #1D2129; font-size: 27rpx; font-weight: 500; line-height: 42rpx; }
.tab-text-active { color: #FF5500; }
/* 下划线 28×2（54×4rpx），与文案间距 8（15rpx） */
.tab-underline { width: 54rpx; height: 4rpx; margin-top: 15rpx; background: #FF5500; }

/* 筛选行：390×48（92rpx），内边距 12（23rpx），横向间距 8（15rpx）。 */
.filter-row { display: flex; align-items: center; height: 92rpx; padding: 23rpx; box-sizing: border-box; }
.filter-chip { display: flex; align-items: center; justify-content: center; height: 46rpx; margin-right: 15rpx; padding: 4rpx 15rpx; border: 2rpx solid transparent; border-radius: 8rpx; background: #F6F7F9; box-sizing: border-box; }
/* 选中项：`#FFF4E8` 底 + 1px `#FF5500` INSIDE 描边（小程序无 inset 描边 ⇒ 用透明占位的同一根边框换色，
   保证选中前后**尺寸不变**、不引发跳动）。 */
.filter-chip-active { border-color: #FF5500; background: #FFF4E8; }
.filter-text { color: #1D2129; font-size: 23rpx; line-height: 38rpx; }
.filter-text-active { color: #FF5500; }
/* 排序双三角：实例 12×12 内的两个三角各 5.18×3.31，上 `#1D2129`（升序生效）/ 下 `#86909C`；
   两个三角间距 2（4rpx），三角与文案间距 2（4rpx）。
   ⚠️ CSS 三角的**墨迹**宽 = 左右边框厚之和 ⇒ 10rpx（5.2px）才等于设计的 5.18px；
   旧实现 6rpx+6rpx = 12rpx（6.24px）偏宽 20%。 */
.sort-arrows { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 23rpx; height: 23rpx; margin-left: 4rpx; }
.sort-arrow-up { width: 0; height: 0; border-right: 5rpx solid transparent; border-bottom: 6rpx solid #86909C; border-left: 5rpx solid transparent; }
.sort-arrow-down { width: 0; height: 0; margin-top: 4rpx; border-top: 6rpx solid #86909C; border-right: 5rpx solid transparent; border-left: 5rpx solid transparent; }
.sort-arrow-up.sort-arrow-on { border-bottom-color: #1D2129; }
.sort-arrow-down.sort-arrow-on { border-top-color: #1D2129; }

/* 商品网格：左右内边距 12（23rpx），**列间距 12 / 行间距 24**，卡宽 177（340rpx）。
   ⚠️ 用 flex `gap` 而不是卡片的 `margin-bottom`：设计里 `Frame 129` 的容器高度**止于末行底部**
   （369 + 287 + 24 + 287 = 967 = 容器底），末行之后**没有**间距；`margin-bottom` 会多出 24px 白。 */
.goods-grid { display: flex; flex-wrap: wrap; gap: 46rpx 23rpx; padding: 0 23rpx; box-sizing: border-box; }
/* 卡片 177 宽、圆角 8（节点 `Frame 27` 的 `r=8`；卡无底色所以圆角不可见，仍按设计写上）。 */
.goods-card { width: 340rpx; border-radius: 15rpx; }
/* 图片容器 177×177 圆角 8（340rpx / 15rpx） */
.goods-image-wrap { width: 340rpx; height: 340rpx; overflow: hidden; border-radius: 15rpx; background: #F2F3F7; }
.goods-image { width: 100%; height: 100%; }
.goods-info { display: flex; flex-direction: column; margin-top: 15rpx; }
/* 标题 14px/600/行高 22，两行截断（设计高 44 = 2×22）；截断用仓库既有的 line-clamp 写法 */
.goods-title { display: -webkit-box; overflow: hidden; color: #1D2129; font-size: 27rpx; font-weight: 600; line-height: 42rpx; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
/* 卖点 13px/400/行高 20，`#FF7B2E`，一行 */
.goods-selling { display: -webkit-box; overflow: hidden; margin-top: 8rpx; color: #FF7B2E; font-size: 25rpx; line-height: 38rpx; -webkit-box-orient: vertical; -webkit-line-clamp: 1; }
/* 价格行：设计是**一个 TEXT 节点**（`Frame 33`，h=22，`main=SPACE_BETWEEN` 但只有一个子节点）
   + `characterStyleOverrides` 三段：`¥ ` 12px/500、整数 18px/500、小数 14px/500，全部 `#FF5500`、lh22。
   ⇒ 用**嵌套 text**（同一条行内基线），字号分别 23/35/27rpx，字重统一 **500**（旧实现是 600）。 */
.goods-price { display: block; margin-top: 23rpx; color: #FF5500; font-size: 27rpx; font-weight: 500; line-height: 42rpx; }
/* `¥` 与数字之间设计里有一个**空格**（覆盖区间 `chars 0..1` = "¥ "）⇒ 用 6rpx（≈3px）右边距等价表达。 */
.goods-price-symbol { margin-right: 6rpx; color: #FF5500; font-size: 23rpx; font-weight: 500; }
.goods-price-int { color: #FF5500; font-size: 35rpx; font-weight: 500; }
.goods-price-dec { color: #FF5500; font-size: 27rpx; font-weight: 500; }

/* 网格状态文案（空态 / 取数失败 / 首页加载中）：三档共用一套中性灰，不引入新配色。
   ⚠️ 文案由模板按**真实状态**给（无在售商品 ≠ 门店不存在 ≠ 请求失败），这里只管排版。 */
.goods-empty { display: flex; align-items: center; justify-content: center; padding: 140rpx 24rpx; }
.goods-empty-text { color: #86909C; font-size: 26rpx; }
/* 翻页提示（加载更多 / 没有更多了）：设计稿没有这一行，取仓库既有的居中灰字口径。 */
.goods-more { display: flex; align-items: center; justify-content: center; padding: 28rpx 24rpx 46rpx; }
.goods-more-text { color: #86909C; font-size: 24rpx; }
</style>
