/** 系统配置实体。 */
export interface SysConfig {
  id: string
  configKey: string
  configValue: string
  remark: string
  createTime: string
  updateTime: string
  delFlag: number
}

/** 系统配置保存参数。 */
export interface SysConfigSaveDTO {
  configKey: string
  configValue: string
  remark?: string
}

/** 红包上限倍率配置。 */
export interface DividendCap {
  multiplier: number
  remark: string
}

/** 红包上限倍率保存参数。 */
export interface DividendCapSaveDTO {
  multiplier: number
  remark?: string
}

/** 商品资金比例配置。 */
export interface ProfitRatesConfig {
  promotionRate: number
  bonusPoolRate: number
  remark: string
}

/** 商品资金比例保存参数。 */
export interface ProfitRatesSaveDTO {
  promotionRate: number
  bonusPoolRate: number
  remark?: string
}

export interface WithdrawRulesConfig {
  minAmount: number
  dailyAmountLimit: number
  dailyCountLimit: number
  feeRate: number
  testUserMinAmount: number
  testUserId: number | null
  testSkipLock: boolean
  maxConcurrent: number
  frozenLimit: number
  /**
   * 微信零钱提现总开关（后端 `WithdrawRuleV2VO` / `WithdrawRuleV2SaveDTO` 字段）。
   * ⚠️ 2026-09-27 补：此前前端类型、读取、提交三处**全都缺这两个开关** ⇒ 保存提现规则时
   * 请求体里不带它们。后端该 DTO 的 `required` 为空、api_doc 也无说明，**无法判定是"缺省不改"
   * 还是"覆盖为 false"** —— 若为后者，运营点一次保存就会把两种提现方式一起关停、C 端提现彻底堵死。
   */
  wechatBalanceEnabled: boolean
  /** 银行卡提现总开关（同上，务必与 wechatBalanceEnabled 一起读写，不可只读不写）。 */
  bankCardEnabled: boolean
  remark: string
}

export type WithdrawRulesSaveDTO = WithdrawRulesConfig

/** 兼容旧版单项比例类型。 */
export interface FundRateConfig {
  rate: number
  remark: string
}

/** 兼容旧版单项比例保存参数。 */
export interface FundRateSaveDTO {
  rate: number
  remark?: string
}
