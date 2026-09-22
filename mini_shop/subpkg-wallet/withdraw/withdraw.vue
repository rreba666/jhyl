<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import { getRealnameStatus, type RealnameStatus } from '@/api/realname'
import { applyTransferAuth, getTransferAuthStatus, type TransferAuthState } from '@/api/transfer-auth'
import {
  BANK_CARDS_CHANGED_EVENT,
  BANK_CARD_SELECTED_EVENT,
  findDefaultBankCard,
  getBankCardList,
  type BankCardVO,
} from '@/api/bank-card'
import { getUserProfile, getWalletInfo, getWithdrawRules, searchUser, transferWallet, withdrawWallet, withdrawWalletWithCard, getWithdrawals, type UserProfile, type UserSearchVO, type WalletInfo, type WithdrawMethod, type WithdrawRecord, type WithdrawRules, type WithdrawType } from '@/api/user'
import RealnameVerifySheet from '@/components/RealnameVerifySheet.vue'
import { clearAuth, getAuth, hasWalletNoticeSeen, isLoggedIn, isRegisteredUser, markWalletNoticeSeen } from '@/utils/auth'
import { isApiRequestError } from '@/utils/request'
import { MERCHANT_TRANSFER_APP_ID, MERCHANT_TRANSFER_MCH_ID, TRANSFER_MIN_AMOUNT, WITHDRAW_MIN_AMOUNT } from '@/utils/wallet-config'
import { validateAmount, validatePositiveInteger } from '@/utils/input-validation'
import LoginGuide from '@/components/LoginGuide.vue'
import { useModuleGuard } from '@/utils/config'

/** wallet 模块守卫：停用则拦截提现/转账（深链防护）。 */
const { moduleEnabled: walletEnabled, loadModuleConfig: loadWalletModule } = useModuleGuard('wallet')

const menuTop = ref(0)
const menuHeight = ref(32)
const user = ref<UserProfile | null>(null)
const wallet = ref<WalletInfo | null>(null)
const loading = ref(false)
const currentTab = ref<'withdraw' | 'transfer'>('transfer')
/** 提现方式入口，默认保留原有零钱提现流程，银行卡作为新增选项。 */
const withdrawOption = ref<'BALANCE' | 'BANK_CARD'>('BALANCE')
const withdrawAmount = ref('')
const transferUserId = ref('')
const transferAmount = ref('')
const recipient = ref<UserSearchVO | null>(null)
const searching = ref(false)
const withdrawSubmitting = ref(false)
const transferSubmitting = ref(false)
/** 提现记录列表（含审核状态）。 */
const withdrawRecords = ref<WithdrawRecord[]>([])
const recordsPage = ref(1)
const recordsLoading = ref(false)
const recordsFinished = ref(false)
const walletNoticeVisible = ref(false)
const walletNoticeSeen = ref(hasWalletNoticeSeen())
const realnameVisible = ref(false)
const realnameVerified = ref(false)
const realnameChecking = ref(false)
const pendingAction = ref<'withdraw' | 'transfer' | null>(null)
const pendingWithdrawAmount = ref<number | null>(null)
/** 当前提现申请的幂等键和请求指纹，网络重试时必须复用。 */
const pendingWithdrawIdempotencyKey = ref<string | null>(null)
const pendingWithdrawFingerprint = ref<string | null>(null)
const pendingTransfer = ref<{ toUserId: number; amount: number } | null>(null)
/** 免确认收款授权状态（''=未授权，WAIT_USER_CONFIRM=待确认，TAKING_EFFECT=已授权）。 */
const transferAuthState = ref<TransferAuthState>('')
const authStatusError = ref(false)
const authLoading = ref(false)
const authApplying = ref(false)
let authPollTimer: ReturnType<typeof setTimeout> | null = null
const MIN_TRANSFER_AUTH_SDK_VERSION = '3.7.9'
const accessChecking = ref(false)
const accessDenied = ref(false)
const loginGuideVisible = ref(false)
const registeredUser = computed(() => isRegisteredUser(user.value?.identity))

/**
 * 银行卡提现用的「已绑定银行卡」列表与当前选中卡。
 *
 * 口径（2026-09-22 核对 `api_doc.json`）：后端 `WithdrawDTO.bankCardId` 可选 ——
 * - 传了：用这张**已绑定银行卡**（tag「提现银行卡」，可多张、可切默认）；
 * - 不传：用**实名认证资料里记录的卡号**（`RealnameVerifySheet` 的 bankCardNo，后端只记录不核验）。
 * 所以两条链路并存：这里优先给用户选已绑卡，一张都没绑时退回实名资料口径，不阻断提现。
 */
const bankCards = ref<BankCardVO[]>([])
/** 当前选中的银行卡；null = 使用实名认证资料里的卡号。 */
const selectedBankCard = ref<BankCardVO | null>(null)

const navStyle = computed(() => ({ top: `${menuTop.value}px`, height: `${menuHeight.value}px` }))
const bodyStyle = computed(() => ({ paddingTop: `${menuTop.value + menuHeight.value + uni.upx2px(100)}px` }))
const availableBalance = computed(() => Number(wallet.value?.balance ?? 0))
/** 提现规则本地兜底费率：后台 `GET /api/wallet/withdraw-rules` 请求失败或字段缺失时使用（页面不留空白）。 */
const DEFAULT_WITHDRAW_FEE_RATE = 0.05
/** 后台下发的提现规则；null = 未取到，全部走本地兜底值。 */
const withdrawRules = ref<WithdrawRules | null>(null)
/** 最低提现金额：以后台配置为准，缺失/非法时回退本地 `WITHDRAW_MIN_AMOUNT`（保留该常量作为兜底）。 */
const withdrawMinAmount = computed(() => {
  const value = Number(withdrawRules.value?.minAmount)
  return Number.isFinite(value) && value > 0 ? value : Number(WITHDRAW_MIN_AMOUNT)
})
/** 最低提现金额文案：整数不补小数（1 元而非 1.00 元），避免后台配置整数时提示显得多余。 */
const withdrawMinimumLabel = computed(() => (Number.isInteger(withdrawMinAmount.value) ? String(withdrawMinAmount.value) : formatMoney(withdrawMinAmount.value)))
/** 每日累计提现金额上限（元）；0/缺失 = 后台未配置，页面不展示该限制。 */
const withdrawDailyAmountLimit = computed(() => {
  const value = Number(withdrawRules.value?.dailyAmountLimit)
  return Number.isFinite(value) && value > 0 ? value : 0
})
/** 每日提现次数上限；0/缺失 = 后台未配置，页面不展示该限制。 */
const withdrawDailyCountLimit = computed(() => {
  const value = Number(withdrawRules.value?.dailyCountLimit)
  return Number.isFinite(value) && value > 0 ? value : 0
})
/** 手续费率（0~1 小数）：以后台配置为准，缺失/非法时回退默认 5%。 */
const withdrawFeeRate = computed(() => {
  const value = Number(withdrawRules.value?.feeRate)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_WITHDRAW_FEE_RATE
})
/** 手续费率百分比文案（0.05 → 5%）。 */
const withdrawFeePercentLabel = computed(() => formatFeeRateLabel(withdrawFeeRate.value))
/**
 * 提现规则提示文案：只在后台真的配置了每日金额/次数上限时才拼出来；
 * 未配置（0/缺失）时返回空串，避免页面上出现「每日上限 0 元」这类错误数字。
 */
