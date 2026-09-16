import { request } from '@/utils/request'

/** 实名认证状态，只保留后端返回的脱敏身份信息。 */
export interface RealnameStatus {
  verified: boolean
  maskedName: string | null
  maskedCertNo: string | null
}

/** 二要素实名认证请求，仅在本次核验请求中使用完整身份信息。 */
export interface RealnameVerifyDTO {
  certName: string
  certNo: string
  idCardFrontUrl?: string
  idCardBackUrl?: string
  bankCardNo?: string
  bankPhone?: string
}

export interface RealnameOcrDTO {
  image?: string
  url?: string
}

/** OCR 结果透传对象，具体字段由实名认证服务返回，前端只读取姓名和证件号候选字段。 */
export interface RealnameOcrVO {
  success: boolean
  data?: unknown
  message?: string
}

/** 查询当前用户的实名认证状态。 */
export function getRealnameStatus(): Promise<RealnameStatus> {
  return request<RealnameStatus>({ url: '/api/realname/status', method: 'GET' })
}

/** 提交姓名和身份证号进行实名认证。 */
export function verifyRealname(payload: RealnameVerifyDTO): Promise<RealnameStatus> {
  return request<RealnameStatus>({ url: '/api/realname/verify', method: 'POST', data: payload })
}

/** 识别身份证正面图片文字，不执行实名认证。 */
export function ocrRealname(payload: RealnameOcrDTO): Promise<RealnameOcrVO> {
  return request<RealnameOcrVO>({ url: '/api/realname/ocr', method: 'POST', data: payload })
}
