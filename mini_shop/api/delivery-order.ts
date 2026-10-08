import { request } from '@/utils/request'

/**
 * 商城域（用户 token）同城配送查询。
 * 依据《同城配送前端接口文档》§2.3（v1.4）：均只能查**自己的**订单（归属校验由后端做）。
 */

/** 配送进度（`progress` 接口已附带骑手信息与承诺送达时间，一次请求即可渲染骑手卡片）。 */
export interface DeliveryProgress {
  /** 0~1 的伪进度；未进配送中为 null。**前端只做展示与平滑动画，禁止本地伪造**。 */
  progress?: number | null
  /** 阶段文案（如「配送中」）。 */
  stage?: string
  /**
   * 节点枚举：WAIT_ACCEPT/ACCEPTED/PREPARING/WAIT_ASSIGN/ASSIGNED/PICKED_UP/DELIVERING/NEARBY/DELIVERED/COMPLETED/CANCELLED/EXCEPTION。
   *
   * ⚠️⚠️ **本接口的 `node` 不下发 `CANCEL_REQUESTED`**（2026-10-08 逐字核对 `api_doc.json`
   *    `DeliveryProgressVO.node` 的枚举原文，里面**没有**这个值）⇒ 「取消申请中」**只能**由
   *    订单**详情**接口的 `deliveryStatus` 驱动（见 `api/order.ts` 的 `OrderSummary.deliveryStatus`
   *    与 `utils/refund-window.ts` 的端点差异表）。
   *    ⛔ 列表页想显示它**不能**拿 `node` 去比字符串 —— 那里判不出来，宁可不显示也不要瞎猜。
   */
  node?: string
  /** 预计剩余分钟。 */
  estimatedRemainingMinutes?: number | null
  /** 骑手 staffId（未分配为 null）。 */
  riderId?: number | null
  /** 骑手姓名（未分配为 null）。 */
  riderName?: string | null
  /** 骑手手机号【明文】，可直接 `wx.makePhoneCall`。 */
  riderPhone?: string | null
  /** 承诺送达时间。 */
  expectedDeliverAt?: string
  /** 距承诺送达的剩余秒数（服务端基准）。 */
  remainingSeconds?: number | null
}

/** 订单当前骑手（`GET /api/delivery/orders/{orderNo}/rider`）。 */
export interface DeliveryRider {
  taskId?: number
  taskNo?: string
  taskStatus?: string
  riderId?: number | null
  riderName?: string | null
  riderPhone?: string | null
  expectedDeliverAt?: string
  remainingSeconds?: number | null
  serverTime?: string
}

/** 查询配送进度（含骑手）。非配送单或未进配送中时后端返回 progress=null。 */
export function getOrderProgress(orderNo: string): Promise<DeliveryProgress> {
  return request<DeliveryProgress>({ url: `/api/delivery/orders/${encodeURIComponent(orderNo)}/progress`, method: 'GET' })
}

/** 查询订单当前骑手（未分配骑手时 riderId/riderName/riderPhone 为 null）。 */
export function getOrderRider(orderNo: string): Promise<DeliveryRider> {
  return request<DeliveryRider>({ url: `/api/delivery/orders/${encodeURIComponent(orderNo)}/rider`, method: 'GET' })
}

/**
 * 确认收货（同城配送 §5.1 第 9 步）。
 * ⚠️ 同城订单**不会**在骑手送达时自动完成：任务 `DELIVERED` 后订单主状态仍是「履约中」，
 * 必须由用户调这个接口才收口为「已完成」（2026-09-19 全流程实测）。
 * 物流订单用的是另一个接口 `POST /api/order/receive/{orderId}`，两者不可互换。
 */
export function confirmReceiveDelivery(orderNo: string): Promise<void> {
  return request<void>({ url: `/api/delivery/orders/${encodeURIComponent(orderNo)}/confirm-receive`, method: 'POST' })
}

