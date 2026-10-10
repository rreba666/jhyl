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
  //    而 `withdraw-timeout-todo.contract.ps1` 明确断言「兜底表恰好 3 项」（防止随意扩张兜底面）
  //    ⇒ 本页只负责**让那个 route 落得下去**（新增 `/delivery/returns` 页面 + 路由 + 菜单 + 矩阵）。
}

/**
 * 单条待办归一化：**后端字段优先**，缺 `label` / `route` / `level` 时用
 * {@link TODO_ITEM_FALLBACKS} 兜底（只对已知的三个键有兜底，其余键保持原样）。
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
    // ⚠️ 逐条归一化：后端给了 label/route/level 就用后端的；只有「提现超时」两项在后端漏字段时兜底
    items: Array.isArray(data?.items) ? data.items.map(normalizeTodoItem) : [],
  }
}
