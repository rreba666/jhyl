<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad, onShareAppMessage, onShow } from '@dcloudio/uni-app'
import { getPromotionRecords, getPromotionSummary, type PromotionRecord, type PromotionSummary } from '@/api/promotion'
import { convertWallet, getUserProfile, getWalletInfo, type UserProfile, type WalletInfo } from '@/api/user'
import { isLoggedIn, isRegisteredUser } from '@/utils/auth'
import { bindStoredPromotionIfLoggedIn, buildPromotionSharePath, capturePromotionContext } from '@/utils/promotion'
import { formatPromotionQueryDate, getFrozenPromotionAmount, getPromotionFreezeDays, getPromotionFreezeMs, hasUnsettledPromotionAmount, isUnsettledPromotion, loadWithdrawPayLockDays, readUnsettledPromotionAmount } from '@/utils/promotion-freeze'
import { resolvePromotionSettlement, savePromotionSettlement, syncPromotionSettlement } from '@/utils/promotion-settlement'
import { createThrottle } from '@/utils/interaction'
import { isApiRequestError } from '@/utils/request'
import { useConvertRealnameGate } from '@/utils/realname-gate'
import LoginGuide from '@/components/LoginGuide.vue'
import RealnameVerifySheet from '@/components/RealnameVerifySheet.vue'
import { useModuleGuard } from '@/utils/config'

/** promotion 模块守卫：停用则拦截推广/红包（深链防护）。 */
const { moduleEnabled: promotionEnabled, loadModuleConfig: loadPromotionModule } = useModuleGuard('promotion')

/**
 * 转余额实名门禁（2026-09-22）：推广金转余额与红包转余额共用 `convertWallet()`，
 * 同样要把实名卡在「变成通用余额」这一步。只加「前置门禁 + 8601 兜底」，
 * 完全不动 `promotion-settlement` 兜底结算与 `promotionStatus` 待到账口径。
 */
const { sheetVisible: realnameSheetVisible, ensureRealname, handleVerified: handleRealnameVerified, handleConvertDenied } = useConvertRealnameGate()

const menuTop = ref(0)
const menuHeight = ref(32)
const user = ref<UserProfile | null>(null)
const wallet = ref<WalletInfo | null>(null)
const promotionSummary = ref<PromotionSummary | null>(null)
const promotionRecords = ref<PromotionRecord[]>([])
const frozenPromotionRecords = ref<PromotionRecord[]>([])
const promotionPage = ref(1)
const promotionTotal = ref(0)
const promotionLoading = ref(false)
const promotionLoadingMore = ref(false)
const promotionClock = ref(Date.now())
const loading = ref(false)
const converting = ref(false)
const accessChecking = ref(false)
const accessDenied = ref(false)
const loginGuideVisible = ref(false)
const navigationThrottle = createThrottle(500)
let pageLoadPromise: Promise<void> | null = null
const registeredUser = computed(() => isRegisteredUser(user.value?.identity))
/** 兜底估算的待到账金额：仅在「后端未下发 unsettledPromotion」时才会真正拉 60 天明细。 */
const frozenPromotionAmount = computed(() => getFrozenPromotionAmount(frozenPromotionRecords.value, promotionClock.value))

/**
 * 后端是否已下发权威的「待到账推广金」字段（推广汇总优先，其次钱包）。
 * 两处都缺失（旧版后端）时才回退到本地按记录时间估算。
 */
const unsettledPromotionFromBackend = computed(() => hasUnsettledPromotionAmount(promotionSummary.value) || hasUnsettledPromotionAmount(wallet.value))

/**
 * 待到账推广金（元）：**优先取后端字段**（推广汇总 → 钱包），
 * 仅当两处都没有该字段时才回退到 `getFrozenPromotionAmount` 的时间口径估算。
 */
const promotionUnsettledAmount = computed(() => {
  const fromSummary = readUnsettledPromotionAmount(promotionSummary.value)
  if (fromSummary !== null) return fromSummary
  const fromWallet = readUnsettledPromotionAmount(wallet.value)
  return fromWallet !== null ? fromWallet : frozenPromotionAmount.value
})