/**
 * **申请取消**同城订单（`POST /api/delivery/orders/{orderNo}/cancel-request`，C 端用户 token）。
 *
 * ## 为什么必须有它（2026-10-08 补，**推翻当天早些时候的「决策 A」**）
 * 秒退在上线备货后关闭并返回 `2013`，后端契约（`api_doc.json` 的
 * `POST /api/order/refund/fast/{orderId}` 描述原文）写着「前端应引导用户走取消申请
 * （`POST /api/delivery/orders/{orderNo}/cancel-request`，由商家审核、可按门店策略扣费）」——
 * 而 C 端**此前零调用**（全仓无人调过这个接口）⇒ 那句引导**指向一条不存在的路**，
 * 用户被引导过去只会弹一句"请联系客服"（见 `utils/refund-window.ts` 的闸门表沿革注释）。
 * 现在把这个入口补上，`2013` 的去向才是真的走得通。
 *
 * ## 行为要点（W8 文档 §2.1 / §2.4）
 * - **幂等**：已在 `CANCEL_REQUESTED` 或已 `CANCELLED` ⇒ **按成功返回**（连点 / 重试都安全）；
 * - **特例**：订单仍在 `WAIT_ACCEPT`（待接单）时**不进商家审核**，直接取消 + **全额退款**
 *   ⇒ 调用方应提示「已取消，退款原路退回」（与"取消申请中"是两种结果，**别用同一句文案**）；
 * - 其余档位进入**商家审核**，超过后端落库的 `cancelAutoApproveAt` 会**由系统自动同意并退款**
 *   （给用户发通知）⇒ 前端只展示后端下发的时间，**不要自己算阈值**。
 *
 * ## ⚠️ `orderNo` 必须是**子单号**
 * 跨商拆单场景传父单会返回 `4000 订单不存在或不属于当前用户`；子单号取自详情的 `children[].orderNo`。
 *
 * @param orderNo 子订单号
 * @param reason  取消原因（可选，≤255 字；不传时后端记为"用户取消"）
 */
export function requestCancelDelivery(orderNo: string, reason?: string): Promise<void> {
  const trimmed = String(reason ?? '').trim()
  return request<void>({
    url: `/api/delivery/orders/${encodeURIComponent(orderNo)}/cancel-request`,
    method: 'POST',
    // ⚠️ 不传 reason 时**整个字段省略**（后端按"用户取消"记账）；传 `{ reason: '' }` 与 `undefined` 语义不同
    data: trimmed ? { reason: trimmed } : {},
  })
}

/**
 * 同城配送节点 → 中文文案（用户端订单列表/详情展示用）。
 * ⚠️ 同城订单的订单状态很长一段时间都是「已支付/履约中」，**看不出配送进度** ——
 * 用户端列表因此直接改用这里的配送节点文案（与商家端口径一致）。
 * ⚠️ 2026-09-21 补充：`GET /api/order/list`（**列表**接口）在履约中**不返回**同城的
 * `deliveryStatus`，只有详情接口才返回字符串节点 —— 列表页必须先 `getOrderProgress()`
 * 拿 `node` 再翻译（见 `subpkg-order/orders/list.vue` 的 `progressNodeMap`）。
 */
export const DELIVERY_NODE_TEXT: Record<string, string> = {
  WAIT_ACCEPT: '待接单',
  ACCEPTED: '待取货',
  PREPARING: '备货中',
  WAIT_ASSIGN: '待派单',
  ASSIGNED: '骑手待取货',
  PICKED_UP: '配送中',
  DELIVERING: '配送中',
  NEARBY: '即将送达',
  PAUSED: '配送暂停',
  DELIVERED: '已送达',
  COMPLETED: '已完成',
  EXCEPTION: '配送异常',
  CANCELLED: '配送已取消',
  /**
   * 用户已提交取消申请、等商家审核（`OrderDetailVO.deliveryStatus` 的枚举值之一）。
   *
   * ⚠️⚠️ **这一条是"必须补 key"的典型**（2026-10-08）：本表原先缺它 ⇒
   *    `deliveryNodeText('CANCEL_REQUESTED', fallback)` 会**回落到订单 `statusDesc`**，
   *    而该订单的交易态是「履约中(1)」⇒ 用户看到的是「**履约中**」而不是「取消申请中」，
   *    完全看不出自己刚提交的申请（见 `deliveryNodeText` 的回落实现）。
   * ⚠️ 调用方有两处：订单详情页 `bannerText`（传详情的 `deliveryStatus`）与
   *    `pendingDeliveryStage`。**不是**给 `progress.node` 用的（那个接口不下发该值，见 `DeliveryProgress.node`）。
   * ⚠️ 用户侧口径是「取消申请中」；**商家端/中控是「取消待审核」**（`mini_shop/api/merchant.ts`
   *    的 `DELIVERY_STATUS_TEXT` 与 `admin/src/utils/deliveryStatus.ts`）—— 两边视角不同，别改齐。
   */
  CANCEL_REQUESTED: '取消申请中',
}

