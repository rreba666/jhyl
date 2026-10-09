import { request } from './request'

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
 * 两个「提现超时」待办的**前端兜底文案与深链**（2026-10-08 新增，依据 spec §4）。
 *
 * | key | 中文 | 判据（后端） | 可见角色 | 深链 |
 * |---|---|---|---|---|
 * | `WITHDRAW_APPROVE_TIMEOUT` | 提现审核超时 | 待审核 > **4 小时**（可配 `fengling.withdraw.approve-timeout-minutes`） | 超管 + 财务 | `/withdraw?status=0`（待审核页签） |
 * | `WITHDRAW_PAYOUT_TIMEOUT` | 提现已通过待打款超时 | 已通过 > **24 小时**（可配 `fengling.withdraw.payout-timeout-minutes`） | 超管 + 财务 | `/withdraw?status=APPROVED`（交易记录页签按「打款中」过滤） |
 *
 * ## ⚠️⚠️ 三条边界（别越界）
 * 1. **数量只认后端**：这里**没有 `count`** —— 后端没返回该待办项时，前端**不显示、也不补 0**，
 *    更不会自己按"4 小时"去数一遍（那需要全量提现单，前端没有这个数据源，
 *    硬算出来的数字必然与后端不一致 ⇒ 违反"徽标数字 == 点进去的条数"）。
 * 2. **后端下发优先**：`label` / `route` / `level` 只要后端给了就用后端的，
 *    这里只在**后端没给**时兜底（后端改口径前端不用发版）。
 * 3. **只提醒、不改状态**：这两项是**建议级**待办，页面不提供"超时自动通过 / 自动打款"之类的动作。
 *
 * ⚠️ 现状（2026-10-08 核对 `api_doc.json`）：后端**尚未**把这两个 key 加进
 * `TodoItemVO.key` 的枚举与计数逻辑（快照里搜不到 `WITHDRAW_APPROVE_TIMEOUT` /
 * `WITHDRAW_PAYOUT_TIMEOUT`，可见角色清单里也只有 `WITHDRAW_AUDIT`）。
 * ⇒ 在它们上线之前，铃铛里**不会**出现这两项；本兜底**不会**凭空造出条目，只是让它们上线当天
 * 就能显示中文并跳到正确的列表（否则后端若只下发 key，铃铛里会显示英文 key 或点了没反应）。
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
}

/**
 * 单条待办归一化：**后端字段优先**，缺 `label` / `route` / `level` 时用
 * {@link TODO_ITEM_FALLBACKS} 兜底（只对已知的两个提现超时项有兜底，其余键保持原样）。
 */
function normalizeTodoItem(value: unknown): TodoItem {
  const row = (value || {}) as Partial<TodoItem>
  const key = String(row.key ?? '')
  const fallback = TODO_ITEM_FALLBACKS[key]
  const count = Number(row.count)
  return {
    key,
    label: String(row.label ?? '') || fallback?.label || key,
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
