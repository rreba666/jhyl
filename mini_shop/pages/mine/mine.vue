<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getUserProfile, getWalletInfo, updateUserProfile, type UserProfile, type WalletInfo } from '@/api/user'
import { clearAuth, getAuth, isLoggedIn, isRegisteredUser } from '@/utils/auth'
import { getPromotionCode } from '@/api/promotion'
import { getAnnouncementList, type Announcement } from '@/api/announcement'
import { uploadFile } from '@/utils/request'
import { hasUnsettledPromotionAmount, loadFrozenPromotionAmount, loadWithdrawPayLockDays } from '@/utils/promotion-freeze'
import { clearPromotionSettlement, resolvePromotionSettlement, syncPromotionSettlement } from '@/utils/promotion-settlement'
import { createThrottle } from '@/utils/interaction'
import { validateText } from '@/utils/input-validation'
import PromotionCodePoster from '@/components/PromotionCodePoster.vue'
import LoginGuide from '@/components/LoginGuide.vue'
import { getModules, isModuleEnabled, type ModuleConfig } from '@/utils/config'
import { getIdentity, switchIdentity, type IdentityItem, type IdentityVO } from '@/api/identity'

const menuTop = ref(0)
const menuHeight = ref(32)
const bodyTop = computed(() => menuTop.value + menuHeight.value + 12)

/** 当前品牌模块开关（空 = 未配置/拉取失败，按全部启用兜底，兼容线上）。 */
const moduleConfig = ref<ModuleConfig[] | null>(null)

const user = ref<UserProfile | null>(null)
const wallet = ref<WalletInfo | null>(null)
const profileEditorVisible = ref(false)
const profileSaving = ref(false)
const avatarUploading = ref(false)
/** chooseAvatar 选中的临时头像路径（保存成功后清空）。 */
const avatarTempPath = ref('')
const profileForm = reactive({ nickname: '', avatarUrl: '' })
const registeredUser = computed(() => isRegisteredUser(user.value?.identity))
/** 当前登录用户 ID：资料未加载完成时用本地登录态兜底，保证结算兜底快照能按用户隔离。 */
const authUserId = computed(() => user.value?.id ?? getAuth()?.userId ?? '')
/** 身份列表（可切换身份 + 待开通占位）；未登录/无身份时为 null。 */
const identity = ref<IdentityVO | null>(null)
/** 身份切换进行中标记。 */
const identitySwitching = ref(false)
const promotionFrozenAmount = ref(0)
/** 后端是否已下发权威的「待到账推广金」字段（`/api/wallet/info` 的 unsettledPromotion）。 */
const unsettledPromotionFromBackend = computed(() => hasUnsettledPromotionAmount(wallet.value))
/**
 * 待到账推广金（元）：**优先取后端字段**，仅在字段缺失（旧版后端）时使用 `promotionFrozenAmount`
 * 的本地时间口径估算值。
 */
const unsettledPromotionAmount = computed(() => (
  unsettledPromotionFromBackend.value ? Number(wallet.value?.unsettledPromotion) : promotionFrozenAmount.value
))
/**
 * 推广收益实时合计 = 钱包可转余额（pendingPromotion）+ 待到账推广金，口径与后端
 * `pendingPromotion + unsettledPromotion` 及推广页保持一致。
 */
const promotionDisplayAmount = computed(() => {
  const withdrawable = Number(wallet.value?.pendingPromotion || 0)
  return (Number.isFinite(withdrawable) ? withdrawable : 0) + unsettledPromotionAmount.value
})
/**
 * 转余额结算兜底：后端转余额会把 `pendingPromotion` 清零（可转的部分都转走了，这是正确结果），
 * 但后端字段短暂未追平（缓存/延迟）时个人页的「推广收益」可能偏小；
 * 这里取"实时值 vs 本地兜底值"较大者并标记「结算中」。
 */
const promotionIncomeDisplay = computed(() => resolvePromotionSettlement(promotionDisplayAmount.value, authUserId))
/** 最终展示的推广收益金额（后端未追平时为本地兜底值）。 */
const promotionIncomeAmount = computed(() => promotionIncomeDisplay.value.amount)
/** 推广收益是否处于「结算中」（当前展示的是本地兜底值）。 */
const promotionSettling = computed(() => promotionIncomeDisplay.value.settling)
/** 启用中的公告列表（公开接口，个人页订单模块下方横向滚动展示）。 */
const announcements = ref<Announcement[]>([])
const announcementVisible = ref(false)
const activeAnnouncement = ref<Announcement | null>(null)

// 仅映射设计稿中已有的本地切图，缺失资源的条目由模板保留占位块。
const orderEntries = [
  { key: 'pending', label: '待付款', icon: '/static/my/待付款_slices/待付款.png' },
  { key: 'shipped', label: '待发货', icon: '/static/my/待发货_slices/待发货.jpg' },
  { key: 'received', label: '待收货', icon: '/static/my/待收货_slices/待收货.jpg' },
  { key: 'pickup', label: '待自提', icon: '/static/my/待自提_slices/待自提.jpg' },
  { key: 'completed', label: '退款/售后', icon: '/static/my/售后_slices/售后.jpg' },
]

/** 订单入口可见性按模块开关过滤：待发货/待收货→delivery，待自提→pickup，退款/售后→aftersale，待付款→basic 恒开。 */
const visibleOrderEntries = computed(() => {
  const modules = moduleConfig.value
  const moduleOf: Record<string, string> = {
    pending: 'basic',
    shipped: 'delivery',
    received: 'delivery',
    pickup: 'pickup',
    completed: 'aftersale',
  }
  return orderEntries.filter((entry) => isModuleEnabled(modules, moduleOf[entry.key] || 'basic'))
})

const menuItems = [
  { key: 'invoice', label: '发票记录', icon: '/static/my/发票.png' },
  { key: 'settings', label: '设置', icon: '/static/my/设置_slices/设置.png' },
  { key: 'service', label: '客服', icon: '/static/my/客服_slices/客服.png' },
  { key: 'favorite', label: '我的收藏', icon: '/static/my/收藏_slices/收藏.png' },
  { key: 'materials', label: '商品素材', icon: '/static/my/商品素材_slices/商品素材.png' },
  { key: 'merchant-apply', label: '商家入驻', icon: '/static/my/商品素材_slices/商品素材.png' },
  // 2026-09-22 用户要求：「用户协议」「隐私保护指引」**不在个人中心显示**，入口已挪到「设置」页。
  // 协议页本身（pages/user-agreement、pages/privacy）保留不动 —— 必须仍然可达。
]

/** 功能菜单可见性按模块开关过滤：发票记录→invoice，其余条目不受模块控制（basic/通用）。客服项单独渲染（微信原生客服）。 */
const visibleMenuItems = computed(() => {
  const modules = moduleConfig.value
  const moduleOf: Record<string, string> = { invoice: 'invoice' }
  return menuItems.filter((item) => {
    if (item.key === 'service') return false
    // 已是某商家身份 → 隐藏「商家入驻」（一人一商家，重复入驻会返回 7316）
    if (item.key === 'merchant-apply' && identity.value?.hasBusinessIdentity) return false
    return isModuleEnabled(modules, moduleOf[item.key] || 'basic')
  })
})

