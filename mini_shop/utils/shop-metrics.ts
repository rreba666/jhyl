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
 * ## 运营开关（§18，2026-10-10 20:3x 上线；本模块是**唯一的位判断入口**）
 * `ShopVO.showSections`（int 位掩码，契约原文：「店铺页展示开关（位掩码：1=评分星级 2=口碑品质
 * 4=发货时效 8=经营资质；默认 15=全开）」）—— **位 = 运营要不要这个板块**：
 * - 位为 0 ⇒ **该板块整块不渲染**（这是后端本意，也是本模块 {@link shopSectionVisible} 的语义）；
 * - 位为 1 但值缺席 ⇒ **留版式 + `--`**（见下面的「用户推翻 §18.4」一段）。
 *
 * ⚠️⚠️ **本文件有两条实现是「用户明确决定、且与后端文挡 §18.4 不一致」的，后来者不要改回去**：
 * 文档 `docs/26/10.10/前端对接文档-2026-10-10-全集.md` §18.4 的伪码写的是
 * 「`if (s & 1) 渲染「评分星级」（rating 缺席则**整块不渲染**）」——即"值缺席就整块不渲染"。
 * 用户 2026-10-10 当面**推翻**了这一条，逐字：「**要留着那里，用 `--` 代替都行**」，
 * 并在同日另有 `03a7482` 的同类决定。⇒ 现行语义是：
 *   ① **位开着但值缺席 ⇒ 版式留着，值渲染 `--`**（不整块消失）；
 *   ② **「客服响应」这一格没有对应的位（后端本期不做、不给位）⇒ 永远渲染、长期 `--`**
 *      （§18.4 末句「前端不渲染该块」同样被用户推翻）。
 * ⇒ 这与"不伪造数据"**不冲突**：`--` 表示"无此数据"，不是编一个数字；被禁止的始终是编数值。
 *   ⛔ 不要为了"贴合文档"把这两条改回"缺席即整块不渲染"。
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
  /**
   * 该格是不是**设计稿那三格**之一（口碑品质 / 发货时效 / 客服响应）。
   * - `true`  = 设计格：进店卡片**按本标记过滤后**再取前三个，缺值渲染 `--`（用户决定，见文件头）；
   * - `false` = **追加格**（准时送达 / 平均接单）：它们是"有才出现"的真实指标，
   *   进店卡片的设计里**没有**它们的位置 ⇒ 卡片必须把它们过滤掉（不能因为设计格被运营关掉，
   *   就让追加格**递补**进设计格的槽位 —— 那会让用户以为那一格换了口径）。
   * ⚠️ 缺省（`undefined`）按**设计格**处理：老调用方自己拼的"名 + 值"数组仍按旧口径渲染，
   *    不会因为本次新增字段而整块消失。
   */
  designSlot?: boolean
}

/** 服务表现的展示上限（设计两张卡都是三格；契约本身没写上限，这里只做防御）。 */
export const SHOP_METRIC_LIMIT = 3

/**
 * 店铺页板块位（`ShopVO.showSections`，§18.3）。
 * 契约原文：「位掩码：1=评分星级 2=口碑品质 4=发货时效 8=经营资质；默认 15=全开」。
 * ⚠️ **没有**「客服响应」的位 —— 后端本期不做（§18.4 末句），见文件头第 ② 条。
 */
export const SHOP_SECTION_RATING = 1
export const SHOP_SECTION_REVIEW = 2
export const SHOP_SECTION_SHIP = 4
export const SHOP_SECTION_QUALIFICATION = 8

/**
 * `showSections` **缺席时的兜底值 = 15（全开）**，与 §18.4 伪码的 `shop.showSections ?? 15` 一致。
 *
 * ⚠️ **这个兜底的风险，必须写清楚（别当成"显然正确"）**：
 * 客户端**分不出**下面两种情况 ——
 *   ① **老后端 / 灰度**：根本没有这个键（前端此刻的行为应当与加这个开关之前**完全一样**）；
 *   ② **运营把 15 位全部关掉**：按 §18.4 的「null 语义」那句，也可能表现为**键不下发**。
 * 兜底成 15 时，②会被读成"全开" ⇒ **运营的关闭动作静默失效**（与 `CLAUDE.md` §十
 * `normalizeDeliverySwitch(undefined) ⇒ 支持` 属**同一类**坑）。
 * **为什么仍然选 15（而不是反过来兜底成 0）**：这条兜底**只决定版式**、不决定任何
 * "放行/拦截"，也**不会**让任何一个数字变成假的（位开着而值缺席时渲染的是 `--`）——
 * 与"兜底让校验必然通过"那种伪造**不是一类**；而反过来兜底成 0 会让**所有老后端 / 灰度
 * 用户**的店铺页凭空少掉全部板块（净回归）。
 * **残余风险的判据**：后端把该键定义为**非空 int**（DB 默认 15，`non_null` 序列化 ⇒
 * 0 也是**下发 0**、不是省略）⇒ ②实际不会以"键缺席"的形态出现。
 * ⚠️ 若将来后端改成 `non_empty` / 可空，或运营反馈"关了没生效"，**第一个要看的就是这里**。
 */
export const SHOP_SECTIONS_FALLBACK = 15

/**
 * ============================================================================
 * ⛔⛔⛔ 演示占位开关（FAKE / DEMO DATA）—— 上线前必须改为 `false` ⛔⛔⛔
 * ============================================================================
 *
 * | 项 | 值 |
 * |---|---|
 * | 名字 | `SHOP_DESIGN_PREVIEW_METRICS` |
 * | 文件 | 本文件 `mini_shop/utils/shop-metrics.ts`（这两张卡的**唯一**口径来源） |
 * | 当前默认 | **`true` = 打开**（用户要求"先看到效果"） |
 * | 引入日期 | **2026-10-10** |
 * | 关闭方式 | 把下面这一行改成 `= false`（**唯一的一行**，别的地方不用动） |
 *
 * ## 这是什么（以及**不是**什么）
 * 用户 2026-10-10 的原话（逐字）：
 * 「图中这些 `--` **先用假值替换**，评分 **4.8** 星星，口碑品质 **9.2** 分，
 *   发货时效 **24** 小时，客服响应不管」
 * —— 目的是**看版式**（"先用假值"，即临时的、只为评估排版）。
 *
 * ⇒ 它**只影响渲染**：
 * - ⛔ **不进任何请求**：不是查询参数、不是请求体字段、不发给任何接口（本文件不 import 任何
 *   请求层；两张卡也只是把它**读**成展示值）；
 * - ⛔ 不是"后端数据"、不是"兜底默认值"：它**只在真值缺席时**才被用（见 {@link previewValue}），
 *   后端一旦下发了真实值，**真值永远赢**；
 * - ⛔ 它**不复活**任何被运营关掉的板块：`showSections` 的位判断在它**之前**
 *   （位为 0 ⇒ 整格不渲染，占位没有机会出现在那里）。
 *
 * ## 为什么要写得这么刺眼
 * 本仓库的硬原则是「⛔ **绝不伪造数据**」（用户原话：「我们千万不能伪造数据给后端」，
 * `CLAUDE.md` §十）。这几个数是**为了让用户看版式**而临时造的假值，
 * ⛔ **绝不允许随着发布上线**：
 * - ⚠️ **上线前必须改为 `false`**（改动就这一行）；
 * - ⚠️ 契约 `tests/shop-page.contract.ps1` §17 会在"发布了（`DSH_RELEASE_CUT=1`）
 *   而开关还开着"时**直接报红**，并且会在开关被悄悄删掉时也报红（见那两段断言）；
 * - ⚠️ 流程记录（谁、为什么、什么时候关）：
 *   `docs/26/10.10/待办-上线前关闭店铺页演示占位-2026-10-10.md`；
 * - ⚠️ **诚实说明**：开关开着时，从**屏幕上看不出**"真实的 4.8"与"占位的 4.8"
 *   （两者都会渲染成 `4.8`）—— 这正是它必须有一个显式开关、且必须在上线前关掉的原因。
 *
 * ## 数值本身**不是**契约字段的合法取值（只是版式占位，别当成"合理默认"）
 * - `rating = 4.8`：契约范围 0~5（客观合成分的展示是 `x.y`）⇒ 4.8 合法；
 * - `reviewAvgScore = 9.2`：⚠️ **契约里「口碑品质」是 1~5 分**（`ShopVO.reviewAvgScore`，
 *   §16）⇒ **9.2 超出该字段的标度**。用户点名要 9.2，这里**照用户的数**渲染
 *   （目的是看版式），但⛔ **不得**因此把 `reviewScoreText` 的标度改成 10 分制；
 * - `shipAvgHours = 24`：契约是"小时、1 位小数"⇒ 经 {@link shipHoursText} 渲染成
 *   **`24.0 小时`**（占位也走真格式化器，才叫"忠实预览"；⛔ 不写死显示字符串）。
 */
export const SHOP_DESIGN_PREVIEW_METRICS = {
  /** 演示用的店铺评分（**假值**，2026-10-10；用户要的 4.8）。 */
  rating: 4.8,
  /** 演示用的口碑品质（**假值**，2026-10-10；用户要的 9.2 —— ⚠️ 超出契约的 1~5 标度）。 */
  reviewAvgScore: 9.2,
  /** 演示用的发货时效小时数（**假值**，2026-10-10；用户要的 24）。 */
  shipAvgHours: 24,
} as const

/**
 * **演示占位开关的总闸**（true = 用 {@link SHOP_DESIGN_PREVIEW_METRICS} 顶上缺席的真值）。
 * ⚠️ 上线前必须改为 `false`（见上面那段 ⛔⛔⛔ 说明）；默认 `true` 是为了让用户**立刻看到效果**。
 */
const SHOP_DESIGN_PREVIEW_ENABLED = true

/**
 * 占位开关是否生效（= 总闸打开）。给契约/报告/调用方一个**只读**读数用。
 * ⛔ 它**不是**给业务逻辑分支用的（业务侧不该有第二个开关：口径只有上面那一处）。
 */
export function shopDesignPreviewEnabled(): boolean {
  return SHOP_DESIGN_PREVIEW_ENABLED
}

/**
 * **真值优先**的占位取数：真值缺席（`null` / `undefined`）且开关打开 ⇒ 返回演示值，否则返回真值本身。
 *
 * ⚠️ 判据是 `== null`（**不是**真值判断）：契约里 `0` 是**合法真值**
 *     （`fansCount = 0` = 暂无粉丝、`rating = 0` 也是一种分数声明）⇒ 真值 `0` **必须赢**，
 *     绝不能被占位顶掉。这也是"绝不伪造数据"在**有真值时**的落点。
 * ⚠️ 非数值的脏值**不算缺席**：它会照旧走各自的格式化器（脏值渲染 `--`），
 *     占位**不参与**——否则脏值就会被"假数据"盖住，等于把故障藏起来。
 */
export function previewValue<T extends number>(actual: T | null | undefined, preview: number): T | number | null | undefined {
  if (actual === null || actual === undefined) {
    return SHOP_DESIGN_PREVIEW_ENABLED ? preview : actual
  }
  return actual
}

/**
 * 取 `showSections` 的有效值：缺席 / `null` / 非数值 ⇒ {@link SHOP_SECTIONS_FALLBACK}。
 * ⚠️ 非数值（脏值）也走兜底而不是当成 0：当成 0 会让**整页板块凭空消失**，
 *    而"看不见的失败"比"多显示一个 `--` 占位"严重得多（两者都不编数字）。
 */
export function shopShowSections(showSections: number | null | undefined): number {
  if (showSections === null || showSections === undefined || !Number.isFinite(Number(showSections))) {
    return SHOP_SECTIONS_FALLBACK
  }
  return Number(showSections)
}

/**
 * 某一个板块位是否打开（**位为 0 ⇒ 整块不渲染** —— 这是后端的本意）。
 * ⚠️ 判据只能是**位**，不能是"值有没有"：值缺席时该板块仍要留版式、渲染 `--`（用户决定）。
 */
export function shopSectionVisible(showSections: number | null | undefined, bit: number): boolean {
  return (shopShowSections(showSections) & bit) !== 0
}

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
  /**
   * 店铺页展示开关（位掩码，`ShopVO.showSections`，**§18.3 新增**）。
   * 1=评分星级 2=口碑品质 4=发货时效 8=经营资质（默认 15=全开）。
   * ⚠️ **位 = 运营要不要这个板块**（位为 0 ⇒ 整块不渲染）；**位开着而值缺席 ⇒ 留版式 + `--`**
   *    （用户 2026-10-10 明确推翻 §18.4 的"缺席则整块不渲染"，见文件头）。
   * ⚠️ 缺席时的兜底与风险见 {@link SHOP_SECTIONS_FALLBACK}。
   */
  showSections?: number | null
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
 * 服务表现列表（设计稿**三格** + **两个真实可计算项自己的格**）：
 * ① 口碑品质 ← `reviewAvgScore`（§16，用户主观口碑平均分；无评价 ⇒ `--`）；
 * ② 发货时效 ← `shipAvgHours`（§15，平均发货时长；样本不足 ⇒ `--`）；
 * ③ 客服响应 ← **永远 `--`**（§15.2 / §16.4：需会话/工单体系，**未实现**；且明令**禁止**
 *    拿配送指标顶替 ⇒ 这一格没有可接的字段）；
 * ④ 准时送达 ← `onTimeRate`（0~1 → 一位小数百分比，与契约示例 `0.972` 口径一致）；
 * ⑤ 平均接单 ← `avgAcceptSeconds`（秒 → `N 秒`；≥60 秒时换算成分钟，避免出现 `523 秒` 这种读不动的值）。
 *
 * ⚠️⚠️ 2026-10-10 第七轮（用户决定）：**设计稿那三格的位置必须留着，没有值就用 `--` 占位**
 *    （用户原话：「要做，用 -- 代替都行，**要留着那里**」）⇒ **各自的位开着**时前三个恒在。
 *    ⚠️ 2026-10-10 20:3x（§十八）追加了一层**运营开关**：①要**位 2**、②要**位 4** 打开才占位
 *    （位为 0 = 运营主动关掉该板块 ⇒ 不渲染）；③ **没有位** ⇒ 恒在。见下面的位门禁一段。
 *
 * ⚠️⚠️ **2026-10-10 晚第九轮（§15 / §16 字段到位）**：①②从"固定 `--`"**接线到真字段**
 *    （这正是当初留占位的目的）；③**不变，仍是 `--`** —— 官方口径没给字段，也没给替代品。
 *    ⛔ 禁止把 `onTimeRate` 塞进「发货时效」、或把 `avgAcceptSeconds` 塞进「客服响应」——
 *      那是**改文案冒充**，比留空更糟（§15.2 末尾原话：「**不要把** `onTimeRate`（配送准时率）/
 *      `avgAcceptSeconds`（配送接单时长）**改文案去顶这两格**」）。
 *    ⚠️ ④⑤ 两个**真实**指标仍**另起两格**、用**它们自己的准确标签**（准时送达 / 平均接单），
 *      有值时才出现。⇒ 格子数 3~5，模板用 flex 等分自适应，不会破版。
 *    ⚠️⚠️ **2026-10-10 第十轮（用户：「先用假值替换…看版式」）**：①②前面各包了一层
 *      {@link previewValue}（演示占位总闸 {@link SHOP_DESIGN_PREVIEW_METRICS}）——
 *      **只在真值缺席时**顶上假值，**真值永远赢**；③「客服响应」**不受它影响，恒 `--`**
 *      （用户逐字：「客服响应不管」）。⛔ 上线前必须把那个开关改成 `false`
 *      （说明与流程记录见该常量，以及 `docs/26/10.10/待办-上线前关闭店铺页演示占位-2026-10-10.md`）。
 * ⚠️ 返回顺序固定（先三个设计格，再两个真实格）—— 契约没给顺序，写死在这里而不是散在模板里，
 *    两张卡（店铺页 + 进店卡）的顺序才不会分叉。
 *    ⚠️ **进店卡片**（`ShopEntryCard.vue`）的设计只有**三格**（106×46 × 3）⇒ 组件侧只保留
 *    **设计格**（`designSlot !== false`）、再 `slice(0, SHOP_METRIC_LIMIT)`；④⑤只在**店铺页**出现。
 *    ⚠️ 组件侧**不能**只靠 `slice(0, 3)`：运营把关掉某个设计格后，列表会**变短**而 ④⑤ 会**前移**，
 *       只切前三个就会让「准时送达」递补进设计格的槽位 ⇒ 必须按 `designSlot` 过滤（见该字段注释）。
 *
 * ⚠️⚠️ **§18.4 的位门禁（2026-10-10 20:3x 上线；与文档的差异见文件头）**：
 * - 「口碑品质」只在 **位 2** 打开时占位；「发货时效」只在 **位 4** 打开时占位；
 *   位为 0 ⇒ 该格**不渲染**（不补 `--`、也不换成别的指标）；
 * - 「客服响应」**没有位** ⇒ **永远渲染、长期 `--`**（用户 2026-10-10 决定，见文件头第 ② 条）；
 * - ④⑤（准时送达 / 平均接单）**契约没有给位** ⇒ 不受 `showSections` 影响，保持"有值才出现"
 *   与它们**自己的**标签（⛔ 不得因为别的格被关掉就把它们改个名塞进那个槽位）。
 *   ⚠️ 这两格自身的"有值才渲染"判据（`!= null`）**不是** `showSections` 管辖范围 —— 别混。
 */
export function shopServiceMetrics(shop: ShopObjectiveMetrics | null | undefined): ShopServiceMetric[] {
  // 位 = 运营要不要这个板块（见文件头）。位为 0 ⇒ 该格整格不渲染；位开着而值缺席 ⇒ 留格 + `--`。
  const sections = shopShowSections(shop?.showSections)
  const list: ShopServiceMetric[] = []
  // 设计稿三格之一「口碑品质」：位 2；值 ← `reviewAvgScore`（§16），无评价 ⇒ `--`。
  // ⚠️ `previewValue` = 2026-10-10 的**演示占位总闸**（仅当该字段缺席时才顶上假值）——
  //    位为 0 时整格不渲染（占位**没有机会**出现在被运营关掉的板块里，见常量那段说明）。
  if (sections & SHOP_SECTION_REVIEW) {
    list.push({ name: '口碑品质', value: reviewScoreText(previewValue(shop?.reviewAvgScore, SHOP_DESIGN_PREVIEW_METRICS.reviewAvgScore)), designSlot: true })
  }
  // 设计稿三格之二「发货时效」：位 4；值 ← `shipAvgHours`（§15），样本不足 ⇒ `--`。
  if (sections & SHOP_SECTION_SHIP) {
    list.push({ name: '发货时效', value: shipHoursText(previewValue(shop?.shipAvgHours, SHOP_DESIGN_PREVIEW_METRICS.shipAvgHours)), designSlot: true })
  }
  // 设计稿三格之三「客服响应」：**没有位** ⇒ 恒在、恒 `--`（用户决定；契约至今没有该字段）。
  list.push({ name: '客服响应', value: '--', designSlot: true })
  const rate = shop?.onTimeRate
  if (rate !== null && rate !== undefined && Number.isFinite(Number(rate))) {
    // 契约示例 `0.972` 恰好是一位小数百分比；`toFixed(1)` 对 0 / 1 也给出 `0.0%` / `100.0%`（真实值，照实显示）。
    list.push({ name: '准时送达', value: `${(Number(rate) * 100).toFixed(1)}%`, designSlot: false })
  }
  const seconds = shop?.avgAcceptSeconds
  if (seconds !== null && seconds !== undefined && Number.isFinite(Number(seconds))) {
    const total = Number(seconds)
    list.push({ name: '平均接单', value: total >= 60 ? `${Math.round(total / 60)} 分钟` : `${Math.round(total)} 秒`, designSlot: false })
  }
  return list
}
