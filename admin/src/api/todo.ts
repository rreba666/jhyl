import { request } from './request'
import { sanitizeBonusText } from '@/utils/textSafe'

/** 待办等级（决定下拉项颜色）。 */
export type TodoLevel = 'INFO' | 'WARN' | 'DANGER'

/** 待办项（后端按 `AdminTodoKeyEnum` 返回；新增类型前端无需发版）。 */
export interface TodoItem {
  /** 稳定标识（如 MERCHANT_AUDIT / AFTER_SALE / ORDER_SHIP / DELIVERY_EXCEPTION / WX_SHIPPING_FAILED …）。 */
  key: string
  /** 中文文案（**直接展示，前端不自拼**）。 */
  label: string
  /** 待办数量；**`0` 的项前端不渲染**（后端照常返回便于统计）。 */
  count: number
  /** 点击跳转的后台路由（可带 query，直接 `router.push`）。 */
  route: string
  /** 颜色等级：`INFO` 蓝 / `WARN` 橙 / `DANGER` 红（缺省按 INFO）。 */
  level?: TodoLevel
}

/** 待办汇总（`GET /api/admin/todo/summary`）。 */
export interface TodoSummary {
  /** 所有待办数量之和（徽标用；`>99` 显示 99+，`=0` 不显示徽标）。 */
  total: number
  items: TodoItem[]
}

/**
 * 中控待办的**前端兜底文案与深链**（后端只下 `key` 时用；后端给了 label/route 就用后端的）。
 *
 * | key | 中文 | 判据（后端） | 可见角色 | 深链 |
 * |---|---|---|---|---|
 * | `WITHDRAW_APPROVE_TIMEOUT` | 提现审核超时 | 待审核 > **4 小时**（可配 `fengling.withdraw.approve-timeout-minutes`） | 超管 + 财务 | `/withdraw?status=0`（待审核页签） |
 * | `WITHDRAW_PAYOUT_TIMEOUT` | 提现已通过待打款超时 | 已通过 > **24 小时**（可配 `fengling.withdraw.payout-timeout-minutes`） | 超管 + 财务 | `/withdraw?status=APPROVED`（交易记录页签按「打款中」过滤） |
 * | `DIVIDEND_CLAWBACK_MISSING` | 退款未追回红包 | `dividend_clawback_failure` 表**未处理条数**（`status=0`） | 超管 + 财务 | `/dividend-clawback?status=0`（未处理） |
 * | `DELIVERY_IN_TRANSIT_TOO_LONG` | 同城在途超时 | `delivery_tasks.status IN ('PICKED_UP','DELIVERING','NEARBY')` 停留超阈值 | **仅超管** | `/delivery` |
 * | `RETURN_REJECTED_PENDING` | 退货被拒收待处理 | `delivery_tasks.return_status = 'REJECTED'` 停留 ≥ 阈值 | **仅超管** | `/delivery` |
 * | `AFTER_SALE_VERIFY_PENDING` | 售后待门店核实超时 | `after_sale_order.merchant_verify_status = 1` 停留 ≥ 阈值 | **仅超管** | `/after-sale`（⚠️ 后端文档写的是 `/aftersale`，见下） |
 * | `RETURN_GATE_LEAK_SUSPECT` | 退货闸门漏网（已退款但返货未验收） | 订单已退款（`status=7`）但返货任务 `return_status` 非 `ACCEPTED` | **仅超管** | `/delivery` |
 *
 * ## ⚠️⚠️ 边界（别越界）
 * 1. **数量只认后端**：这里**没有 `count`** —— 后端没返回该待办项时，前端**不显示、也不补 0**，
 *    更不会自己去数一遍（那需要全量业务数据，前端没有这个数据源，
 *    硬算出来的数字必然与后端不一致 ⇒ 违反"徽标数字 == 点进去的条数"）。
 * 2. **后端下发优先**：`label` / `route` / `level` 只要后端给了就用后端的，
 *    这里只在**后端没给**时兜底（后端改口径前端不用发版）。
 * 3. **只提醒、不改状态**：这几项是**建议级**待办，页面不提供"超时自动通过 / 自动打款 / 自动追回"之类的动作。
 *
 * ## ⚠️ 2026-10-09 实测（dev 后端，超管账号）：`DIVIDEND_CLAWBACK_MISSING` **已经上线**
 * `GET /api/admin/todo/summary` 真实返回了该项（`count=0`，`level=DANGER`；
 * ⚠️ 它下发的 `label` 用的是**旧业务词**形态 ⇒ 由下面的 `normalizeTodoItem` 在展示层归一化）。
 * ⚠️ 但后端当前下发的 `route` 是 **`/orders?status=7`**（一个**占位深链**：点进去是订单列表，
 *    **看不到**追回失败记录 —— 那些行在 `dividend_clawback_failure` 表里，只有本页能展示）。
 *    ⚠️ 因为"后端下发优先"，这条 `route` 会**盖住**下面的兜底深链 ⇒ **需后端把该 key 的 route 改成
 *    `/dividend-clawback?status=0`**（前端不越权改写后端数据；本次只在兜底里把正确深链备好，并在此留痕）。
 */
