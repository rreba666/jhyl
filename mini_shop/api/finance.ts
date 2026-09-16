import { request } from '@/utils/request'

/**
 * 财务流水（C端「我的资金明细」）
 * ------------------------------------------------------------
 * 依据：隆平后端 api_doc.json -> GET /api/v2/finance/flows
 * 分页返回当前用户全部资金变动，可按业务类型/方向过滤。
 * 资金明细归 basic 模块：停用 wallet 后仍可查看余额与流水（见 docs/plan 口径）。
 */

/** 财务流水（对应 FinanceFlowVO）。 */
export interface FinanceFlow {
  /** 流水号 */
  flowNo: string
  /** 业务类型：ORDER_PAY/ORDER_REFUND/WITHDRAW/WITHDRAW_FAIL_RETURN/TRANSFER_OUT/TRANSFER_IN/CONVERT/PROMOTION_INCOME/BONUS_INCOME/PROMOTION_REVOKE */
  bizType: string
  /** 业务类型中文描述（如「订单支付」） */
  bizTypeDesc: string
  /** 方向：1=收入, 2=支出 */
  direction: number
  /** 方向描述：收入/支出 */
  directionDesc: string
  /** 账户：BALANCE/PROMOTION/BONUS/WECHAT */
  accountType: string
  /** 变动金额（元） */
  amount: number
  /** 变动后余额快照；余额类有值，WECHAT 类为 null（提现申请不留余额快照） */
  balanceAfter: number | null
  /** 关联单号：订单号/提现单号/转账单号 */
  bizNo: string
  /** 备注 */
  remark: string
  /** 发生时间 */
  createTime: string
}

/** 财务流水分页结果（对应 PageResultFinanceFlowVO）。 */
export interface FinanceFlowPageResult {
  /** 符合条件的总记录数。小程序用 ceil(total/pageSize) 算总页数 */
  total: number
  /** 当前页数据；无数据时为空数组 [] */
  list: FinanceFlow[]
  /** 当前页码，从 1 开始 */
  page: number
  /** 每页大小 */
  pageSize: number
}

export interface FinanceFlowQuery {
  /** 业务类型过滤，缺省为全部 */
  bizType?: string
  /** 方向过滤：1=收入, 2=支出；缺省为全部 */
  direction?: number
  /** 页码 */
  page?: number
  /** 每页条数 */
  pageSize?: number
}

/** 使用 uni-app 兼容方式构造查询字符串，避免依赖浏览器 Web API。 */
function buildQuery(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
}

/** 分页获取当前用户的财务流水（C端我的资金明细）。需登录，未登录走 401 由统一层处理。 */
export function getFinanceFlows(params: FinanceFlowQuery = {}): Promise<FinanceFlowPageResult> {
  const query = buildQuery({
    bizType: params.bizType,
    direction: params.direction,
    page: params.page || 1,
    pageSize: params.pageSize || 10,
  })
  return request<FinanceFlowPageResult>({ url: `/api/v2/finance/flows?${query}`, method: 'GET' })
}
