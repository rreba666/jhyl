import { request } from './request'
import { resolveDownloadFilename, saveBlob } from '@/utils/download'

/**
 * 结算资金报表 + 渠道对账（P7 / P8，2026-10-02 新增）。
 *
 * ## P7 渠道账单对账
 * - `POST /api/admin/ledger/channel-reconcile`：把微信渠道账单与本地资金事实**逐笔比对**，
 *   差异**只落异常台账 + 告警，绝不修改本地数据**（`billBody` 可省略 ⇒ 后端自动下载 v3 tradebill）；
 * - `GET  /api/admin/ledger/channel-anomalies?billDate=`：差异明细（**最多 500 条**，新记录在前），**只读**。
 * ⚠️⚠️ **「渠道无账单」是正常情况**（后端返回 `code=1000`）——
 *    例如当天微信还没出账、或该日无交易 ⇒ 界面必须按**中性信息**展示，**不能**弹红色错误。
 *
 * ## P8 资金日报 / 月报
 * - `GET /api/admin/ledger/fund-report/daily?from=&to=`：按自然日汇总（**不传默认最近 30 天**）；
 * - `GET /api/admin/ledger/fund-report/monthly?year=`：按自然月汇总（**由日报汇总而来**，保证一致）；
 * - `GET /api/admin/ledger/fund-report/export?from=&to=`：日报 CSV（UTF-8 BOM，Excel 直接打开不乱码）。
 * ⚠️⚠️ **后端会补齐 0 值日**（没有交易的日子也返回一行 0）⇒ 前端**不要**自己补/跳过空日，
 *    也**不要**把日报累加成月报（月报由后端汇总，前端累加会与后端口径漂移）。
 */

/** 后端统一响应体。 */
interface ReportsResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

/** 业务错误（带后端 code，便于识别"渠道无账单"这类**正常**情况）。 */
export class ReportsApiError extends Error {
  code: number
  constructor(message: string, code: number) {
    super(message)
    this.name = 'ReportsApiError'
    this.code = code
  }
}

/** 校验业务码并取出 data（把 code 一并带出，供调用方区分"正常空结果"与"真错误"）。 */
function unwrap<T>(response: { data: ReportsResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) {
    throw new ReportsApiError(result.message || fallback, Number(result.code))
  }
  return result.data as T
}

// ===== P7：渠道对账 =====

/**
 * ⚠️ 「渠道无账单」的业务码。
 * 后端说明：该日渠道账单尚未生成（或当日无交易）⇒ **属正常**，界面按中性提示，**不要**弹错误。
 */
export const CHANNEL_BILL_ABSENT_CODE = 1000

/** 渠道差异类型 → 中文（⚠️ **按码匹配**，不依赖后端文案）。 */
export const CHANNEL_DIFF_LABELS: Record<string, string> = {
  /** 渠道有、本地无 ⇒ 可能漏记了一笔支付。 */
  CHANNEL_ONLY: '渠道有本地无',
  /** 本地有、渠道无 ⇒ 可能本地多记了一笔。 */
  LOCAL_ONLY: '本地有渠道无',
  /** 金额不一致 ⇒ 对不上账。 */
  AMOUNT_MISMATCH: '金额不一致',
  /** 状态不一致（如本地成功、渠道退款）。 */
  STATUS_MISMATCH: '状态不一致',
}

/** 渠道差异类型 → 中文；未知原样回显（便于发现后端新增类型）。 */
export function channelDiffLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return CHANNEL_DIFF_LABELS[key] || key
}

/** 一条渠道差异（对应后端 `ChannelAnomalyVO`；字段按契约可空处理）。 */
export interface ChannelAnomalyVO {
  /** 渠道流水号 / 本地单号（后端下发什么展示什么）。 */
  channelTradeNo?: string | null
  orderNo?: string | null
  /** 差异类型：见 {@link CHANNEL_DIFF_LABELS}。 */
  diffType?: string
  /** 本地金额（元）；渠道多出时为 null。 */
  localAmount?: number | null
  /** 渠道金额（元）；本地多出时为 null。 */
  channelAmount?: number | null
  status?: string | null
  billDate?: string | null
  remark?: string | null
}

/** 触发渠道对账。⚠️ **差异只落台账 + 告警，绝不修改本地数据**。 */
export async function reconcileChannelBill(params: { billDate?: string; billBody?: string } = {}): Promise<void> {
  const response = await request.post<ReportsResponse<null>>('/api/admin/ledger/channel-reconcile', params)
  unwrap(response, '渠道对账失败')
}

