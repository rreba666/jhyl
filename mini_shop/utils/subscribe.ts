/**
 * 微信小程序订阅消息 —— **商家侧**引导工具（2026-09-28）。
 *
 * 依据：后端《前端对接说明-商家端通知与微信提示》《前端对接说明-商家端订阅模板下发》。
 *
 * ⚠️ 核心约束（决定了本文件的"**预取 + 缓存**"设计）：
 *   `wx.requestSubscribeMessage` **必须在用户点击手势的同步链路里**调用
 *   —— 放进 `await` / `setTimeout` 之后会直接 `fail`（部分基础库连 errMsg 都不给）。
 *   而模板 ID 是**接口异步下发**的（`GET /api/merchant/notify/subscribe-config`，用户裁决不让前端硬编码）
 *   ⇒ 所以必须**提前把配置拉回来缓存**，点击时**同步读缓存**；缓存没就绪就静默跳过。
 *
 * ⚠️ 其它三条铁律：
 *  1. 微信限制：**一次调用最多 3 个**模板 ID；
 *  2. **`configured=false` 的场景不要引导、也不要报 bug** —— 表示运营还没在微信公众平台配模板 ID；
 *  3. **不在本地维护"还剩几条授权"**（微信不提供额度查询，客户端也记不准）。
 */

import { getMerchantSubscribeConfig, type MerchantSubscribeConfig, type MerchantSubscribeSceneConfig } from '@/api/merchant'

/** 已下发的订阅配置（模块级缓存；进页面时预取一次）。 */
let cachedConfig: MerchantSubscribeConfig | null = null

/** 微信限制：一次调用最多 3 个模板。 */
const MAX_TMPL_PER_CALL = 3

/**
 * 本次会话内已被**拒绝/封禁**的场景。
 * ⚠️ 只是"别反复弹"的礼貌性去重，**不是**授权额度记录（额度客户端记不准）。
 */
const rejectedScenes = new Set<string>()

/**
 * 本次会话是否已提示过「门店接收人未绑微信」。
 * ⚠️ 只提示一次 —— 每次点击都弹会变成骚扰（而且绑定要去 PC 后台，提示再多也解决不了）。
 */
let receiverWarned = false

/**
 * **预取订阅配置**（进页面时调用）。
 *
 * ⚠️ 必须**提前**调用：点击那一刻只能同步读缓存，来不及请求接口。
 * 失败时置空配置 ⇒ 后续引导自动跳过（不打扰用户，也不会误报 bug）。
 */
export async function preloadMerchantSubscribeConfig(): Promise<void> {
  try {
    cachedConfig = await getMerchantSubscribeConfig()
  } catch (error) {
    console.warn('[subscribe] 订阅配置拉取失败，本轮不引导订阅：', error)
    cachedConfig = null
  }
}

/**
 * 读取**门店维度接收人**是否已绑定微信（来自 `receiver.bound`）。
 *
 * ⚠️ 后端文档明确：它比"当前登录人自己的 `openidBound`"**更准**（两者可能不是同一个人）——
 * 因为微信提示发给的是**门店店长（MANAGER）优先、未绑则回退门店主账号**。
 * 返回 `null` 表示配置未就绪，调用方**不要**据此提示用户。
 */
export function readSubscribeReceiverBound(): boolean | null {
  const bound = cachedConfig?.receiver?.bound
  return typeof bound === 'boolean' ? bound : null
}

/** 当前 `configured=true` 的场景清单，供设置页展示"哪些通知能收到微信提示"。 */
export function readConfiguredSubscribeScenes(): MerchantSubscribeSceneConfig[] {
  return (cachedConfig?.scenes || []).filter((scene) => scene.configured && !!scene.templateId)
}

/**
 * 引导商家订阅消息（**必须在点击手势的同步链路里调用**）。
 *
 * 只使用**已缓存的**配置；以下情况一律**静默跳过**（不打扰用户）：
 * - 配置尚未预取成功；
 * - 该场景 `configured=false`（运营还没配模板 ID）；
 * - 该场景本次会话内已被拒绝/封禁过；
 * - 非微信端 / 基础库不支持。
 *
 * 用户在弹窗里点「拒绝」或已被「封禁」时，会**引导去设置页开启**（而不是提示"稍后重试"）。
 *
 * @param scenes 场景码数组，如 `['NEW_ORDER']`（与接口返回的 `scene` 字段一致）
 */
export function requestMerchantSubscribe(scenes: string[]): void {
  const list = cachedConfig?.scenes || []
  if (!list.length) return

  // ⓿ ⚠️ 接收人未绑微信 ⇒ 订阅了也收不到（后端会跳过微信通道）。
  // 文档 §2.2 要求"先引导绑定再订阅"；但**绑定入口在 PC 后台**、小程序内无法跳转，
  // 所以这里只做**一次**提示（指向后台「店员管理」），不反复骚扰。
  if (readSubscribeReceiverBound() === false) {
    if (!receiverWarned) {
      receiverWarned = true
      uni.showModal({
        title: '需先绑定微信',
        content: '当前门店的通知接收人（店长优先，未绑则回退门店主账号）尚未绑定微信，订阅后也收不到提示。请在 PC 后台「店员管理」中为店长绑定微信。',
        showCancel: false,
        confirmText: '知道了',
      })
    }
    return
  }

  // ① 只取「已配置 + 有模板 ID + 未被拒」的，并遵守"一次最多 3 个"
  const picked = scenes
    .filter((scene) => !rejectedScenes.has(scene))
    .map((scene) => list.find((item) => item.scene === scene))
    .filter((item): item is MerchantSubscribeSceneConfig => !!item && item.configured && !!item.templateId)
    .slice(0, MAX_TMPL_PER_CALL)
  const ids = picked.map((item) => String(item.templateId))
  if (!ids.length) return

  // ② 非微信端跳过
  // @ts-ignore 微信小程序 API（uni-app 下用 wx 原生）
  const wxApi = typeof wx !== 'undefined' ? wx : null
  if (!wxApi || typeof wxApi.requestSubscribeMessage !== 'function') return

  // ③ 同步调用（务必保持在本函数的同步流程里，不要包 Promise/await）
  wxApi.requestSubscribeMessage({
    tmplIds: ids,
    success: (res: Record<string, string>) => {
      const blocked = ids.some((id) => {
        const state = res?.[id]
        const scene = picked.find((item) => String(item.templateId) === id)?.scene
        if (state === 'accept') {
          if (scene) rejectedScenes.delete(scene)
          return false
        }
        if (state === 'reject' || state === 'ban') {
          if (scene) rejectedScenes.add(scene)
          return true
        }
        return false
      })
      // 有被拒绝/封禁的 ⇒ 引导去设置页（⚠️ 文案不要写"稍后重试"）
      if (blocked) {
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
  receiverWarned = false
}
