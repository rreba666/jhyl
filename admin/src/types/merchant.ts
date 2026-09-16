/** 商户（品牌）状态：0=待审核, 1=启用, 2=禁用。 */
export type MerchantStatus = 0 | 1 | 2

/** 商户（品牌商家）实体（后端 MerchantVO）。id 为 long，前端按 string 处理。 */
export interface MerchantVO {
  id: string
  brandId: string
  brandName: string
  contactName: string
  contactPhone: string
  status: MerchantStatus
  remark: string
  /** 门店数（列表接口含）。 */
  shopCount?: number
  createTime?: string
}

/** 商户分页结果。 */
export interface MerchantPageResult {
  total: number
  list: MerchantVO[]
  page: number
  pageSize: number
}

/** 商户列表查询参数。 */
export interface MerchantFilters {
  keyword: string
  status: '' | MerchantStatus
}

/** 新增/编辑商户请求体。 */
export interface MerchantCreateDTO {
  brandId?: string
  brandName: string
  contactName?: string
  contactPhone?: string
  remark?: string
}

/** 商户接口统一响应结构。 */
export interface MerchantResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