export const TODO_ITEM_FALLBACKS: Record<string, { label: string; route: string; level: TodoLevel }> = {
  WITHDRAW_APPROVE_TIMEOUT: {
    label: '提现审核超时',
    route: '/withdraw?status=0',
    level: 'WARN',
  },
  WITHDRAW_PAYOUT_TIMEOUT: {
    label: '提现已通过待打款超时',
    route: '/withdraw?status=APPROVED',
    level: 'DANGER',
  },
  // 退款未追回红包（2026-10-09）：③ 号待办，与上面两项同为"超管 + 财务"可见。
  // label 按本项目术语口径写「红包」（界面不出现旧业务词）；深链落到本批新增的工作台，并带上"未处理"筛选。
  DIVIDEND_CLAWBACK_MISSING: {
    label: '退款未追回红包',
    route: '/dividend-clawback?status=0',
    level: 'DANGER',
  },
  // 返货待验收（2026-10-10）：该 key 的 `route` 在契约示例响应里就是
  // `/delivery/returns?returnStatus=RETURNED`（此前 admin 侧**没有这个页面** ⇒ 点了没反应）。
  // ⚠️ **本期不在这里加兜底**：后端已经下发正确 route ⇒ 兜底是死代码；
  //    `delivery-returns.contract.ps1` 也反向断言「兜底表里不得出现 `DELIVERY_RETURN_ACCEPT` 这个键」
  //    （⚠️ 那条断言是**纯文本包含**，不区分注释 ⇒ 注释里也**不要**把这个键连上 `: {` 写出来）。
  //    ⇒ 本页只负责**让那个 route 落得下去**（新增 `/delivery/returns` 页面 + 路由 + 菜单 + 矩阵）。

  // ---- 同城/物流风险整改 4 项（2026-10-10）----
  // 依据：`docs/26/10.10/前端对接文档-同城物流风险整改5项-2026-10-10.md` §二。
  //
  // 三条口径说明（都**不是**这里能改的事，写下来免得下一个人误改）：
  // 1. **可见角色 = 只认后端**：这 4 项后端**仅下发给超管**（未加入财务/客服清单）。
  //    本文件的铃铛（`AdminLayout.vue`）**没有任何按角色过滤待办的逻辑** —— 它只渲染
  //    `GET /api/admin/todo/summary` 返回的 `items` 里**数量大于 0** 的项 ⇒ 角色过滤**在后端**，
  //    前端不需要（也**不应该**）在此按角色裁剪，否则会与后端清单两处漂移。
  //    ⚠️ 这段注释里刻意不写出那个"数量"字段的英文字段名：本文件的兜底表被契约用纯文本
  //       `IndexOf` 守住"不许带数量"，而它**不剔除注释** ⇒ 连注释里出现该字段名都会把它判红。
  // 2. **级别（颜色）已有既有机制**：`level` 由后端 `TodoItem.level` 下发，缺省时用这里的兜底；
  //    铃铛的 `todoTagType()` 已把 `DANGER → danger(红)` / `WARN → warning(橙)` / 其余 `primary(蓝)`
  //    ⇒ 兜底只需**如实带上文档标注的级别**，不需要新造视觉体系。
  // 3. **`AFTER_SALE_VERIFY_PENDING` 的深链不是文档原文**：文档 §二 建议路由写的是 `/aftersale`，
  //    但 admin 侧**没有**这个路由（已全仓检索：`admin/src` 下 0 处 `/aftersale`），
  //    实际路由是 `/after-sale`（`router/index.ts` 的 `path: 'after-sale'`，菜单名「售后管理」）。
  //    照抄文档会得到一条"点了没反应"的死链 ⇒ 这里按**仓内真实路由**兜底（同 `DELIVERY_IN_TRANSIT_TOO_LONG` 等）。
  DELIVERY_IN_TRANSIT_TOO_LONG: {
    label: '同城在途超时',
    route: '/delivery',
    level: 'WARN',
  },
  RETURN_REJECTED_PENDING: {
    label: '退货被拒收待处理',
    route: '/delivery',
    level: 'WARN',
  },
  // `AFTER_SALE_VERIFY_PENDING` 的深链不是文档原文：文档 §二 建议路由写的是 `/aftersale`，
  // 但 admin 侧**没有**这个路由（已全仓检索：`admin/src` 下 0 处 `/aftersale`），实际路由是
  // `/after-sale`（`router/index.ts` 的 `path: 'after-sale'`，菜单名「售后管理」）。
  // ⚠️ 照抄文档会得到一条"点了没反应"的死链 ⇒ 这里按**仓内真实路由**兜底。
  // （⚠️ 下面每个条目的**条目体内不要插注释**：契约 `withdraw-timeout-todo.contract.ps1` 的 §1b
  //   用「整条目」正则钉住 key + label + route + level 四件事，插一行注释就会把它撑红。）
  AFTER_SALE_VERIFY_PENDING: {
    label: '售后待门店核实超时',
    route: '/after-sale',
    level: 'WARN',
  },
  // 已退款但返货未验收 ⇒ 钱已出、货没回，文档定级 **DANGER**（红）。
  RETURN_GATE_LEAK_SUSPECT: {
    label: '退货闸门漏网（已退款但返货未验收）',
    route: '/delivery',
    level: 'DANGER',
  },
}