/** 自定义导航栏样式，和微信胶囊按钮保持同一高度。 */
const navStyle = computed(() => ({ top: `${menuTop.value}px`, height: `${menuHeight.value}px` }))

/** 内容区从胶囊按钮下方开始，避免标题被系统导航遮挡。 */
const bodyStyle = computed(() => ({ paddingTop: `${menuTop.value + menuHeight.value + uni.upx2px(100)}px` }))

/** 当前已入账、可转余额的推广金；待到账部分不参与转余额。 */
const withdrawablePromotion = computed(() => {
  const value = Number(promotionSummary.value?.pendingPromotion ?? wallet.value?.pendingPromotion)
  return Number.isFinite(value) && value > 0 ? value : 0
})

/**
 * 当前推广收益展示合计 = 可转余额 + 待到账，与后端口径
 * （`pendingPromotion + unsettledPromotion`）一致，仅用于展示。
 */
const displayedPromotionAmount = computed(() => withdrawablePromotion.value + promotionUnsettledAmount.value)

/**
 * 转余额兜底：后端转余额会把 `pendingPromotion` 清零（可转的部分都转走了，这是正确结果）。
 * 页面展示合计仍按「可转余额 + 待到账」计算，理论上不会归零；但后端字段短暂未追平（缓存/延迟）时
 * 用「转账前展示合计 − 实际转入余额金额」兜底，避免推广金瞬间显示为 0
 * （详见 utils/promotion-settlement.ts）。
 */
const promotionDisplay = computed(() => resolvePromotionSettlement(displayedPromotionAmount.value, user.value?.id))
/** 最终对外展示的推广金合计（后端尚未追平时为本地兜底值）。 */
const promotionBalanceAmount = computed(() => promotionDisplay.value.amount)
/** 是否处于「结算中」（当前展示的是本地兜底值，后端数据尚未追平）。 */
const promotionSettling = computed(() => promotionDisplay.value.settling)

/** 累计推广金额，接口失败时保持真实空态；口径与首页展示合计一致（含冻结/结算中金额）。 */
const totalPromotionText = computed(() => {
  if (!promotionSummary.value) return '--'
  return formatMoney(promotionBalanceAmount.value)
})

/** 已绑定用户数量，接口失败时保持真实空态。 */
const boundUserCountText = computed(() => formatIntegerOrPlaceholder(promotionSummary.value?.boundUserCount))

/** 是否还有未加载的推广明细。 */
const hasMorePromotionRecords = computed(() => promotionRecords.value.length < promotionTotal.value)

/** 将可选人数格式化为整数，否则显示空态。 */
function formatIntegerOrPlaceholder(value: unknown): string {
  const count = Number(value)
  return Number.isInteger(count) && count >= 0 ? String(count) : '--'
}

/** 将接口日期压缩成设计稿可容纳的短日期时间。 */
function formatDate(value: string | null | undefined): string {
  if (!value) return '--'
  return value.replace(' ', '\n').slice(0, 16)
}

/** 将金额显示为两位小数，保持卡片数字宽度稳定。 */
function formatMoney(value: unknown): string {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00'
}

