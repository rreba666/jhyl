/**
 * C 端 · **商品卡片文字位**的共用口径（2026-10-10 新增）。
 *
 * ## 为什么单独一个模块
 * 同一张商品卡的「标题 + 卖点」要在**多处**出现：
 * - 首页商品瀑布流 `components/home/HomeProductCard.vue`（`grid` / `list` 两态）；
 * - 分类页 `components/category/CategoryProductCard.vue`（`horizontal` / `grid`，另有 `subtitle` 兜底）；
 * - 店铺页 `subpkg-goods/shop/index.vue` 的**手写**网格卡（`subpkg-goods/` 是分包）。
 * 三处的**几何与字号各不相同**（各自有各自的 Figma 画板：首页 366rpx 图 / 店铺页 177px 图…），
 * 但**取哪两个字段**必须完全相同 —— 2026-10-10 用户报障正是这条：
 * 「**店铺页里，商品卡片展示的字段不一致，图上展示的字段跟首页商品卡片的字段不一样**」
 * （店铺页手写卡取 `description`，首页组件取 `descriptionTitle || tag` ⇒ 同一个商品两个页面两套文字）。
 * ⇒ 把「取哪两个字段 + 推荐文本开关」抽到这里；样式仍各写各的 SFC（与 `utils/shop-metrics.ts` 同一套做法）。
 *
 * ## 字段口径（`api_doc.json` 的 `ProductListVO`，逐字引用）
 * - 「`descriptionTitle` 描述标题（标题栏大字，最多两行）。**小程序商品卡标题 = descriptionTitle || name**」
 * - 「`description` 详情描述（下方说明，最多一行）。**小程序商品卡下方 = description || subtitle**」
 * - `tag`：旧的副标题字段，排在 `description` **之后**作后备（语义同分类页的 `subtitle` 参数）。
 *
 * ## ⚠️ 实测（2026-10-10，线上 `/api/product/list?pageSize=200`，78 个在售商品）
 * - `descriptionTitle` 有值 **0/78**；`tag` 有值 **0/78**；`description` 有值 **75/78**；
 * - `recommendTextEnabled` **一个都没下发**（0/78）；`originalPrice` 也一个都没下发；
 * - `GET /api/shop/{shopId}/products` 对同一商品返回的**字段集合与取值与列表接口完全一致**
 *   （契约原文「端上必然一致」）⇒ 两个页面的差异**只可能来自前端取错字段**。
 * ⇒ 结论：**`description` 才是有真实数据的那个"卖点"字段**。原先首页那条
 *   `descriptionTitle || tag || '精选好物，安心品质'` 在线上**永远取不到前两项** ⇒ 那句兜底文案会出现在
 *   **每一张**卡片上（那是**编出来的文案**，违反本仓库「绝不伪造数据」的硬原则）。
 * ⇒ 本模块**不提供任何文案兜底**：没有真实文字就返回空串，由各 SFC 用空行保住行高（网格不跳），
 *   而**不是**塞一句通用好话。
 */

/**
 * 卡片文字位消费的最小商品形状。
 *
 * ⚠️ 刻意**不**直接依赖 `@/api/product` 的 `ProductCard`：结构类型（structural typing）让
 * 首页/分类页/店铺页各自的对象都能直接传进来，不必为了类型去补假字段（与 `shop-metrics.ts` 同理）。
 */
export interface ProductCardText {
  name?: string
  descriptionTitle?: string
  description?: string
  tag?: string
  /**
   * 后台「推荐文本」开关（**只有首页/店铺页的商品卡消费它**；分类页没有这个开关）。
   * 后端可能下发 `0/1` 或 `'0'/'1'`（也兼容 boolean）；**未下发时按开启**。
   */
  recommendTextEnabled?: 0 | 1 | '0' | '1' | boolean
}

/** 只把「真有文字」当作有值：null / undefined / 非字符串 / 纯空白一律算没有。 */
function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 卡片**标题**：契约「小程序商品卡标题 = `descriptionTitle || name`」。
 *
 * ⚠️ 两者都没有时返回**空串**（不返回「精选商品」之类的兜底文案）：`name` 在契约里是必填字段，
 *    真拿不到就如实留空 —— 编一个标题属于伪造数据。
 */
export function productCardTitle(product: ProductCardText): string {
  return trimmed(product.descriptionTitle) || trimmed(product.name)
}

/**
 * 卡片**卖点 / 副标题**：契约「小程序商品卡下方 = `description || subtitle`」。
 *
 * ⚠️ 顺序**不能**反过来：线上 `descriptionTitle` / `tag` 一个都没有，把 `tag` 排前面
 *    会让这一行在所有商品上变空（实测 0/78 有值）。
 */
export function productCardSellingPoint(product: ProductCardText): string {
  return trimmed(product.description) || trimmed(product.tag)
}

/**
 * 后台「推荐文本」开关是否开启（`HomeProductCard` 与店铺页网格卡**共用**这一条判据）。
 *
 * ⚠️ **未下发（undefined / null / 空串）按开启**处理：老接口或字段缺失时若按"关闭"处理，
 *    会让**每一个**商品的卖点行整片消失（静默失效）。实测线上该字段一个都没下发
 *    ⇒ 这条兜底就是"默认照常显示"。
 */
export function productCardShowSellingPoint(product: ProductCardText): boolean {
  const flag = product.recommendTextEnabled
  if (flag === undefined || flag === null || flag === '') return true
  return flag === 1 || flag === '1' || flag === true
}