/** 收益卡可见性按模块开关过滤：推广收益/平台红包→promotion，我的余额→basic（停用 wallet 后余额仍展示）。 */
const incomeEntries = computed(() => {
  const modules = moduleConfig.value
  const all = [
    { label: '我的余额', value: wallet.value?.balance, settling: false },
    // 推广收益取兜底后的金额，口径与推广页一致；settling 为 true 时在标签后加「结算中」标记
    { label: '推广收益', value: promotionIncomeAmount.value, settling: promotionSettling.value },
    { label: '平台红包', value: wallet.value?.pendingBonus, settling: false },
  ]
  const moduleOf: Record<number, string> = { 0: 'basic', 1: 'promotion', 2: 'promotion' }
  return all.filter((_, index) => isModuleEnabled(modules, moduleOf[index] || 'basic'))
})

/** 待领取红包积分（即红包金额）。 */
const pendingBonus = computed(() => Number(wallet.value?.pendingBonus || 0))
/** 上次已查看的红包金额（本地缓存，用于红点提示新红包）。 */
const lastSeenBonus = ref(Number(uni.getStorageSync('bonus_last_seen') || 0))
/**
 * 本地开发预览开关：**开发构建**下即使没有新红包也点亮红点 / 允许打开红包弹窗，方便调样式；
 * 正式构建 `import.meta.env.DEV` 为 `false`，一律走下面的真实条件。
 * ⚠️ 由契约 `mine-redpacket-preview-trigger.contract.ps1` 保护（开发可预览 + 生产保留真实触发），
 *    不要随意改动这一段 —— 改了契约会红。
 */
const redPacketPreviewEnabled = import.meta.env.DEV
/**
 * 是否有未查看的新红包 —— **红点专用**。
 *
 * ⚠️ 2026-09-24 事故：原来这里是 `redPacketPreviewEnabled || pendingBonus > lastSeenBonus`，
 * 而 `redPacketPreviewEnabled` 是常量 ⇒ vite 把它**常量折叠**成 `true`，
 * 真实条件被整段 tree-shaking 删掉（实测编译产物：`computed(() => redPacketPreviewEnabled)`）。
 * 结果在**开发构建**里红点恒亮、**点了也不会灭**（体验版若用 `dist/dev` 上传就是这种产物）。
 * ⇒ 现在红点**始终**按真实口径，不受开发预览影响。
 */
const hasUnseenBonus = computed(() => pendingBonus.value > lastSeenBonus.value)
/**
 * 点击「平台红包」格时是否**直接弹红包窗**（而不是进红包页）。
 * 真实有新红包时弹窗；**开发构建**下额外允许预览弹窗样式（否则没红包就看不到弹窗效果）。
 * ⚠️ 只影响"弹哪个"，**不影响红点**。
 */
const shouldOpenRedPacketDialog = computed(() => redPacketPreviewEnabled || hasUnseenBonus.value)
/** 红包弹窗可见状态。 */
const redPacketVisible = ref(false)
/** 红包弹窗打开时锁定的未转余额红包总额，避免使用旧钱包快照。 */
const redPacketDisplayAmount = ref(0)
/** 红包弹窗内用于递增动画的金额，不参与业务计算。 */
const redPacketAnimatedAmount = ref(0)
/** 红包弹窗动效状态，每次打开时重新触发 CSS 动画。 */
const redPacketMotionVisible = ref(false)
const redPacketLoading = ref(false)
const redPacketMotionDuration = 600
const redPacketActionPressed = ref(false)
let redPacketActionTimer: ReturnType<typeof setTimeout> | null = null
let redPacketMotionTimer: ReturnType<typeof setInterval> | null = null
const navigationThrottle = createThrottle(500)
let dataLoadPromise: Promise<void> | null = null
/** 推广码弹窗状态（个人页二维码按钮点击后展示小程序码）。 */
const promotionCodeVisible = ref(false)
const promotionCodeLoading = ref(false)
const promotionCodeUrl = ref('')
const loginGuideVisible = ref(false)

