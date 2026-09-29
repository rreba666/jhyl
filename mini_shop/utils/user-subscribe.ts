/**
 * 微信小程序订阅消息 —— **C 端（用户侧）**引导工具（2026-09-29 新建）。
 *
 * ## 目的
 * 用户下单后需要知道**配送进度**（已支付 / 已接单 / 待取货 / 已送达）。
 * 微信订阅消息是**一次性授权**：用户不点授权，后端即便配好模板也发不出去 ——
 * 这正是后端反馈的「C 端 49 条死信、9-22 至今一次都没成功」的前端侧原因。
 *
 * ## ⚠️ 与商家端 `utils/subscribe.ts` **刻意分开**
 * 两者**场景码、模板 ID、接收人完全不同**，混用会把商家模板塞进用户授权请求里
 * （微信会直接 `Request list fail`）。**不要把两边合并成一个工具。**
 *
 * ## ⚠️ 三条硬约束（决定了本文件的设计）
 * 1. **`wx.requestSubscribeMessage` 必须在「用户点击手势」的同步链路里调用** ——
 *    `onLaunch`/`onShow`/`onLoad` 里直接调**必然 fail**。
 *    ⇒ 所以**做不到"进入小程序就自动弹授权框"**；只能"**进入首页就弹引导弹窗，
 *      用户点一下按钮即同步发起授权**"（见 `components/SubscribeGuide.vue`）。
 * 2. 微信限制：**一次调用最多 3 个模板 ID**。
 * 3. 未配置模板（`USER_TMPL_IDS` 为空 / 接口没下发）时**不要调用、也不要报 bug**。
 */

/**
 * C 端订阅模板配置。
 *
 * ⚠️ **当前为空** —— 需要后端把 C 端场景的模板 ID 下发下来（推荐加一个
 * `GET /api/notify/subscribe-config` 之类的 C 端公开接口，与商家端的
 * `/api/merchant/notify/subscribe-config` 对称）。
 *
 * 已知后端在发的 C 端场景（来自后端反馈的 49 条死信）：`PAID` / `ACCEPTED` / `READY` / `DELIVERED`
 * —— 但**微信一次最多 3 个模板**，且同一模板可覆盖多场景，所以这里用「模板 ID 数组」而不是场景映射，
 * 具体几个由后端配置决定。
 *
 * ⚠️ 留空时：`requestUserSubscribe()` 直接返回，**不弹授权框、不报错**（优雅降级）。
 */
export const USER_TMPL_IDS: string[] = []

/** 一次最多 3 个（微信硬限制）。 */
const MAX_TMPL_PER_CALL = 3

/** 本地记录：是否已经向用户弹过引导（只弹一次，避免每次进首页都打扰）。 */
const GUIDED_STORAGE_KEY = 'user_subscribe_guided'

/** 本次会话是否已发起过授权（避免同一会话重复弹微信的授权框）。 */
let requestedInSession = false

/**
 * 是否应该弹「开启配送通知」引导。
 *
 * ⚠️ 只在**首次**引导：微信订阅是**一次性授权**，理论上每次下单都该再要一次，
 * 但"每次进首页都弹引导弹窗"会变成骚扰 ⇒ 首页只引导一次，
 * 后续的授权引导应放在**下单成功 / 查看订单**等关键时机（由业务页面调用 `requestUserSubscribe`）。
 */
export function shouldGuideUserSubscribe(): boolean {
  if (!USER_TMPL_IDS.length) return false
  try {
    return !uni.getStorageSync(GUIDED_STORAGE_KEY)
  } catch {
    return true
  }
}

/** 标记「已经引导过」（用户点过开启或点过暂不，都算），之后首页不再弹。 */
export function markUserSubscribeGuided(): void {
  try {
    uni.setStorageSync(GUIDED_STORAGE_KEY, 1)
  } catch {
    // 存储失败不影响主流程：最坏情况是下次进首页再弹一次
  }
}

/**
 * 发起 C 端订阅授权（**必须在用户点击手势的同步链路里调用**）。
 *
 * 以下情况一律**静默跳过**（不打扰用户、也不误报）：
 * - 模板 ID 未配置（`USER_TMPL_IDS` 为空）；
 * - 本地没有任何可用模板；
 * - 非微信端 / 基础库不支持。
 *
 * 用户点「拒绝」或已被「封禁」时，引导去设置页开启（而不是提示"稍后重试"）。
 *
 * @param options.onFinish 授权流程结束后的回调（无论成功、拒绝还是失败），
 *   用于调用方更新 UI 或继续后续流程（例如下单后立刻引导）。
 */
export function requestUserSubscribe(options: { onFinish?: () => void } = {}): void {
  // 去重 + 过滤空值 + 遵守"一次最多 3 个"
  const ids = Array.from(new Set(USER_TMPL_IDS.filter((id) => !!id))).slice(0, MAX_TMPL_PER_CALL)
  if (!ids.length) {
    options.onFinish?.()
    return
  }

  // @ts-ignore 微信小程序 API（uni-app 下用 wx 原生）
  const wxApi = typeof wx !== 'undefined' ? wx : null
  if (!wxApi || typeof wxApi.requestSubscribeMessage !== 'function') {
    options.onFinish?.()
    return
  }

  // ⚠️ 同步调用：务必保持在本函数的同步流程里，不要包 Promise / await
  requestedInSession = true
  console.warn('[user-subscribe] 已调用 requestSubscribeMessage，等待微信弹授权框：', JSON.stringify({ tmplIds: ids }))
  wxApi.requestSubscribeMessage({
    tmplIds: ids,
    success: (res: Record<string, string>) => {
      const blocked = ids.filter((id) => {
        const state = res?.[id]
        return state === 'reject' || state === 'ban'
      })
      console.info('[user-subscribe] 授权结果：', JSON.stringify(res))
      if (blocked.length) {
        uni.showModal({
          title: '开启配送通知',
          content: '你已关闭通知，可能收不到配送进度提醒。可前往「设置 → 订阅消息」重新开启。',
          confirmText: '去设置',
          cancelText: '暂不',
          success: (result) => {
            if (result.confirm) uni.openSetting({})
          },
        })
      }
      options.onFinish?.()
    },
    fail: (err: { errMsg?: string }) => {
      // 常见原因：不在点击手势中调用、模板未配置/不属于本小程序、基础库过低
      console.warn('[user-subscribe] 订阅授权失败：', err?.errMsg || err, JSON.stringify({ tmplIds: ids }))
      options.onFinish?.()
    },
  })
}

/** 本次会话是否已发起过授权（供页面判断是否需要再引导）。 */
export function hasRequestedInSession(): boolean {
  return requestedInSession
}
