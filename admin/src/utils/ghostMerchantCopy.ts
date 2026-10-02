/**
 * 「订单异常巡检」的**商家版说明字典** + 内联 Markdown 处理工具。
 *
 * ## 为什么要这个文件（2026-10-02 用户实测反馈）
 * > 「建议里面的内容还是技术相关的，商户管理员根本看不懂，
 * >  而且还有大量 `**文本**` 这种 md 解析失败漏出的标签」
 *
 * 复核生产环境真实响应后确认：
 * 1. **后端 `suggestion` 是写给工程师的报告** —— 含 `autoFixable 恒 false`、`affected_rows=1`、
 *    `OrderStateTransitionInterceptor`、`OrderDeliveryPort.markDelivered`、`trace_id`、证据测试类名…
 *    ⇒ 商家看了**完全无法行动**（而且它的措辞会随后端版本变，**不能**直接当商家文案用）；
 * 2. **后端字符串里带 Markdown 粗体**（同一段实测 **10 处** `**...**`），前端当纯文本渲染 ⇒ 原样上屏；
 * 3. **连 `label` 也混着技术词**（`to_value`、`trace_id`、`status=4`、`RUNNING`、`死信`）。
 *
 * ⇒ 因此：**商家文案由前端自己维护**（本文件），后端的 `label` / `suggestion` 只进「给技术同学的详情」折叠区。
 *
 * ## 维护约定
 * - 新增巡检项时，**必须**在这里补一条（`admin/tests/ghost-merchant-readable.contract.ps1` 会校验 27 项全覆盖）；
 * - `what` 用**商家的话**说清「这是什么、为什么会这样」，`todo` 说清「你该做什么」；
 * - ⚠️ 措辞**不要**出现：字段名、表名、类名、`trace_id`、状态码数字、英文枚举。

/** 单个巡检项的商家版说明。 */
export interface GhostMerchantCopy {
  /** 一句话说清「这是什么」（商家视角）。 */
  what: string
  /** 「你该做什么」——必须是商家**能执行**的动作。 */
  todo: string
}

/**
 * 商家版说明表：**key → 商家文案**。
 * ⚠️ key 与后端 `GET /api/admin/order/ghost-inspect/checks` 的 `key` 一一对应（共 **27** 项）。
 */
