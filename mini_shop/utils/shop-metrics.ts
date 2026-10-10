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
 * ## 口径纪律（契约 §12.2 / §12.3 / §15 / §16，逐条对应）
 * 1. **评分是客观指标合成，不是用户评价**：契约 `ShopVO.rating` 原文「由客观指标合成，
 *    **非用户评价**；每日定时重算」—— 合成项 = 完成率 + 无售后率 + 准时送达率（权重可配，
 *    缺数据的项不参与加权），最少订单数默认 5（样本不足**不写评分**）。
 *    ⇒ ⚠️ 它的含义**不是**直觉上的"用户打分"（`RATING_LABEL` 就是为此准备的解释文案）。
 *    ⚠️ **2026-10-10 §16 不影响这条**：§16.3-3 原文「与 `rating` **并存不混用**：`rating` =
 *       客观运营质量（完成率/无售后率/准时率合成，每日重算）；`reviewAvgScore` = **用户主观口碑**」
 *       ⇒ 结论**不变**（rating 仍是非用户评价）⇒ `RATING_LABEL` 文案**不改**（本次已复核）。
 * 2. 展示位**各自独立地"有才渲染"**（`rating` / `onTimeRate` / `avgAcceptSeconds` … 无值时的处理
 *    见第 4 条）。
 * 3. **只接契约真有的字段**（`api_doc.json`，2026-10-10 晚 531 paths / 628 schemas）：
 *    - 已到位：`onTimeRate`（准时送达率）、`avgAcceptSeconds`（平均接单时长）、
 *      `shipAvgHours`（平均发货时长）、`reviewAvgScore`（口碑平均分）；
 *    - ⛔ 仍然**没有**：`客服响应`（平均回复秒数）—— §15.2 / §16.4 原文「⏳ 未实现（需会话/工单
 *      体系；建议工单式起步）」，并且**明令禁止**拿 `onTimeRate` / `avgAcceptSeconds` 去顶那一格
 *      （§16.3-3「专稿 §五 明确**禁止**拿配送指标顶替『口碑品质』那一格」，§15.2 同款警告）
 *      ⇒ 该格**保持 `--`**（占位，不是编数）。
 *    - ⚠️ 也不许拿 `MerchantOverviewVO.serviceScore`（恒 null 占位）当评分。
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
  /**
   * 平均发货时长（小时，1 位小数；`ShopVO.shipAvgHours`，2026-10-10 §15 新增）。
   * 口径 = 近窗口内该店**已发货**（`ship_time` 非空）且**已支付**（`pay_time` 非空）订单的
   * `ship_time − pay_time` 均值。**样本不足时为 null ⇒ 键缺席**（全局 `non_null` 省略）
   * ⇒ 「发货时效」格按"没有数据"渲染占位（见 {@link shipHoursText}）。
   */
  shipAvgHours?: number | null
  /**
   * 发货时效的**样本单数**（`ShopVO.shipSampleCount`，§15）。
   * ⚠️ 本模块**不渲染**它：格子只有"名 + 值"两个文本槽，塞进"基于 N 单"会破版（§15.1 只说
   *    "前端**可用**它决定是否展示"）。声明它是为了**不丢契约字段**、并让调用方随时可用。
   */
  shipSampleCount?: number | null
  /**
   * 口碑平均分 1~5（1 位小数，`ShopVO.reviewAvgScore`，2026-10-10 §16 新增）。
   * ⚠️ 与 `rating` **并存不混用**（§16.3-3）：本字段是**用户主观口碑**（只统计审核显示的评价），
   *    `rating` 是客观运营质量合成。**无有效评价时为 null ⇒ 键缺席** ⇒ 「口碑品质」格渲染占位。
   */
  reviewAvgScore?: number | null
  /**
   * 口碑评价数（`ShopVO.reviewCount`，§16.2）。
   * ⚠️ 同 {@link ShopObjectiveMetrics.shipSampleCount}：**声明但不在格子里渲染**（版式只有一个值槽）。
   */
  reviewCount?: number | null
  /**
   * 好评率 = **4~5 星占比**（0~1，3 位小数，`ShopVO.goodRate`，§16.2）。
   * ⚠️ **不渲染**：它**不是**"口碑品质"那一格的头条值（那一格用 `reviewAvgScore` 才与
   *    格名同口径）；若要展示，应另起一个**自己名下**的格子（如「好评率」），
   *    ⛔ 不得把它冒名成设计稿别的格（口径纪律：不许改文案冒充）。
   */
  goodRate?: number | null
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
 * 「口碑品质」格的取值：`reviewAvgScore`（1 位小数 + 「分」）。
 * ⚠️ **无有效评价时 `reviewAvgScore` 键缺席**（§16.3-2：三个字段全为 null ⇒ `non_null` 省略）
 *    ⇒ 这里给 `--`（占位 = "无此数据"）。设计稿的填充值（`平均满意度 97.2%`）严禁写死。
 * ⚠️ 单位用「分」而不是「%」：本字段是 **1~5 分**的平均分，不是百分比；
 *    `goodRate`（4~5 星占比）才是百分比，**不在这里顶替**（见接口注释）。
 * ⚠️ 与星级评分（`rating`）**并存不混用**（§16.3-3）—— 两者是不同的数，文案不得互相冒充。
 */
