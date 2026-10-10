/**
 * C 端 · **店铺客观指标**的共用视图模型（2026-10-10 S4 起真实字段到位）。
 *
 * ## 为什么单独一个模块
 * 同一批字段（评分 / 粉丝 / 服务表现）要同时出现在**两张卡**上：
 * - 店铺页 `subpkg-goods/shop/index.vue` 的**透明店铺卡**（白字压渐变、指标块 `#FFFFFF@10%`）；
 * - 商品详情页 `components/goods/ShopEntryCard.vue` 的**白卡**（深字、指标块无底色）。
 * 两处**样式不同、数据口径必须完全相同** ⇒ 只把「取数 + 文案 + 单位 + 缺省」抽到这里，
 * 样式仍各自写在各自的 SFC 里（两张卡不共用样式，见进店卡片头部注释）。
 *
 * ## 口径纪律（契约 §12.2 / §12.3，逐条对应）
 * 1. **评分是客观指标合成，不是用户评价**：契约 `ShopVO.rating` 原文「由客观指标合成，
 *    **非用户评价**；每日定时重算」—— 合成项 = 完成率 + 无售后率 + 准时送达率（权重可配，
 *    缺数据的项不参与加权），最少订单数默认 5（样本不足**不写评分**）。
 *    ⇒ ⚠️ 它的含义**不是**直觉上的"用户打分"（`RATING_LABEL` 就是为此准备的解释文案）。
 * 2. 三个展示位**各自独立地"有才渲染"**（`rating == null` / `onTimeRate == null` /
 *    `avgAcceptSeconds == null` 一律**不出现那一格**，不补 `0`、不补 `—`、不补空框）。
 * 3. **只接契约真有的字段**：`onTimeRate`（准时送达率）与 `avgAcceptSeconds`（平均接单时长）。
 *    设计稿里的「口碑品质 / 商品品质」「满意度 %」「发货时效 12 小时」「客服响应 14 秒」
 *    **契约里都没有**（`serviceMetrics` 这个结构不存在）——
 *    ⚠️ 尤其**不许**把"平均接单时长"改名叫"客服响应"（那是另一个指标），
 *    也不许拿 `MerchantOverviewVO.serviceScore`（恒 null 占位）当评分。
 *
 * ⚠️ **计数类文案用 Chinese numerals/counters 必须与后端字段语义一致**：
 * `fansCount` 契约原文「关注该门店的用户数；恒不为 null，0 表示暂无粉丝」⇒ 0 也照实渲染
 * `0 粉丝`（0 是**真实值**，不是"没有数据"）。这与评分不同：评分"没有"是 **null**，
 * 两者判据不能混（`!= null` vs 直接取值）。
 */

/** 一条服务表现（名 + 值，值已含单位，如「准时送达 97.2%」）。 */
export interface ShopServiceMetric {
  name: string
  value: string
}

/** 服务表现的展示上限（设计两张卡都是三格；契约本身没写上限，这里只做防御）。 */
export const SHOP_METRIC_LIMIT = 3

/**
 * 本模块消费的最小门店形状。
 *
 * ⚠️ 刻意**不**直接依赖 `@/api/shop` 的 `EnabledShop`：
 * - 进店卡片的门店来自**商品详情**（`ProductDetailV2VO.shopId/shopName/shopImage`，S1），
 *   它**没有**评分/粉丝字段 ⇒ 父页面会另外拉一次门店档案；
 * - 结构类型（structural typing）让两张卡都能传各自的对象，不必为了类型去补假字段。
 */
export interface ShopObjectiveMetrics {
  rating?: number | null
  onTimeRate?: number | null
  avgAcceptSeconds?: number | null
  fansCount?: number
}

/**
 * 评分区的解释文案（**给用户看的**）。
 *
 * ⚠️ 契约明写评分是**客观指标合成、非用户评价**，而设计稿只画了「★★★★★ 5.0」这一行、
 * 没有任何解释 ⇒ 光看星串，用户会默认理解成"用户评分"（这是**被动的误导**）。
 * 因此这一行在**有评分的两张卡上都渲染**：文案本身不含数字、不占位、不新增配色
 * （沿用各卡既有的次要文字色），只在"真有评分"时出现。
 */
export const RATING_LABEL = '综合服务分（非用户评价）'

/** 把评分归一到 `x.y`；没有值（含 `0` 以外的非法值）时返回空串。 */
export function ratingText(rating: number | null | undefined): string {
  if (rating === null || rating === undefined || !Number.isFinite(Number(rating))) return ''
  return Number(rating).toFixed(1)
}