export const GHOST_MERCHANT_COPY: Record<string, GhostMerchantCopy> = {
  // ===== 钱与货对不上（MONEY）=====
  REFUNDED_BUT_IN_TRANSIT: {
    what: '顾客的钱已经退了，但这单的配送还在进行 —— 等于钱退了、货可能还在路上。',
    todo: '先确认骑手实际位置和货物去向，然后**联系平台客服**处理（可能需要追回货物）。这是钱和货对不上的问题，**不要自己改订单状态**。',
  },
  CANCELLED_DELIVERY_BUT_PAID: {
    what: '这单的配送已经取消了，但顾客的钱还没退、订单也没关闭。',
    todo: '确认确实不发这单后，**联系平台客服**给顾客退款并关闭订单。',
  },
  REFUNDING_WITHOUT_REFUND_NO: {
    what: '订单显示"退款中"，但系统里没有对应的退款记录 —— 这笔退款**永远走不完**，顾客会一直等不到钱。',
    todo: '**联系平台客服**补建退款，避免顾客反复催。',
  },
  REFUNDING_STUCK_TOO_LONG: {
    what: '退款卡住了很久没完成（超过规定时间，或支付渠道反复失败）。',
    todo: '**联系平台客服**人工推进这笔退款。',
  },
  DUPLICATE_REFUND_ORDER_PER_ORDER: {
    what: '同一笔订单上挂着**多张未完成的退款单** —— 有把同一笔钱退两次的风险。',
    todo: '**立即联系平台客服**核实，这属于资金风险，不要自己动。',
  },
  STOCK_COMPENSATION_STUCK_RUNNING: {
    what: '一次库存回补（退款后把货加回库存）**卡在中途**了。系统通常会在 10 分钟内自动重试。',
    todo: '先等 10 分钟看是否自动恢复；仍不恢复就**联系平台客服**。',
  },
  STOCK_COMPENSATION_RETRY_EXHAUSTED: {
    what: '库存回补**反复失败** —— 你的**库存数字和实际可能对不上**。',
    todo: '到「商品管理」**手工核对并修正库存**，同时**联系平台客服**排查原因。',
  },
  STOCK_COMPENSATION_DEAD: {
    what: '库存回补已经**彻底放弃**，你的库存数字很可能与实际不符。',
    todo: '到「商品管理」**手工把库存改成实际数量**，并**联系平台客服**。',
  },
  TASK_ACTIVE_BUT_ORDER_REFUNDED: {
    what: '顾客的钱已经退了，但配送任务**没有取消** —— 骑手可能还在接单甚至还在送。',
    todo: '**联系平台客服**取消该配送任务（避免白跑一趟或货丢了）。',
  },
  TASK_CANCELLED_ORDER_STILL_IN_FLIGHT: {
    what: '你取消了"未取货"的配送，但既**没有重新派单**、也**没有给顾客退款** —— 这单卡住了。',
    todo: '决定是**重新发货**还是**退款**，然后**联系平台客服**按你的决定处理。',
  },

  // ===== 卡住不动（STUCK）=====
  WAIT_ASSIGN_WITHOUT_TASK: {
    what: '订单在等安排配送，但**没有任何配送任务在跑** —— 平台可能不知道要派单。',
    todo: '**联系平台客服**补派单（常见于商家忘了点安排，或任务被误取消）。',
  },
  TASK_EXCEPTION_TOO_LONG: {
    what: '配送任务长期停在**异常或暂停**状态，没有人恢复它。',
    todo: '**联系平台客服**恢复该配送任务。',
  },
  TASK_PENDING_TOO_LONG: {
    what: '你发布了配送任务但**很久没人接单** —— 这单会一直占着你的配送名额。',
    todo: '**联系平台客服**协调骑手，或取消后重新发布。',
  },
  IN_FLIGHT_ORDER_WITHOUT_ACTIVE_TASK: {
    what: '订单显示"配送中/异常"，但**没有任何进行中的配送任务** —— 这单没人能推进（俗称死单）。',
    todo: '**联系平台客服**处理，让它重新流转或收口。',
  },
  CANCEL_REQUESTED_TOO_LONG: {
    what: '顾客申请了取消订单，但**超过 15 分钟还没处理** —— 顾客在干等。',
    todo: '⚠️ **需要人工电话联系商家/顾客**：请尽快登录后台处理这条取消申请，或**联系平台客服**协助。',
  },
  AFTER_SALE_PENDING_REVIEW_TOO_LONG: {
    what: '顾客提交的售后申请**超过一天还挂着待审核** —— 顾客等不到结论。',
    todo: '尽快到「售后」页处理；无法判断就**联系平台客服**。',
  },
  RETURN_WAIT_ACCEPT_TOO_LONG: {
    what: '骑手已经把退货**送回你店里超过两天**，但你还没验收。',
    todo: '尽快验收退回的商品，确认后处理退款。',
  },

  // ===== 有风险 / 需人确认（RISK）=====
  DELIVERED_48H_NO_PROOF: {
    what: '订单显示"已送达"**超过 48 小时**，但没有送达凭证 —— 系统无法自动完成这单。',
    todo: '核实顾客是否真的收到，然后**手工确认完成**；有争议就**联系平台客服**。',
  },
  NOTIFY_OUTBOX_DEAD: {
    what: '有一条**通知永久发不出去**了（比如该发给顾客的到货提醒）。',
    todo: '**联系平台客服**（这条通知不会自己恢复；如重要请让客服改用其它方式通知顾客）。',
  },
  NOTIFY_OUTBOX_FAILED_STUCK: {
    what: '有一条通知**反复发送失败且已停止重试**。',
    todo: '**联系平台客服**排查。',
  },

  // ===== 记录不一致（INCONSISTENT）=====
  REFUND_ORDER_PENDING_BUT_ORDER_MOVED: {
    what: '退款记录还挂在"待处理"，但订单本身已经不在退款流程里了 —— 两边状态对不上。',
    todo: '**联系平台客服**核实这笔退款是否真的完成。',
  },
  CANCEL_REQUESTED_NO_ANCHOR: {
    what: '这单有一个"取消申请"等着处理，但**缺少恢复用的记录** —— 如果你驳回，它可能回不到原来的状态。',
    todo: '**联系平台客服**处理这条取消申请（不要自行驳回）。',
  },
  TASK_WITHOUT_ORDER: {
    what: '有一个配送任务**找不到对应的订单**（订单被删了，或这单本来就不是同城配送单）。',
    todo: '**联系平台客服**清理该任务。',
  },
  STATE_TRANSITION_LINK_BROKEN: {
    what: '订单**状态变化的记录断了链**（前后对不上）—— 属于系统留痕问题，**不影响顾客看到的订单状态**。',
    todo: '**通常无需你处理**，也不影响你发货/收款；把订单号发给平台客服备查即可。',
  },
  STATE_TRANSITION_DUPLICATE: {
    what: '同一次状态变更被**记了两遍**（系统在极短时间内重复写入）—— 属于系统留痕问题，**不代表发生了两次业务动作**。',
    todo: '**不用你处理**，也**不影响钱和货**；把订单号发给平台客服备查即可。',
  },
  ORDER_COMPLETED_NO_COMPLETE_TIME: {
    what: '订单显示已完成，但**完成时间没记上**（或与历史记录不一致）—— 会影响"完成后 7 天"的资金释放计算。',
    todo: '⚠️ 如果这单的**可提现时间算错了**，请把订单号发给**平台客服**补正时间。',
  },
  STATE_TRANSITION_ACTOR_MISMATCH: {
    what: '同一次操作在**两处记录里的操作人身份对不上**（例如一边记成骑手、一边记成顾客）—— 属于留痕问题。',
    todo: '**通常无需你处理**；把订单号发给平台客服备查即可。',
  },
}