const withdrawLimitHint = computed(() => {
  const parts: string[] = []
  if (withdrawDailyAmountLimit.value > 0) parts.push(`每日累计提现上限 ¥${formatMoney(withdrawDailyAmountLimit.value)}`)
  if (withdrawDailyCountLimit.value > 0) parts.push(`每日最多提现 ${withdrawDailyCountLimit.value} 次`)
  return parts.join('，')
})

/**
 * 下次可提现时刻（后端 `nextWithdrawableAt`，`yyyy-MM-dd HH:mm:ss`）。
 * 只接受非空字符串：null / 缺失 = 当前不在锁定期，页面不展示锁定期提示。
 */
const nextWithdrawableAt = computed(() => {
  const value = withdrawRules.value?.nextWithdrawableAt
  return typeof value === 'string' && value.trim() ? value.trim() : ''
})

/**
 * 锁定期提示文案（口径：自订单支付时刻起算的 N×24 小时，不再按自然日零点解锁）：
 * 后端没有下发 `nextWithdrawableAt` 时不展示，避免提示与实际可提现时间不一致。
 */
const withdrawLockHint = computed(() => {
  if (!nextWithdrawableAt.value) return ''
  return `最近有订单支付，暂时无法提现；${nextWithdrawableAt.value} 后可提现`
})

/**
 * 提现规则区块是否展开（默认展开）。
 * 微信提审要求「在提现页面清晰展示相关提现规则」，默认展开保证审核与用户一眼可见；
 * 用户看完后可自行收起，不影响提现主流程。
 */
const withdrawRulesExpanded = ref(true)

/**
 * 同时处理中的提现笔数上限（后端 `WithdrawRuleVO.maxConcurrent`）；0/缺失 = 未配置，规则区块不展示该条。
 */
const withdrawMaxConcurrent = computed(() => {
  const value = Number(withdrawRules.value?.maxConcurrent)
  return Number.isFinite(value) && value > 0 ? value : 0
})

/**
 * 提现冻结总额上限（后端 `WithdrawRuleVO.frozenLimit`，元）；0/缺失 = 未配置，规则区块不展示该条。
 */
const withdrawFrozenLimit = computed(() => {
  const value = Number(withdrawRules.value?.frozenLimit)
  return Number.isFinite(value) && value > 0 ? value : 0
})

/**
 * 支付后锁定期天数（后端 `WithdrawRuleVO.payLockDays`，自订单支付时刻起算 N×24 小时）。
 * 这里是**只读展示**：后端未下发时返回 0，规则区块随之隐藏该条，**不写死天数**（避免与后端口径打架）。
 */
const withdrawLockDays = computed(() => {
  const value = Number(withdrawRules.value?.payLockDays)
  return Number.isFinite(value) && value > 0 ? value : 0
})

/** 用户输入的提现金额（非法输入按 0 处理）。 */
const withdrawAmountNumber = computed(() => {
  const value = Number(withdrawAmount.value)
  return Number.isFinite(value) ? value : 0
})
/** 提现手续费：按后台配置费率计算，不再写死 5%。 */
const withdrawFee = computed(() => (withdrawAmountNumber.value > 0 ? withdrawAmountNumber.value * withdrawFeeRate.value : 0))
/** 扣除手续费后的实际到账金额：按动态费率倒推，避免费率改动后展示金额与实际打款不一致。 */
const withdrawActual = computed(() => (withdrawAmountNumber.value > 0 ? withdrawAmountNumber.value * (1 - withdrawFeeRate.value) : 0))
/** 是否需要引导完成免确认收款授权。 */
const needAuth = computed(() => transferAuthState.value !== 'TAKING_EFFECT')

/** 选中银行卡的展示文案（后端只回脱敏卡号）。 */
const selectedBankCardLabel = computed(() => {
  const card = selectedBankCard.value
  if (!card) return ''
  return `${card.bankName} ${card.cardNoMasked || '****'}`
})

function formatMoney(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

/** 手续费率百分比文案：0.05 → 5%，0.006 → 0.6%（先四舍五入到万分之一，避免浮点误差显示成 5.000000000000001%）。 */
function formatFeeRateLabel(rate: number): string {
  const percent = Math.round(rate * 10000) / 100
  return `${Number.isInteger(percent) ? percent : String(percent)}%`
}

/**
 * 加载后台提现规则，随页面数据一起加载。
 * 失败静默：置空后所有规则 computed 回退本地默认值，既不弹错误打断提现流程，也不会展示 0 或空白。
 */
async function loadWithdrawRules(): Promise<void> {
  try {
    withdrawRules.value = await getWithdrawRules()
  } catch {
    withdrawRules.value = null
  }
}

function createWithdrawIdempotencyKey(): string {
  const cryptoApi = (globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }).crypto
  const uuid = cryptoApi?.randomUUID?.()
  const fallback = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
  return `wd-${uuid || fallback}`.slice(0, 64)
}

/** 同一金额、来源和收款方式复用 key；任一项变化都开启新的提现申请。 */
function getWithdrawIdempotencyKey(amount: number, type: WithdrawType, withdrawMethod: WithdrawMethod): string {
  const fingerprint = `${amount.toFixed(2)}|${type}|${withdrawMethod}`
  if (pendingWithdrawFingerprint.value === fingerprint && pendingWithdrawIdempotencyKey.value) {
    return pendingWithdrawIdempotencyKey.value
  }
  const idempotencyKey = createWithdrawIdempotencyKey()
  pendingWithdrawFingerprint.value = fingerprint
  pendingWithdrawIdempotencyKey.value = idempotencyKey
  return idempotencyKey
}

function clearWithdrawRequestContext(): void {
  pendingWithdrawFingerprint.value = null
  pendingWithdrawIdempotencyKey.value = null
}

/** 比较微信基础库版本号，避免低版本调用授权 API 后只返回笼统 fail。 */
function compareVersion(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number(part) || 0)
  const rightParts = right.split('.').map((part) => Number(part) || 0)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** 读取真机微信基础库版本，非微信环境返回空字符串交给环境检查处理。 */
function readWechatSdkVersion(): string {
  try {
    // @ts-ignore 微信小程序专用 API，仅微信环境可用
    const systemInfo = typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function'
      ? wx.getSystemInfoSync()
      : null
    return systemInfo?.SDKVersion || ''
  } catch {
    return ''
  }
}