/**
 * 单条待办归一化：**后端字段优先**，缺 `label` / `route` / `level` 时用
 * {@link TODO_ITEM_FALLBACKS} 兜底（只对兜底表里登记过的键有兜底，其余键保持原样）。
 *
 * ⚠️ `label` 统一过一遍 {@link sanitizeBonusText}（本项目口径：后端文案在**展示层**归一化为「红包」，
 * 见 `CLAUDE.md` §七）—— 2026-10-09 实测 dev 的 `DIVIDEND_CLAWBACK_MISSING` 下发的 label 仍是旧业务词，
 * 铃铛会把它原样显示出来。这是**归一化后端文案**，不是改写文案语义（无旧词时是恒等变换）。
 */
function normalizeTodoItem(value: unknown): TodoItem {
  const row = (value || {}) as Partial<TodoItem>
  const key = String(row.key ?? '')
  const fallback = TODO_ITEM_FALLBACKS[key]
  const count = Number(row.count)
  return {
    key,
    label: sanitizeBonusText(String(row.label ?? '')) || fallback?.label || key,
    // ⚠️ 只认后端数字；非法值按 0（0 的项页面本来就不渲染）—— 绝不编一个非 0 的数量
    count: Number.isFinite(count) ? count : 0,
    route: String(row.route ?? '') || fallback?.route || '',
    level: (row.level as TodoLevel | undefined) ?? fallback?.level,
  }
}

interface TodoResponse {
  code: number
  message: string
  data?: TodoSummary | null
  success?: boolean
}

/**
 * 查询后台待办汇总（右上角铃铛）。
 * - 中控 + 商户后台共用同一接口，**返回内容由后端按登录角色过滤**（权限不足的类型整项不返回）；
 * - `count` 与对应列表页筛选条件同源 → 「徽标数字 = 点进去的条数」；
 * - 建议 30~60s 轮询；**失败时不报错**（不显示徽标、下拉显示「暂无待办」）。
 */
export async function getTodoSummary(): Promise<TodoSummary> {
  const response = await request.get<TodoResponse>('/api/admin/todo/summary')
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || '待办汇总查询失败')
  const data = result.data
  return {
    total: Number(data?.total || 0),
    // ⚠️ 逐条归一化：后端给了 label/route/level 就用后端的；只有兜底表里登记过的键在后端漏字段时才兜底
    items: Array.isArray(data?.items) ? data.items.map(normalizeTodoItem) : [],
  }
}
