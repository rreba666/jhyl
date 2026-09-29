import { request } from '@/utils/request'

export interface PrepayParams {
  timeStamp: string
  nonceStr: string
  package: string
  signType: string
  paySign: string
}

/** 获取微信 JSAPI 支付签名参数。 */
export function createPrepay(orderId: number | string): Promise<PrepayParams> {
  return request<PrepayParams>({ url: '/api/pay/prepay', method: 'POST', data: { orderId } })
}

/** 调起微信小程序支付收银台。 */
export function requestPayment(params: PrepayParams): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.requestPayment({
      timeStamp: params.timeStamp,
      nonceStr: params.nonceStr,
      package: params.package,
      signType: params.signType,
      paySign: params.paySign,
      success: () => resolve(),
      fail: (error) => reject(new Error(error.errMsg || '微信支付未完成')),
    })
  })
}

/** 余额支付：用钱包余额全额抵扣订单，同步完成（无微信回调）。余额不足时后端返回错误。 */
export function payByBalance(orderId: number | string): Promise<void> {
  return request<void>({ url: '/api/pay/balance', method: 'POST', data: { orderId } })
}

/**
 * 微信收银台取消后安全切换到余额支付。
 * 后端会先查询微信真实支付状态，确认未支付后释放微信占位并完成余额扣款。
 */
export function switchToBalance(orderId: number | string): Promise<void> {
  return request<void>({ url: '/api/pay/switch-to-balance', method: 'POST', data: { orderId } })
}

/**
 * **只释放通道占用、不做任何支付**（幂等）—— 2026-09-29 第十二批新增。
 *
 * 用途：用户在收银台**取消支付 / 直接返回 / 离开结算页**时调用。
 * ⚠️ 不调用的话，通道占位要等后端自动过期才释放（第十二批起统一 **2 分钟**），
 *    期间用户改用其它支付方式会撞上互斥报错（如"已选择余额支付"）。
 *
 * ⚠️ 后端幂等且**只释放占用、不会动已成功的支付** ⇒ 重复调用 / 在支付结果未知时调用都安全。
 * ⚠️ 释放失败**不要**打扰用户：最坏结果只是多等一会儿自动过期。
 */
export function releasePayChannel(orderId: number | string): Promise<void> {
  return request<void>({ url: '/api/pay/release-channel', method: 'POST', data: { orderId } })
}

/**
 * 把**余额占用**切换为**微信支付** —— 2026-09-29 第十二批新增。
 *
 * 场景：用户先选了余额支付（占了余额通道），又想改用微信。
 * ⚠️ 与 {@link switchToBalance} **互为反向**：后者是"微信未支付 ⇒ 改用余额"。
 * 后端会先确认真实占用/支付状态再切换，避免重复扣款。
 */
export function switchToWechat(orderId: number | string): Promise<void> {
  return request<void>({ url: '/api/pay/switch-to-wechat', method: 'POST', data: { orderId } })
}
