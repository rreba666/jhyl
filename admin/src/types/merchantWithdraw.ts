/**
 * 商户提现审核（平台财务端）类型定义。
 * 契约来源：`docs/商户提现-前端开发文档-2026-09-22.md` §3（财务接口 7 条）+ §4（状态机）+
 * `api_doc.json`（`MerchantWithdrawOrderEntity` / `MerchantWithdrawReviewDTO` / `PageResultMerchantWithdrawOrderEntity`）。
 * 口径来源：`docs/商户结算与提现-设计与口径-2026-09-22.md` §3（金额不变量）。
 *
 * ⚠️ 与既有「提现审核」`/withdraw`（C 端**用户**提现，`AdminWithdrawVO`）**是两套完全不同的业务**：
 * 本文件为「商户提现」（`merchant_withdraw_order`，商家按发票申请提现），字段名不可跨用。
 */

/** 分页返回体（复用公共分页结构）。 */
import type { PaginationResult } from './common'

/**
 * 商户提现单状态（与后端 `merchant_withdraw_order.status` 一致）。
 * `PENDING_REVIEW` 待财务审核 / `APPROVED` 待打款 / `SUCCESS` 已打款 / `REJECTED` 已驳回 / `FAILED` 打款失败。
 */
export const MERCHANT_WITHDRAW_STATUS = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  SUCCESS: 'SUCCESS',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const

/** 状态取值联合类型。 */
export type MerchantWithdrawStatus = (typeof MERCHANT_WITHDRAW_STATUS)[keyof typeof MERCHANT_WITHDRAW_STATUS]

/**
 * 一条商户提现单（后端 `MerchantWithdrawOrderEntity`）。
 * ⚠️ `invoiceImages` 后端**当前返回 JSON 字符串**（如 `"[\"https://…\"]"`），
 * 由 `api/merchantWithdraw.ts` 统一解析成数组后再交付页面（页面只吃数组）。
 */
export interface MerchantWithdrawOrder {
  /** 主键 ID（BIGINT，统一按字符串处理，避免大整数精度丢失）。 */
  id: string
  /** 提现单号（业务主键，四个操作接口路径都用它）。 */
  withdrawNo: string
  /** 结算主体（品牌）ID。 */
  merchantId: string
  /** 主体类型（当前恒为 `MERCHANT`）。 */
  subjectType: string
  /** 申请人（店员）ID；商家端小程序自主申请时为 null。 */
  applyStaffId: string | null
  /** 申请人（C 端用户）ID；PC 商家账号申请时为 null。 */
  applyUserId: string | null
  /** 申请人名称（列表/详情展示用）。 */
  applyName: string
  /** 申请提现金额 —— 三数核对的数字 ③。 */
  amount: number
  /** 商家填写的发票对应金额（后端已强校验 == `amount`，此处仅作对照展示）。 */
  invoiceAmount: number
  /** 发票号（选填，财务核验辅助）。 */
  invoiceNo: string | null
  /** 发票图片 URL 列表（1~6 张）—— 三数核对的数字 ①（人工看票面金额）。 */
  invoiceImages: string[]
  /** **提交时**的可提现余额快照（防止审核期间余额变动造成误判）—— 三数核对的数字 ②。 */
  balanceSnapshot: number
  /** 收款方式：`WECHAT` 微信 / `BANK_CARD` 银行卡。 */
  payeeType: string
  /** 收款人姓名（财务线下转账核对用）。 */
  payeeName: string
  /** 收款账号：微信号 / 手机号 / 银行卡号（**人工打款的依据**）。 */
  payeeAccount: string
  /** 收款码图片 URL（选填）。 */
  payeeQrUrl: string | null
  /** 当前状态。 */
  status: MerchantWithdrawStatus | string
  /** 审核人管理员 ID；未审核为 null。 */
  reviewerAdminId: string | null
  /** 审核时间；未审核为 null。 */
  reviewTime: string | null
  /** 审核意见 / 驳回原因 / 打款失败原因。 */
  reviewRemark: string | null
  /** 打款流水号（确认打款时回填，便于对账）。 */
  payNo: string | null
  /** 打款回单图片 URL。 */
  payVoucherUrl: string | null
  /** 打款完成时间（`SUCCESS` 才有值）。 */
  paidAt: string | null
  /** 申请时间（列表按此倒序）。 */
  createTime: string
  /** 最后更新时间。 */
  updateTime: string | null
}

/** 列表查询参数（`GET /api/admin/merchant-withdraw/list`，全部可选、组合生效）。 */
export interface MerchantWithdrawQuery {
  /**
   * 状态筛选：**多值英文逗号分隔**（如 `PENDING_REVIEW` / `SUCCESS,FAILED,REJECTED`）；不传 = 全部。
   * 页面默认只传 `PENDING_REVIEW`（财务待办口径）。
   */
  status?: string
  /** 关键词：匹配 提现单号 / 申请人 / 收款人姓名 / 收款账号。 */
  keyword?: string
  /** 页码，从 1 开始。 */
  page: number
  /** 每页条数。 */
  size: number
}

/** 列表分页结果（`page` / `pageSize` 以后端返回为准，缺失时回退请求参数）。 */
export type MerchantWithdrawPage = PaginationResult<MerchantWithdrawOrder> & { page: number; pageSize: number }

/**
 * 待办汇总（`GET /api/admin/merchant-withdraw/summary`）。
 * 后端用 `Map<String,Object>` 返回，字段名以文档示例为准，前端一律按可空/可缺失处理。
 */
export interface MerchantWithdrawSummary {
  /** 待财务审核（`PENDING_REVIEW`）的提现单笔数。 */
  pendingCount: number
  /** 待财务审核的提现单金额合计。 */
  pendingAmount: number
}

/**
 * 审核 / 打款请求体（四个 PUT 共用后端 `MerchantWithdrawReviewDTO`）。
 * ⚠️ 驳回 `reject` 时 `remark` **必填**（后端强校验），页面必须在提交前拦住。
 */
export interface MerchantWithdrawReviewPayload {
  /** 审核意见 / 驳回原因 / 打款失败原因。 */
  remark?: string
  /** 打款流水号（确认打款时建议填写，便于对账）。 */
  payNo?: string
  /** 打款回单图片 URL（选填；先走上传接口拿 URL）。 */
  payVoucherUrl?: string
}