async function loadWallet(): Promise<void> {
  if (!registeredUser.value) return
  loading.value = true
  try {
    wallet.value = await getWalletInfo()
  } catch (error) {
    wallet.value = null
    uni.showToast({ title: error instanceof Error ? error.message : '余额加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

/** 提现状态码 → 展示样式类名，用于区分审核各阶段颜色。 */
function withdrawStatusClass(status: string): string {
  switch (status) {
    case 'PENDING_REVIEW': return 'pending'
    case 'APPROVED': return 'approved'
    case 'SUCCESS': return 'success'
    case 'FAILED': return 'failed'
    case 'REJECTED': return 'rejected'
    case 'STUCK': return 'stuck'
    default: return ''
  }
}

/** 分页加载当前用户提现记录，展示审核状态。reset=true 时清空重载。 */
async function loadWithdrawRecords(reset = false): Promise<void> {
  if (recordsLoading.value) return
  if (reset) {
    recordsPage.value = 1
    recordsFinished.value = false
    withdrawRecords.value = []
  }
  if (recordsFinished.value) return
  recordsLoading.value = true
  try {
    const result = await getWithdrawals(recordsPage.value, 20)
    withdrawRecords.value = [...withdrawRecords.value, ...result.list]
    recordsFinished.value = withdrawRecords.value.length >= result.total
    recordsPage.value += 1
  } catch {
    // 记录加载失败静默处理，不影响提现主流程
  } finally {
    recordsLoading.value = false
  }
}

function openWalletNotice(): void {
  if (walletNoticeSeen.value) return
  walletNoticeVisible.value = true
}

function acknowledgeWalletNotice(): void {
  markWalletNoticeSeen()
  walletNoticeSeen.value = true
  walletNoticeVisible.value = false
}

function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1 })
    return
  }
  uni.switchTab({ url: '/pages/mine/mine' })
}

/** 进入我的资金明细页，查看余额/收益等全部资金变动流水。 */
function goFlows(): void {
  uni.navigateTo({ url: '/subpkg-wallet/flows/flows' })
}

/** 拦截游客访问钱包页，并返回个人中心等待后端身份升级。 */
function denyGuestAccess(): void {
  if (accessDenied.value) return
  accessDenied.value = true
  uni.showToast({ title: '完成订单后开放推广功能', icon: 'none' })
  setTimeout(() => uni.switchTab({ url: '/pages/mine/mine' }), 650)
}

/** 刷新用户身份，只有注册用户才加载余额、授权和提现数据。 */
async function ensureRegisteredAccess(): Promise<boolean> {
  if (accessDenied.value || accessChecking.value) return false
  if (!isLoggedIn()) {
    loginGuideVisible.value = true
    return false
  }
  accessChecking.value = true
  try {
    user.value = await getUserProfile()
    if (!registeredUser.value) {
      denyGuestAccess()
      return false
    }
    return true
  } catch {
    user.value = null
    denyGuestAccess()
    return false
  } finally {
    accessChecking.value = false
  }
}

/** 页面进入时读取实名状态，决定提现按钮是“实名绑定”还是“确认提现”。 */
async function loadRealnameStatus(): Promise<void> {
  try {
    const status = await getRealnameStatus()
    realnameVerified.value = status.verified
  } catch {
    // 查询失败时按未实名处理，避免错误放行提现。
    realnameVerified.value = false
  }
}

/**
 * 加载已绑定银行卡，并保持当前选中项有效。
 * 选中优先级：已选（仍在列表里）> 默认卡 > 列表第一张。
 * 一张都没绑时保持 null —— 提现请求不带 `bankCardId`，后端回退到实名资料里的卡号。
 */
async function loadBankCards(): Promise<void> {
  try {
    const list = await getBankCardList() || []
    bankCards.value = list
    const stillExists = selectedBankCard.value
      ? list.find((card) => String(card.id) === String(selectedBankCard.value?.id))
      : null
    selectedBankCard.value = stillExists || findDefaultBankCard(list)
  } catch {
    // 银行卡列表失败不阻断提现主流程：退化为"使用实名资料卡号"的旧口径
    bankCards.value = []
    selectedBankCard.value = null
  }
}

/** 打开银行卡管理页选卡（`mode=select` 回来后由事件回填）。 */
function chooseBankCard(): void {
  uni.navigateTo({ url: '/subpkg-wallet/bank-card/list?mode=select' })
}

/** 银行卡管理页选卡回传：写入当前选中卡。 */
function onBankCardSelected(payload: unknown): void {
  const card = payload as BankCardVO | null
  if (!card || card.id == null) return
  selectedBankCard.value = card
}

/** 银行卡列表变化（新绑/解绑/切默认）后重新拉取，保证提现用的是有效卡。 */
function onBankCardsChanged(): void {
  void loadBankCards()
}

/** 初始化或刷新钱包页，确保身份升级后重新进入即可使用提现功能。 */
async function loadPage(): Promise<void> {
  if (!(await ensureRegisteredAccess())) return
  await Promise.all([loadWallet(), loadWithdrawRules(), loadTransferAuthStatus(), loadWithdrawRecords(true), loadRealnameStatus(), loadBankCards()])
  openWalletNotice()
}

/** 查询免确认收款授权状态。 */
async function loadTransferAuthStatus(): Promise<boolean> {
  authLoading.value = true
  authStatusError.value = false
  try {
    const status = await getTransferAuthStatus()
    transferAuthState.value = status.state === 'TAKING_EFFECT' || status.state === 'WAIT_USER_CONFIRM'
      ? status.state
      : ''
    return true
  } catch {
    transferAuthState.value = ''
    authStatusError.value = true
    return false
  } finally {
    authLoading.value = false
  }
}

/** 手动重试授权状态查询，避免网络异常时沿用旧授权状态。 */
async function refreshTransferAuth(): Promise<void> {
  await loadTransferAuthStatus()
}

/** 停止授权状态轮询。 */
function stopAuthPolling(): void {
  if (authPollTimer) {
    clearTimeout(authPollTimer)
    authPollTimer = null
  }
}

/** 轮询授权状态，直到已授权或超过最大次数。 */
function startAuthPolling(attempt = 0): void {
  stopAuthPolling()
  if (attempt >= 10) return
  authPollTimer = setTimeout(async () => {
    try {
      const status = await getTransferAuthStatus()
      if (status.state === 'TAKING_EFFECT') {
        transferAuthState.value = 'TAKING_EFFECT'
        authStatusError.value = false
        uni.showToast({ title: '授权成功，可正常提现', icon: 'success' })
        return
      }
      transferAuthState.value = status.state === 'WAIT_USER_CONFIRM' ? 'WAIT_USER_CONFIRM' : ''
      authStatusError.value = false
      startAuthPolling(attempt + 1)
    } catch {
      transferAuthState.value = ''
      authStatusError.value = true
      startAuthPolling(attempt + 1)
    }
  }, 2000)
}

/** 读取当前微信运行容器的 AppID，用于阻止配置与实际小程序身份不一致。 */
function readRuntimeAppId(): string {
  try {
    // @ts-ignore 微信小程序专用 API，仅微信环境可用
    const accountInfo = typeof wx !== 'undefined' && typeof wx.getAccountInfoSync === 'function'
      ? wx.getAccountInfoSync()
      : null
    return accountInfo?.miniProgram?.appId || ''
  } catch {
    return ''
  }
}

