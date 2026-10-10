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
 * ## 数据来源（2026-10-10 S2b / S3 已全部落地，本页不再有"无接口"的占位逻辑）
 * 本页**两个真实数据源**（都免登录、游客可访问）：
 * | 区块 | 接口 | 说明 |
 * |---|---|---|
 * | 店铺档案 | `GET /api/shop/{shopId}`（S3，新增） | `Result<ShopVO>`，与 `/api/shop/all` 同构 |
 * | 商品网格 | `GET /api/shop/{shopId}/products`（S2b，新增） | `sortBy` + `page` / `pageSize` |
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
 * ## 新节点 `4045:5826`（= 本页店铺卡 `Frame 114`）**确认了什么、我们仍填不了什么**
 * 2026-10-10 第三轮重取该节点（390×143，`docs/_ref/shop-card-4045-5826/`）——它**只覆盖店铺卡本体**
 * （logo + 店名 + 评分行 + 收藏按钮 + 服务表现三格），**不含**资质条 / Tab / 筛选 / 商品网格。
 * 卡内的两块在契约里**依然一个字段都没有**（下面逐条给了 2026-10-10 的复核方式）⇒ **一律不渲染**
 * （不编文案、不放 `0`/`—`、不硬编码设计稿的填充数字）：
 * - 店铺**评分**（节点 `4045:5834..5841`：5 颗 10×10 实心星 + `5.0`，`#FFB200`）：
 *   契约无 `rating`（`MerchantOverviewVO.serviceScore` 是**恒 null 占位**，不得挪用）。
 *   复核：本地 `api_doc.json` 与 dev `/v3/api-docs`（HTTP 200，1 394 605 B）的 `ShopVO` 逐字段一致，
 *   37 个字段里**没有**任何评分字段；
 * - 店铺**粉丝数**（节点 `4045:5843` = `3484 粉丝`）：契约无 `fansCount`；`ShopVO.boundUserCount`
 *   = 「已绑定微信人数」，**语义不同**，且实测 dev `/api/shop/all` 14 家**全都没下发**该键；
 * - **服务表现**三格（节点 `4045:5847`：128/116/103 × 55，`#FFFFFF@10%`，r=6）：契约无服务指标字段。
 * - **店铺收藏**：契约无关注/收藏店铺的读写接口（全库只有**商品**收藏）⇒ 按钮只提示未开放。
 * ⇒ 已按本轮口径把这三项进需求单：`docs/26/10.10/后端需求-店铺页数据缺口-2026-10-10.md` **R8**
 *   （P0：评分 / 粉丝数 / 服务表现，含需要的字段名与待定口径）；旧的缺口清单见
 *   `docs/26/10.09/店铺页-Figma实现说明-2026-10-09.md` §4.3。
 */
import { computed, ref } from 'vue'
import { onLoad, onReachBottom } from '@dcloudio/uni-app'
import { getShopDetail, type EnabledShop } from '@/api/shop'
// ⚠️ 用 `getShopProducts`（= `GET /api/shop/{shopId}/products`，S2b）而**不是**
//    `getProductList({ shopId })`：后者是"商品维度"的接口，对不存在的门店回 `200` + `total=0`，
//    会把"这家店没了"渲染成"这家店没商品"（本仓库最忌的静默失真）。
import { getShopProducts, type ProductCard } from '@/api/product'
import { isApiRequestError } from '@/utils/request'

/**
 * 门店不存在的业务码（契约 §七：`8000` = 门店不存在（含停用/软删））。
 * ⚠️ 它是**业务码**（HTTP 仍是 200），由 `utils/request.ts` 转成 `ApiRequestError.code`。
 */
const SHOP_NOT_FOUND_CODE = 8000

/** 页面入参：`/subpkg-goods/shop/index?shopId=…`（进店卡片跳转过来）。 */
const shopId = ref('')
/** 店铺档案；`null` = 未加载/未命中。 */
const shop = ref<EnabledShop | null>(null)
const loading = ref(true)
/** 取数失败（网络/接口异常）——与「门店不存在」必须分开显示。 */
const errorMessage = ref('')
/** 门店**不存在 / 已停用 / 已被删除**（接口业务码 `8000`，或页面压根没带 `shopId`）。 */
const shopUnavailable = ref(false)

/** 真实状态栏高度（px）；导航栏高度 = 状态栏 + 设计稿的 **44px 标题栏**。 */
const statusBarHeight = ref(0)
const navHeight = computed(() => statusBarHeight.value + 44)