/** 同城订单的状态文案：按配送节点取，取不到时回退到订单自身的状态文案。 */
export function deliveryNodeText(node?: string | number | null, fallback = ''): string {
  return DELIVERY_NODE_TEXT[String(node || '')] || fallback
}

/**
 * **骑手尚未取货**的履约节点 —— 这些节点下可以提交「取消申请」（由商家审核）。
 *
 * ⚠️⚠️ 为什么必须单独判一次（2026-10-08，别把 `isFastRefundGateClosed` 当等价条件）：
 * 后端契约（`api_doc.json` 的 `POST /api/delivery/orders/{orderNo}/cancel-request` 描述原文）写着
 * 「待接单直接取消全额退；已接单未取货进入商家审核（`CANCEL_REQUESTED`），驳回自动恢复。
 * **已取货后取消请走售后申请**」。
 * 而秒退的「履约闸门」（{@link FAST_REFUND_CLOSED_DELIVERY_STATUSES}）**范围更大** ——
 * 它把 `PICKED_UP` / `DELIVERING` / `NEARBY` 也算了进去（那些状态秒退同样关闭）。
 * ⇒ 两个集合**不等价**：闸门关闭 ≠ 能申请取消。拿闸门当判据会让「已取货」的单也冒出
 *   「申请取消」按钮，用户点了必然被后端拒。
 *
 * ⚠️ `EXCEPTION` **刻意不在**本集合里：异常单可能已取货、也可能未取货，前端判不出来
 *    ⇒ **fail-closed**（不给取消入口，引导联系客服），宁可让用户找客服，也不给一个可能失败的按钮。
 */
export const CANCEL_REQUESTABLE_NODES: readonly string[] = [
  'WAIT_ACCEPT',
  'ACCEPTED',
  'PREPARING',
  'WAIT_ASSIGN',
  'ASSIGNED',
]

/**
 * 该履约节点下是否可提交「取消申请」。
 * ⚠️ 只判节点；调用方仍需判 `pickupType === 2`（同城）与订单状态（见订单详情页的 `canRequestCancel`）。
 */
export function canRequestCancelByDeliveryNode(node?: string | number | null): boolean {
  return CANCEL_REQUESTABLE_NODES.includes(String(node || ''))
}

/** 同城收货码的原始返回形态（见下方 `normalizeDeliveryPickupCode` 的兼容说明）。 */
export type DeliveryPickupCodePayload = string | number | { code?: string | number; pickupCode?: string | number } | null

/**
 * 归一化同城收货码。
 * ⚠️ 2026-09-21 实测：`GET /api/delivery/orders/{orderNo}/pickup-code` 的 `data` **直接就是字符串码**
 * （如 `"163843"`），不是对象；但后端历史上同类接口给过 `{ code: "163843" }` 这种包装，
 * 为了不让展示层因为形态变化整块消失，这里两种都兼容（取不到一律返回空串，由页面静默隐藏）。
 */
export function normalizeDeliveryPickupCode(data: unknown): string {
  if (data == null) return ''
  if (typeof data === 'string') return data.trim()
  if (typeof data === 'number') return String(data)
  if (typeof data === 'object') {
    const record = data as Record<string, unknown>
    const value = record.code ?? record.pickupCode ?? ''
    return value == null ? '' : String(value).trim()
  }
  return ''
}

