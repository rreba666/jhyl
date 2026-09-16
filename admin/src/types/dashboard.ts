/** 后台产品购买记录。接口只返回已付款且未退款的有效订单明细。 */
export interface SalesRecord {
  orderNo: string
  productName: string
  nickname: string
  quantity: number
  price: number
  subtotal: number
  createTime: string
  payTime?: string
  status: number
  statusDesc: string
}

export interface SalesRecordQueryParams {
  productName?: string
}

export type DashboardTimeRange = '7' | '30' | '90' | 'all'

export interface ProductSales {
  name: string
  quantity: number
  amount: number
}

export interface DailySales {
  date: string
  quantity: number
  amount: number
}

export interface DashboardAnalytics {
  totalRecords: number
  totalQuantity: number
  totalAmount: number
  averagePrice: number
  productSales: ProductSales[]
  dailySales: DailySales[]
}

export interface DashboardResponse<T = unknown> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