function formatIncome(value?: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

function incomeValueClass(value?: number): string {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '0.00'
  if (raw.length >= 12) return 'income-value-long'
  if (raw.length >= 10) return 'income-value-compact'
  if (raw.length >= 8) return 'income-value-small'
  return ''
}

async function loadData(): Promise<void> {
  // 公告为公开接口，游客也能查看
  void loadAnnouncements()
  if (!isLoggedIn()) {
    user.value = null
    wallet.value = null
    identity.value = null
    promotionFrozenAmount.value = 0
    // 未登录时清掉结算兜底快照，避免换账号后展示上一位用户的兜底金额
    clearPromotionSettlement()
    return
  }
  try {
    user.value = await getUserProfile()
  } catch (error) {
    user.value = null // 资料失败按游客处理
    // 后端明确「用户不存在」= 本地 token 已失效（用户被删/数据被清）→ 清理登录态，
    // 否则每次进个人中心都会重复报错，且残留 token 会让 isLoggedIn() 误判为已登录
    const message = error instanceof Error ? error.message : ''
    if (message.includes('用户不存在')) {
      clearAuth()
      uni.removeStorageSync('identity_entry')
    }
  }
  // 身份列表（可切换身份 / 待开通占位）：**只要有登录态就拉**，与"资料是否完善"无关。
  // ⚠️ 2026-09-22 修（用户反馈"入驻通过了还是看不到门店管理"）：原先这一步在下面 `registeredUser`
  // 判断**之后**，而资料未完善的用户会在那里直接 return → `getIdentity()` 压根没被调用
  // → 身份区永远不显示，只改显示条件是没用的（上一版就漏了这里）。
  void loadIdentity()
  if (!registeredUser.value) {
    // 资料未完善（「我的」页顶部显示"游客"）：钱包与推广兜底确实依赖注册用户 → 清掉；
    // 但**身份照常展示** —— 身份绑在微信/token 上，与资料是否完善无关。
    // 也不再清 `identity_entry`：那是身份切换缓存（骑手页店名、弹层默认选中都用它），
    // 在"资料未完善"场景清掉只会让店长/骑手丢展示信息。
    wallet.value = null
    promotionFrozenAmount.value = 0
    clearPromotionSettlement()
    return
  }
  try {
    // 钱包信息优先拉取：后端已下发 unsettledPromotion 时无需再拉 60 天推广明细做汇总
    const walletInfo = await getWalletInfo()
    wallet.value = walletInfo
    if (hasUnsettledPromotionAmount(walletInfo)) {
      promotionFrozenAmount.value = 0
    } else {
      // 兜底路径：旧版后端没有 unsettledPromotion，先校准锁定期天数（提现规则 payLockDays）再按窗口估算
      await loadWithdrawPayLockDays()
      promotionFrozenAmount.value = await loadFrozenPromotionAmount()
    }
    if (!redPacketVisible.value) redPacketDisplayAmount.value = Number(wallet.value?.pendingBonus || 0)
    // 数据加载完成后校准结算兜底：后端已追平则清除快照，仍处于结算中则继续按兜底值展示
    syncPromotionSettlement(promotionDisplayAmount.value, authUserId.value)
  } catch {
    wallet.value = null
    promotionFrozenAmount.value = 0
  }
}

/** 拉取身份列表；身份被解绑/禁用时后端返回 roleChanged，提示并回商城页。 */
async function loadIdentity(): Promise<void> {
  try {
    const result = await getIdentity()
    identity.value = result
    if (result.roleChanged) {
      uni.showToast({ title: '您的身份已变更，请重新选择', icon: 'none' })
      uni.removeStorageSync('identity_entry')
    }
  } catch {
    identity.value = null
  }
}

/**
 * 后端是否真的下发过身份数据（可开通身份或待开通占位）。
 * 这是身份区的**唯一权威判据**：`/api/auth/identity` 返回什么就展示什么。
 */
const hasIdentityData = computed(() => Boolean(
  identity.value && (identity.value.identities.length || identity.value.pendingIdentities.length),
))

/**
 * 是否展示身份区：**已登录 + 后端给了身份数据**。
 *
 * ⚠️ 2026-09-22 修正：这里原先还要求 `registeredUser`（"已注册用户/资料可用"），
 * 导致**以游客身份（微信登录了但资料未完善，页面顶部显示"游客"）提交商家入驻**的用户，
 * 审核通过后**看不到「门店管理」入口** —— 身份明明已经开通，却因为资料那一条被整块隐藏。
 * 去掉这条不会引入"token 残留还显示身份"的问题：token 失效时 `/api/auth/identity` 直接失败、
 * 用户不存在时后端返回空身份 → `hasIdentityData` 自然为 false，身份区照样隐藏。
 */
const showIdentitySection = computed(() => Boolean(
  isLoggedIn() && hasIdentityData.value,
))

/**
 * 店长身份「内含骑手能力」时补的骑手入口。
 * 后端常常**只下发一张店长卡**（`IdentityVO.deliveryCapability = true`）而不发 RIDER 卡，
 * 与 `subpkg-merchant/home/index.vue` 的 `roleOptions` 同口径。
 * 进骑手页**不需要切换身份**（同一 token，任务接口用 C 端 token 直调）→ `bindingId` 保持 null。
 */
const RIDER_ENTRY: IdentityItem = {
  bindingId: null,
  role: 'RIDER',
  label: '骑手工作台',
  targetPage: 'RIDER',
  primary: false,
  pending: false,
  hint: null,
}

/**
 * 身份区实际渲染的行：已开通身份在前、待开通占位在后，**并按 targetPage 去重**。
 *
 * 为什么必须去重（2026-09-19 后端行为变更）：入驻审核通过会**同时**授予
 * 「商家（MERCHANT_OWNER）」与「首店店长（MANAGER）」两个身份 —— 店长身份让
 * `identities[]` 里出现一张**可点**的「门店管理」；而 `pendingIdentities[]` 那个置灰占位
 * 是按「商家账号有没有发工号」判断的，**未发号期间仍会下发**同名的「门店管理（待开通）」。
 * 两组直接渲染，用户就会看到两个「门店管理」。
 * 口径见 docs/商家端-入驻身份与通知-方案架构-2026-09-19.md §十-①。
 *
 * ⚠️ 2026-09-22 补充：后端只发店长卡时（`deliveryCapability=true`）**补一张「骑手工作台」**，
 * 否则骑手/店长在「我的」这页找不到骑手入口（此前只有商家端工作台里补了，见该页注释）。
 */
const identityRows = computed<IdentityItem[]>(() => {
  const owned = identity.value?.identities || []
  const ownedTargets = new Set(owned.map((item) => item.targetPage || 'CUSTOMER'))
  const pending = (identity.value?.pendingIdentities || []).filter(
    (item) => !ownedTargets.has(item.targetPage || 'CUSTOMER'),
  )
  const rows = [...owned, ...pending]
  const hasRiderEntry = rows.some((item) => (item.targetPage || '') === 'RIDER')
  if (identity.value?.deliveryCapability && !hasRiderEntry) rows.push(RIDER_ENTRY)
  return rows
})

/** 点击身份卡：切换身份并按 entry 跳对应工作台（token 不变）。 */
async function goIdentity(item: IdentityItem): Promise<void> {
  // 店长内含骑手能力（后端不发 RIDER 卡）：骑手入口**不切身份**，直接进骑手工作台
  // （与 subpkg-merchant/home/index.vue 的 confirmSwitch 同口径：进骑手页用同一 token 直调任务接口）
  if (item.targetPage === 'RIDER' && !item.pending && !item.bindingId) {
    uni.navigateTo({ url: '/subpkg-delivery/rider/index' })
    return
  }
  if (item.pending || !item.bindingId) {
    uni.showToast({ title: item.hint || '该身份尚未开通，请联系客服', icon: 'none' })
    return
  }
  if (identitySwitching.value) return
  identitySwitching.value = true
  try {
    const result = await switchIdentity(item.bindingId)
    uni.setStorageSync('identity_entry', result)
    // 直接进工作台，不经中间页：门店 → 商家端工作台（新的 subpkg-merchant/home），骑手 → 骑手页
    // （旧的 subpkg-delivery/manager 页不再作为门店入口；身份切换改在工作台顶部箭头里做）
    if (result.entry === 'MANAGER') uni.navigateTo({ url: '/subpkg-merchant/home/index' })
    else if (result.entry === 'RIDER') uni.navigateTo({ url: '/subpkg-delivery/rider/index' })
    else uni.switchTab({ url: '/pages/index/index' })
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '身份切换失败', icon: 'none' })
  } finally {
    identitySwitching.value = false
  }
}

/** 加载启用中的公告列表，失败时保持空态。 */
async function loadAnnouncements(): Promise<void> {
  try { announcements.value = await getAnnouncementList() } catch { announcements.value = [] }
}

/** 拉取当前品牌模块开关；失败/为空保持 null（按全部启用兜底，兼容线上）。 */
async function loadModuleConfig(): Promise<void> {
  try {
    const modules = await getModules()
    moduleConfig.value = modules && modules.length ? modules : null
  } catch {
    moduleConfig.value = null
  }
}

/** 合并首次挂载与页面重新显示时的并发刷新，避免重复请求。 */
function refreshData(): Promise<void> {
  if (dataLoadPromise) return dataLoadPromise
  const pending = Promise.all([loadData(), loadModuleConfig()]).then(() => undefined)
  dataLoadPromise = pending
  pending.then(
    () => { if (dataLoadPromise === pending) dataLoadPromise = null },
    () => { if (dataLoadPromise === pending) dataLoadPromise = null },
  )
  return pending
}

/** 打开公告详情，完整展示当前公告内容。 */
function openAnnouncement(item: Announcement): void {
  activeAnnouncement.value = item
  announcementVisible.value = true
}

/** 关闭公告详情并清理当前选中项。 */
function closeAnnouncement(): void {
  announcementVisible.value = false
  activeAnnouncement.value = null
}

function goOrder(key: string): void {
  if (!navigationThrottle()) return
  if (!isLoggedIn()) {
    showLoginGuide()
    return
  }
  if (key === 'completed') {
    // 退款售后入口直接落到订单列表的「退款售后」分类
    uni.navigateTo({ url: '/subpkg-order/orders/list?tab=aftersale' })
    return
  }
  // 待发货(status=1,物流) 与 待自提(status=1,自提) 用 pickupType 区分
  const tabMap: Record<string, { status?: number; pickupType?: number }> = {
    pending: { status: 0 },
    shipped: { status: 1, pickupType: 0 },
    received: { status: 2 },
    pickup: { status: 1, pickupType: 1 },
  }
  const target = tabMap[key]
  if (!target || target.status === undefined) { uni.navigateTo({ url: '/subpkg-order/orders/list' }); return }
  const pickup = target.pickupType !== undefined ? `&pickupType=${target.pickupType}` : ''
  uni.navigateTo({ url: `/subpkg-order/orders/list?status=${target.status}${pickup}` })
}