/** 拉起微信免确认收款授权页，并保留微信返回的失败原因。 */
function openMerchantTransferAuth(packageInfo: string): void {
  if (!MERCHANT_TRANSFER_MCH_ID || !MERCHANT_TRANSFER_APP_ID) {
    uni.showToast({ title: '未配置商户转账参数，请联系管理员', icon: 'none' })
    return
  }
  const sdkVersion = readWechatSdkVersion()
  if (sdkVersion && compareVersion(sdkVersion, MIN_TRANSFER_AUTH_SDK_VERSION) < 0) {
    uni.showToast({ title: `微信基础库需达到 ${MIN_TRANSFER_AUTH_SDK_VERSION}，请升级微信`, icon: 'none' })
    return
  }
  const runtimeAppId = readRuntimeAppId()
  if (runtimeAppId && runtimeAppId !== MERCHANT_TRANSFER_APP_ID) {
    uni.showToast({ title: '当前小程序 AppID 与支付配置不一致，请重新编译', icon: 'none' })
    return
  }
  // @ts-ignore 微信商家转账授权 API，仅微信小程序环境可用
  if (typeof wx === 'undefined' || typeof wx.requestMerchantTransfer !== 'function') {
    uni.showToast({ title: '当前环境不支持授权，请在微信小程序中操作', icon: 'none' })
    return
  }
  // @ts-ignore
  wx.requestMerchantTransfer({
    mchId: MERCHANT_TRANSFER_MCH_ID,
    appId: MERCHANT_TRANSFER_APP_ID,
    package: packageInfo,
    success: () => {
      // 授权页展示成功，不等同于用户已确认，需轮询确认
      transferAuthState.value = 'WAIT_USER_CONFIRM'
      authStatusError.value = false
      startAuthPolling()
    },
    fail: (res: { errMsg?: string }) => {
      transferAuthState.value = ''
      const errMsg = res?.errMsg || ''
      const detail = errMsg.replace('requestMerchantTransfer:', '').trim()
      if (detail === 'cancel') {
        uni.showToast({ title: '已取消授权', icon: 'none' })
        return
      }
      if (/微信号不一致|授权微信号不一致|openid/i.test(detail)) {
        clearAuth()
        uni.showModal({
          title: '微信号不一致',
          content: '当前微信号与授权账号不一致，请重新登录后再试。',
          showCancel: false,
          confirmText: '重新登录',
          success: () => uni.reLaunch({ url: '/pages/login/login' }),
        })
        return
      }
      uni.showToast({ title: detail ? `授权页拉起失败：${detail}` : '授权页拉起失败，请重试', icon: 'none' })
    },
  })
}

/** 用户点击「去授权」。 */
async function handleAuthorize(): Promise<void> {
  if (authApplying.value) return
  authApplying.value = true
  try {
    const packageInfo = (await applyTransferAuth()).packageInfo
    if (packageInfo === null) {
      // 已授权（幂等），直接刷新状态
      await loadTransferAuthStatus()
    } else if (typeof packageInfo === 'string' && packageInfo.length > 0) {
      openMerchantTransferAuth(packageInfo)
    } else {
      throw new Error('授权 package 信息为空')
    }
  } catch (error) {
    showWalletActionError(error, '授权发起失败')
  } finally {
    authApplying.value = false
  }
}

/** 将提现和授权接口的关键业务码转换成明确的用户提示。 */
function showWalletActionError(error: unknown, fallback: string): void {
  if (isApiRequestError(error) && error.code === 7005) {
    uni.showToast({ title: '已有一笔提现正在处理中，请稍后重试', icon: 'none' })
    return
  }
  if (isApiRequestError(error) && error.code === 9000) {
    uni.showToast({ title: '微信服务暂时不可用，请稍后重试', icon: 'none' })
    return
  }
  uni.showToast({ title: error instanceof Error ? error.message : fallback, icon: 'none' })
}

async function ensureRealnameReady(action: 'withdraw' | 'transfer'): Promise<boolean> {
  if (realnameVerified.value) return true
  if (realnameChecking.value) return false

  realnameChecking.value = true
  try {
    const status = await getRealnameStatus()
    realnameVerified.value = status.verified
    if (status.verified) return true
    pendingAction.value = action
    realnameVisible.value = true
    return false
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '实名认证状态查询失败', icon: 'none' })
    return false
  } finally {
    realnameChecking.value = false
  }
}

/** 切换提现方式，零钱和银行卡分别走各自的后端收款流程。 */
function selectWithdrawOption(option: 'BALANCE' | 'BANK_CARD'): void {
  if (withdrawSubmitting.value || withdrawOption.value === option) return
  clearWithdrawRequestContext()
  pendingWithdrawAmount.value = null
  withdrawOption.value = option
}

async function executeWithdraw(amount: number): Promise<void> {
  if (withdrawSubmitting.value) return
  const withdrawMethod: WithdrawMethod = withdrawOption.value === 'BANK_CARD' ? 'BANK_CARD' : 'WECHAT_BALANCE'
  const idempotencyKey = getWithdrawIdempotencyKey(amount, 'BALANCE', withdrawMethod)
  withdrawSubmitting.value = true
  try {
    // 银行卡提现且已选中已绑卡 → 指定 bankCardId；否则沿用实名资料卡号（不带该字段）
    const bankCardId = withdrawMethod === 'BANK_CARD' ? selectedBankCard.value?.id : undefined
    if (bankCardId != null) await withdrawWalletWithCard(amount, 'BALANCE', withdrawMethod, idempotencyKey, bankCardId)
    else await withdrawWallet(amount, 'BALANCE', withdrawMethod, idempotencyKey)
    withdrawAmount.value = ''
    pendingWithdrawAmount.value = null
    pendingAction.value = null
    clearWithdrawRequestContext()
    await loadWallet()
    await loadWithdrawRecords(true)
    uni.showToast({ title: '提现申请已提交，待审核', icon: 'success' })
  } catch (error) {
    if (isApiRequestError(error) && error.code === 8601) {
      // 未实名认证 → 引导实名
      realnameVerified.value = false
      pendingAction.value = 'withdraw'
      pendingWithdrawAmount.value = amount
      realnameVisible.value = true
    } else if (withdrawOption.value === 'BALANCE' && isApiRequestError(error) && error.code === 7007) {
      // 未完成免确认收款授权 → 引导授权
      transferAuthState.value = ''
      pendingWithdrawAmount.value = amount
      uni.showToast({ title: '请先完成免确认收款授权', icon: 'none' })
    } else {
      showWalletActionError(error, '提现申请失败')
    }
  } finally {
    withdrawSubmitting.value = false
  }
}

async function handleWithdraw(): Promise<void> {
  if (withdrawSubmitting.value) return
  const amountResult = validateAmount(withdrawAmount.value, {
    label: '提现金额',
    // 下限用后台配置（缺失时回退本地默认），与页面上展示的最低提现金额保持一致
    min: withdrawMinAmount.value,
    max: availableBalance.value,
  })
  if (!amountResult.ok) {
    uni.showToast({ title: amountResult.message, icon: 'none' })
    return
  }
  const amount = amountResult.value

  const withdrawMethod: WithdrawMethod = withdrawOption.value === 'BANK_CARD' ? 'BANK_CARD' : 'WECHAT_BALANCE'
  getWithdrawIdempotencyKey(amount, 'BALANCE', withdrawMethod)
  pendingWithdrawAmount.value = amount
  if (!(await ensureRealnameReady('withdraw'))) return
  await executeWithdraw(amount)
}

