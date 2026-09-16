import { request } from '@/utils/request'

/** 首店信息（入驻必填）。 */
export interface MerchantApplyShopDTO {
  name: string
  address?: string
  province?: string
  city?: string
  district?: string
  latitude?: number
  longitude?: number
  mainBusiness?: string
}

/** 入驻申请请求体。 */
export interface MerchantApplyDTO {
  /** 品牌名称（必填）。 */
  brandName: string
  contactName?: string
  contactPhone?: string
  /** 首店（必填）。 */
  shop: MerchantApplyShopDTO
  /** 营业执照图 URL。 */
  licenseImage?: string
  remark?: string
}

/** 申请单状态：0 待审核 / 1 已通过 / 2 已驳回。 */
export type MerchantApplyStatus = 0 | 1 | 2

/** 我的入驻申请。 */
export interface MerchantApplyVO {
  applyId?: number
  merchantId?: number
  shopId?: number
  status: MerchantApplyStatus
  statusText?: string
  brandName?: string
  shopName?: string
  /** 审核意见：**仅 status=2（已驳回）有值**，内容即驳回原因；其他状态为 null。 */
  auditRemark?: string
  /** 上一次被驳回的原因（驳回后重新提交、status=0 时仍返回），无驳回历史为 null。 */
  previousRejectReason?: string
  /** 客服是否已发号（工号+密码都已设才为 true）。 */
  backendAccountIssued?: boolean
  accountUsername?: string
  accountBound?: boolean
  applyTime?: string
  auditTime?: string
}

/** 提交入驻申请（需 C 端登录态）。重复提交 → code 7315「您有正在审核中的入驻申请」。 */
export function submitMerchantApply(payload: MerchantApplyDTO): Promise<MerchantApplyVO> {
  return request<MerchantApplyVO>({ url: '/api/merchant/apply', method: 'POST', data: payload })
}

/** 我的申请（无则返回 null），用于页面状态机。 */
export function getMyMerchantApply(): Promise<MerchantApplyVO | null> {
  return request<MerchantApplyVO | null>({ url: '/api/merchant/apply/my', method: 'GET' })
}
