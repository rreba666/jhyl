import { request } from '@/utils/request'

/**
 * 提现银行卡（C 端）接口层。
 *
 * 后端接口（`api_doc.json` tag「提现银行卡」，controller `UserBankCardController`）：
 * - GET    /api/user/bank-card/list       银行卡列表（只返回脱敏卡号，默认卡在前）
 * - POST   /api/user/bank-card            绑卡（后端校验卡号 Luhn + **持卡人必须与实名一致**；第一个自动设为默认）
 * - PUT    /api/user/bank-card/{id}       修改（复用绑卡入参 `BindDTO`）
 * - DELETE /api/user/bank-card/{id}       解绑
 * - PUT    /api/user/bank-card/{id}/default  设为默认卡
 *
 * ⚠️ 与「实名认证里填的银行卡号」的关系（2026-09-22 核对）：
 * `RealnameVerifySheet` 里的 `bankCardNo/bankPhone` 是**实名认证接口的附属字段**（后端只记录、不核验），
 * 提现时若不带 `bankCardId`，后端就用那份实名资料里的卡号；
 * 本模块管的是**独立银行卡表**（可多张、可切换默认），提现请求带 `bankCardId` 时优先用它。
 * 两条链路并存，不是二选一。
 */

/** 银行卡视图（对应后端 `BankCardVO`，**只含脱敏卡号**，前端拿不到完整卡号）。 */
export interface BankCardVO {
  /** 银行卡 ID（int64）。 */
  id: number
  /** 银行名称。 */
  bankName: string
  /** 脱敏卡号，如 `6222 **** **** 0123`。 */
  cardNoMasked: string
  /** 持卡人姓名。 */
  holderName: string
  /** 银行预留手机号。 */
  phone?: string
  /** 是否默认卡：1=默认，0=非默认。 */
  isDefault?: number
}

/** 绑卡 / 修改银行卡入参（对应后端 `BindDTO`，bankName/cardNo/holderName 必填）。 */
export interface BankCardBindDTO {
  bankName: string
  /** 完整卡号，仅提交时使用，不在本地缓存。 */
  cardNo: string
  /** 持卡人姓名，后端会校验与实名认证一致。 */
  holderName: string
  /** 银行预留手机号（选填）。 */
  phone?: string
  /** 1 = 设为默认卡。 */
  isDefault?: number
}

/** 查询当前用户已绑定的银行卡（默认卡在前，卡号已脱敏）。 */
export function getBankCardList(): Promise<BankCardVO[]> {
  return request<BankCardVO[]>({ url: '/api/user/bank-card/list', method: 'GET' })
}

/** 绑定一张银行卡。 */
export function bindBankCard(data: BankCardBindDTO): Promise<BankCardVO> {
  return request<BankCardVO>({ url: '/api/user/bank-card', method: 'POST', data })
}

/** 修改已绑定的银行卡信息。 */
export function updateBankCard(id: number, data: BankCardBindDTO): Promise<void> {
  return request<void>({ url: `/api/user/bank-card/${encodeURIComponent(String(id))}`, method: 'PUT', data })
}

/** 解绑银行卡。 */
export function removeBankCard(id: number): Promise<void> {
  return request<void>({ url: `/api/user/bank-card/${encodeURIComponent(String(id))}`, method: 'DELETE' })
}

/** 把指定银行卡设为默认。 */
export function setDefaultBankCard(id: number): Promise<void> {
  return request<void>({ url: `/api/user/bank-card/${encodeURIComponent(String(id))}/default`, method: 'PUT' })
}

/** 设为默认卡：1=默认，0=非默认（判断口径与后端一致）。 */
export function isDefaultBankCard(card: BankCardVO): boolean {
  return Number(card.isDefault || 0) === 1
}

/** 取默认卡；没有默认卡时返回列表第一张（后端已按默认卡在前排序）。 */
export function findDefaultBankCard(cards: BankCardVO[]): BankCardVO | null {
  if (!cards || !cards.length) return null
  return cards.find(isDefaultBankCard) || cards[0]
}

/** 银行卡列表变化（绑定 / 解绑 / 设为默认）时广播，提现页据此刷新已选卡。 */
export const BANK_CARDS_CHANGED_EVENT = 'bank-card:changed'

/** 在提现页选定某张银行卡时广播，载荷是选中的卡片（`null` 表示清空选择）。 */
export const BANK_CARD_SELECTED_EVENT = 'bank-card:selected'

/**
 * 常用银行名称候选：后端 `bankName` 是自由文本，这里提供常见银行让用户少打字。
 * 只作为选择器候选，用户仍可手动输入其它银行名。
 */
export const COMMON_BANK_NAMES: string[] = [
  '中国工商银行',
  '中国农业银行',
  '中国银行',
  '中国建设银行',
  '交通银行',
  '中国邮政储蓄银行',
  '招商银行',
  '浦发银行',
  '中信银行',
  '中国民生银行',
  '兴业银行',
  '平安银行',
  '广发银行',
  '华夏银行',
  '中国光大银行',
  '北京银行',
  '上海银行',
  '农村商业银行',
  '农村信用合作社',
]