async function handleSearchRecipient(): Promise<void> {
  if (searching.value) return
  const userIdResult = validatePositiveInteger(transferUserId.value, '用户ID')
  if (!userIdResult.ok) {
    uni.showToast({ title: userIdResult.message, icon: 'none' })
    return
  }
  const userId = userIdResult.value
  transferUserId.value = String(userId)

  searching.value = true
  try {
    recipient.value = await searchUser(userId)
  } catch (error) {
    recipient.value = null
    uni.showToast({ title: error instanceof Error ? error.message : '查找接收人失败', icon: 'none' })
  } finally {
    searching.value = false
  }
}

async function executeTransfer(payload: { toUserId: number; amount: number }): Promise<void> {
  if (transferSubmitting.value) return
  transferSubmitting.value = true
  try {
    await transferWallet(payload)
    transferAmount.value = ''
    recipient.value = null
    pendingTransfer.value = null
    pendingAction.value = null
    await loadWallet()
    uni.showToast({ title: '转账已提交', icon: 'success' })
  } catch (error) {
    if (isApiRequestError(error) && error.code === 8601) {
      realnameVerified.value = false
      pendingAction.value = 'transfer'
      pendingTransfer.value = payload
      realnameVisible.value = true
    } else {
      showWalletActionError(error, '转账失败')
    }
  } finally {
    transferSubmitting.value = false
  }
}

async function handleTransfer(): Promise<void> {
  if (!recipient.value) {
    uni.showToast({ title: '请先查找接收人', icon: 'none' })
    return
  }
  const amountResult = validateAmount(transferAmount.value, {
    label: '转账金额',
    min: TRANSFER_MIN_AMOUNT,
    max: availableBalance.value,
  })
  if (!amountResult.ok) {
    uni.showToast({ title: amountResult.message, icon: 'none' })
    return
  }
  const amount = amountResult.value
  if (getAuth()?.userId != null && recipient.value.id === getAuth()?.userId) {
    uni.showToast({ title: '不能转给自己', icon: 'none' })
    return
  }

  const payload = { toUserId: recipient.value.id, amount }
  pendingTransfer.value = payload
  if (!(await ensureRealnameReady('transfer'))) return
  await executeTransfer(payload)
}

async function handleRealnameVerified(status: RealnameStatus): Promise<void> {
  realnameVerified.value = status.verified
  if (!status.verified) {
    uni.showToast({ title: '实名认证未完成，请核对信息后重试', icon: 'none' })
    return
  }
  realnameVisible.value = false

  const action = pendingAction.value
  pendingAction.value = null

  if (action === 'withdraw' && pendingWithdrawAmount.value != null) {
    pendingWithdrawAmount.value = null
    return
  }
  if (action === 'transfer' && pendingTransfer.value) {
    const payload = pendingTransfer.value
    pendingTransfer.value = null
    await executeTransfer(payload)
  }
}

watch(transferUserId, () => {
  recipient.value = null
})

watch(withdrawAmount, (next, previous) => {
  if (withdrawSubmitting.value) return
  if (next !== previous && pendingWithdrawIdempotencyKey.value) {
    clearWithdrawRequestContext()
    pendingWithdrawAmount.value = null
  }
})

onMounted(() => {
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect) {
      menuTop.value = rect.top
      menuHeight.value = rect.height
    }
  } catch { /* 非微信环境没有胶囊按钮 */ }
  void loadWalletModule()
})

onShow(() => { void loadPage() })

// 银行卡相关的跨页事件：选卡回填 + 绑卡/解绑后刷新列表。
// 用 onMounted/onUnload 成对注册与注销，避免返回本页时重复绑定导致回调执行多次。
onMounted(() => {
  uni.$on(BANK_CARD_SELECTED_EVENT, onBankCardSelected)
  uni.$on(BANK_CARDS_CHANGED_EVENT, onBankCardsChanged)
})

onUnload(() => {
  stopAuthPolling()
  uni.$off(BANK_CARD_SELECTED_EVENT, onBankCardSelected)
  uni.$off(BANK_CARDS_CHANGED_EVENT, onBankCardsChanged)
})
</script>