/**
 * 查询同城收货码（`GET /api/delivery/orders/{orderNo}/pickup-code`）。
 * ⚠️ **仅下单人可查**（骑手调会 403）；门店开启收货码时，骑手必须先用该码核销才能送达 ——
 * 此前 C 端**零入口**，用户看不到码 → 订单永远卡在配送中（2026-09-21 实测确认）。
 * 门店未开启收货码 / 已完成后失效时返回空，页面按「静默隐藏」处理。
 */
export function getDeliveryPickupCode(orderNo: string): Promise<string> {
  return request<DeliveryPickupCodePayload>({
    url: `/api/delivery/orders/${encodeURIComponent(orderNo)}/pickup-code`,
    method: 'GET',
  }).then((data) => normalizeDeliveryPickupCode(data))
}

/** 送达凭证（照片）行。 */
export interface DeliveryProofVO {
  /** 图片 objectKey / URL（拼 URL 用 `resolveImageUrl`）。 */
  objectKey?: string
  /** 凭证类型，如 `PHOTO`。 */
  proofType?: string
  /** 上传时间。 */
  createTime?: string
}

/**
 * 查看本单的送达凭证（`GET /api/delivery/orders/{orderNo}/proofs`）。
 * ⚠️ 这是 **C 端**接口（按下单人校验）：用户本人可查、骑手调用会 403
 * （骑手端要用 `/api/delivery/tasks/{taskId}/proofs`）。
 */
export function getOrderProofs(orderNo: string): Promise<DeliveryProofVO[]> {
  return request<DeliveryProofVO[]>({ url: `/api/delivery/orders/${encodeURIComponent(orderNo)}/proofs`, method: 'GET' })
}

/** 配送试算结果（`POST /api/delivery/quote`）。 */
export interface DeliveryQuote {
  merchantId?: number
  /**
   * 是否可配送；false 时看 `failCode` + `reason`。
   * ⛔ **唯一的"能不能送"判据**（后端回执 §一）：绝不能因为 `failCode` 缺失就当成成功 ——
   *    老版本后端不返回该字段，此时只有 `reason` 可看。
   */
  canDelivery?: boolean
  /**
   * 结构化失败码（后端回执 §七 全量枚举，2026-10-08 R4 上线）。
   *
   * ✅ **字段名已由后端确认 = `failCode`**（回执 §二-1：`quoteFailCode` 是后端的**枚举类名**
   *   `DeliveryQuoteFailCode`，**不是响应字段**），且 `api_doc.json` 的 `Quote.failCode`
   *   现已带 `enum`（11 项）与分类描述 ⇒ 本字段是契约字段。
   * ⚠️ 但**取值必须按类（class）处理，不能按单个码处理** —— 见
   *   {@link CONCLUSIVE_UNDELIVERABLE_FAIL_CODES} / {@link INCONCLUSIVE_ENVIRONMENT_FAIL_CODES}
   *   与后端回执 §三（`docs/26/10.08/` 下的回执-前端-同城配送不可用排查 文档）。
   * ⚠️ 可能缺省（老版本后端）⇒ 判空后再按 `reason` 展示，**不得**把缺失当成成功。
   *
   * ⚠️ **`canDelivery=false ⇒ failCode 必非空`**（回执 §二-5：后端 `DeliveryRuleService` 只有
   *   两处构造 `Quote` —— 成功（`failCode=null`）与 `fail()` 助手）⇒ 只有 `canDelivery===false`
   *   时才有必要读码；`canDelivery=true` 时该字段为 `null`。
   *
   * ⚠️⚠️ 读码一律走 {@link resolveQuoteFailCode}（`failCode` 优先，兼读历史别名的容忍读法；
   *   字段名歧义已登记：`docs/26/10.08/后端排查-同城配送全部不可用-2026-10-08.md` §三-1 / §三-2），
   *   **任何调用方都不要直接读字段**，更**不要**自己写 `code === 'XXX'` 的单码判断。
   */
  failCode?: string
  /**
   * 结构化失败码的**历史别名**（容忍读法，唯一的第二候选名字）。
   *
   * ⚠️ **后端已澄清：它不是第二个响应字段** —— `quoteFailCode` 是后端的**枚举类名**
   *   `DeliveryQuoteFailCode`（回执 §二-1），响应字段只有 `failCode`。
   *   保留本字段只是为了让 {@link resolveQuoteFailCode} 的兼容读法**不依赖对文档措辞的推断**：
   *   万一某环境真下发了这个别名，也不会把「坐标不可信」误读成「超出配送范围」。
   */
  quoteFailCode?: string
  /** 不可配送的原因（可配送时为 'ok'）——后端文案**可直接展示**。 */
  reason?: string
  /** 配送费（元）。 */
  deliveryFee?: number
  /** 起送金额（元）。 */
  minOrderAmount?: number
  /** 预计备货分钟。 */
  estimatedPrepareMinutes?: number
  /** 预计配送分钟。 */
  estimatedDeliveryMinutes?: number
  /** 距离（km）。 */
  distanceKm?: number
}