/** 加载当前用户钱包信息，接口失败时保留页面结构并提示。 */
async function loadWallet(): Promise<void> {
  if (!registeredUser.value) return
  loading.value = true
  try {
    wallet.value = await getWalletInfo()
  } catch (error) {
    wallet.value = null
    uni.showToast({ title: error instanceof Error ? error.message : '收益信息加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

/** 加载推广汇总，失败时只保留统计卡空态。 */
async function loadPromotionSummary(): Promise<void> {
  if (!registeredUser.value) return
  try {
    promotionSummary.value = await getPromotionSummary()
  } catch (error) {
    promotionSummary.value = null
    uni.showToast({ title: error instanceof Error ? error.message : '推广汇总加载失败', icon: 'none' })
  }
}

/** 加载推广明细首屏数据。 */
async function loadPromotionRecords(): Promise<void> {
  if (!registeredUser.value) return
  promotionLoading.value = true
  try {
    const result = await getPromotionRecords({ page: 1, pageSize: 10 })
    promotionRecords.value = result.list || []
    promotionPage.value = result.page || 1
    promotionTotal.value = result.total || 0
  } catch (error) {
    promotionRecords.value = []
    promotionTotal.value = 0
    uni.showToast({ title: error instanceof Error ? error.message : '推广明细加载失败', icon: 'none' })
  } finally {
    promotionLoading.value = false
  }
}

/**
 * 【兜底】查询锁定期窗口内的推广记录，完整计算当前仍待到账的推广金。
 * 仅在 `unsettledPromotionFromBackend` 为 false（后端未下发该字段）时才会调用。
 * 窗口长度取当前生效的锁定期毫秒数（后端 payLockDays，默认 10 天），与后端提现锁口径一致。
 */
async function loadFrozenPromotionRecords(): Promise<void> {
  if (!registeredUser.value) return
  const now = Date.now()
  promotionClock.value = now
  const startTime = formatPromotionQueryDate(now - getPromotionFreezeMs())
  const endTime = formatPromotionQueryDate(now)
  const recentRecords: PromotionRecord[] = []
  let page = 1
  let total = 0
  try {
    do {
      const result = await getPromotionRecords({ startTime, endTime, page, pageSize: 100 })
      recentRecords.push(...(result.list || []))
      total = Number(result.total) || recentRecords.length
      page += 1
      if (!result.list?.length) break
    } while (recentRecords.length < total && page <= 5)
    frozenPromotionRecords.value = recentRecords
  } catch {
    // 待到账金额是增强展示，查询失败时保留后端确认金额，不影响转余额。
    frozenPromotionRecords.value = []
  }
}

/** 滚动到底部时继续加载推广明细。 */
async function loadMorePromotionRecords(): Promise<void> {
  if (!registeredUser.value) return
  if (promotionLoading.value || promotionLoadingMore.value || !hasMorePromotionRecords.value) return
  promotionLoadingMore.value = true
  try {
    const result = await getPromotionRecords({ page: promotionPage.value + 1, pageSize: 10 })
    promotionRecords.value = promotionRecords.value.concat(result.list || [])
    promotionPage.value = result.page || promotionPage.value + 1
    promotionTotal.value = result.total || promotionTotal.value
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '推广明细加载失败', icon: 'none' })
  } finally {
    promotionLoadingMore.value = false
  }
}


/**
 * 将推广积分一键转入余额；转后立即按「转账前合计 − 实际到账金额」兜底展示，不依赖后端轮询。
 * 转余额前先过实名门禁；认证通过后自动续跑本次转账（用户无需再点一次）。
 */
async function handleConvertPromotion(): Promise<void> {
  if (!registeredUser.value) {
    denyGuestAccess()
    return
  }
  if (converting.value) return
  if (withdrawablePromotion.value <= 0) {
    uni.showToast({ title: '暂无可转余额', icon: 'none' })
    return
  }
  // 前置门禁：未实名先完成实名认证，通过后自动续跑 handleConvertPromotion()
  if (!(await ensureRealname(() => { void handleConvertPromotion() }))) return
  converting.value = true
  try {
    // 转账前的展示合计与余额：用于计算"本次实际转入余额的金额"（余额增量最可信，用户可自行核对）
    const beforeDisplay = displayedPromotionAmount.value
    const beforeBalance = Number(wallet.value?.balance || 0)
    // 直接调用 /api/wallet/convert，避免前端只改界面不改余额。
    await convertWallet('PROMOTION')
    await Promise.all([loadWallet(), loadPromotionSummary()])
    // 后端仍未下发 unsettledPromotion 时，重拉兜底明细，保证兜底值里包含"仍待到账"的那部分推广金
    if (!unsettledPromotionFromBackend.value) await loadFrozenPromotionRecords()
    const transferred = Math.max(0, Number(wallet.value?.balance || 0) - beforeBalance)
    // 兜底：转账后仍应展示的推广金 = 转账前合计 − 实际到账金额（待到账部分不该凭空消失）
    savePromotionSettlement(user.value?.id, Math.max(0, beforeDisplay - transferred))
    // 立即按兜底口径重算并落一次展示，避免后端 pending 清零期间页面显示 0
    syncPromotionSettlement(displayedPromotionAmount.value, user.value?.id)
    uni.showToast({ title: '已转入余额', icon: 'success' })
  } catch (error) {
    // 兜底：后端返回 8601（未实名）时给出明确引导并打开实名弹层，认证后自动续跑
    if (isApiRequestError(error) && error.code === 8601) {
      handleConvertDenied(() => { void handleConvertPromotion() })
      return
    }
    uni.showToast({ title: error instanceof Error ? error.message : '转余额失败', icon: 'none' })
  } finally {
    converting.value = false
  }
}

/**
 * 查看待到账推广金的规则说明（金额取兜底后的展示值，与卡片一致）。
 * 后端已下发权威字段时说明金额来源是后端「待到账」口径；
 * 字段缺失（旧版后端）时说明是按锁定期天数估算，避免用户误以为数字取错。
 */
function showPromotionIncomeInfo(): void {
  const total = promotionBalanceAmount.value
  const withdrawable = withdrawablePromotion.value
  const unsettled = promotionUnsettledAmount.value
  const freezeDays = getPromotionFreezeDays()
  const unsettledExplanation = unsettledPromotionFromBackend.value
    ? `待到账推广金是已产生、平台尚未结算到账的推广收益，结算后即可正常使用。`
    : `待到账推广金是最近 ${freezeDays} 天内产生、暂时不能转余额的推广收益，结算期满后即可正常使用。`
  // 结算中：后端数据尚未追平「可转 + 待到账 = 合计」的等式，改用说明口径，避免用户看到数字对不上
  const content = promotionSettling.value
    ? `你刚刚将推广金转入了余额，页面仍显示 ${formatMoney(total)} 元（其中待到账推广金 ${formatMoney(unsettled)} 元），最迟 1 小时内更新为最新金额。${unsettledExplanation}`
    : `当前推广收益 ${formatMoney(total)} 元，其中可转余额 ${formatMoney(withdrawable)} 元，待到账推广金 ${formatMoney(unsettled)} 元。${unsettledExplanation}`
  uni.showModal({
    title: '推广收益说明',
    content,
    showCancel: false,
    confirmText: '知道了',
  })
}

/** 打开微信分享能力，具体分享内容由 onShareAppMessage 返回。 */
function handleShare(): void {
  if (!registeredUser.value) {
    denyGuestAccess()
    return
  }
  uni.showShareMenu({ withShareTicket: true })
}

/** 进入统一钱包页，余额提现与转账统一在钱包页完成。 */
function goWallet(): void {
  if (!navigationThrottle()) return
  if (!registeredUser.value) {
    denyGuestAccess()
    return
  }
  uni.navigateTo({ url: '/subpkg-wallet/withdraw/withdraw' })
}

/** 拦截游客访问推广中心，并返回个人中心等待后端身份升级。 */
function denyGuestAccess(): void {
  if (accessDenied.value) return
  accessDenied.value = true
  uni.showToast({ title: '完成订单后开放推广功能', icon: 'none' })
  setTimeout(() => uni.switchTab({ url: '/pages/mine/mine' }), 650)
}

/** 刷新用户身份，只有注册用户才加载推广中心数据。 */
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

/** 初始化或刷新推广中心，身份升级后重新进入即可获得完整功能。 */
async function loadPage(): Promise<void> {
  if (!(await ensureRegisteredAccess())) return
  // 首页明细列表始终要拉（展示用）；后端已下发 unsettledPromotion 时不再拉 60 天明细做汇总
  await Promise.all([loadWallet(), loadPromotionSummary(), loadPromotionRecords()])
  if (!unsettledPromotionFromBackend.value) {
    // 兜底路径：旧版后端没有 unsettledPromotion，先校准锁定期天数（payLockDays）再按窗口查询明细
    await loadWithdrawPayLockDays()
    await loadFrozenPromotionRecords()
  }
  // 数据加载完成后校准兜底快照：后端已追平则清除，仍处于结算中则继续按兜底值展示
  syncPromotionSettlement(displayedPromotionAmount.value, user.value?.id)
}

/** 合并首次挂载与重新显示时的并发刷新，避免重复请求推广数据。 */
function refreshPage(): Promise<void> {
  if (pageLoadPromise) return pageLoadPromise
  const pending = loadPage()
  pageLoadPromise = pending
  pending.then(
    () => { if (pageLoadPromise === pending) pageLoadPromise = null },
    () => { if (pageLoadPromise === pending) pageLoadPromise = null },
  )
  return pending
}

/** 返回来源页面，没有历史页面时回到个人中心。 */
function goBack(): void {
  if (!navigationThrottle()) return
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1 })
    return
  }
  uni.switchTab({ url: '/pages/mine/mine' })
}

