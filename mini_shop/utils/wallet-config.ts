import developmentEnv from '../.env?raw'
import productionEnv from '../.env.production?raw'

function readEnvValue(source: string, key: string): string {
  const line = source.split(/\r?\n/).find((item) => item.trim().startsWith(`${key}=`))
  return line ? line.trim().slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '') : ''
}

const envSource = import.meta.env.MODE === 'production' ? productionEnv : developmentEnv

/** 开发环境允许更小金额，线上保持 1。 */
export const WITHDRAW_MIN_AMOUNT = Number(readEnvValue(envSource, 'VITE_WALLET_WITHDRAW_MIN_AMOUNT') || '1')

/** 余额转赠仍保持 1 的最小金额。 */
export const TRANSFER_MIN_AMOUNT = 1

/** 微信商家转账「免确认收款」商户号，需与后端 wx.pay.mch-id 一致。 */
export const MERCHANT_TRANSFER_MCH_ID = readEnvValue(envSource, 'VITE_MERCHANT_TRANSFER_MCH_ID')

/** 小程序 AppID，需与后端 wx.pay.app-id 一致。 */
export const MERCHANT_TRANSFER_APP_ID = readEnvValue(envSource, 'VITE_MERCHANT_TRANSFER_APP_ID')
