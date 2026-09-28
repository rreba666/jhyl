/**
 * 微信小程序订阅消息 —— **商家侧**引导工具（2026-09-28 接入）。
 *
 * 依据：后端《前端对接说明-商家端通知与微信提示-2026-09-28.md》。
 *
 * ⚠️ 三条铁律（踩了就不生效或不礼貌）：
 *  1. **必须在用户点击手势的同步链路里调用** —— 放进 `await` / `setTimeout` 之后会直接 `fail`；
 *     所以本文件导出的函数只能写在 `@click` 处理函数的**最前面**，不要等接口回来再调；
 *  2. 微信限制：**一次调用最多 3 个**模板 ID；
 *  3. **不要在本地维护"还剩几条授权"** —— 微信不提供额度查询，客户端也记不准。
 *
 * ⚠️ 模板 ID 现状（2026-09-28）：后端 `delivery.notify.template-ids` 里**只配了
 * `MERCHANT_CANCEL_REQUESTED`**，而 `NEW_ORDER` / `ACCEPT_TIMEOUT` / `EXCEPTION` **尚未配置**。
 * ⇒ 因此下面这张表**故意留空**：留空时**不调用微信接口、也不提示用户**（避免"授权了却收不到"的误解）。
 * ⇒ 运营在微信公众平台申请到模板后，**只改这张表**即可生效，无需动其它代码。
 */

/** 商家侧模板 ID 配置表（留空 = 该场景暂不引导订阅）。 */
export const MERCHANT_TMPL_IDS = {
  /** 有新订单（待接单）。 */
  NEW_ORDER: '',
  /** 接单超时提醒。 */
  ACCEPT_TIMEOUT: '',
  /** 配送异常（需商家介入）。 */
  EXCEPTION: '',
  /** 用户提交取消申请（后端已配模板，拿到 ID 后可填这里用于引导）。 */
  CANCEL_REQUESTED: '',
} as const

export type MerchantSubscribeScene = keyof typeof MERCHANT_TMPL_IDS

/** 微信限制：一次调用最多 3 个模板。 */
const MAX_TMPL_PER_CALL = 3

/**
 * 本次会话内已被**拒绝/封禁**的场景。
 * ⚠️ 只是"别再反复弹"的礼貌性去重，**不是**授权额度记录（额度客户端记不准，见文件头第 3 条）。
 */
const rejectedScenes = new Set<MerchantSubscribeScene>()

/**
 * 引导商家订阅消息（**必须在点击手势的同步链路里调用**）。
 *
 * 以下情况一律**静默跳过**，不打扰用户：
 * - 该场景模板 ID 尚未配置（当前四个都未配）；
 * - 该场景本次会话内已被拒绝/封禁过；
 * - 非微信端 / 基础库不支持。
 *
 * 用户在弹窗里点了「拒绝」或已被「封禁」时，会**引导去设置页开启**（而不是提示"稍后重试"）。
 */
export function requestMerchantSubscribe(scenes: MerchantSubscribeScene[]): void {
  // ① 过滤：未配置模板的场景 + 本次会话已被拒的场景
  const ids = scenes
    .filter((scene) => !rejectedScenes.has(scene))
    .map((scene) => MERCHANT_TMPL_IDS[scene])
    .filter((id): id is string => !!id)
    .slice(0, MAX_TMPL_PER_CALL)

  // ⚠️ 全部未配置 ⇒ 直接返回，**不调用** wx.requestSubscribeMessage
  if (!ids.length) return

  // ② 非微信端跳过
  // @ts-ignore 微信小程序 API（uni-app 下用 wx 原生）
  const wxApi = typeof wx !== 'undefined' ? wx : null
  if (!wxApi || typeof wxApi.requestSubscribeMessage !== 'function') return

  // ③ 同步调用（务必保持在本函数的同步流程里，不要包 Promise/await）
  wxApi.requestSubscribeMessage({
    tmplIds: ids,
    success: (res: Record<string, string>) => {
      const blockedScenes: MerchantSubscribeScene[] = []
      ids.forEach((id) => {
        const scene = scenes.find((item) => MERCHANT_TMPL_IDS[item] === id)
        if (!scene) return
        const state = res?.[id]
        if (state === 'accept') {
          rejectedScenes.delete(scene)
        } else if (state === 'reject' || state === 'ban') {
          rejectedScenes.add(scene)
          blockedScenes.push(scene)
        }
      })
      // 有被拒绝/封禁的 ⇒ 引导去设置页（⚠️ 文案不要写"稍后重试"）
      if (blockedScenes.length) {
        uni.showModal({
          title: '开启微信通知',
          content: '你已关闭微信通知，可能会漏掉新订单提醒。可前往「设置 → 订阅消息」重新开启。',
          confirmText: '去设置',
          cancelText: '暂不',
          success: (result) => {
            if (result.confirm) uni.openSetting({})
          },
        })
      }
    },
    fail: (err: { errMsg?: string }) => {
      // 常见原因：不在点击手势中调用、基础库过低 —— 留痕便于排查（不打扰用户）
      console.warn('[subscribe] 订阅授权失败：', err?.errMsg || err)
    },
  })
}

/** 清空"已拒绝"去重记录（例如用户重新登录/绑定微信后允许再引导一次）。 */
export function resetMerchantSubscribeMemory(): void {
  rejectedScenes.clear()
}