/**
 * 读取试算响应的**结构化失败码**，大写归一。
 *
 * ⚠️⚠️ 为什么需要这个函数（而不是直接读 `quote.failCode`）：
 *   「失败原因码」的确切字段名在**后端交付物里自相矛盾** ——
 *   回执 §六-3 写 `failCode`、回执 §七 标题写 `quoteFailCode`、`api_doc.json` 的 `Quote` schema
 *   里只有 `failCode` 且无描述（**已向后端提问**，见 {@link DeliveryQuote.failCode} 的说明）。
 *   只读一个名字的代价是 **P0 真实故障**：读错 ⇒ 预试算必然返回的 `NO_COORDINATE`
 *   （进页面用"当前位置"试算、刻意不谎报 `coordinateSource`）被误判成"确定送不到"
 *   ⇒ 同城配送对**所有商品**置灰。
 *
 * ⇒ 兼容读取：**`failCode` 优先**，缺失时再读 `quoteFailCode`（顺序不可颠倒 —— 契约里
 *   `api_doc.json` 认的是 `failCode`）。两个都没有时返回**空串**，调用方必须按
 *   「**结论不可用**」处理，⛔ **绝不能**把空码当成"确定不可送"（那正是本次故障的形态）。
 */
export function resolveQuoteFailCode(quote?: DeliveryQuote | null): string {
  return String(quote?.failCode ?? quote?.quoteFailCode ?? '').trim().toUpperCase()
}

/**
 * 类别 ①「**确定不可送**」的失败码 —— **只有**这些码才允许前端据此**置灰 / 过滤该门店**，
 * 并按码给用户提示。
 *
 * 来源：**后端回执 §三**（`docs/26/10.08/回执-前端-同城配送不可用排查-2026-10-08.md`，线上实测），
 * 与 `api_doc.json` 的 `Quote.failCode` 枚举描述**逐字一致**（11 码分两类）。
 *
 * ⛔ 这是一张**白名单**：不在本表内的码 —— 包括类别②、空码、以及**后端将来新增的码** ——
 *   **一律不得**当作"确定不可送"（见 {@link isConclusiveUndeliverable} 的安全默认值）。
 *   用「不在类别②里 ⇒ 不可送」这种**黑名单式反推**正是 2026-10-08 P0 的形态，**禁止**。
 */
export const CONCLUSIVE_UNDELIVERABLE_FAIL_CODES: readonly string[] = [
  'OUT_OF_RANGE',
  'MIN_AMOUNT',
  'DELIVERY_DISABLED',
  'SHOP_CLOSED',
  'NOT_IN_DELIVERY_HOURS',
  'GOODS_NOT_PROVIDED',
]

/**
 * 类别 ②「**不确定 · 环境性**」的失败码 —— 后端回执 §三 明确其前端用法：
 * **视为"不确定"**：提示用户「请在地图上选点」；**门店列表不得过滤**；
 * **尤其不得据此禁用整个同城配送**。
 *
 * 为什么必须按**类**而不是按单个码：回执 §三 的线上实测 —— 不带 `coordinateSource` 的预试算
 * 返回 `NO_COORDINATE`，而**同一商家**带上 `MAP_PICK` 坐标后返回的是**另一个码**
 * `SHOP_NO_COORDINATE`（「商家门店坐标未配置，暂不支持配送」）⇒ 只认一个码**仍会误禁用整个同城**。
 */