/**
 * 打开**主包静态页**（用户协议 / 隐私保护指引）。
 *
 * ⚠️ 2026-09-22 修（用户反馈「用户协议」「隐私保护指引」点不开/空白）：
 * 这两个页面是**纯静态主包页面**（不拉接口、不依赖登录态），原先和业务入口共用同一个
 * `navigationThrottle`（500ms）——用户在个人中心连着点两下（例如先点「我的订单」再点「用户协议」）
 * 第二下会被静默吞掉，表现就是"点了没反应"。静态页跳转没有重复下单之类的副作用，
 * 因此这里**不再参与节流**；同时 `fail` 回调给出明确提示，不再让用户面对"点了什么都不发生"。
 */
function openStaticPage(url: string, label: string): void {
  uni.navigateTo({
    url,
    fail: (error) => {
      // 页面栈已满(10 层)/主包未同步等都会走到这里，必须给用户可读反馈
      uni.showToast({ title: `${label}打开失败：${error?.errMsg || '请稍后重试'}`, icon: 'none' })
    },
  })
}

function goMenu(key: string): void {
  // 静态主包页面放在节流之前：它们没有任何写副作用，被 500ms 节流吞掉只会让人以为"点不开"
  if (key === 'agreement') { openStaticPage('/pages/user-agreement/user-agreement', '用户协议'); return }
  if (key === 'privacy') { openStaticPage('/pages/privacy/privacy', '隐私保护指引'); return }
  if (!navigationThrottle()) return
  if (['invoice', 'favorite'].includes(key) && !isLoggedIn()) {
    showLoginGuide()
    return
  }
  if (key === 'invoice') { uni.navigateTo({ url: '/subpkg-order/invoice/list' }); return }
  if (key === 'settings') { uni.navigateTo({ url: '/pages/settings/settings' }); return }
  if (key === 'favorite') { uni.navigateTo({ url: '/subpkg-wallet/favorite/list' }); return }
  if (key === 'promotion') { goPromotionCenter(); return }
  if (key === 'wallet') { goWallet(); return }
  if (key === 'merchant-apply') {
    if (!isLoggedIn()) { showLoginGuide(); return }
    uni.navigateTo({ url: '/subpkg-merchant/apply/apply' })
    return
  }
  const item = menuItems.find((menu) => menu.key === key)
  uni.showToast({ title: `${item?.label || '功能'} - 功能开发中`, icon: 'none' })
}

/** 处理收益卡点击：余额进钱包、推广收益进推广页；平台红包按红点状态分流。 */
function goIncome(index: number): void {
  if (!navigationThrottle()) return
  if (!registeredUser.value) return
  const label = incomeEntries.value[index]?.label
  if (label === '我的余额') {
    goWallet()
    return
  }
  if (label === '推广收益') {
    goPromotionCenter()
    return
  }
  if (label === '平台红包') {
    // 有新红包（红点）时弹红包窗；无红点时直接进入红包页（开发构建下允许预览弹窗，见 shouldOpenRedPacketDialog）
    if (shouldOpenRedPacketDialog.value) {
      openRedPacket()
    } else {
      openRedPacketPage()
    }
  }
}

/** 格式化红包总额，纯数字积分，不含货币符号。 */
function formatRedPacketAmount(value: unknown): string {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return '0'
  return amount.toFixed(2).replace(/\.00$/, '').replace(/\.(\d)0$/, '.$1')
}

/** 清理红包金额递增计时器，避免快速开关时叠加动画。 */
function clearRedPacketMotionTimer(): void {
  if (redPacketMotionTimer !== null) {
    clearInterval(redPacketMotionTimer)
    redPacketMotionTimer = null
  }
}

/** 清理红包按钮点击后的延迟跳转，避免关闭后仍然跳页。 */
function clearRedPacketActionTimer(): void {
  if (redPacketActionTimer !== null) {
    clearTimeout(redPacketActionTimer)
    redPacketActionTimer = null
  }
  redPacketActionPressed.value = false
}

/** 重置并启动红包弹窗的金额和视觉动效。 */
function startRedPacketMotion(): void {
  clearRedPacketMotionTimer()
  redPacketAnimatedAmount.value = 0
  redPacketMotionVisible.value = true

  const targetAmount = Number(redPacketDisplayAmount.value)
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) return

  const startedAt = Date.now()
  redPacketMotionTimer = setInterval(() => {
    const progress = Math.min((Date.now() - startedAt) / redPacketMotionDuration, 1)
    const easedProgress = 1 - Math.pow(1 - progress, 3)
    redPacketAnimatedAmount.value = targetAmount * easedProgress
    if (progress >= 1) {
      redPacketAnimatedAmount.value = targetAmount
      clearRedPacketMotionTimer()
    }
  }, 16)
}

/** 刷新钱包后打开红包弹窗，展示当前未转余额的红包总额。 */
async function openRedPacket(): Promise<void> {
  if (redPacketLoading.value) return
  redPacketLoading.value = true
  try {
    wallet.value = await getWalletInfo()
    redPacketDisplayAmount.value = Number(wallet.value?.pendingBonus || 0)
    lastSeenBonus.value = redPacketDisplayAmount.value
    uni.setStorageSync('bonus_last_seen', redPacketDisplayAmount.value)
    redPacketVisible.value = true
    startRedPacketMotion()
  } catch (error) {
    redPacketDisplayAmount.value = pendingBonus.value
    redPacketVisible.value = true
    startRedPacketMotion()
    uni.showToast({ title: error instanceof Error ? error.message : '红包金额刷新失败', icon: 'none' })
  } finally {
    redPacketLoading.value = false
  }
}

/** 关闭红包弹窗。 */
function closeRedPacket(): void {
  redPacketVisible.value = false
  redPacketMotionVisible.value = false
  redPacketAnimatedAmount.value = 0
  clearRedPacketMotionTimer()
  clearRedPacketActionTimer()
}

/** 点击「开心收下」先播放按压反馈，再进入红包页。 */
function handleRedPacketAction(): void {
  if (!redPacketVisible.value || redPacketActionTimer !== null) return
  redPacketActionPressed.value = true
  redPacketActionTimer = setTimeout(() => {
    redPacketActionTimer = null
    redPacketActionPressed.value = false
    openRedPacketPage()
  }, 520)
}

/** 点击「开心收下」进入红包页。 */
function openRedPacketPage(): void {
  closeRedPacket()
  uni.navigateTo({ url: '/subpkg-wallet/redpacket/redpacket' })
}

onUnmounted(() => {
  clearRedPacketMotionTimer()
  clearRedPacketActionTimer()
})