/** 配置微信转发卡片，转发后仍回到推广收益页。 */
onShareAppMessage(() => {
  const path = buildPromotionSharePath('/pages/index/index')
  return { title: '今华有肽，年轻常在', path, imageUrl: '/static/logo.webp' }
})

/** 捕获推广收益页的原生分享参数，兼容已登录用户扫码后直接补绑定。 */
onLoad((options) => {
  capturePromotionContext(options as Record<string, unknown>)
  void bindStoredPromotionIfLoggedIn()
})

onMounted(() => {
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect) {
      menuTop.value = rect.top
      menuHeight.value = rect.height
    }
  } catch { /* 非微信环境没有胶囊按钮 */ }
  void refreshPage()
  void loadPromotionModule()
})

onShow(() => {
  void refreshPage()
})
</script>

<template>
  <view class="page">
    <view class="nav" :style="navStyle">
      <image class="back-button" src="/static/left_arrow.webp" mode="aspectFit" @click="goBack" />
    </view>

    <!-- promotion 模块停用：拦截推广/红包（深链防护） -->
    <view v-if="!promotionEnabled" class="module-blocked">
      <text class="module-blocked-title">推广功能未开通</text>
      <text class="module-blocked-desc">当前商户未开通分销推广模块，推广与红包暂不可用。</text>
    </view>

    <scroll-view v-if="registeredUser && promotionEnabled" class="page-scroll" scroll-y :style="bodyStyle" @scrolltolower="loadMorePromotionRecords">
      <view class="page-content">
        <view class="share-heading">
          <text class="share-title">分享赚钱</text>
          <text class="share-subtitle">即刻兑现</text>
        </view>

        <view class="balance-card">
          <image class="promotion-background" src="/static/Promotion/推广背景_slices/推广背景@2x.webp" mode="scaleToFill" />
          <view class="balance-amount">
            <text class="balance-value" @click="showPromotionIncomeInfo">{{ formatMoney(promotionBalanceAmount) }}</text>
            <text v-if="promotionSettling" class="balance-settling" @click="showPromotionIncomeInfo">结算中</text>
          </view>
          <view class="card-actions">
            <view class="wallet-button" :class="{ disabled: converting }" @click="handleConvertPromotion">转余额</view>
            <view class="wallet-button wallet-link" @click="goWallet">钱包提现</view>
          </view>
        </view>

        <view class="share-actions">
          <button class="share-button" open-type="share" @click="handleShare">立即分享赚钱 <view class="share-arrow" /></button>
        </view>

        <view class="stats-row">
          <view class="stat-card">
            <image class="stat-icon-image" src="/static/Promotion/推广金_slices/推广金.webp" mode="aspectFit" />
            <view class="stat-copy">
              <text class="stat-value">{{ totalPromotionText }}</text>
              <text class="stat-label">累计推广（元）</text>
            </view>
          </view>
          <view class="stat-card">
            <image class="stat-icon-image" src="/static/Promotion/绑定人数_slices/绑定人数.webp" mode="aspectFit" />
            <view class="stat-copy">
              <text class="stat-value">{{ boundUserCountText }}</text>
              <text class="stat-label">绑定总数（人）</text>
            </view>
          </view>
        </view>

        <view class="promotion-section">
          <text class="promotion-title">推广数据</text>
          <view class="table-head">
            <text>用户名</text>
            <text>下单时间</text>
            <text>下单金额</text>
            <text>推广金</text>
          </view>
          <view class="table-line" />
          <view v-show="promotionLoading" class="promotion-empty">
            <text>推广数据加载中...</text>
          </view>
          <view v-show="!promotionLoading && !promotionRecords.length" class="promotion-empty">
            <text>暂无推广数据</text>
          </view>
          <view v-show="!promotionLoading && promotionRecords.length" class="promotion-list">
            <view v-for="record in promotionRecords" :key="record.orderNo" class="promotion-row">
              <text class="promotion-cell buyer-name">{{ record.buyerName || '--' }}</text>
              <text class="promotion-cell order-time">{{ formatDate(record.createTime) }}</text>
              <text class="promotion-cell order-amount">{{ formatMoney(record.payAmount) }}</text>
              <view class="promotion-cell promotion-amount"><text>+{{ formatMoney(record.amount) }}</text><text v-if="isUnsettledPromotion(record)" class="promotion-frozen-mark">待到账</text></view>
            </view>
            <view v-show="promotionLoadingMore" class="promotion-more">加载中...</view>
            <view v-show="!promotionLoadingMore && !hasMorePromotionRecords" class="promotion-more">已加载全部</view>
          </view>
        </view>
      </view>
    </scroll-view>

    <view v-if="!registeredUser && !loginGuideVisible" class="access-empty">
      <text class="access-empty-title">登录后即可体验完整功能</text>
      <text class="access-empty-text">登录后即可查看推广收益和推广数据</text>
    </view>

    <LoginGuide v-model="loginGuideVisible" />

    <!-- 转余额实名弹层：前置门禁与 8601 兜底共用；认证成功后自动续跑转余额 -->
    <RealnameVerifySheet v-model="realnameSheetVisible" @verified="handleRealnameVerified" />

  </view>