/**
 * 评分星串：`Math.round(rating)` 颗实心 + 其余空心（满格 5 颗）。
 *
 * ⚠️ 设计只画了满分态（5 颗实心）；**分值不是满分时必须能看出来** —— 写死五颗实心
 * 等于把 3.2 分的店显示成满分（视觉伪造数据，2026-10-10 第三轮已修过一次）。
 * 没有真实评分时返回空串（调用方据此整行不渲染）。
 */
export function ratingStars(rating: number | null | undefined): string {
  if (!ratingText(rating)) return ''
  const filled = Math.max(0, Math.min(5, Math.round(Number(rating))))
  return '★'.repeat(filled) + '☆'.repeat(5 - filled)
}

/**
 * 粉丝数文案。
 * ⚠️ **0 是有效值** ⇒ 判据是"字段存不存在"，不是真值判断；
 *    `null` / `undefined` / 非数字才返回空串（那种情况才叫"没有数据"）。
 *    契约保证 `fansCount` 恒不为 null，但老后端/灰度仍可能没有这个键。
 */
export function fansText(fansCount: number | null | undefined): string {
  if (fansCount === null || fansCount === undefined || !Number.isFinite(Number(fansCount))) return ''
  return `${Number(fansCount)} 粉丝`
}

/**
 * 服务表现列表（**只含契约真有的可计算项**）：
 * ① 准时送达率 `onTimeRate`（0~1 → 一位小数百分比，与契约示例 `0.972` 口径一致）；
 * ② 平均接单时长 `avgAcceptSeconds`（秒 → `N 秒`；≥60 秒时换算成分钟，避免出现 `523 秒` 这种读不动的值）。
 *
 * ⚠️⚠️ 2026-10-10 第七轮（用户决定）：**设计稿那三格的位置必须留着，没有值就用 `--` 占位**
 *    （用户原话：「要做，用 -- 代替都行，**要留着那里**」）。
 *    ⇒ 本函数现在**无条件**返回设计稿的三个固定格（口碑品质 / 发货时效 / 客服响应），
 *      取不到值时填 `--`。`--` 是明确表示"无此数据"，**不是伪造数据**，与仓库硬原则不冲突。
 *
 * ⚠️ 口径纪律（别为了填满格子去错配）：设计稿三格是**满意度 / 发货时效 / 客服响应**，
 *    而契约目前**只有** `onTimeRate`（**准时送达率**）与 `avgAcceptSeconds`（**平均接单时长**）——
 *    **两者口径不同**，所以：
 *    · 「口碑品质」「发货时效」「客服响应」三格**一律 `--`**（那三项契约里没有字段：
 *      满意度连评价模块都没有；客服响应连 IM/会话实体都没有）；
 *    · 两个**真实**指标**另起两格**、用**它们自己的准确标签**（准时送达 / 平均接单）追加在后面，
 *      有值时才出现。⇒ 格子数 3~5，模板用 flex 等分自适应，不会破版。
 *    ⛔ 禁止把 `onTimeRate` 塞进「发货时效」、或把 `avgAcceptSeconds` 塞进「客服响应」——
 *      那是**改文案冒充**，比留空更糟。
 * ⚠️ 返回顺序固定（先三个设计格，再两个真实格）—— 契约没给顺序，写死在这里而不是散在模板里，
 *    两张卡（店铺页 + 进店卡）的顺序才不会分叉。
 */
export function shopServiceMetrics(shop: ShopObjectiveMetrics | null | undefined): ShopServiceMetric[] {
  // 设计稿的三格：契约当前无字段 ⇒ 固定 `--` 占位（用户要求"留着那里"）。
  const list: ShopServiceMetric[] = [
    { name: '口碑品质', value: '--' },
    { name: '发货时效', value: '--' },
    { name: '客服响应', value: '--' },
  ]
  const rate = shop?.onTimeRate
  if (rate !== null && rate !== undefined && Number.isFinite(Number(rate))) {
    // 契约示例 `0.972` 恰好是一位小数百分比；`toFixed(1)` 对 0 / 1 也给出 `0.0%` / `100.0%`（真实值，照实显示）。
    list.push({ name: '准时送达', value: `${(Number(rate) * 100).toFixed(1)}%` })
  }
  const seconds = shop?.avgAcceptSeconds
  if (seconds !== null && seconds !== undefined && Number.isFinite(Number(seconds))) {
    const total = Number(seconds)
    list.push({ name: '平均接单', value: total >= 60 ? `${Math.round(total / 60)} 分钟` : `${Math.round(total)} 秒` })
  }
  return list
}