<template>
  <view class="page">
    <view class="nav" :style="navStyle">
      <image class="back-button" src="/static/left_arrow.png" mode="aspectFit" @click="goBack" />
      <text class="nav-title">余额转账</text>
      <view class="nav-spacer" />
    </view>

    <!-- wallet 模块停用：拦截提现/转账（深链防护） -->
    <view v-if="!walletEnabled" class="module-blocked">
      <text class="module-blocked-title">钱包功能未开通</text>
      <text class="module-blocked-desc">当前商户未开通钱包模块，提现与转账暂不可用。</text>
    </view>

    <scroll-view v-if="registeredUser && walletEnabled" class="page-scroll" scroll-y :style="bodyStyle">
      <view class="page-content">
        <view class="hero-card">
          <image class="hero-card-bg" src="/static/bg/钱包页背景.png" mode="aspectFill" />
          <text class="hero-label">可转账余额</text>
          <text class="hero-value">{{ formatMoney(availableBalance) }}</text>
          <text class="hero-subtitle">1:1 提现</text>
        </view>

        <view class="flow-entry" @click="goFlows">
          <text class="flow-entry-label">资金明细</text>
          <text class="flow-entry-arrow">›</text>
        </view>

        <view class="tab-row">
          <view class="tab-item" :class="{ active: currentTab === 'withdraw' }" @click="currentTab = 'withdraw'">提现</view>
          <view class="tab-item" :class="{ active: currentTab === 'transfer' }" @click="currentTab = 'transfer'">转赠他人</view>
        </view>

        <view v-show="currentTab === 'withdraw'" class="panel-card">
          <text class="panel-title">提现方式</text>
          <view class="type-row">
            <view class="type-chip" :class="{ active: withdrawOption === 'BALANCE' }" @click="selectWithdrawOption('BALANCE')">零钱提现</view>
            <view class="type-chip" :class="{ active: withdrawOption === 'BANK_CARD' }" @click="selectWithdrawOption('BANK_CARD')">银行卡提现</view>
          </view>
          <text class="panel-title panel-section-title">提现金额</text>
          <input v-model="withdrawAmount" class="panel-input" maxlength="11" type="digit" :disabled="withdrawSubmitting" :placeholder="`请输入提现余额，最低 ${withdrawMinimumLabel}`" />
          <!-- 锁定期提示：后端 nextWithdrawableAt 非空时说明可提现时刻（口径：自订单支付时刻起算） -->
          <view v-if="withdrawLockHint" class="lock-banner">
            <text class="lock-text">{{ withdrawLockHint }}</text>
          </view>
          <text v-if="withdrawOption === 'BANK_CARD'" class="fee-hint">银行卡信息取自实名认证资料，平台审核通过后人工打款；提现将收取 {{ withdrawFeePercentLabel }} 手续费。</text>
          <text v-else class="fee-hint">提现将收取 {{ withdrawFeePercentLabel }} 手续费，提交后进入审核。</text>
          <!-- 未实名时就地说明：审核账号若未实名会卡在「实名绑定」，这里把口径说透（仅一次、无其他门槛） -->
          <text v-if="!realnameVerified" class="fee-hint">首次提现需完成实名认证（仅一次），认证后余额满 {{ withdrawMinimumLabel }} 元即可提现，无其他门槛。</text>
          <text v-if="withdrawLimitHint" class="fee-hint">{{ withdrawLimitHint }}</text>
          <text class="fee-hint">提现额度自订单支付时刻起算，锁定期结束后即可提现。</text>
          <text v-if="withdrawAmountNumber > 0" class="fee-calc">手续费 ¥{{ formatMoney(withdrawFee) }}，实际到账 ¥{{ formatMoney(withdrawActual) }}</text>
          <!--
            提现规则区块（微信提审合规要求：提现页须清晰展示门槛 / 额度 / 次数 / 提现时间 / 可提现时间 / 到账时间 / 实名认证 / 收款授权 / 手续费）。
            数值一律取后台配置 GET /api/wallet/withdraw-rules（minAmount / feeRate / dailyAmountLimit / dailyCountLimit /
            maxConcurrent / frozenLimit / payLockDays / nextWithdrawableAt）与本地既有 computed，**后端未下发的字段不编造**：
            未配置的条目整行隐藏（v-if），不展示 0 或猜测值。默认展开，用户可自行收起。
          -->
          <view class="rule-card">
            <view class="rule-head" @click="withdrawRulesExpanded = !withdrawRulesExpanded">
              <text class="rule-title">提现规则</text>
              <text class="rule-toggle">{{ withdrawRulesExpanded ? '收起' : '展开' }}</text>
            </view>
            <view v-show="withdrawRulesExpanded" class="rule-body">
              <view class="rule-item"><text class="rule-label">提现门槛</text><text class="rule-text">账户余额满 {{ withdrawMinimumLabel }} 元即可提现，无需邀请好友、无需消费</text></view>
              <view class="rule-item"><text class="rule-label">可提现额度</text><text class="rule-text">最低提现 {{ withdrawMinimumLabel }} 元{{ withdrawDailyAmountLimit > 0 ? '，单日累计上限 ' + formatMoney(withdrawDailyAmountLimit) + ' 元' : '' }}</text></view>
              <view class="rule-item"><text class="rule-label">每日提现次数</text><text class="rule-text">{{ withdrawDailyCountLimit > 0 ? '每日最多可提现 ' + withdrawDailyCountLimit + ' 次' : '每日提现次数不限' }}</text></view>
              <!-- 并行笔数与冻结上限：仅后端下发（maxConcurrent / frozenLimit）时才展示 -->
              <view v-if="withdrawMaxConcurrent > 0" class="rule-item"><text class="rule-label">在途笔数</text><text class="rule-text">同时处理中的提现最多 {{ withdrawMaxConcurrent }} 笔</text></view>
              <view v-if="withdrawFrozenLimit > 0" class="rule-item"><text class="rule-label">冻结上限</text><text class="rule-text">提现冻结总额上限 {{ formatMoney(withdrawFrozenLimit) }} 元</text></view>
              <view class="rule-item"><text class="rule-label">提现时间</text><text class="rule-text">提现申请全天可提交（00:00–24:00），提交后进入平台审核</text></view>
              <!-- 可提现时间：天数取后端 payLockDays，具体时刻取 nextWithdrawableAt，两者都不写死 -->
              <view class="rule-item"><text class="rule-label">可提现时间</text><text class="rule-text">{{ withdrawLockDays > 0 ? '收益有 ' + withdrawLockDays + ' 天锁定期（自订单支付时刻起算），期满后方可提现' : '收益需过锁定期后方可提现' }}{{ nextWithdrawableAt ? '；当前可提现时刻 ' + nextWithdrawableAt : '' }}</text></view>
              <view class="rule-item"><text class="rule-label">到账时间</text><text class="rule-text">提交后进入平台审核，审核通过后由平台打款到账（非实时到账）</text></view>
              <view class="rule-item"><text class="rule-label">实名认证</text><text class="rule-text">依据法律法规要求，首次提现前需完成实名认证（仅需一次），认证后即可正常提现</text></view>
              <view class="rule-item"><text class="rule-label">收款授权</text><text class="rule-text">零钱提现首次需在微信中确认一次免确认收款授权，授权后后续提现无需重复操作</text></view>
              <view class="rule-item"><text class="rule-label">手续费</text><text class="rule-text">按提现金额的 {{ withdrawFeePercentLabel }} 收取，实际到账 = 提现金额 − 手续费</text></view>
            </view>
          </view>
          <template v-if="withdrawOption === 'BANK_CARD'">
            <!-- 到账银行卡：优先用「已绑定银行卡」（可多张），一张没绑时退回实名资料里的卡号 -->
            <view class="bank-row" @click="chooseBankCard">
              <text class="bank-row-label">到账银行卡</text>
              <text class="bank-row-value">{{ selectedBankCardLabel || '使用实名认证银行卡' }}</text>
              <text class="bank-row-arrow">›</text>
            </view>
            <text v-if="!bankCards.length" class="bank-hint">还没有绑定银行卡，点上方可去绑定；也可继续使用实名认证时填写的卡号。</text>
            <button class="panel-button" :disabled="withdrawSubmitting || realnameChecking" @click="handleWithdraw">
              {{ withdrawSubmitting ? '提交中...' : (realnameVerified ? '确认提现' : '实名绑定') }}
            </button>
          </template>
          <template v-else>
            <!-- 未完成免确认收款授权时引导授权，仅零钱提现需要此流程 -->
            <button v-if="!realnameVerified" class="panel-button" :disabled="withdrawSubmitting || realnameChecking" @click="handleWithdraw">
              {{ realnameChecking ? '查询中...' : '实名绑定' }}
            </button>
            <view v-else-if="authStatusError" class="auth-banner">
              <text class="auth-text">授权状态获取失败，请重试</text>
              <button class="panel-button" :disabled="authLoading" @click="refreshTransferAuth">
                {{ authLoading ? '刷新中...' : '刷新授权状态' }}
              </button>
            </view>
            <view v-else-if="needAuth" class="auth-banner">
              <text class="auth-text">{{ transferAuthState === 'WAIT_USER_CONFIRM' ? '授权未完成，请再次确认授权' : '首次零钱提现前需完成免确认收款授权，提交后由平台审核打款' }}</text>
              <button class="panel-button" :disabled="authApplying || authLoading" @click="handleAuthorize">
                {{ authApplying ? '授权中...' : (transferAuthState === 'WAIT_USER_CONFIRM' ? '重新授权' : '去授权') }}
              </button>
            </view>
            <button v-else class="panel-button" :disabled="withdrawSubmitting" @click="handleWithdraw">
              {{ withdrawSubmitting ? '提交中...' : '确认提现' }}
            </button>
          </template>
        </view>

        <view v-show="currentTab === 'transfer'" class="panel-card">
          <text class="panel-title">转账账号</text>
          <view class="search-row">
            <input v-model="transferUserId" class="panel-input search-input" maxlength="19" type="number" placeholder="请输入接收人账号或ID" />
            <button class="search-button" :disabled="searching" @click="handleSearchRecipient">
              {{ searching ? '查找中...' : '查找' }}
            </button>
          </view>
          <view v-if="recipient" class="recipient-card">
            <image v-if="recipient.avatarUrl" class="recipient-avatar" :src="recipient.avatarUrl" mode="aspectFill" />
            <view v-else class="recipient-avatar placeholder" />
            <view class="recipient-info">
              <text class="recipient-name">{{ recipient.nickname }}</text>
              <text class="recipient-id">ID: {{ recipient.id }}</text>
            </view>
          </view>
          <text class="panel-title panel-section-title">转出金额</text>
          <input v-model="transferAmount" class="panel-input" maxlength="11" type="digit" placeholder="请输入转出余额" />
          <button class="panel-button" :disabled="transferSubmitting" @click="handleTransfer">
            {{ transferSubmitting ? '提交中...' : '确认转账' }}
          </button>
        </view>

        <view class="records-card">
          <text class="records-title">提现记录</text>
          <view v-if="withdrawRecords.length" class="records-list">
            <view v-for="record in withdrawRecords" :key="record.withdrawNo" class="record-item">
              <view class="record-top">
                <text class="record-type">{{ record.withdrawMethod === 'BANK_CARD' ? '银行卡提现' : record.typeDesc }}</text>
                <text :class="['record-status', withdrawStatusClass(record.status)]">{{ record.statusDesc }}</text>
              </view>
              <view class="record-mid">
                <text class="record-amount">¥ {{ formatMoney(record.amount) }}</text>
                <text class="record-time">{{ record.createdAt }}</text>
              </view>
              <text v-if="record.failReason" class="record-reason">{{ record.failReason }}</text>
            </view>
          </view>
          <view v-else class="records-empty">{{ recordsLoading ? '加载中...' : '暂无提现记录' }}</view>
          <view v-if="!recordsFinished && withdrawRecords.length" class="records-more" @click="loadWithdrawRecords()">
            {{ recordsLoading ? '加载中...' : '加载更多' }}
          </view>
        </view>
      </view>
    </scroll-view>

    <view v-if="!registeredUser && !loginGuideVisible" class="access-empty">
      <text class="access-empty-title">登录后即可体验完整功能</text>
      <text class="access-empty-text">登录后即可使用余额转账和提现</text>
    </view>

    <view v-show="walletNoticeVisible" class="mask" @click="acknowledgeWalletNotice">
      <view class="notice-card" @click.stop>
        <view class="notice-head">
          <text class="notice-title">温馨提示</text>
          <text class="notice-close" @click="acknowledgeWalletNotice">×</text>
        </view>
        <text class="notice-body">余额按 1:1 提现，请确认提现方式、接收人和余额数无误。</text>
        <button class="notice-button" @click="acknowledgeWalletNotice">我知道了</button>
      </view>
    </view>

    <RealnameVerifySheet
      v-model="realnameVisible"
      :required-bank-info="withdrawOption === 'BANK_CARD'"
      @verified="handleRealnameVerified"
    />
    <LoginGuide v-model="loginGuideVisible" />
  </view>