/** 生成并展示带当前推广者身份的小程序码（个人页二维码按钮）。 */
async function openPromotionCode(): Promise<void> {
  if (!isLoggedIn()) {
    showLoginGuide()
    return
  }
  if (!registeredUser.value) {
    uni.showToast({ title: '完成订单后开放推广功能', icon: 'none' })
    return
  }
  if (promotionCodeLoading.value) return
  if (!getAuth()?.userId) {
    uni.showToast({ title: '请先登录后生成推广码', icon: 'none' })
    return
  }
  promotionCodeLoading.value = true
  promotionCodeVisible.value = true
  try {
    promotionCodeUrl.value = await getPromotionCode()
    if (!promotionCodeUrl.value) throw new Error('推广码地址为空')
  } catch (error) {
    promotionCodeVisible.value = false
    uni.showToast({ title: error instanceof Error ? error.message : '推广码生成失败', icon: 'none' })
  } finally {
    promotionCodeLoading.value = false
  }
}

function goAllOrders(): void {
  if (!navigationThrottle()) return
  if (!isLoggedIn()) {
    showLoginGuide()
    return
  }
  uni.navigateTo({ url: '/subpkg-order/orders/list' })
}

function showLoginGuide(): void {
  loginGuideVisible.value = true
}

function goWallet(): void {
  if (!isLoggedIn()) {
    showLoginGuide()
    return
  }
  if (!registeredUser.value) {
    uni.showToast({ title: '完成订单后开放推广功能', icon: 'none' })
    return
  }
  uni.navigateTo({ url: '/subpkg-wallet/withdraw/withdraw' })
}

function goPromotionCenter(): void {
  if (!isLoggedIn()) {
    showLoginGuide()
    return
  }
  if (!registeredUser.value) {
    uni.showToast({ title: '完成订单后开放推广功能', icon: 'none' })
    return
  }
  uni.navigateTo({ url: '/subpkg-wallet/dividend/dividend' })
}

function goEditProfile(): void {
  avatarTempPath.value = ''
  Object.assign(profileForm, { nickname: user.value?.nickname || '', avatarUrl: user.value?.avatarUrl || '' })
  profileEditorVisible.value = true
}

/** 个人资料区点击：未登录先引导登录，已登录进入编辑资料。 */
function handleProfileTap(): void {
  if (!isLoggedIn() || !user.value) {
    // 首次进入个人页时资料请求仍在进行，避免把有效会话误判为失效。
    if (isLoggedIn() && dataLoadPromise) {
      uni.showToast({ title: '用户信息加载中，请稍候', icon: 'none' })
      return
    }
    // 资料为空且本地仍有 Token 时，先清理残留会话，避免登录页直接跳回首页。
    if (isLoggedIn()) clearAuth()
    uni.navigateTo({ url: '/pages/login/login' })
    return
  }
  goEditProfile()
}

/**
 * 退出登录：二次确认后清理登录态 + 身份缓存，并把页面刷回游客态。
 * - `clearAuth()` 会一并清掉钱包提示与地址改址草稿；
 * - `identity_entry` 必须一起清，否则下次一键登录会带着旧门店/骑手身份直接进工作台；
 * - 清完本地视图后按游客态重新拉取（不跳页，留在「我的」页看游客态更直观）。
 */
function doLogout(): void {
  uni.showModal({
    title: '退出登录',
    content: '退出后需重新一键登录才能查看订单与收益，确定退出？',
    confirmText: '确定退出',
    confirmColor: '#ff5500',
    success: (result) => {
      if (!result.confirm) return
      clearAuth()
      uni.removeStorageSync('identity_entry')
      user.value = null
      wallet.value = null
      identity.value = null
      promotionFrozenAmount.value = 0
      // 退出登录即清理结算兜底快照，避免下次登录（可能是另一个账号）看到旧的兜底金额
      clearPromotionSettlement()
      uni.showToast({ title: '已退出登录', icon: 'none' })
      void refreshData()
    },
  })
}

/** 处理微信头像选择回调，记录临时路径。 */
function onChooseAvatar(event: { detail: { avatarUrl?: string } }): void {
  const tempPath = event.detail?.avatarUrl
  if (tempPath) {
    avatarTempPath.value = tempPath
  } else {
    uni.showToast({ title: '未选择头像', icon: 'none' })
  }
}

async function saveProfile(): Promise<void> {
  const nickname = validateText(profileForm.nickname, { label: '昵称', maxLength: 32 })
  if (!nickname.ok) { uni.showToast({ title: nickname.message, icon: 'none' }); return }
  profileSaving.value = true
  try {
    // 用户选了新头像时，先把微信临时文件上传成永久 URL
    let avatarUrl = profileForm.avatarUrl.trim()
    if (avatarTempPath.value) {
      avatarUploading.value = true
      avatarUrl = await uploadFile(avatarTempPath.value)
      avatarTempPath.value = ''
    }
    // 仅允许修改昵称和头像，电话不允许编辑，保存时不上传 phone
    user.value = await updateUserProfile({ nickname: nickname.value, avatarUrl })
    profileEditorVisible.value = false
    uni.showToast({ title: '资料已保存', icon: 'success' })
  } catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '资料保存失败', icon: 'none' }) }
  finally {
    profileSaving.value = false
    avatarUploading.value = false
  }
}

onMounted(() => {
  try {
    const menuButton = uni.getMenuButtonBoundingClientRect()
    if (menuButton) {
      menuTop.value = menuButton.top
      menuHeight.value = menuButton.height
    }
  } catch { /* 非微信环境没有胶囊按钮 */ }
  void refreshData()
})

onShow(() => { void refreshData() })
</script>