/** 导航标题：优先店铺名（真实数据），未加载时用设计稿写的平台标题。 */
const navTitle = computed(() => String(shop.value?.name || '').trim() || '非遗老号')
const logo = computed(() => String(shop.value?.shopImage || '').trim())

/**
 * 当前 Tab（`首页` / `商品`）。
 * ⚠️ 设计只给了「首页」选中态的示例，**两个 Tab 的内容差异仍未定义**（实现说明 §5 第 7 条）。
 *    现在两档共用同一份「店铺档案 + 筛选行 + 商品网格」—— 这不是"没做"，
 *    而是**产品口径未定时刻意不分叉**（同一份数据，分叉只会凭空造出两套行为）。
 *    后端已具备分叉能力（S2b 的 `sortBy` 含 `new_desc` / `sort_order`），等口径确定再拆。
 */
const activeTab = ref<'home' | 'goods'>('home')

/**
 * 当前排序。设计给了三个筛选项，映射关系（实现说明 §4.2）：
 * - `销量` → `sortBy=sold_desc` ✅ 契约支持；
 * - `价格` → `sortBy=price_asc|price_desc` ✅ 契约支持（图标上三角=升序、下三角=降序）；
 * - `口碑优品` → ⚠️ 契约**没有**对应枚举（`reputation_desc` 需后端补，§4.3 第 9 条）
 *   ⇒ 点它只给一句中性提示，**不切换选中态**（不能假装它已生效）。
 */
const activeSort = ref<'sold' | 'price'>('sold')
/** 价格排序方向：`asc` = 从低到高（设计稿渲染图里**上三角为深色** ⇒ 默认升序）。 */
const priceOrder = ref<'asc' | 'desc'>('asc')

/**
 * 传给 S2b 的 `sortBy`。
 *
 * ⚠️ `sortBy` 在契约里是**可选**参数（`sold_desc / price_asc / price_desc / new_desc / sort_order`），
 *    不传 = 后端默认排序。两个价格档**各自**给出自己的枚举值（升/降序不可互相顶替）；
 *    「销量」档给出 `sold_desc`（设计里「销量」= 销量倒序，映射关系见 `activeSort` 注释）。
 */
const sortByParam = computed<'sold_desc' | 'price_asc' | 'price_desc'>(() => {
  if (activeSort.value !== 'price') return 'sold_desc'
  return priceOrder.value === 'desc' ? 'price_desc' : 'price_asc'
})

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
 * 读页面参数 → 取门店档案（S3）→ 再取该门店的在售商品（S2b）。
 *
 * ⚠️ 两个接口**串行**：商品接口对停用门店同样返回 `8000`，但"门店没了"这个结论应当由
 *    门店档案接口给出（它是门店维度的事实来源）；先档案后商品，语义最直白。
 */
onLoad(async (options) => {
  try {
    const info = uni.getSystemInfoSync()
    statusBarHeight.value = Number(info?.statusBarHeight) || 0
  } catch {
    // 非微信环境拿不到系统信息：退化为仅 44px 标题栏。
    statusBarHeight.value = 0
  }
  shopId.value = String(options?.shopId || '').trim()
  if (!shopId.value) {
    // 没带 shopId 就没法定位门店：如实说"门店不存在"，不编一个默认店。
    shopUnavailable.value = true
    loading.value = false
    return
  }
  try {
    shop.value = await getShopDetail(shopId.value)
  } catch (error) {
    // ⚠️ `8000` 是**独立状态**（门店不存在/停用），不是通用错误：契约 §七 给的建议文案就是
    //    「门店不存在或已停用」。其余异常（网络/5xx/其它业务码）一律走通用错误分支。
    if (isApiRequestError(error) && Number(error.code) === SHOP_NOT_FOUND_CODE) {
      shopUnavailable.value = true
    } else {
      errorMessage.value = error instanceof Error ? error.message : '店铺信息加载失败'
    }
  } finally {
    loading.value = false
  }
  // 门店不存在 ⇒ 不再去问商品（问了也只有 8000）。
  if (shop.value) await loadProducts(true)
})

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
 * 选择排序项并**立即按新排序重查第 1 页**（S2b 的 `sortBy`，见 `sortByParam`）。
 *
 * - 点「销量」：切到销量档（已在该档则什么都不做，`sortByParam` 不变 ⇒ 不发重复请求）；
 * - 点「价格」：未在价格档 ⇒ 切过去并回到**升序**（设计默认）；已在价格档 ⇒ **反转升降序**。
 * ⚠️ 重查走 `loadProducts(true)`：它会用 token 作废在飞的旧请求（见该函数注释），
 *    所以连着点也不会出现"列表回到上一个排序"。
 */
