/**
 * 「转余额前实名」门禁（今华有礼 C 端，2026-09-22）
 *
 * 背景：**红包**与**推广金**都通过同一个接口 `convertWallet(type)` 一键转成**通用余额**
 * （`api/user.ts` 的 `convertWallet()`：「一键转余额，默认可由推广金或红包发起」），
 * 而余额可支付（`/api/pay/balance`「用钱包余额全额抵扣订单」）、可提现（提现接口 `/api/wallet/withdraw`
 * 已明确「首次提现前必须完成实名认证，未认证返回 8601」）。
 *
 * 于是存在一条**绕开提现实名**的套现闭环：
 *   多开微信号（各自 userId）→ 各自下单领红包/推广金 → **转余额（原先无任何实名校验）** → 余额支付买货 → 实物到手。
 *   提现实名那道墙完全没碰到，恶意用户零成本获利。
 *
 * 对策：把实名卡在**「转余额」这一个动作**上 —— 红包与推广金共用同一接口，一刀切两条路。
 * 正常用户「浏览 / 下单 / 红包抵扣」全程不触碰本门禁，只有要把平台送的权益变成**通用余额**时才需实名。
 *
 * 门禁由两道保险组成（与提现页 `withdraw.vue` 的既有做法一致）：
 * 1. `ensureRealname()` —— **前置拦截**：先查实名状态，未实名就不发转余额请求（省一次无效请求，体验好）；
 * 2. `handleConvertDenied()` —— **后端兜底**：接口返回 `8601` 时再打开实名弹层（前置查询失败 / 状态过期 / 别处直连接口都不会漏）。
 * 两者都指向同一个 `RealnameVerifySheet`，认证成功后都会**自动续跑**原转账动作（用户无需再点一次）。
 *
 * ⚠️ 前端门禁只负责**体验与引导**，真正的拦截必须由后端在 `/api/wallet/convert` 上实施
 * （前端可被绕过 —— 直接调接口即可）。有礼后端截至 2026-09-22 的 `api_doc.json` 中该接口
 * **尚无实名说明与 8601**，故本文件同时是后端补齐前的兜底与后端补齐后的前端接入点。
 */
import { ref, type Ref } from 'vue'
import { getRealnameStatus } from '@/api/realname'

/** 实名门禁对外暴露的能力：页面把 `sheetVisible` 绑到 `<RealnameVerifySheet v-model>`。 */
export interface ConvertRealnameGate {
  /** 实名弹层显隐。 */
  sheetVisible: Ref<boolean>
  /** 是否正在查询实名状态（页面可用于禁用按钮防连点）。 */
  checking: Ref<boolean>
  /** 转余额前的前置门禁；已实名返回 true，未实名打开弹层并返回 false。 */
  ensureRealname: (onVerified?: () => void) => Promise<boolean>
  /** 实名弹层的 `@verified` 回调：关闭弹层并续跑被拦下的动作。 */
  handleVerified: () => void
  /** 后端返回 8601（未实名）时的兜底入口：提示并打开实名弹层。 */
  handleConvertDenied: (onVerified?: () => void) => void
}

/**
 * 创建一套「转余额实名门禁」。
 * 红包页（`redpacket.vue`）与推广金页（`dividend.vue`）各调用一次，互不共享状态。
 */
export function useConvertRealnameGate(): ConvertRealnameGate {
  /** 实名弹层显隐：页面把它绑到 `<RealnameVerifySheet v-model="sheetVisible">`。 */
  const sheetVisible = ref(false)
  /** 是否正在查询实名状态（防连点）。 */
  const checking = ref(false)
  /** 认证成功后要续跑的动作（就是「再转一次余额」）。 */
  let resumeAction: (() => void) | null = null

  /**
   * 转余额前调用（**前置拦截**）。
   * - 已实名 → 返回 `true`，调用方继续执行转账；
   * - 未实名 → 打开实名弹层并返回 `false`；认证成功后会执行 `onVerified` 续跑（用户无需再点一次）。
   *
   * 查询失败时**按未实名处理**（与提现页 `loadRealnameStatus()`/`ensureRealnameReady()` 一致）——
   * 宁可多要一次实名，也不放行未经核验的转账。
   */
  async function ensureRealname(onVerified?: () => void): Promise<boolean> {
    if (checking.value) return false
    checking.value = true
    try {
      const status = await getRealnameStatus()
      if (status?.verified) return true
      // 未实名：挂起续跑动作后弹实名层，本次转账到此为止
      resumeAction = onVerified || null
      sheetVisible.value = true
      return false
    } catch (error) {
      // 状态查询本身失败（网络/接口异常）：给出明确提示，不放行
      uni.showToast({ title: error instanceof Error ? error.message : '实名认证状态查询失败', icon: 'none' })
      return false
    } finally {
      checking.value = false
    }
  }

  /** 实名认证成功回调：关闭弹层并续跑被拦下的转账（此刻必定已实名）。 */
  function handleVerified(): void {
    sheetVisible.value = false
    const action = resumeAction
    resumeAction = null
    action?.()
  }

  /**
   * 后端返回 **`8601 未实名`** 时调用（`/api/wallet/convert` 与 `/api/wallet/withdraw` 共用该码）。
   *
   * 这里**主动给出引导文案**（而不是只弹后端原文），并打开同一个实名弹层；
   * 认证成功后自动续跑原转账，避免用户「认证完了还得自己再点一次转余额」。
   */
  function handleConvertDenied(onVerified?: () => void): void {
    resumeAction = onVerified || null
    uni.showToast({ title: '请先完成实名认证后再转余额', icon: 'none' })
    sheetVisible.value = true
  }

  return { sheetVisible, checking, ensureRealname, handleVerified, handleConvertDenied }
}