</template>

<style>
.page { position: relative; height: 100vh; overflow: hidden; background: #fff; color: #000; font-family: '苹方-简', 'PingFang SC', sans-serif; font-weight: 600; }
.page button, .page input { font-family: '苹方-简', 'PingFang SC', sans-serif; font-weight: 600; }
.nav { position: fixed; right: 0; left: 0; z-index: 20; display: flex; align-items: center; padding-left: 40rpx; background: #fff; box-sizing: border-box; }
.back-button { width: 40rpx; height: 40rpx; }
.page-scroll { position: absolute; inset: 0; width: 100%; height: 100%; box-sizing: border-box; }
.page-content { padding: 0 0 100rpx; box-sizing: border-box; }
.access-empty { position: absolute; top: 50%; right: 0; left: 0; display: flex; align-items: center; flex-direction: column; transform: translateY(-50%); }
.access-empty-title { color: #222; font-size: 30rpx; font-weight: 700; }
.access-empty-text { margin-top: 16rpx; color: #959595; font-size: 24rpx; }
.share-heading { display: flex; align-items: baseline; height: 40rpx; }
.share-heading { margin-left: 40rpx; }
.share-title { color: #000; font-size: 26.72rpx; line-height: 26.72rpx; }
.share-subtitle { margin-left: 10rpx; color: #959595; font-size: 22.9rpx; line-height: 22.9rpx; }
.balance-card { position: relative; width: 756rpx; max-width: calc(100% - 32rpx); height: 176rpx; margin: 24rpx 16rpx 0; overflow: hidden; }
.promotion-background { position: absolute; inset: 0; z-index: 0; display: block; width: 100%; height: 100%; }
.balance-amount { position: absolute; bottom: 34rpx; left: 64rpx; z-index: 1; display: flex; align-items: center; }
.balance-value { color: #fbd69d; font-size: 45.8rpx; font-weight: 600; line-height: 54.96rpx; }
/* 「结算中」标记：转余额后后端 pending 尚未追平，展示的是本地兜底值 */
.balance-settling { margin-left: 12rpx; padding: 2rpx 10rpx; border: 1rpx solid #fbd69d; color: #fbd69d; font-size: 18rpx; line-height: 26rpx; }
.card-actions { position: absolute; right: 62rpx; bottom: 40rpx; z-index: 1; display: flex; align-items: center; gap: 24rpx; }
.wallet-button { display: flex; align-items: center; justify-content: center; width: 136rpx; height: 56rpx; box-sizing: border-box; border: 1rpx solid #fbd69d; color: #fbd69d; background: transparent; font-size: 22.9rpx; white-space: nowrap; }
.wallet-button.wallet-link { color: #000; background: #fbd69d; }
.wallet-button.disabled { opacity: .65; }
.share-button { display: flex; align-items: center; justify-content: center; width: 445rpx; height: 64rpx; margin: 52rpx auto 0; padding: 0; border: 1rpx solid #000; border-radius: 0; color: #000; background: #fff; font-size: 22.9rpx; line-height: 64rpx; }
.share-button::after { border: 0; }
.share-actions { display: flex; align-items: center; justify-content: center; gap: 16rpx; margin-top: 52rpx; }
.share-actions .share-button { margin: 0; }
.share-arrow { position: relative; width: 28rpx; height: 1rpx; margin-left: 12rpx; background: #000; }
.share-arrow::after { position: absolute; top: -4rpx; right: 0; width: 8rpx; height: 8rpx; border-top: 1rpx solid #000; border-right: 1rpx solid #000; content: ''; transform: rotate(45deg); }
.stats-row { display: flex; gap: 26rpx; margin: 48rpx 40rpx 0; }
.stat-card { display: flex; flex: none; align-items: center; width: 340rpx; height: 136rpx; padding: 0 28rpx; box-sizing: border-box; background: #f6f6f6; }
.stat-icon-image { width: 88rpx; height: 88rpx; flex-shrink: 0; }
.stat-copy { display: flex; min-width: 0; height: 88rpx; flex-direction: column; justify-content: space-between; margin-left: 28rpx; }
.stat-value { color: #4f4f4f; font-size: 45.8rpx; font-weight: 600; line-height: 54.96rpx; }
.stat-label { color: #959595; font-size: 22.9rpx; line-height: 28rpx; white-space: nowrap; }
.promotion-section { margin-top: 94rpx; }
.promotion-title { display: block; margin-left: 56rpx; color: #000; font-size: 26.72rpx; line-height: 40rpx; }
.table-head { display: grid; grid-template-columns: 200rpx 194rpx 212rpx 72rpx; width: 678rpx; margin: 32rpx 0 0 56rpx; color: #959595; font-size: 22.9rpx; line-height: 34rpx; }
.table-head text:nth-child(n + 2) { text-align: center; }
.table-head text:last-child { text-align: right; }
.table-line { height: 1rpx; margin: 14rpx 40rpx 0; background: #f6f6f6; }
.promotion-empty { display: flex; align-items: center; justify-content: center; height: 120rpx; color: #959595; font-size: 22.9rpx; }
.promotion-list { margin-top: 12rpx; }
.promotion-row { display: grid; grid-template-columns: 202rpx 216rpx 190rpx 98rpx; min-height: 100rpx; margin: 0 40rpx; align-items: center; border-bottom: 1rpx solid #f6f6f6; color: #959595; font-size: 20rpx; line-height: 26rpx; }
.promotion-cell { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre-line; }
.order-time, .order-amount { text-align: center; }
.promotion-amount { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; color: #010101; text-align: right; }
/* 明细行「待到账」标记：优先按后端 promotionStatus 判断，字段缺失时回退到锁定期时间口径 */
.promotion-frozen-mark { margin-top: 4rpx; padding: 2rpx 8rpx; color: #b4772f; background: #fff4e5; font-size: 18rpx; line-height: 22rpx; }
.promotion-more { padding: 18rpx 0; color: #959595; font-size: 20rpx; text-align: center; }
.sheet-head { position: relative; display: flex; align-items: center; justify-content: center; min-height: 54rpx; }
.sheet-title { color: #222; font-size: 30rpx; font-weight: 600; }
.sheet-close { position: absolute; right: 0; color: #888; font-size: 42rpx; line-height: 42rpx; }

/* 模块停用拦截提示 */
.module-blocked { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; padding: 40rpx; text-align: center; }
.module-blocked-title { color: #1f2937; font-size: 32rpx; font-weight: 600; }
.module-blocked-desc { margin-top: 16rpx; color: #98a2b3; font-size: 26rpx; line-height: 1.6; }
</style>