function selectSort(sort: 'sold' | 'price'): void {
  if (sort === activeSort.value) {
    if (sort !== 'price') return
    priceOrder.value = priceOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    activeSort.value = sort
    if (sort === 'price') priceOrder.value = 'asc'
  }
  void loadProducts(true)
}

/**
 * 「口碑优品」：契约里 `sortBy` 没有对应枚举（实现说明 §4.3 第 9 条）⇒ 只给中性提示，
 * 不改选中态、不发请求（不假装生效）。
 */
function onReputationTap(): void {
  uni.showToast({ title: '该排序暂未开放', icon: 'none' })
}

/**
 * 「收藏」按钮：契约里**没有**店铺关注/收藏的读接口，也没有写接口
 * （`favorite` + `POST/DELETE /api/shop/{shopId}/favorite`，实现说明 §4.3 第 6 条）
 * ⇒ 按钮按设计渲染，但**不伪造已收藏状态**、也不发请求，只如实提示功能未开放。
 */
function onFavoriteTap(): void {
  uni.showToast({ title: '店铺收藏功能暂未开放', icon: 'none' })
}

/**
 * 「经营资质」：打开**经营资质页**（本分包新增 `subpkg-goods/shop/qualification`）。
 *
 * ⚠️ 设计稿里**没有**这张页面的节点（2026-10-10 把 Figma 文件「店铺」页整棵树按
 *    `资质 / 营业执照 / 许可证 / 证照` 四个词扫过一遍，只命中这条入口本身，
 *    没有任何画板）⇒ 页面按用户给的**真实小程序参考页**（别家店铺的「经营资质」）排版。
 * 📄 页面只渲染**契约真有的**字段：`ShopVO.name`（店铺名）/ `ShopVO.businessName`（工商名称
 *    = 商家主体）；**营业执照 / 许可证图片契约里没有**（图片只在商户**入驻表单**上：
 *    `MerchantApplyDTO.licenseImage`，C 端 `ShopVO` 全字段无此列）⇒ 页面给诚实空态。
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

    <!-- 导航栏：固定在最上方（滚下去也要能返回），背景取同一渐变的 0→92 切片。 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px`, height: `${navHeight}px` }">
      <!-- 返回箭头：设计是 9×17 白色折线（`#FFFFFF@90%`）；用两根边框旋转画，零切图。 -->
      <view class="nav-back" @click="goBack">
        <view class="nav-back-arrow" />
      </view>
      <text class="nav-title">{{ navTitle }}</text>
    </view>

    <!-- 内容层：顶部让出导航栏高度（= 设计里店铺卡的起点 y=92）。 -->
    <view class="shop-body" :style="{ paddingTop: `${navHeight}px` }">
      <view v-if="loading" class="page-state"><text>加载中...</text></view>
      <view v-else-if="errorMessage" class="page-state"><text>{{ errorMessage }}</text></view>
      <!-- ⚠️ `8000 SHOP_NOT_FOUND`（门店不存在/停用/软删）**独立于**上面的通用错误：
           契约 §七 给的建议文案就是这句；不要用 `errorMessage` 兜住它。 -->
      <view v-else-if="shopUnavailable" class="page-state"><text>店铺不存在或已停用</text></view>

      <template v-else>
        <!-- ① 店铺卡：**透明卡**（产品已定）——白字直接压在渐变上，不画白底。
             圆角 12、内边距 上12/右12/下16/左12、纵向间距 16（设计值）。 -->
        <view class="shop-card">
          <view class="shop-card-head">
            <image v-if="logo" class="shop-logo" :src="logo" mode="aspectFill" />
            <!-- 没有 `shopImage` 时画**中性方块**（`.shop-logo` 自带的 10% 白底），不塞占位图：
                 设计稿的 logo 是 IMAGE 填充（平台自己的品牌图），拿它顶 = 伪造门店归属。 -->
            <view v-else class="shop-logo" />
            <view class="shop-card-main">
              <text class="shop-name">{{ shop?.name }}</text>
              <!-- ⚠️ 评分行与粉丝数：设计里这两项是**写死的填充文案**，契约里既没有 `rating`
                   也没有 `fansCount` ⇒ 整行不渲染（数值本身见文件头「不渲染清单」，此处不重复写出）。
                   注意：不得用 `MerchantOverviewVO.serviceScore`（恒 null 占位）或
                   `ShopVO.boundUserCount`（已绑定微信人数）顶替。 -->
              <!-- ✅ 门店档案现在是**真实数据**（`GET /api/shop/{shopId}`，S3）：
                   店名走 `shop.name`、logo 走 `shop.shopImage`；未配置时画**中性方块**（不是占位图、
                   也不是设计稿那枚平台自己的品牌图）。 -->
            </view>
            <!-- 「收藏」按钮：设计 66×28 圆角 4，填充是**渐变** `#FF9900 → #FF3C00`
                 （三个 handle 的仿射变换 ⇒ CSS `104.7deg`，见样式表注释），
                 内边距 上4/右12/下4/左12、元素间距 4，星形 14×14 **空心**白星（真实切图，
                 `static/shop/fav-star.png`），文案白字 12px。
                 点击只提示（店铺收藏读写接口缺失，见 onFavoriteTap 注释）。 -->
            <view class="shop-fav" @click="onFavoriteTap">
              <image class="shop-fav-star" src="/subpkg-goods/static/shop/fav-star.png" mode="aspectFit" />
              <text class="shop-fav-text">收藏</text>
            </view>
          </view>

          <!-- ⚠️ 服务表现三格（128/116/103 × 55，`#FFFFFF@10%`，圆角 6，左对齐）：
               契约无服务指标字段 ⇒ 整行不渲染（不放假数据）。 -->
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
               层级靠**文档顺序**（资质条先渲染 = 在下层）。 -->
        <view class="shop-content">
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

          <!-- 筛选行：390×48，内边距 12，横向间距 8。 -->
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
            <view class="filter-chip" @click="onReputationTap">
              <text class="filter-text">口碑优品</text>
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
          <view v-else-if="productsLoading" class="goods-empty">
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
      </template>
    </view>
  </view>
</template>

<style>
/* 页面根：底色 `#F2F3F7`（设计值），并给渐变头图层一个**定位上下文**（`position: relative`），
   否则绝对定位的背景层会挂到初始包含块上、行为依赖平台实现。
   `overflow-x: hidden` 是仓库既有的 iOS 横向溢出兜底。 */
