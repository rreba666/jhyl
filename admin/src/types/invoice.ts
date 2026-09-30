export type InvoiceType = 1 | 2
/**
 * 发票申请状态：0 待处理 / 1 已发送 / 2 待红冲 / 3 已驳回（终态）/ 4 已作废。
 * ⚠️ 3（已驳回）是 2026-09-30 后端新增的独立终态：后端**实际会返回 3**，
 * 但 `api_doc.json` 的契约描述里漏写了它（只写到 0/1/2/4），**不要照那份滞后的描述删掉 3**，
 * 否则驳回后的记录会落到归一化兜底分支被当成「待处理」。
 */
export type InvoiceStatus = 0 | 1 | 2 | 3 | 4

/** 后台发票申请列表记录。 */
export interface AdminInvoice {
  id: string
  userId: string
  userNickname: string
  userPhone: string
  type: InvoiceType
  personalName?: string
  companyName?: string
  taxNo?: string
  email: string
  amount: number
  orderIds: string
  status: InvoiceStatus
  statusDesc: string
  invoiceNo?: string
  adminRemark?: string
  createTime: string
  updateTime: string
}

/** 后台发票详情中的商品明细。 */
export interface AdminInvoiceOrderItem {
  orderNo: string
  productName: string
  specs?: string
  price: number
  quantity: number
  subtotal: number
}

export interface AdminInvoiceDetail extends AdminInvoice {
  orderItems: AdminInvoiceOrderItem[]
}

export interface AdminInvoiceFilters {
  status: '' | InvoiceStatus
}

export interface AdminInvoicePageResult {
  total: number
  list: AdminInvoice[]
  page: number
  pageSize: number
}

export interface AdminInvoiceProcessDTO {
  invoiceNo: string
  adminRemark?: string
}

/** 驳回发票申请请求体：驳回原因**必填**，后端写入 admin_remark 并在小程序「我的发票」对用户可见。 */
export interface AdminInvoiceRejectDTO {
  reason: string
}

/**
 * 批量删除发票申请请求体。
 *
 * ⚠️ 2026-09-30 决策：这里用 **`number[]`**，**不**沿用「id 一律 String」的约定。
 *    原因（本项目实测先例）：**后端关闭了 Jackson 的标量强制转换** ——
 *    商品多分类时 `long[]` 传字符串数组会被判「请求体格式错误」（`code=1000`，2026-09-19 实测）。
 *    契约里本接口 body 是 `{"ids":[1,2,3]}`（**int64 数组**），与其它 body 内数字数组同口径。
 * ⚠️ 精度：发票 id 是**自增主键**（当前量级两位数），远小于 `Number.MAX_SAFE_INTEGER`
 *    ⇒ `Number(id)` 不丢精度；转换处仍做 `Number.isFinite` 与**数量**兜底（见 api 层）。
 */
export interface AdminInvoiceBatchDeleteDTO {
  ids: number[]
}

export interface InvoiceResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