/**
 * 查询渠道差异明细（**只读，最多 500 条**）。
 *
 * ⚠️ 「渠道无账单」（`code=1000`）**不抛错**，而是返回 `billAbsent: true` ⇒
 * 调用方按**中性信息**提示（例如「该日渠道无账单，属正常情况」），而不是报错。
 */
export async function getChannelAnomalies(billDate: string): Promise<{ list: ChannelAnomalyVO[]; billAbsent: boolean }> {
  try {
    const response = await request.get<ReportsResponse<ChannelAnomalyVO[]>>('/api/admin/ledger/channel-anomalies', {
      params: { billDate },
    })
    const data = unwrap<ChannelAnomalyVO[]>(response, '渠道差异查询失败')
    return { list: Array.isArray(data) ? data : [], billAbsent: false }
  } catch (error) {
    // ⚠️ "渠道无账单"是**正常情况**：转成中性结果交给页面展示，不要冒泡成错误弹窗
    if (error instanceof ReportsApiError && error.code === CHANNEL_BILL_ABSENT_CODE) {
      return { list: [], billAbsent: true }
    }
    throw error
  }
}

// ===== P8：资金日报 / 月报 =====

/**
 * 资金日报的一天（对应后端 `FundReportDailyVO`）。
 * ⚠️ 后端**会补齐 0 值日** ⇒ 前端**不要**跳过年内无交易的日子。
 */
export interface FundReportDailyVO {
  /** 日期（`yyyy-MM-dd`）。 */
  date?: string
  /** 结算单数。 */
  statementCount?: number
  goodsAmount?: number
  commissionAmount?: number
  merchantIncome?: number
  /** 按状态分组单数。 */
  pendingCount?: number
  creditedCount?: number
  reversedCount?: number
  /** 账户资金流入 / 流出。 */
  inflowAmount?: number
  outflowAmount?: number
  /** 渠道差异数。 */
  channelDiffCount?: number
}

/** 资金月报的一个月（**由日报汇总而来**，不要再在本地累加）。 */
export interface FundReportMonthlyVO {
  /** 月份（`yyyy-MM`）。 */
  month?: string
  statementCount?: number
  goodsAmount?: number
  commissionAmount?: number
  merchantIncome?: number
  pendingCount?: number
  creditedCount?: number
  reversedCount?: number
  inflowAmount?: number
  outflowAmount?: number
  channelDiffCount?: number
}

/** 资金日报（不传 from/to 时后端默认最近 30 天）。 */
export async function getFundReportDaily(params: { from?: string; to?: string } = {}): Promise<FundReportDailyVO[]> {
  const response = await request.get<ReportsResponse<FundReportDailyVO[]>>('/api/admin/ledger/fund-report/daily', {
    params,
  })
  const data = unwrap<FundReportDailyVO[]>(response, '资金日报加载失败')
  return Array.isArray(data) ? data : []
}

/** 资金月报（`year` 不传取当前年）。 */
export async function getFundReportMonthly(year?: number): Promise<FundReportMonthlyVO[]> {
  const response = await request.get<ReportsResponse<FundReportMonthlyVO[]>>('/api/admin/ledger/fund-report/monthly', {
    params: year ? { year } : {},
  })
  const data = unwrap<FundReportMonthlyVO[]>(response, '资金月报加载失败')
  return Array.isArray(data) ? data : []
}

/**
 * 导出资金日报 CSV（UTF-8 带 BOM）。
 * ⚠️ 与列表**同一区间**（`from`/`to` 口径一致），否则"看到的"和"导出的"对不上。
 */
export async function exportFundReportCsv(params: { from?: string; to?: string } = {}): Promise<void> {
  const response = await request.get<Blob>('/api/admin/ledger/fund-report/export', {
    params,
    responseType: 'blob',
  })
  const contentType = String(response.headers['content-type'] || '')
  // ⚠️ 无权限 / 接口未上线时后端返回 JSON 而不是 CSV ⇒ 识别后抛业务文案，
  //    否则用户会下载到一个内容是报错 JSON 的 ".csv"
  if (contentType.includes('application/json')) {
    const text = await response.data.text()
    let message = '资金日报导出失败'
    try {
      message = (JSON.parse(text) as { message?: string }).message || message
    } catch {
      // 非 JSON 内容保持默认文案
    }
    throw new Error(message)
  }
  saveBlob(response.data, resolveDownloadFilename(String(response.headers['content-disposition'] || ''), 'fund-report.csv'))
}