export const INCONCLUSIVE_ENVIRONMENT_FAIL_CODES: readonly string[] = [
  'NO_COORDINATE',
  'SHOP_NO_COORDINATE',
  'MAP_SERVICE_ERROR',
  'ADDRESS_UNRESOLVED',
  'COORDINATE_INVALID',
]

/** 失败码归一化（去空白 + 大写）—— 两个分类器共用一份口径，避免各处各写一遍。 */
function normalizeFailCode(code?: string | null): string {
  return String(code == null ? '' : code).trim().toUpperCase()
}

/**
 * 该失败码是否属于类别 ①「**确定不可送**」—— **只有**它可以让前端置灰 / 过滤门店。
 *
 * ⛔ **未知 / 未识别的码一律返回 `false`**（这就是安全默认值，也是本函数存在的理由）：
 *   判定做成"**命中类①白名单才为真**"，而不是"不命中类②就为真" ⇒ **后端新增一个码时，
 *   它默认落到"不确定"侧**（不置灰、不过滤门店、不禁用同城），最坏结果是用户多点一次、
 *   由下游带可信坐标的试算与提交守卫拦下（仍然 fail-closed）；反过来把未知码当"确定不可送"，
 *   最坏结果是**整个同城配送对所有商品不可用**（2026-10-08 的真实 P0）。
 *   两害相权 ⇒ **未知 ⇒ 不确定**。
 */
export function isConclusiveUndeliverable(code?: string | null): boolean {
  return CONCLUSIVE_UNDELIVERABLE_FAIL_CODES.includes(normalizeFailCode(code))
}

/**
 * 该失败码是否属于类别 ②「**不确定 · 环境性**」—— 出路是「去地图选点」，
 * **不得**据此过滤门店，**尤其不得**禁用整个同城配送。
 *
 * ⚠️ 本函数只回答"是不是已被归类为环境性不确定"，**不要**把它当成
 *   {@link isConclusiveUndeliverable} 的反面：未知码两边都不属于，仍必须按"不确定"处理
 *   （所以置灰判据只能写成 `isConclusiveUndeliverable(code)`）。
 */
export function isInconclusiveEnvironmentFailure(code?: string | null): boolean {
  return INCONCLUSIVE_ENVIRONMENT_FAIL_CODES.includes(normalizeFailCode(code))
}

/**
 * 同城配送试算：确认订单页选好「发货门店 + 收货地址」后调用，
 * 用于展示真实配送费、距离、预计送达时间，并判断该地址是否在配送范围内。
 *
 * ⚠️ 2026-10-08 起 `coordinateSource` **必传**（后端已按 fail-closed 上线）：
 * - 白名单（可信）：`MAP_PICK`（地图选点）/ `WECHAT_ADDRESS`（微信地址**且真的带坐标**），
 *   大小写 / 空白不敏感；
 * - `MANUAL_INPUT` / `AUTO_LOCATE` / 未知值 / **缺失** ⇒ 后端一律判 `canDelivery=false` +
 *   `failCode=NO_COORDINATE`（拿不到坐标时**不要**调本接口，直接提示用户去地图选点）。
 * - ⛔ 绝不伪造来源：只有坐标**真的**来自地图选点时才传 `MAP_PICK`
 *   （见 `utils/coordinate-source.ts`）。
 */
export function quoteDelivery(payload: {
  merchantId: number
  goodsAmount: number
  receiverLat?: number
  receiverLng?: number
  /** 坐标来源（白名单，见上）；**缺失/非白名单 ⇒ 后端 fail-closed**。 */
  coordinateSource?: string
  address?: string
}): Promise<DeliveryQuote> {
  return request<DeliveryQuote>({ url: '/api/delivery/quote', method: 'POST', data: payload })
}