export function reviewScoreText(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return '--'
  return `${Number(score).toFixed(1)} 分`
}

/**
 * 「发货时效」格的取值：`shipAvgHours`（小时，1 位小数）。
 * ⚠️ **样本不足（默认 < 5 单）时后端写 NULL ⇒ 键缺席**（§15.1："上线/新店初期必然缺席，属正常"）
 *    ⇒ 这里给 `--`。⛔ 不许拿 `onTimeRate`（**准时送达率**，配送口径）来顶这一格 ——
 *    §15.2 明确两者"不是一回事"。
 */
export function shipHoursText(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(Number(hours))) return '--'
  return `${Number(hours).toFixed(1)} 小时`
}

/**
 * 服务表现列表（设计稿**固定的三格** + **两个真实可计算项自己的格**）：
 * ① 口碑品质 ← `reviewAvgScore`（§16，用户主观口碑平均分；无评价 ⇒ `--`）；
 * ② 发货时效 ← `shipAvgHours`（§15，平均发货时长；样本不足 ⇒ `--`）；
 * ③ 客服响应 ← **永远 `--`**（§15.2 / §16.4：需会话/工单体系，**未实现**；且明令**禁止**
 *    拿配送指标顶替 ⇒ 这一格没有可接的字段）；
 * ④ 准时送达 ← `onTimeRate`（0~1 → 一位小数百分比，与契约示例 `0.972` 口径一致）；
 * ⑤ 平均接单 ← `avgAcceptSeconds`（秒 → `N 秒`；≥60 秒时换算成分钟，避免出现 `523 秒` 这种读不动的值）。
 *
 * ⚠️⚠️ 2026-10-10 第七轮（用户决定）：**设计稿那三格的位置必须留着，没有值就用 `--` 占位**
 *    （用户原话：「要做，用 -- 代替都行，**要留着那里**」）⇒ 前三个恒在。
 *
 * ⚠️⚠️ **2026-10-10 晚第九轮（§15 / §16 字段到位）**：①②从"固定 `--`"**接线到真字段**
 *    （这正是当初留占位的目的）；③**不变，仍是 `--`** —— 官方口径没给字段，也没给替代品。
 *    ⛔ 禁止把 `onTimeRate` 塞进「发货时效」、或把 `avgAcceptSeconds` 塞进「客服响应」——
 *      那是**改文案冒充**，比留空更糟（§15.2 末尾原话：「**不要把** `onTimeRate`（配送准时率）/
 *      `avgAcceptSeconds`（配送接单时长）**改文案去顶这两格**」）。
 *    ⚠️ ④⑤ 两个**真实**指标仍**另起两格**、用**它们自己的准确标签**（准时送达 / 平均接单），
 *      有值时才出现。⇒ 格子数 3~5，模板用 flex 等分自适应，不会破版。
 * ⚠️ 返回顺序固定（先三个设计格，再两个真实格）—— 契约没给顺序，写死在这里而不是散在模板里，
 *    两张卡（店铺页 + 进店卡）的顺序才不会分叉。
 *    ⚠️ **进店卡片**（`ShopEntryCard.vue`）的设计只有**三格**（106×46 × 3）⇒ 组件侧
 *    `slice(0, SHOP_METRIC_LIMIT)` 只保留前三个（三个设计格）；④⑤只在**店铺页**出现。
 */
export function shopServiceMetrics(shop: ShopObjectiveMetrics | null | undefined): ShopServiceMetric[] {
  // 设计稿的三格：①②已由 §15/§16 字段接线；③ 契约**没有**对应字段（客服响应）⇒ 恒 `--` 占位。
  const list: ShopServiceMetric[] = [
    { name: '口碑品质', value: reviewScoreText(shop?.reviewAvgScore) },
    { name: '发货时效', value: shipHoursText(shop?.shipAvgHours) },
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