</template>

<style>
.page { position: relative; height: 100vh; overflow: hidden; background: #f5f6f8; color: #172033; font-family: 'PingFang SC', '苹方-简', sans-serif; }
.nav { position: fixed; right: 0; left: 0; z-index: 20; display: flex; align-items: center; padding: 0 32rpx; box-sizing: border-box; background: #f5f6f8; }
.back-button { width: 34rpx; height: 34rpx; flex-shrink: 0; }
.nav-title { position: absolute; left: 50%; color: #111; font-size: 32rpx; font-weight: 600; transform: translateX(-50%); }
.nav-spacer { width: 34rpx; height: 34rpx; }
.page-scroll { position: absolute; inset: 0; width: 100%; height: 100%; box-sizing: border-box; }
.page-content { padding: 0 30rpx 56rpx; box-sizing: border-box; }
.access-empty { position: absolute; top: 50%; right: 0; left: 0; display: flex; align-items: center; flex-direction: column; transform: translateY(-50%); }
.access-empty-title { color: #172033; font-size: 30rpx; font-weight: 700; }
.access-empty-text { margin-top: 16rpx; color: #98a2b3; font-size: 24rpx; }
.hero-card { position: relative; overflow: hidden; margin-top: 20rpx; padding: 36rpx 30rpx 32rpx; border-radius: 28rpx; background: #ff6427; box-shadow: 0 14rpx 28rpx rgba(255, 90, 31, .22); color: #fff; }
.hero-card-bg { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; }
.hero-label { position: relative; z-index: 1; display: block; font-size: 24rpx; opacity: .92; }
.hero-value { position: relative; z-index: 1; display: block; margin-top: 10rpx; font-size: 64rpx; font-weight: 700; line-height: 1.1; }
.hero-subtitle { position: relative; z-index: 1; display: block; margin-top: 10rpx; color: rgba(255, 255, 255, .88); font-size: 22rpx; }
.flow-entry { display: flex; align-items: center; justify-content: space-between; margin-top: 20rpx; padding: 24rpx 28rpx; border-radius: 24rpx; background: #fff; box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, .06); }
.flow-entry-label { color: #172033; font-size: 28rpx; font-weight: 600; }
.flow-entry-arrow { color: #98a2b3; font-size: 34rpx; line-height: 1; }
.tab-row { display: flex; gap: 18rpx; margin-top: 22rpx; }
.tab-item { flex: 1; height: 76rpx; display: flex; align-items: center; justify-content: center; border-radius: 22rpx; background: #fff; color: #667085; font-size: 26rpx; font-weight: 600; box-shadow: 0 6rpx 16rpx rgba(15, 23, 42, .06); }
.tab-item.active { background: linear-gradient(135deg, #ff6a2b, #ff5a1f); color: #fff; }
.panel-card { margin-top: 20rpx; padding: 28rpx; border-radius: 24rpx; background: #fff; box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, .06); }
.panel-title { display: block; color: #111827; font-size: 28rpx; font-weight: 600; }
/* 到账银行卡选择行：银行卡提现专用（优先已绑卡，缺省用实名资料卡号） */
.bank-row { display: flex; align-items: center; justify-content: space-between; margin-top: 20rpx; padding: 22rpx; border-radius: 18rpx; background: #f8fafc; }
.bank-row-label { flex-shrink: 0; color: #475467; font-size: 25rpx; }
.bank-row-value { flex: 1; min-width: 0; margin-left: 16rpx; overflow: hidden; color: #111827; font-size: 25rpx; font-weight: 600; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.bank-row-arrow { margin-left: 10rpx; color: #98a2b3; font-size: 32rpx; line-height: 1; }
.bank-hint { display: block; margin-top: 12rpx; color: #98a2b3; font-size: 22rpx; line-height: 1.5; }
.panel-section-title { margin-top: 22rpx; }
.type-row { display: flex; gap: 16rpx; margin-top: 20rpx; }
.type-chip { flex: 1; height: 72rpx; display: flex; align-items: center; justify-content: center; border-radius: 18rpx; background: #f3f4f6; color: #475467; font-size: 24rpx; font-weight: 600; }
.type-chip.active { background: rgba(255, 106, 43, .12); color: #ff5a1f; border: 2rpx solid rgba(255, 106, 43, .35); }
.search-row { display: flex; gap: 16rpx; margin-top: 18rpx; }
.panel-input { height: 84rpx; padding: 0 22rpx; box-sizing: border-box; border-radius: 18rpx; background: #f8fafc; color: #111827; font-size: 26rpx; }
.fee-hint { display: block; margin-top: 14rpx; color: #b45309; font-size: 22rpx; line-height: 1.5; }
/* 锁定期提示条：后端 nextWithdrawableAt 非空（当前有订单仍在锁定期）时展示 */
.lock-banner { margin-top: 18rpx; padding: 20rpx 22rpx; border-radius: 18rpx; background: #fff7ed; border: 2rpx solid rgba(255, 106, 43, .25); }
.lock-text { color: #9a3412; font-size: 24rpx; line-height: 36rpx; }
/* 提现规则区块（微信审核要求：清晰展示门槛/额度/次数/提现与到账时间/实名/授权/手续费） */
.rule-card { margin-top: 22rpx; padding: 20rpx 22rpx; border-radius: 18rpx; background: #f8fafc; }
.rule-head { display: flex; align-items: center; justify-content: space-between; }
.rule-title { color: #111827; font-size: 26rpx; font-weight: 600; }
.rule-toggle { color: #ff5a1f; font-size: 22rpx; }
.rule-body { margin-top: 14rpx; }
.rule-item { display: flex; margin-bottom: 10rpx; }
.rule-item:last-child { margin-bottom: 0; }
.rule-label { flex-shrink: 0; width: 160rpx; color: #475467; font-size: 22rpx; line-height: 34rpx; }
.rule-text { flex: 1; min-width: 0; color: #667085; font-size: 22rpx; line-height: 34rpx; }
.fee-calc { display: block; margin-top: 8rpx; color: #ff5a1f; font-size: 24rpx; font-weight: 600; line-height: 1.5; }
.search-input { flex: 1; }
.search-button { flex-shrink: 0; width: 140rpx; height: 84rpx; border-radius: 18rpx; background: linear-gradient(135deg, #ff6a2b, #ff5a1f); color: #fff; font-size: 26rpx; font-weight: 600; }
.search-button::after, .panel-button::after, .notice-button::after { border: 0; }
.recipient-card { display: flex; align-items: center; gap: 16rpx; margin-top: 18rpx; padding: 18rpx; border-radius: 18rpx; background: #f8fafc; }
.recipient-avatar { width: 72rpx; height: 72rpx; border-radius: 50%; background: #d9dee7; }
.recipient-avatar.placeholder { background: linear-gradient(135deg, #d9dee7, #eef2f7); }
.recipient-info { display: flex; flex-direction: column; min-width: 0; }
.recipient-name { color: #111827; font-size: 26rpx; font-weight: 600; }
.recipient-id { margin-top: 6rpx; color: #667085; font-size: 22rpx; }
.panel-button { height: 84rpx; margin-top: 24rpx; border-radius: 18rpx; background: linear-gradient(135deg, #ff6a2b, #ff5a1f); color: #fff; font-size: 28rpx; font-weight: 600; }
.panel-button.ghost { margin-top: 16rpx; background: #fff; border: 2rpx solid rgba(255, 90, 31, .28); color: #ff5a1f; }
.notice-body { display: block; margin-top: 18rpx; color: #475467; font-size: 26rpx; line-height: 42rpx; }
.mask { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; padding: 40rpx; box-sizing: border-box; background: rgba(0, 0, 0, .56); }
.notice-card { width: 100%; padding: 28rpx 28rpx 30rpx; border-radius: 28rpx; background: #fff; box-sizing: border-box; }
.notice-head { position: relative; display: flex; align-items: center; justify-content: center; min-height: 52rpx; }
.notice-title { color: #111827; font-size: 32rpx; font-weight: 700; }
.notice-close { position: absolute; right: 0; color: #98a2b3; font-size: 42rpx; line-height: 1; }
.notice-button { height: 84rpx; margin-top: 26rpx; border-radius: 18rpx; background: linear-gradient(135deg, #ff6a2b, #ff5a1f); color: #fff; font-size: 28rpx; font-weight: 600; }
.auth-banner { display: flex; flex-direction: column; gap: 8rpx; margin-top: 22rpx; padding: 22rpx; border-radius: 18rpx; background: #fff7ed; border: 2rpx solid rgba(255, 106, 43, .25); }
.auth-text { color: #9a3412; font-size: 24rpx; line-height: 36rpx; }
.records-card { margin-top: 20rpx; padding: 28rpx; border-radius: 24rpx; background: #fff; box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, .06); }
.records-title { display: block; color: #111827; font-size: 28rpx; font-weight: 600; }
.records-list { margin-top: 8rpx; }
.record-item { padding: 22rpx 0; border-bottom: 2rpx solid #f1f3f6; }
.record-item:last-child { border-bottom: 0; }
.record-top { display: flex; align-items: center; justify-content: space-between; }
.record-type { color: #475467; font-size: 24rpx; font-weight: 600; }
.record-status { font-size: 22rpx; font-weight: 600; }
.record-status.pending { color: #d97706; }
.record-status.approved { color: #2563eb; }
.record-status.success { color: #16a34a; }
.record-status.failed { color: #dc2626; }
.record-status.rejected { color: #9ca3af; }
.record-status.stuck { color: #dc2626; }
.record-mid { display: flex; align-items: baseline; justify-content: space-between; margin-top: 8rpx; }
.record-amount { color: #111827; font-size: 30rpx; font-weight: 700; }
.record-time { color: #98a2b3; font-size: 22rpx; }
.record-reason { display: block; margin-top: 8rpx; color: #dc2626; font-size: 22rpx; line-height: 1.5; }
.records-empty { padding: 30rpx 0; text-align: center; color: #98a2b3; font-size: 24rpx; }
.records-more { margin-top: 18rpx; padding: 16rpx 0; text-align: center; color: #ff5a1f; font-size: 24rpx; font-weight: 600; }

/* 模块停用拦截提示 */
.module-blocked { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; padding: 40rpx; text-align: center; }
.module-blocked-title { color: #1f2937; font-size: 32rpx; font-weight: 600; }
.module-blocked-desc { margin-top: 16rpx; color: #98a2b3; font-size: 26rpx; line-height: 1.6; }
</style>
