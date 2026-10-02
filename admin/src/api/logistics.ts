import { request } from './request'

/**
 * 物流签收兜底（P5，2026-10-03 新增）。
 *
 * ## 背景
 * ⚠️ **2026-10-03 晚口径变更**（业务定案「**不能退款才能到账**」）：物流单的**资金释放主锚点**
 * 是「**订单完成后 7 天**」；**签收时间只在"签收晚于订单完成"时起作用**（此时等「**签收 + 7 天**」，**只会更晚**）。
 * 但快递100 有时**查不到签收**、或拿到的是**估算值** ⇒ 需要中控**人工兜底**把签收补准：
 * - `GET  /api/admin/logistics/sign-pending`：列出「已发货及之后（status 2/3/4）、有运单号、
 *   **尚无签收时间**」的物流单，**按发货时间升序**（越早发货越该先看）；
 * - `GET  /api/admin/logistics/sign-pending/count`：同口径 COUNT，用于**待办角标**（建议 5~10 分钟轮询）；
 * - `PUT  /api/admin/logistics/sign-time`：人工写真实签收时间（写入后 `signTimeEstimated` 置 0，视为真实值）。
 *
 * ⚠️⚠️ **本组接口仅超管（SUPER_ADMIN）可用**（P5 §一）⇒ 前端要按角色隐藏入口，且后端会拦。
 * ⚠️ `PUT sign-time` **强制审计留痕**（记录操作人与修正值）；`code=1000` 参数非法
 *   （**不得传未来时间**）、`code=4000` 订单不存在。
 * ⚠️ `fallbackDays` **不传 = 15 天**；`pastFallbackDays = true` 只表示"发货已超过该天数"，
 *   **不代表系统已写入估算签收时间**（估算由定时任务在发货满 15 天后写入）。
 */

/** 后端统一响应体（沿用 `api/ledger.ts` 的写法）。 */
interface LogisticsResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

/** 校验业务码并取出 data。 */
function unwrap<T>(response: { data: LogisticsResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 待签收清单里的一条（对应后端 `LogisticsSignPendingVO`）。 */
export interface LogisticsSignPendingVO {
  /** 订单号（`PUT sign-time` 用它定位）。 */
  orderNo?: string
  /** 订单状态（2 已发货 / 3 已收货 / 4 已完成）。 */
  status?: number
  /** 履约门店 ID；⚠️ 物流单可能为 null。 */
  fulfillShopId?: number | null
  /** 快递公司。 */
  expressCompany?: string | null
  /** 运单号。 */
  expressNo?: string | null
  /** 发货时间（清单按它**升序**）。 */
  shipTime?: string | null
  /** 签收时间；⚠️ **为空表示还没查到签收**（本清单只会列出空的行）。 */
  signTime?: string | null
  /**
   * ⚠️ 目前**恒为 `false`**（本接口只列无签收时间的单），后端留该字段是为了"前端少改一次"
   * ⇒ 前端按**可能为 true** 处理即可，不要假设它存在。
   */
  signTimeEstimated?: boolean
  /**
   * **发货已超过兜底天数**（`fallbackDays`，默认由后端定）。
   * ⚠️ `true` 表示该单「要么刚被估算、要么需要人工介入」⇒ 界面上要**显著标出来**。
   */
  pastFallbackDays?: boolean
  /** 商品/收货人等摘要信息（后端下发什么就展示什么）。 */
  receiverName?: string | null
  receiverPhone?: string | null
  goodsSummary?: string | null
}

/** 待签收分页结果。 */
export interface LogisticsSignPendingPageResult {
  total?: number
  list?: LogisticsSignPendingVO[]
  page?: number
  pageSize?: number
}

/**
 * 查询待签收清单（分页）。
 * @param params.fallbackDays 兜底天数（用于计算 `pastFallbackDays`）；不传用后端默认
 */
export async function getSignPendingList(params: {
  page?: number
  pageSize?: number
  fallbackDays?: number
} = {}): Promise<LogisticsSignPendingPageResult> {
  const response = await request.get<LogisticsResponse<LogisticsSignPendingPageResult>>(
    '/api/admin/logistics/sign-pending',
    { params },
  )
  const data = unwrap(response, '待签收清单加载失败')
  return { total: 0, list: [], ...data }
}

/** 待签收数量（**待办角标**用；建议 5~10 分钟轮询一次）。 */
export async function getSignPendingCount(): Promise<number> {
  const response = await request.get<LogisticsResponse<number>>('/api/admin/logistics/sign-pending/count')
  // ⚠️ 后端可能返回裸数字或 `{ count: n }`，两种都兼容（返回 0 不报错，角标不该因格式差异消失）
  const data = unwrap<number | { count?: number }>(response, '待签收数量加载失败') as number | { count?: number }
  if (typeof data === 'number') return data
  return Number(data?.count || 0)
}

/**
 * 人工修正签收时间（**仅超管**）。
 *
 * ⚠️ 该时间**仅在签收晚于订单完成时**才影响资金释放（此时等「签收 + 7 天」）⇒ 填错会让释放时点算错。
 * ⚠️ 后端**强制审计留痕**；`signTime` 格式 `yyyy-MM-ddTHH:mm:ss` 且**不得是未来时间**。
 */
export async function updateSignTime(orderNo: string, signTime: string): Promise<void> {
  const response = await request.put<LogisticsResponse<null>>('/api/admin/logistics/sign-time', { orderNo, signTime })
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || '签收时间修正失败')
}