/** 兜底文案（后端新增了未登记的巡检项时用）。 */
const FALLBACK: GhostMerchantCopy = {
  what: '系统检测到这一类订单状态不太正常（具体说明平台正在补充中）。',
  todo: '把下方「相关订单」里的订单号发给**平台客服**，让客服协助排查。',
}

/**
 * 取某个巡检项的**商家版**说明。
 * ⚠️ 未登记的 key 返回兜底文案（**不会**把后端的工程师报告直接给商家看）。
 */
export function ghostMerchantCopyFor(key?: string | null): GhostMerchantCopy {
  if (!key) return FALLBACK
  return GHOST_MERCHANT_COPY[key] || FALLBACK
}

/**
 * 把后端文本里的**内联 Markdown** 转成可安全渲染的 HTML 片段。
 *
 * 后端 `suggestion` / `label` 里混着 Markdown（实测单段有 10 处 `**粗体**`），
 * 前端当纯文本渲染就会把 `**` 原样上屏（用户实测反馈）。
 *
 * ⚠️ **安全**：只处理两种标记，其余**全部转义**，因此可以安全用于 `v-html`：
 * - `**文字**` ⇒ `<strong>文字</strong>`
 * - `` `代码` `` ⇒ `<code>代码</code>`
 *
 * @param raw 原始文本（可空）
 * @returns 已转义并应用了标记的 HTML 片段
 */
export function renderInlineMarkdown(raw?: string | null): string {
  if (!raw) return ''
  // ① 先转义 HTML，避免后端文本里夹带的标签被当成结构渲染（XSS 防护）
  let html = String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  // ② 再做两种内联标记（在已转义文本上操作，安全）
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  return html
}

/**
 * 把内联 Markdown **剥成纯文本**（用于 `title` / 表格等不能放 HTML 的位置）。
 * 保留文字、去掉标记符号。
 */
export function stripMarkdown(raw?: string | null): string {
  if (!raw) return ''
  return String(raw)
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*/g, '')
}