page { background: #F2F3F7; overflow-x: hidden; }
.shop-page { position: relative; min-height: 100vh; background: #F2F3F7; overflow-x: hidden; }

/* ① 渐变头图层（设计 0→248 设计 px）。色值 = 节点树的 GRADIENT_LINEAR 端点，
   且与渲染图逐点取色核对一致（实现说明 §1.2 表）。 */
.hero-gradient { position: absolute; top: 0; left: 0; right: 0; height: 477rpx; background: linear-gradient(180deg, #704138 0%, #9A674D 100%); }

/* ② 导航栏（固定）：背景是上面那条渐变的 **0→92 切片**，
   终点 `#804F40` = `#704138`→`#9A674D` 在 t=92/248 的线性插值（渲染图实测 #805041，差 1 为抗锯齿）。 */
.nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, #704138 0%, #804F40 100%); box-sizing: border-box; }
/* 返回热区 40×44，右内边距 12 / 左内边距 16（设计值 → 23rpx / 31rpx） */
.nav-back { position: absolute; left: 0; bottom: 0; display: flex; align-items: center; width: 77rpx; height: 85rpx; padding-left: 31rpx; box-sizing: content-box; }
/* 箭头：9×17 的白色折线（#FFFFFF@90%）—— 边框旋转 45° 画法，不引入切图。 */
.nav-back-arrow { width: 17rpx; height: 17rpx; border-left: 4rpx solid rgba(255, 255, 255, 0.9); border-bottom: 4rpx solid rgba(255, 255, 255, 0.9); transform: rotate(45deg); }
/* 标题：17px/600/行高 23.8，`#FFFFFF`，水平居中（实现说明 §1.3 导航栏） */
.nav-title { max-width: 420rpx; overflow: hidden; color: #FFFFFF; font-size: 33rpx; font-weight: 600; line-height: 46rpx; white-space: nowrap; text-overflow: ellipsis; }

.page-state { padding: 200rpx 32rpx; color: #86909C; text-align: center; font-size: 26rpx; }

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