<template>
  <view class="pg">
    <scroll-view class="bd" scroll-y>
      <view class="hero" :style="{ paddingTop: bodyTop + 'px' }">
        <image class="hero-bg" src="/static/bg/个人bg.jpg" mode="aspectFill" />
        <view class="profile-row">
          <view class="u-avatar" @click="handleProfileTap">
            <image v-if="user?.avatarUrl" class="u-avatar-image" :src="user.avatarUrl" mode="aspectFill" />
          </view>
          <view class="u-info" @click="handleProfileTap">
            <text class="u-name">{{ user?.nickname || '我的姓名微信名' }}</text>
            <image v-if="registeredUser" class="vip-avatar-badge" src="/static/my/vip 头像_slices/vip 头像.png" mode="aspectFit" />
            <text v-if="user" class="u-id">ID: {{ user.id }}</text>
          </view>
          <image v-if="isModuleEnabled(moduleConfig, 'promotion')" class="qr-mark" src="/static/my/QRcode.png" mode="aspectFit" @click="openPromotionCode" />
        </view>

        <view class="member-card" :class="{ 'member-card-guest': !registeredUser }">
          <image v-if="registeredUser" class="member-card-background" src="/static/my/vip会员背景_slices/vip会员背景.png" mode="scaleToFill" />
          <view v-else class="member-mark" />
          <text :class="['member-label', { 'member-label-registered': registeredUser }]">{{ registeredUser ? '您已是vip会员用户啦' : '游客' }}</text>
          <view v-if="!registeredUser" class="member-end" />
        </view>

        <view v-if="registeredUser" class="income-strip">
          <view v-for="(item, index) in incomeEntries" :key="item.label" class="income-item" @click="goIncome(index)">
            <text :class="['income-value', incomeValueClass(item.value)]">{{ formatIncome(item.value) }}</text>
            <!-- 推广收益标签：后端字段短暂未追平时展示「结算中」，说明当前是本地兜底金额 -->
            <view class="income-label-row">
              <text class="income-label">{{ item.label }}</text>
              <text v-if="item.settling" class="income-label-tag">结算中</text>
            </view>
            <view v-if="index === 2 && hasUnseenBonus" class="income-dot" />
          </view>
        </view>
      </view>

      <!-- 身份区：可切换身份（门店管理 / 骑手工作台）+ 待开通占位（对接文档 §4.2） -->
      <view v-if="showIdentitySection" class="identity-section">
        <view class="identity-head"><text class="identity-title">我的身份</text></view>
        <view class="identity-list">
          <!-- 已开通 + 待开通合并渲染（identityRows 已按 targetPage 去重，避免两个「门店管理」） -->
          <view
            v-for="(item, index) in identityRows"
            :key="`id-${item.bindingId ?? item.targetPage ?? index}`"
            class="identity-card"
            :class="{ 'identity-card-pending': item.pending }"
            @click="goIdentity(item)"
          >
            <view class="identity-card-main">
              <text class="identity-label">{{ item.label }}</text>
              <text class="identity-sub">{{ item.pending ? (item.hint || '等待客服开通账号后即可使用') : (item.merchantName || item.shopName || '') }}</text>
            </view>
            <text class="identity-action">{{ item.pending ? '待开通' : '进入' }}</text>
          </view>
        </view>
      </view>

      <view class="order-section">
        <view class="order-head">
          <text class="order-title">我的订单</text>
          <view class="order-all" @click="goAllOrders"><text>全部</text><image class="all-arrow" src="/static/my/右_slices/右.png" mode="aspectFit" /></view>
        </view>
        <view class="order-grid">
          <view v-for="entry in visibleOrderEntries" :key="entry.key" class="order-item" @click="goOrder(entry.key)">
            <image v-if="entry.icon" class="order-icon order-icon-image" :src="entry.icon" mode="aspectFit" />
            <view v-else class="order-icon" />
            <text class="order-label">{{ entry.label }}</text>
          </view>
        </view>
      </view>

      <!-- 公告栏：订单模块下方、功能选项上方，横向滚动展示 -->
      <view v-if="announcements.length" class="announcement-bar">
        <text class="announcement-label">公告</text>
        <view class="announcement-scroll">
          <view class="announcement-marquee">
            <view v-for="copy in 2" :key="copy" class="announcement-group">
              <text v-for="item in announcements" :key="`${copy}-${item.id}`" class="announcement-item" @click="openAnnouncement(item)">{{ item.content }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="menu-section">
        <view class="menu-list">
          <!-- 客服：微信原生客服（open-type=contact），点击弹起客服会话 -->
          <button class="menu-item menu-item-btn" open-type="contact">
            <image class="menu-icon menu-icon-image" src="/static/my/客服_slices/客服.png" mode="aspectFit" />
            <text class="menu-label">客服</text>
          </button>
          <view v-for="item in visibleMenuItems" :key="item.key" class="menu-item" @click="goMenu(item.key)">
            <image v-if="item.icon" class="menu-icon menu-icon-image" :src="item.icon" mode="aspectFit" />
            <view v-else class="menu-icon" />
            <text class="menu-label">{{ item.label }}</text>
          </view>
        </view>
      </view>

      <!-- 退出登录：仅登录态展示（游客不显示） -->
      <view v-if="isLoggedIn()" class="logout-section">
        <button class="logout-btn" @click="doLogout">退出登录</button>
      </view>

    </scroll-view>

    <view v-show="announcementVisible" class="announcement-mask" @click="closeAnnouncement">
      <view class="announcement-dialog" @click.stop>
        <view class="announcement-dialog-head">
          <text class="announcement-dialog-title">公告详情</text>
          <text class="announcement-dialog-close" @click="closeAnnouncement">×</text>
        </view>
        <scroll-view class="announcement-detail-scroll" scroll-y>
          <text class="announcement-detail-content">{{ activeAnnouncement?.content || '' }}</text>
        </scroll-view>
      </view>
    </view>

    <view v-show="profileEditorVisible" class="mask" @click="profileEditorVisible = false">
      <view class="sheet" @click.stop>
        <view class="sheet-head"><text class="sheet-title">编辑资料</text><text class="sheet-close" @click="profileEditorVisible = false">×</text></view>
        <button class="avatar-picker" open-type="chooseAvatar" :disabled="avatarUploading || profileSaving" @chooseavatar="onChooseAvatar">
          <image v-if="avatarTempPath || profileForm.avatarUrl" class="avatar-preview" :src="avatarTempPath || profileForm.avatarUrl" mode="aspectFill" />
          <text v-else class="avatar-placeholder">{{ avatarUploading ? '上传中...' : '点击选择头像' }}</text>
        </button>
        <text class="avatar-tip">点击可选择微信头像或相册图片</text>
        <input v-model="profileForm.nickname" class="sheet-input" type="nickname" placeholder="请输入昵称（可点选微信昵称）" />
        <button class="sheet-submit" :disabled="profileSaving || avatarUploading" @click="saveProfile">{{ profileSaving ? '保存中...' : '保存资料' }}</button>
      </view>
    </view>

    <!-- 平台红包弹窗 -->
    <view v-show="redPacketVisible" class="mask redpacket-mask" :class="{ 'redpacket-mask-in': redPacketMotionVisible }" @click="closeRedPacket">
      <view class="redpacket-sheet" :class="{ 'redpacket-sheet-in': redPacketMotionVisible, 'redpacket-sheet-action-pressed': redPacketActionPressed }" @click.stop>
        <image class="redpacket-bg" src="/static/my/红包_slices/编组.png" mode="aspectFit" />
        <text class="redpacket-amount">{{ formatRedPacketAmount(redPacketAnimatedAmount) }}</text>
        <view class="redpacket-action" :class="{ 'redpacket-button-pulse': redPacketMotionVisible, 'redpacket-button-pressed': redPacketActionPressed }" @click="handleRedPacketAction" />
      </view>
    </view>

    <PromotionCodePoster v-model="promotionCodeVisible" :loading="promotionCodeLoading" :code-url="promotionCodeUrl" />
    <LoginGuide v-model="loginGuideVisible" />
  </view>
</template>

<style>
.pg { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: #fff; color: #242526; }
.bd { flex: 1; width: 100%; min-height: 0; margin-bottom: -50rpx; box-sizing: border-box; }

.hero { position: relative; overflow: hidden; padding-right: 38.17rpx; padding-left: 38.17rpx; background: #0d0e0f; color: #fff; }
.hero-bg { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; }
.profile-row { position: relative; z-index: 1; display: flex; align-items: center; padding: 16rpx 0 48rpx; }
.u-avatar { width: 99.24rpx; height: 99.24rpx; flex-shrink: 0; overflow: hidden; border-radius: 50%; background: #819a7b; }
.u-avatar-image { width: 100%; height: 100%; }
.u-info { display: flex; min-width: 0; flex: 1; flex-direction: column; align-items: flex-start; margin-left: 22.9rpx; }
.u-name { overflow: hidden; color: #fff; font-size: 26.72rpx; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.vip-avatar-badge { width: 78rpx; height: 25.5rpx; margin-top: 8rpx; }
.u-id { margin-top: 8rpx; color: rgba(255, 255, 255, .72); font-size: 21rpx; line-height: 1.2; }
.qr-mark { width: 93.51rpx; height: 93.51rpx; flex-shrink: 0; }

.member-card { position: relative; z-index: 1; display: flex; align-items: center; height: 82.06rpx; padding: 0 24.8rpx 0 38.17rpx; box-sizing: border-box; overflow: hidden; border-radius: 16rpx 16rpx 0 0; box-shadow: 0 8rpx 18rpx rgba(0, 0, 0, .16); color: #55575b; }
.member-card:not(.member-card-guest) { align-items: flex-start; height: 304rpx; padding-right: 48rpx; }
.member-card-background { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; }
.member-card-guest { background: linear-gradient(108deg, #f4f4f6 0%, #d9dade 38%, #aeb0b6 100%); }
.member-mark, .member-end { position: relative; z-index: 1; width: 38.17rpx; height: 38.17rpx; flex-shrink: 0; background: #55565a; }
.member-label { position: relative; z-index: 1; margin-left: 19.08rpx; font-size: 26.72rpx; font-weight: 500; }
.member-label-registered { margin-top: 48rpx; margin-left: 114rpx; }
.member-end { position: relative; z-index: 1; margin-left: auto; }
.income-strip { position: relative; z-index: 1; display: flex; height: 196rpx; margin: -196rpx -38.17rpx 0; padding: 38rpx 38.17rpx 50rpx; box-sizing: border-box; overflow: hidden; background: linear-gradient(104deg, #303134 0%, #5c5d61 48%, #28292b 100%); box-shadow: inset 0 1rpx rgba(255, 255, 255, .24); }
.income-strip::after { position: absolute; top: -120%; left: -16%; width: 34%; height: 340%; background: linear-gradient(108deg, transparent 0%, rgba(255, 255, 255, .11) 46%, rgba(255, 255, 255, .03) 62%, transparent 100%); content: ''; transform: rotate(16deg); pointer-events: none; }
.income-item { position: relative; z-index: 1; display: flex; flex: 1 1 0; min-width: 0; flex-direction: column; align-items: center; justify-content: center; }
.income-item + .income-item::before { position: absolute; top: 50%; left: 0; width: 2rpx; height: 116rpx; background: rgba(255, 255, 255, .72); content: ''; transform: translateY(-50%); }
.income-value { display: block; width: 100%; padding: 0 8rpx; box-sizing: border-box; color: #fff; font-size: 42rpx; font-weight: 700; line-height: 58rpx; text-align: center; white-space: nowrap; }
.income-value-small { font-size: 36rpx; }
.income-value-compact { font-size: 30rpx; }
.income-value-long { font-size: 25rpx; }
.income-label { display: block; margin-top: 12rpx; color: #fff; font-size: 24rpx; line-height: 34rpx; text-align: center; white-space: nowrap; }
/* 标签行：标签 +「结算中」标记同行居中，标记不撑高卡片（沿用 income-label 的 margin-top） */
.income-label-row { display: flex; align-items: center; justify-content: center; margin-top: 12rpx; }
.income-label-row .income-label { margin-top: 0; }
/* 「结算中」标记：转余额后后端 pending 尚未追平，当前展示的是本地兜底金额（参考今华有肽同款样式） */
.income-label-tag { margin-left: 8rpx; padding: 2rpx 10rpx; border: 1rpx solid rgba(255, 255, 255, .72); border-radius: 6rpx; color: #fff; font-size: 18rpx; line-height: 24rpx; }
.income-dot { position: absolute; top: 56rpx; left: 160rpx; width: 20rpx; height: 20rpx; border-radius: 50%; background: #f34848; }

/* 身份区：可切换身份 + 待开通占位 */
.identity-section { padding: 24rpx 24rpx 28rpx; background: #fff; border-bottom: 22.9rpx solid #f5f5f5; }
.identity-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16rpx; }
.identity-title { color: #1E1E1E; font-size: 30rpx; font-weight: 600; }
.identity-list { display: flex; flex-direction: column; gap: 16rpx; }
.identity-card { display: flex; align-items: center; justify-content: space-between; padding: 22rpx 24rpx; box-sizing: border-box; border-radius: 20rpx; background: #f7f8fa; }
.identity-card-pending { opacity: .6; }
.identity-card-main { display: flex; min-width: 0; flex-direction: column; gap: 6rpx; }
.identity-label { color: #1E1E1E; font-size: 30rpx; font-weight: 600; }
.identity-sub { overflow: hidden; color: #86909c; font-size: 24rpx; white-space: nowrap; text-overflow: ellipsis; }
.identity-action { flex-shrink: 0; margin-left: 16rpx; color: #ff5500; font-size: 26rpx; font-weight: 600; }
.order-section { padding: 34rpx 0 38rpx; background: #fff; border-bottom: 22.9rpx solid #f5f5f5; color: #1E1E1E; font-family: 'PingFang SC', '苹方-简', sans-serif; font-weight: 500; }
.order-head { display: flex; align-items: center; justify-content: space-between; padding: 0 38.17rpx; }
.order-title { color: #1E1E1E; font-size: 26.72rpx; font-weight: 500; }
.order-all { display: flex; align-items: center; gap: 15.27rpx; color: #1E1E1E; font-size: 26.72rpx; }
.all-arrow { width: 14rpx; height: 16rpx; }
.order-grid { display: flex; padding: 24rpx 59.16rpx 0 38.17rpx; box-sizing: border-box; justify-content: space-between; }
.order-item { display: flex; width: 80.15rpx; flex: 0 0 80.15rpx; flex-direction: column; align-items: center; }
.order-icon { width: 80.15rpx; height: 80.15rpx; background: #d8d8d8; }
.order-icon-image { background: transparent; }
.order-label { margin-top: 16rpx; color: #1E1E1E; font-size: 26.72rpx; font-weight: 500; white-space: nowrap; }

.announcement-bar { display: flex; align-items: center; gap: 16rpx; padding: 20rpx 38.17rpx; background: #fff; border-bottom: 22.9rpx solid #f5f5f5; }
.announcement-label { flex-shrink: 0; padding: 4rpx 14rpx; border-radius: 8rpx; color: #fff; background: #916448; font-size: 22rpx; font-weight: 600; }
.announcement-scroll { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; }
.announcement-marquee { display: inline-flex; width: max-content; min-width: 200vw; animation: announcement-marquee 18s linear infinite; will-change: transform; }
.announcement-group { display: flex; flex: 0 0 auto; align-items: center; gap: 48rpx; min-width: 100vw; padding-right: 48rpx; box-sizing: border-box; }
.announcement-item { flex-shrink: 0; color: #4F4F4F; font-size: 24rpx; white-space: nowrap; }
.announcement-item:active { opacity: .65; }
@keyframes announcement-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.announcement-mask { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; padding: 40rpx; box-sizing: border-box; background: rgba(0, 0, 0, .52); }
.announcement-dialog { width: 100%; max-width: 680rpx; overflow: hidden; border-radius: 12rpx; background: #fff; }
.announcement-dialog-head { position: relative; display: flex; align-items: center; justify-content: center; height: 92rpx; border-bottom: 1rpx solid #f0f0f0; }
.announcement-dialog-title { color: #222; font-size: 30rpx; font-weight: 600; }
.announcement-dialog-close { position: absolute; top: 16rpx; right: 24rpx; color: #888; font-size: 42rpx; font-weight: 400; line-height: 42rpx; }
.announcement-detail-scroll { height: 520rpx; padding: 30rpx 32rpx; box-sizing: border-box; }
.announcement-detail-content { color: #4F4F4F; font-size: 26rpx; font-weight: 400; line-height: 42rpx; white-space: pre-wrap; word-break: break-all; }

.menu-section { padding: 0 0 120rpx; background: #fff; font-family: 'PingFang SC', '苹方-简', sans-serif; font-weight: 500; }
.menu-list { background: #fff; }
.menu-item { display: flex; align-items: center; min-height: 99.24rpx; padding: 0 38.17rpx; box-sizing: border-box; border-bottom: 0; }
.menu-item:last-child { border-bottom: 0; }
/* 客服项用 <button open-type="contact">：重置微信 button 默认边框/背景，与菜单项视觉一致 */
.menu-item-btn { display: flex; align-items: center; width: 100%; margin: 0; padding: 0 38.17rpx; min-height: 99.24rpx; background: transparent; border: 0; border-radius: 0; line-height: inherit; text-align: left; }
.menu-item-btn::after { border: 0; }
.menu-item-btn:active { opacity: .7; }
.menu-icon { width: 45.8rpx; height: 45.8rpx; flex-shrink: 0; margin-right: 34.35rpx; background: #d8d8d8; }
.menu-icon-image { background: transparent; }
.menu-label { color: #4F4F4F; font-size: 26.72rpx; font-weight: 500; }
/* 退出登录（仅登录态展示） */
.logout-section { padding: 8rpx 38.17rpx 60rpx; background: #fff; font-family: 'PingFang SC', '苹方-简', sans-serif; }
.logout-btn { margin: 0; border-radius: 44rpx; background: #f5f5f5; color: #ff5500; font-size: 28rpx; font-weight: 500; line-height: 88rpx; }
.logout-btn::after { border: 0; }
.mask { position: fixed; inset: 0; z-index: 20; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .62); }
.sheet { width: 100%; padding: 30rpx 28rpx calc(30rpx + env(safe-area-inset-bottom)); background: #fff; box-sizing: border-box; }
.sheet-head { display: flex; align-items: center; justify-content: center; min-height: 54rpx; }.sheet-title { font-size: 30rpx; font-weight: 700; }.sheet-close { position: absolute; right: 30rpx; color: #888; font-size: 42rpx; }
.sheet-input { height: 78rpx; margin-top: 20rpx; padding: 0 22rpx; background: #f7f7f7; box-sizing: border-box; color: #333; font-size: 25rpx; }.balance { display: block; margin-top: 22rpx; color: #555; font-size: 26rpx; }
.sheet-submit { height: 78rpx; margin: 28rpx 0 0; color: #fff; background: #222; border-radius: 4rpx; font-size: 27rpx; }.sheet-submit::after { border: 0; }
.avatar-picker { display: flex; align-items: center; justify-content: center; width: 140rpx; height: 140rpx; margin: 24rpx auto 0; padding: 0; border-radius: 50%; overflow: hidden; background: #f3f3f3; }.avatar-picker::after { border: 0; }
.avatar-preview { width: 140rpx; height: 140rpx; }
.avatar-placeholder { color: #888; font-size: 24rpx; }
.avatar-tip { display: block; margin-top: 12rpx; color: #999; font-size: 22rpx; text-align: center; }
.redpacket-mask { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.81); }
.redpacket-mask-in { animation: redpacket-mask-fade-in 320ms ease-out both; }
.redpacket-sheet { position: relative; width: 620rpx; height: 1104rpx; }
.redpacket-sheet-in { overflow: hidden; animation: redpacket-sheet-enter 420ms cubic-bezier(.22, .8, .28, 1) both; }
.redpacket-sheet-in::before { position: absolute; top: 242rpx; right: 62rpx; bottom: 246rpx; left: 62rpx; z-index: 2; border-radius: 96rpx; background: rgba(255, 232, 150, .16); box-shadow: inset 0 0 52rpx rgba(255, 239, 188, .75), inset 0 0 118rpx rgba(255, 255, 255, .32), 0 0 52rpx rgba(255, 117, 214, .42), 0 0 118rpx rgba(255, 220, 150, .22); content: ''; opacity: 0; pointer-events: none; animation: redpacket-background-glow 1.8s 100ms ease-in-out infinite alternate both; }
.redpacket-sheet-in::after { position: absolute; top: -20%; bottom: -20%; left: -36%; z-index: 3; width: 28%; background: linear-gradient(105deg, transparent 0%, rgba(255, 255, 255, .04) 35%, rgba(255, 255, 255, .28) 50%, rgba(255, 255, 255, .04) 65%, transparent 100%); content: ''; pointer-events: none; transform: rotate(16deg) translateX(-260%); animation: redpacket-shine 850ms 160ms ease-out both; }
.redpacket-bg { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; }
.redpacket-amount { position: absolute; left: 0; right: 0; top: 51%; z-index: 4; color: #916448; font-size: 60rpx; font-weight: 700; text-align: center; line-height: 1; }
.redpacket-action { position: absolute; left: 50%; top: 62%; z-index: 4; width: 224rpx; height: 80rpx; transform: translateX(-50%); }
.redpacket-action::after { position: absolute; inset: 0; border: 2rpx solid rgba(255, 255, 255, .82); border-radius: 40rpx; box-shadow: 0 0 0 rgba(255, 255, 255, 0); content: ''; opacity: 0; pointer-events: none; }
.redpacket-button-pulse::after { animation: redpacket-button-pulse 1.8s ease-in-out 680ms infinite; }
.redpacket-sheet-action-pressed { animation: redpacket-sheet-click 520ms cubic-bezier(.25, .8, .25, 1) both; }
.redpacket-button-pressed::after { animation: redpacket-button-press-glow 520ms cubic-bezier(.25, .8, .25, 1) both; }
@keyframes redpacket-mask-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes redpacket-sheet-enter { from { opacity: 0; transform: translateY(36rpx) scale(.94); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes redpacket-background-glow { from { opacity: .42; } to { opacity: 1; } }
@keyframes redpacket-shine { from { transform: rotate(16deg) translateX(-260%); } to { transform: rotate(16deg) translateX(620%); } }
@keyframes redpacket-button-pulse { 0%, 100% { opacity: 0; box-shadow: 0 0 0 rgba(255, 255, 255, 0); } 50% { opacity: .76; box-shadow: 0 0 18rpx rgba(255, 255, 255, .76); } }
@keyframes redpacket-sheet-click { 0% { transform: translateY(0) scale(1); } 28% { transform: translateY(2rpx) scale(.98); } 56% { transform: translateY(4rpx) scale(.94); } 78% { transform: translateY(-2rpx) scale(1.025); } 100% { transform: translateY(0) scale(1); } }
@keyframes redpacket-button-press-glow { 0% { opacity: .62; box-shadow: 0 0 12rpx rgba(255, 255, 255, .56); } 32% { opacity: .78; box-shadow: 0 0 22rpx rgba(255, 255, 255, .72); } 62% { opacity: 1; box-shadow: 0 0 34rpx rgba(255, 255, 255, .98); } 100% { opacity: .18; box-shadow: 0 0 6rpx rgba(255, 255, 255, .22); } }
</style>
