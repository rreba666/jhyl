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
