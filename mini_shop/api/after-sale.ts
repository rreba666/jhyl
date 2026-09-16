import { request } from '@/utils/request'

/** 售后单记录（对应 AfterSaleVO）。 */
export interface AfterSaleRecord {
  /** 售后单 ID（Long，后端 JSON 序列化为字符串）。 */
  id: string
  /** 售后单号（AS 开头）。 */
  afterSaleNo: string
  /** 关联订单 ID（字符串）。 */
  orderId: string
  /** 关联订单号。 */
  orderNo: string
  /** 售后类型：1=仅退款，2=退货退款。 */
  type: number
  /** 售后类型描述。 */
  typeDesc: string
  /** 申请原因。 */
  reason: string
  /** 退款金额（元）。 */
  refundAmount: number
  /** 售后单状态：0=待审核,1=已驳回,2=退款中,3=已退款,4=待寄回,5=待收货。 */
  status: number
  /** 状态描述。 */
  statusDesc: string
  /** 驳回原因（审核驳回/质检不通过时返回）。 */
  rejectReason?: string | null
  /** 提交时间。 */
  createTime: string
  /** 最近更新时间。 */
  updateTime?: string | null
}

/** 售后单分页结果。 */
export interface AfterSalePageResult {
  total: number
  list: AfterSaleRecord[]
  page: number
  pageSize: number
}

/** 分页查询当前用户的售后单列表，按提交时间倒序。 */
export function getAfterSaleList(page = 1, pageSize = 10): Promise<AfterSalePageResult> {
  return request<AfterSalePageResult>({
    url: `/api/after-sale/list?page=${encodeURIComponent(String(page))}&pageSize=${encodeURIComponent(String(pageSize))}`,
    method: 'GET',
  })
}
