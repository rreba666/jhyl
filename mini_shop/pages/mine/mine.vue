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

/**
 * 「我的订单」入口（5 项）。
 *
 * ⚠️ 2026-10-09 改造（用户确认）：
 *   1. 图标由**本地切图**（`/static/my/*_slices/`）换成 **iconfont 字体图标** —— `icon` 字段现在存的是
 *      `styles/rider-iconfont.wxss` 里的 `app-icon-*` 类名，模板把该类名**动态绑到** `<text class="app-icon">` 上渲染。
 *      原 5 个切图目录已确认无其它引用，已删除（字体本身与 19 个既有 `rider-icon-*` 字形共用同一个 ttf）。
 *   2. 「待发货」入口**下线**（与「待收货」同属 delivery 模块，用户只要 5 项）。
 *   3. 「退款/售后」文案收短为「**售后**」（键名也从 `completed` 改为 `aftersale`，与模块键同名，一眼对得上）。
 *   4. 新增「**全部**」：与右上角「全部 >」**同一目的地**（订单列表全量、不带筛选）——
 *      用户明确「其他的不变」，故右上角那个入口原样保留；两处指向同一页是有意为之，不是重复。
 */
const orderEntries = [
  { key: 'pending', label: '待付款', icon: 'app-icon-daifukuan' },
  { key: 'received', label: '待收货', icon: 'app-icon-daishouhuo' },
  { key: 'pickup', label: '待自提', icon: 'app-icon-daiziti' },
  { key: 'aftersale', label: '售后', icon: 'app-icon-shouhou' },
  { key: 'all', label: '全部', icon: 'app-icon-quanbu' },
]

/**
 * 订单入口可见性按模块开关过滤：待收货→delivery，待自提→pickup，售后→aftersale，待付款/全部→basic（恒开）。
 *
 * ⚠️ 模块键**只能用 `utils/config.ts` 里已有的**（basic / delivery / pickup / samecity / wallet /
 *    promotion / aftersale / invoice / merchant），不要为新入口新造 key。
 * ⚠️ 「全部」= 订单列表**全量**入口，订单列表本身不设任何模块闸门 ⇒ 用恒开的 `basic`：
 *    它既不属于物流(delivery)也不属于自提(pickup)/售后(aftersale)，挂到任何一个业务模块上都会
 *    因为「别的模块被关掉」而连带消失，那是错的。
 */
const visibleOrderEntries = computed(() => {
  const modules = moduleConfig.value
  const moduleOf: Record<string, string> = {
    pending: 'basic',
    received: 'delivery',
    pickup: 'pickup',
    aftersale: 'aftersale',
    all: 'basic',
  }
  return orderEntries.filter((entry) => isModuleEnabled(modules, moduleOf[entry.key] || 'basic'))
})

/**
 * 个人中心**下方功能列表**。
 *
 * ⚠️ 2026-10-09：前 5 项的图标由**本地切图**换成 **iconfont 字体图标**（`app-icon-*`，
 *    字体见 `styles/rider-iconfont.wxss`），与上方「我的订单」同一套写法与同一档尺寸；
 *    **每一项的 label 与 `goMenu(key)` 深链/模块行为一律未动**。
 *    ⇒ `icon` 字段现在承载**字形类名**，`image` 字段承载**切图路径**；两者分开是因为
 *      「商家入驻」的门店图标**字体里没有**（不得拿别的字形顶替），必须继续走 `<image>`。
 *      模板按 `icon`（字形）→ `image`（切图）→ `v-else`（灰块占位）三级分支渲染。
 * ⚠️ 「客服」这一项虽在数组里，但**不参与下方的 v-for**（`visibleMenuItems` 把它滤掉），
 *    它单独渲染成微信原生客服按钮 `<button open-type="contact">`；那里的字形类名是**字面量**，
 *    与这里的 `icon` 必须一致（契约 mine-icons.contract.ps1 钉着这对关系，改一处必改两处）。
 */
type MenuItem = { key: string; label: string; icon?: string; image?: string }

const menuItems: MenuItem[] = [
  { key: 'invoice', label: '发票记录', icon: 'app-icon-fapiao' },
  { key: 'settings', label: '设置', icon: 'app-icon-shezhi' },
  { key: 'service', label: '客服', icon: 'app-icon-kefu' },
  { key: 'favorite', label: '我的收藏', icon: 'app-icon-shoucang' },
  { key: 'materials', label: '商品素材', icon: 'app-icon-sucai' },
  // ⚠️ 2026-09-29：原先这条与「商品素材」**共用同一个 PNG**（复制粘贴漏改），
  //    现改用专门的门店图标 `static/my/store.svg`（24×24、fill=black 的线性图标）。
  //    ⚠️ 小程序里 SVG 走 `<image src="...svg" mode="aspectFit">`（与 CategoryProductCard 的 location.svg 同一用法）。
  //    ⚠️ 2026-10-09：字体里没有门店字形 ⇒ 这一项**保留切图**（走 `image` 字段），不得用附近字形顶替。
  { key: 'merchant-apply', label: '商家入驻', image: '/static/my/store.svg' },
  // 2026-09-22 用户要求：「用户协议」「隐私保护指引」**不在个人中心显示**，入口已挪到「设置」页。
  // 协议页本身（pages/user-agreement、pages/privacy）保留不动 —— 必须仍然可达。
]

/**
 * 功能菜单可见性按模块开关过滤：发票记录→invoice，商家入驻→merchant，其余条目不受模块控制（basic/通用）。
 * 客服项单独渲染（微信原生客服）。
 *
 * ⚠️ 2026-10-03 新增 `merchant` 键（用户要求「商家入驻按钮要由后台管理系统控制显隐，
 *    有时需要关闭这个功能，隐藏按钮是成本最低的做法」）：
 *    · 走**独立**模块键，**绝不能**搭 `delivery`/`pickup` —— 实测 `delivery` 的 pathPatterns
 *      含 `/api/merchant/**`，关掉它会**拦截商家端接口**，影响远不止一个按钮；
 *    · `isModuleEnabled` 在「配置为空 / 找不到该 key」时**兜底 true**
 *      ⇒ 后端还没建 `merchant` 模块时**线上行为完全不变**（不会误隐藏）；
 *    · 后端加一行模块数据、后台关掉它，这个入口立即消失。
 */
const visibleMenuItems = computed(() => {
  const modules = moduleConfig.value
  const moduleOf: Record<string, string> = { invoice: 'invoice', 'merchant-apply': 'merchant' }
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
 * 身份区实际渲染的行：已开通身份在前、待开通占位在后，**并按 targetPage 去重**。
 *
 * 为什么必须去重（2026-09-19 后端行为变更）：入驻审核通过会**同时**授予
 * 「商家（MERCHANT_OWNER）」与「首店店长（MANAGER）」两个身份 —— 店长身份让
 * `identities[]` 里出现一张**可点**的「门店管理」；而 `pendingIdentities[]` 那个置灰占位
 * 是按「商家账号有没有发工号」判断的，**未发号期间仍会下发**同名的「门店管理（待开通）」。
 * 两组直接渲染，用户就会看到两个「门店管理」。
 * 口径见 docs/商家端-入驻身份与通知-方案架构-2026-09-19.md §十-①。
 *
 * ⚠️ 2026-09-29 修正（用户反馈「第一次进个人页会同时出现门店管理和骑手工作台，
 *    进过门店管理再回来才正常」）：
 *    这里**曾**在 `deliveryCapability=true` 时**主动补一张「骑手工作台」**（原 2026-09-22 行为）。
 *    但那是**冗余**的 —— 点「门店管理」进入的商家端工作台（`subpkg-merchant/home`）里
 *    **本身就有骑手入口**（见该页 roleOptions 注释："门店管理员必须能进配送页"）。
 *    ⇒ 个人页再补一张，就会出现「门店管理 + 骑手工作台」两张卡，用户以为重复。
 *    ⇒ 已删除补入口逻辑。**纯骑手**账号不受影响：后端会给它下发真正的 `RIDER` 身份卡。
 */
const identityRows = computed<IdentityItem[]>(() => {
  const owned = identity.value?.identities || []
  const ownedTargets = new Set(owned.map((item) => item.targetPage || 'CUSTOMER'))
  const pending = (identity.value?.pendingIdentities || []).filter(
    (item) => !ownedTargets.has(item.targetPage || 'CUSTOMER'),
  )
  return [...owned, ...pending]
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
  // 售后入口直接落到订单列表的「退款售后」分类（键名与上方的模块键一致）
  if (key === 'aftersale') {
    uni.navigateTo({ url: '/subpkg-order/orders/list?tab=aftersale' })
    return
  }
  // ⚠️ 2026-10-09：「待发货」入口已下线，它原有的 deeplink 映射（物流 status=1 + pickupType=0）随之删除
  //    （`status=1` 现在只由「待自提」用 `pickupType=1` 表达）；待收货(status=2)。
  const tabMap: Record<string, { status?: number; pickupType?: number }> = {
    pending: { status: 0 },
    received: { status: 2 },
    pickup: { status: 1, pickupType: 1 },
  }
  const target = tabMap[key]
  // key='all'（及任何未映射的 key）→ 订单列表**全量**，与右上角「全部 >」同一目的地（goAllOrders 的 url 必须一致）
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
  // ⚠️ 2026-09-30：原先这里有两行 `if (key === 'agreement' / 'privacy')` 的分支，
  //    但菜单项早在 2026-09-22 就从这个页面移除了 ⇒ 那两个 key **永远不会传进来**，属死代码。
  //    协议入口现已统一收敛到**登录页**（`pages/login/login.vue`）⇒ 一并删除，避免误以为这里还有入口。
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
    <scroll-view class="bd" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false">
      <view class="hero" :style="{ paddingTop: bodyTop + 'px' }">
        <!-- ⚠️ 2026-09-29：`mode` 由 `aspectFill` 改 `widthFix` —— 详见 `.hero-bg` 的样式说明。
             图片必须**按自身比例从顶部**显示，容器（`.hero` 已有 `overflow: hidden`）负责裁掉下方多余。 -->
        <image class="hero-bg" src="/static/bg/个人bg.jpg" mode="widthFix" />
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
        <!-- ⚠️⚠️ 2026-10-10 第三版（用户真机反馈「上下并没有对齐」）：
             这里原来是**横向 scroll-view + item 宽度自适应内容**（2026-09-29 为防「退款/售后」5 个字折行加的），
             而下方功能宫格是 `flex: 1 1 0` 等分 ⇒ 两排的列宽/列中心天然对不上（内容定宽 vs 等分）。
             现在入口文案最长 3 个字（售后/全部），"折行"的前提已不存在
             ⇒ **去掉 scroll-view，改成与下方宫格逐项同构的等分 5 列**（两排共用同一套盒子规则，
             列宽/列中心由同一套数值算出，严格对齐；契约里用数字钉住了这件事）。
             ⚠️ 若将来又出现更长文案：改字号或加 `overflow: hidden`，**不要**退回"宽度自适应内容"
             （那样上下又会对不齐）；下方宫格同理，两排必须一直是同一种等分规则。 -->
        <view class="order-grid">
          <view v-for="entry in visibleOrderEntries" :key="entry.key" class="order-item" @click="goOrder(entry.key)">
            <!-- ⚠️ 2026-10-09：图标由本地切图改为 **iconfont 字体图标**（`app-icon-*`，字体在 styles/rider-iconfont.wxss）。
                 2026-10-10：图标盒/字号按参考图实测下调（52rpx 盒 + 46rpx 字形，见下方 .order-icon 的实测记录）。
                 缺字形（app-icon-* 未定义）时盒子里是空白，不再有旧的灰色占位块兜底。 -->
            <text class="order-icon order-icon-font app-icon" :class="entry.icon" aria-hidden="true" />
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
          <!-- 客服：微信原生客服（open-type=contact），点击弹起客服会话。
               ⚠️ 2026-10-09：图标由切图改为 iconfont 字形（`app-icon-kefu`，与上方「我的订单」同档尺寸）。
               ⚠️ `open-type="contact"`、`.menu-item-btn` 样式、以及下方 v-for 的过滤逻辑（客服不在循环里）
                  一律未动 —— 本次只把 `<image>` 换成承载字形的 `<text>`。
               ⚠️ 这里的 `app-icon-kefu` 与 menuItems 里 service 项的 `icon` 必须一致（契约钉着）。 -->
          <button class="menu-item menu-item-btn" open-type="contact">
            <text class="menu-icon menu-icon-font app-icon app-icon-kefu" aria-hidden="true" />
            <text class="menu-label">客服</text>
          </button>
          <!-- ⚠️ 2026-10-09：三级分支渲染 ——
               `icon` → iconfont 字形类名（发票记录/设置/我的收藏/商品素材）；
               `image` → 切图路径（只剩「商家入驻」，字体里没有门店字形）；
               `v-else` → 无图标时的灰块占位（历史兜底路径，**保留**，别拆）。 -->
          <view v-for="item in visibleMenuItems" :key="item.key" class="menu-item" @click="goMenu(item.key)">
            <text v-if="item.icon" class="menu-icon menu-icon-font app-icon" :class="item.icon" aria-hidden="true" />
            <image v-else-if="item.image" class="menu-icon menu-icon-image" :src="item.image" mode="aspectFit" />
            <view v-else class="menu-icon" />
            <text class="menu-label">{{ item.label }}</text>
          </view>
        </view>
      </view>

      <!-- 退出登录：仅登录态展示（游客不显示）。
           ⚠️ 2026-10-10：**按钮自身就是那张白卡**，外层「白卡套浅灰药丸按钮」的那层已删
           （用户按截图要求：直接白色按钮就行，因为底色本来就是灰的）。
           去掉外层后按钮仍是**原生 `<button>`**（`@click="doLogout"` / `v-if` 登录态判断**逐字未动**）：
           微信 `<button>` 的 UA 样式本来就是 `display: block`，所以它照旧铺满「屏宽 − 左右各 16rpx」，
           与上方四张卡左右边界对齐（`.logout-btn` 里把 `display`/`width` 显式钉住，见样式注释）。 -->
      <button v-if="isLoggedIn()" class="logout-btn" @click="doLogout">退出登录</button>

    </scroll-view>

    <view v-show="announcementVisible" class="announcement-mask" @click="closeAnnouncement">
      <view class="announcement-dialog" @click.stop>
        <view class="announcement-dialog-head">
          <text class="announcement-dialog-title">公告详情</text>
          <text class="announcement-dialog-close" @click="closeAnnouncement">×</text>
        </view>
        <scroll-view class="announcement-detail-scroll" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false">
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
/**
 * ⚠️⚠️ 2026-10-10 卡片化改版（用户按参考图要求「上下两块都做成白底圆角卡片，页面底色改灰」）：
 *    · 页面底色 **白 → `#f5f6f8`**。取值依据（**不新造色系**）：同为 tabBar 页的
 *      `pages/index/index.vue`（`.home-page`）与 `pages/category/category.vue`（`.pg`）都是这个值，
 *      `wallet-transfer-header.contract.ps1` 也把它钉成了"页面灰底"。
 *      （本文件原来的 `#f5f5f5` 是**分隔条**色、`pages.json` 的 `#f5f5f5` 是 tabBar 底色，两者都不是页面底。）
 *    · 中间 5 个区块（身份区 / 我的订单 / 公告栏 / 功能宫格 / 退出登录）改成**浮在灰底上的白底圆角卡**，
 *      公共规格写在下面 `.identity-section` 前的那段注释里。
 *    · `.hero` 自带 `#F1471B` 底、`.bd` 未设底色 ⇒ 头部不受影响，卡片之间的缝隙显出的就是这里的灰。
 */
.pg { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: #f5f6f8; color: #242526; }
.bd { flex: 1; width: 100%; min-height: 0; margin-bottom: -50rpx; box-sizing: border-box; }

/**
 * 顶部背景区（个人页 hero）。
 *
 * ⚠️ 2026-09-29：`background` 由 `#0d0e0f`（深黑）改为 **`#F1471B`** ——
 *    这是背景图 `个人bg.jpg` **底部 3 行的平均色**（脚本实测 336 个采样点）。
 *    因为背景图改为按自身比例显示后，**内容更高时图片可能不够高**（750rpx 宽时图片自然高仅 631rpx），
 *    露出的底色必须是图片的自然延续色；用深黑会像"下面断了一截"。
 * ⚠️ `overflow: hidden` 是本次修复的关键：它负责把背景图**下方多余的部分裁掉**。
 * ⚠️ 2026-10-10 卡片化：头部下面不再是"紧贴的白区块"，而是灰底 + 卡片
 *    ⇒ 这里补一条 `margin-bottom: 16rpx`（与卡片间距同值，均为参考图实测），让"头部 → 第一张卡"的缝隙也一致。
 *    `overflow: hidden` 已让 `.hero` 成为 BFC，这条外边距不会和内部元素塌陷。
 */
.hero { position: relative; overflow: hidden; margin-bottom: 16rpx; padding-right: 38.17rpx; padding-left: 38.17rpx; background: #F1471B; color: #fff; }
/**
 * 背景图（`个人bg.jpg`，780×656）。
 *
 * ⚠️ 2026-09-29 修「**游客身份时背景图会往上移**」：
 *    原来是 `inset: 0; width: 100%; height: 100%` + `mode="aspectFill"` ——
 *    图片高度被绑成**容器高度**，而 `aspectFill` 是**居中裁剪**
 *    ⇒ 游客态内容少、`.hero` 变矮 ⇒ 显示的是图片**中间那一段** ⇒ 视觉上图片像"往上移了"✗。
 *    ⇒ 改为「`top/left` 定位 + `width: 100%` + `height: auto`」配合 `mode="widthFix"`：
 *      · 图片**按自身比例从顶部开始**显示（750rpx 宽时高 631rpx），**位置恒定、不随内容移动** ✔；
 *      · 容器矮（游客态）时，由 `.hero` 的 `overflow: hidden` **裁掉图片下方多余部分** ✔。
 *    ⚠️ 图片尺寸若更换，`mode="widthFix"` 会自动跟随，无需改这里。
 */
.hero-bg { position: absolute; top: 0; left: 0; z-index: 0; width: 100%; height: auto; }
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
/* ⚠️ 2026-09-29 背景改为 #4D3D3D + 透明度 0.6（用户指定），原来是深灰渐变
   `linear-gradient(104deg, #303134, #5c5d61, #28292b)`。
   ⚠️ 注意这是**半透明**底色：本元素 `margin-top: -196rpx` 向上压在头部区域之上，
      透出的正是头部自己的底色 ⇒ 实际观感会随头部渐变走（"融进头部"的效果）。
   ⚠️ 下面两层修饰保留：`box-shadow: inset` 是顶部内高光、`::after` 是一道斜向柔光，
      在深棕底上依旧成立；若后续觉得亮度过高再单独调。 */
.income-strip { position: relative; z-index: 1; display: flex; height: 196rpx; margin: -196rpx -38.17rpx 0; padding: 38rpx 38.17rpx 50rpx; box-sizing: border-box; overflow: hidden; background: rgba(77, 61, 61, .6); box-shadow: inset 0 1rpx rgba(255, 255, 255, .24); }
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
/**
 * ⚠️⚠️ 2026-10-10 第三版：卡片与尺寸**全部按参考图实测**重做
 *    （参考图 `docs/_ref/mine-reference/jd-profile-ref.jpg`，1080×615px 的整屏截图；整屏 1080px ↔ 750rpx
 *      ⇒ `rpx = px / 1080 * 750`。**校准依据**：卡片白底横向 x=23..1056px ⇒ 左右各留 23px = **16.0rpx**，两侧对称
 *      ⇒ 截图没有左右裁边，可以按"整屏 1080px"换算；另一条独立校验：5 个图标中心实测落在"卡宽等分 5 份"的位置上）。
 *
 *    · 卡片左右外边距 **16rpx**（实测 23px = 16.0rpx）；卡片之间、以及头部与首卡之间 **16rpx**
 *      （实测卡间灰缝 y=342..363px = 15.3rpx；`.hero` 也带同值下边距）。
 *      ⚠️ **只给下边距、不给上边距**：相邻两张卡若各带上/下边距会叠成 32rpx（不依赖 margin 合并，两平台一致）。
 *    · 圆角 **20rpx**：实测约 26px = 18.1rpx（左下/左上角轨迹拟合），沿用本页既有的 `.identity-card` 半径 20rpx（差 0.9 个 CSS px）。
 *    · 卡内左右内边距 **16rpx**（实测：卡内那条灰底订单条 x=46..1033px ⇒ 距卡片左右边各 16.0rpx）。
 *      ⚠️ 两排**宫格的格子是铺满整卡宽度**的（不是 16rpx 内缩）—— 参考图 5 个图标中心正好落在整卡宽度等分 5 份处，
 *         见 `(5)` 的对齐断言与实测列中心。
 *    · 尺寸（图标盒 52rpx / 字形 46rpx / 标签 24rpx / 行高 32rpx）的实测推导见下方 `.order-icon` 前的注释块。
 *    ⚠️ 卡面子元素**不得再用不透明白底铺满**：`.menu-list` 原来的 `background: #fff` 已删 ——
 *       方角白底会盖住卡片的圆角（父级只有 `border-radius`、没有 `overflow: hidden`）。
 */
.identity-section { margin: 0 16rpx 16rpx; padding: 24rpx 16rpx 28rpx; border-radius: 20rpx; background: #fff; }
.identity-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16rpx; }
.identity-title { color: #1E1E1E; font-size: 30rpx; font-weight: 600; }
.identity-list { display: flex; flex-direction: column; gap: 16rpx; }
.identity-card { display: flex; align-items: center; justify-content: space-between; padding: 22rpx 24rpx; box-sizing: border-box; border-radius: 20rpx; background: #f7f8fa; }
.identity-card-pending { opacity: .6; }
.identity-card-main { display: flex; min-width: 0; flex-direction: column; gap: 6rpx; }
.identity-label { color: #1E1E1E; font-size: 30rpx; font-weight: 600; }
.identity-sub { overflow: hidden; color: #86909c; font-size: 24rpx; white-space: nowrap; text-overflow: ellipsis; }
.identity-action { flex-shrink: 0; margin-left: 16rpx; color: #ff5500; font-size: 26rpx; font-weight: 600; }
/* ⚠️ 2026-10-10：卡片公共规格见上方注释。卡内纵向：上 16rpx（标题行）＋ 标题行向下 20rpx ＋ 宫格自身节奏 ＋ 下 16rpx。 */
.order-section { margin: 0 16rpx 16rpx; padding: 24rpx 0 16rpx; border-radius: 20rpx; background: #fff; color: #1E1E1E; font-family: 'PingFang SC', '苹方-简', sans-serif; font-weight: 500; }
/* ⚠️ 2026-10-10：卡内左右内边距 **16rpx**（实测参考图卡内内容距卡片边 16.0rpx）；宫格行本身不内缩（格子铺满卡宽）。 */
.order-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20rpx; padding: 0 16rpx; }
.order-title { color: #1E1E1E; font-size: 26.72rpx; font-weight: 500; }
.order-all { display: flex; align-items: center; gap: 15.27rpx; color: #1E1E1E; font-size: 26.72rpx; }
.all-arrow { width: 14rpx; height: 16rpx; }
/**
 * ⚠️⚠️ 2026-10-10 第三版：**尺寸按参考图实测下调**（用户真机反馈「大小太大了，我需要像京东个人页那样的」）。
 *    参考图 `docs/_ref/mine-reference/jd-profile-ref.jpg`（1080×615px 整屏，`rpx = px/1080*750`），
 *    Pillow 逐像素 ink 量测（两排各 5 个图标 + 4 字标签）：
 *      · 图标墨迹：宽 **36.8–40.3rpx**、高 **36.8–40.3rpx**（两排均值 ≈ 38.9 × 38.5rpx）；
 *      · 标签（4 字，如「商品收藏」）墨迹：宽 **89.6rpx**、高 **20.1rpx**；
 *        图标中心实测 87.5 / 230.9 / 374.7 / 519.1 / 663.2rpx ⇒ 与"卡宽等分 5 份"的理论值（见下）逐项 ≤1.0rpx。
 *
 *    我们这套字形（`app-icon-*`，10 个字形）**按同一套 4× 渲染逐像素量测**（不是字体 API 的 bbox —— 那个给的是
 *    排版框而非墨迹，会高估：它报"满 em 宽"，实渲染墨迹只有 0.78–1.00em）：
 *      先量"墨迹/字号"比值（基准 40rpx 盒 48rpx，实测）：墨迹 31.2–40.0rpx 宽 × 29.0–40.0rpx 高
 *      （均值 **34.2 × 32.4**）⇒ 墨迹/字号 = **0.855 宽、0.810 高**。
 *      ⇒ 让"平均墨迹"对上参考图（38.9 × 38.5rpx）：`font-size = 38.9 / 0.855 ≈ 45.5`、`38.5 / 0.810 ≈ 47.5`
 *        ⇒ 取 **46rpx**（实测墨迹均值 **39.5 × 37.3rpx**，与参考图差 +1.5% / −3.2%）。
 *      ⇒ 盒（`line-height`）= **52rpx**：46/52 = 0.885，字形四周留 3rpx（最大的那个字形 fapiao 墨迹正好 1.00em，
 *        在 52rpx 盒里四周各余 3rpx，**不裁切**）。
 *      ⚠️ 这套字形**偏扁**（横向 0.78–1.00em、纵向 0.72–1.00em）⇒ 扁字形（信用卡/货车）在 46rpx 下高约 33rpx，
 *         比参考图的方图标（≈38rpx 高）矮一档 —— 这是**字形形状**差异，不是尺寸没对上。
 *    标签字号 **24rpx**（= 12 CSS px，这类个人页的标准小字）：
 *      参考图 4 字墨迹 89.6 × 20.1rpx。CJK 字宽恒为 1em ⇒ 24rpx 时 4 字排版宽 96rpx、墨迹 ≈ 90–94rpx
 *      （与参考图的 89.6 差 ≤5%）；若沿用 26.72rpx，排版宽 106.9rpx、墨迹 ≈ 100–104rpx ⇒ 比参考图宽 13–16%。
 *      （Windows 无 PingFang，用 msyh 实渲染复核：24rpx 下 4 字墨迹 ≈ 92rpx 宽，与上式吻合。）
 *    行高 **32rpx**（显式写死，不用 `normal`）：`normal` 在 iOS/Android 上取值不同，会让两排纵向节奏漂移。
 *    纵向节奏验算（相对卡片上沿，单位 rpx）：卡内上内边距 24 ＋ 盒 52 ＋ 标签上边距 12 = 88（标签行盒顶）；
 *      标签墨迹顶 ≈ 88 + (32 − 20.1)/2 ≈ **94.0**（参考图实测 93.7 ✓）；标签盒底 88 + 32 = 120，
 *      ＋ 卡内下内边距 16 ⇒ 卡片高 **136.0**（参考图实测 135.4 ✓）。
 */
/* ⚠️ 2026-10-10 第三版：上排与下排宫格**逐项同构**（等分 5 列、铺满卡宽）。横向 scroll-view 已拆（原因见模板注释）：
   `padding: 0` ⇒ 行内容宽 = 卡片宽 750 − 2×16 = **718rpx** ⇒ 每格 718/5 = **143.6rpx**，
   列中心 = 16 + 143.6×(i+0.5) = **87.8 / 231.4 / 375.0 / 518.6 / 662.2rpx**（下排同一套数值 ⇒ 严格对齐）。
   参考图实测列中心 87.5 / 230.9 / 374.7 / 519.1 / 663.2rpx ⇒ 逐项偏差 ≤1.0rpx。 */
.order-grid { display: flex; align-items: flex-start; padding: 0; }
/* ⚠️ 与 `.menu-item`（含客服那个原生 button 之外的所有格）**逐字相同的声明** —— 两排列宽/列中心因此由同一套规则决定，
   契约 `mine-order-icons.contract.ps1` 直接比较这两条声明是否逐字相同（防"只改一边"）。 */
.order-item { display: flex; flex: 1 1 0; min-width: 0; flex-direction: column; align-items: center; }
/* 点击反馈：轻微缩放 + 变淡，让"点到了"更可感知（配合问题三的交互动效） */
.order-item:active { opacity: .6; transform: scale(.94); }
.order-icon { width: 52rpx; height: 52rpx; background: #d8d8d8; }
/* ⚠️ 2026-10-09 由切图（<image>）改为 iconfont 字形（<text>），这条规则替掉原 `.order-icon-image`；
   2026-10-10 第三版：盒 80.15→**52rpx**、字形 64→**46rpx**（推导见上方注释块）。
   · `background: transparent` —— 去掉 .order-icon 的灰色占位底；
   · `line-height: 52rpx` + `text-align: center` —— 把字形**在 52rpx 的盒子里居中**。
     若不钉行高（落回 `.app-icon { line-height: 1 }`），半行距变 0 ⇒ 字形整体上移，与盒子的中轴错开。
   · 选择器写成两段是为了稳过 `.app-icon { line-height: 1 }`（同权重时页面样式虽在后，
     但两段权重更高，不依赖 app.wxss / page.wxss 的加载顺序）。
   ⚠️ 墨迹复核（Pillow，4× 渲染后逐像素量测再折回 rpx，本字体 ascent/descent = 0.875/0.125em）：
      `font-size: 46rpx` / 盒 `52rpx` 时，10 个字形墨迹 **36.0–46.0rpx 宽 × 33.0–46.2rpx 高**
      （均值 39.5 × 37.3rpx；参考图实测 36.8–40.3rpx 见方 / 均值 38.9 × 38.5 ⇒ 差 +1.5% / −3.2%）；
      盒内**四周各余 ≥3.0rpx、不裁切**；水平/垂直中心偏差 **≤0.8rpx**（无需 translateY 校正）。 */
.order-icon.order-icon-font { display: inline-block; background: transparent; color: #1E1E1E; font-size: 46rpx; line-height: 52rpx; text-align: center; }
/* ⚠️ 标签：与下方 `.menu-label` 逐项同值（只有那边的 `display: block` 是给原生 button 用的）。 */
.order-label { margin-top: 12rpx; color: #1E1E1E; font-size: 24rpx; font-weight: 500; line-height: 32rpx; white-space: nowrap; }

/* ⚠️ 2026-10-10：卡片公共规格见上方注释（外边距/圆角/卡内 16rpx 内边距均为参考图实测值）。 */
.announcement-bar { display: flex; align-items: center; gap: 16rpx; margin: 0 16rpx 16rpx; padding: 16rpx; border-radius: 20rpx; background: #fff; }
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

/* ⚠️⚠️ 2026-10-10 宫格化（第三版：尺寸与卡片按参考图实测重做）：下方功能列表由**纵向列表**改成
   **一行等分宫格**（图标在上、文字在下），与上方「我的订单」**逐项同构**。模板结构**一个字没动**：
   `.menu-list` 里仍是「客服原生 button + `visibleMenuItems` 的 v-for」，只是布局从"每一行一项"变成"一排格子"。

   ▸ 一行几格：`flex: 1 1 0` ⇒ **所有格子永远等宽**，格子数 = 可见项数（1~6 个都自适应铺满整卡宽）：
       · 5 格（发票记录 / 设置 / 客服 / 我的收藏 / 商品素材）= 参考图那一排的形态；行内容宽 718rpx ⇒ 每格 **143.6rpx**；
       · 6 格（再多一个「商家入驻」，普通用户的默认情形）= 每格 **119.7rpx**，最长 4 字 label 在 24rpx 字号下宽 **96rpx**
         ⇒ 左右各余 ≈11.8rpx，**仍放得下** ⇒ 不做折行（`flex-wrap` 保持默认 nowrap，"一行"是硬要求）。
         ⚠️ 若以后再加 5 字以上 label（96 → 120rpx），6 格就会挤 ⇒ 那时改回"每行 5 格 + 折行"。
       · 少于 5 格（模块开关关掉「发票记录」等）= 每格变宽，整排仍铺满卡片宽度，不做居中/左对齐特判（`flex: 1` 天然均分）。
   ▸ 不折行靠**两条**保证：格子等分（宽度够）+ `.menu-label` 的 `white-space: nowrap`（与 `.order-label` 同一条机制）。
   ▸ 与上排的对齐：两边**同一套格子规则**（`.menu-item` 与 `.order-item` 声明逐字相同）+ 同样铺满卡宽
     ⇒ 列宽都是 143.6rpx、列中心都是 87.8 / 231.4 / 375.0 / 518.6 / 662.2rpx（详见上方 `.order-grid` 注释与契约断言）。 */
.menu-section { margin: 0 16rpx 16rpx; padding: 0; border-radius: 20rpx; background: #fff; font-family: 'PingFang SC', '苹方-简', sans-serif; font-weight: 500; }
/* ⚠️ 2026-10-10：`background: #fff` **必须没有** —— 卡面已经是白的，这里再铺一层方角白底会盖掉卡片圆角
   （父级只有 `border-radius`、没有 `overflow: hidden`）。
   纵向 24/16 是参考图实测的卡内节奏（见 `.order-icon` 前的验算：24 + 52 + 12 + 32 + 16 = 136rpx = 实测卡片高 135.4rpx）。 */
.menu-list { display: flex; align-items: flex-start; padding: 24rpx 0 16rpx; }
/* 宫格单元（客服之外的每一项，以及 `v-else` 灰块占位）：等宽 + 纵向"图标在上、文字在下"。
   ⚠️ 与上方 `.order-item` **逐字相同的声明** —— 两排列宽/列中心因此由同一套规则决定。 */
.menu-item { display: flex; flex: 1 1 0; min-width: 0; flex-direction: column; align-items: center; }
/* 点击反馈：与上方 `.order-item` 逐项同值（"同一套组件"的观感一致性） */
.menu-item:active { opacity: .6; transform: scale(.94); }
/**
 * 客服项：微信原生客服按钮 `<button open-type="contact">`（**不能**改成 `<view>`/`<text>`，否则弹不出客服会话，
 * 契约 `mine-icons.contract.ps1` 也钉着它）。
 *
 * ⚠️⚠️ 这里**刻意不用 flex 布局**：微信 `<button>` 的 `display` 由基础库 UA 样式决定，历史上这一项能"图标在左、
 *    文字在右"其实靠的是 inline 流（`<text>` 图标 + `<text>` 文字）——**不能证明 button 吃 `display: flex`**。
 *    所以宫格化改用「block 流 + 居中」这条不依赖 flex 的路径，与其它格视觉等价：
 *      · `display: block` + `text-align: center`：图标是 inline-block（`.menu-icon.menu-icon-font`），第一行居中；
 *      · `.menu-label` 是 `display: block` ⇒ 自动落到第二行；
 *      · 行高对齐：图标盒 `line-height: 52rpx` ⇒ 该行行盒正好 52rpx（字体 descent 8.75rpx 大于 strut 的下沉量，
 *        不会多出 inline-block 常见的基线缝），再 + `.menu-label` 的 `margin-top: 12rpx` + 文字行高 32rpx
 *        ⇒ 与 flex 版逐项等高（96rpx），横向也一样是 52rpx 盒居中。
 *      · `flex: 1 1 0` 让它与其它格**等宽**（它是 `.menu-list` 的 flex item，`display` 被块化，不影响格宽）。
 */
.menu-item-btn { display: block; flex: 1 1 0; min-width: 0; width: 100%; margin: 0; padding: 0; background: transparent; border: 0; border-radius: 0; line-height: inherit; text-align: center; }
.menu-item-btn::after { border: 0; }
.menu-item-btn:active { opacity: .6; transform: scale(.94); }
/* ⚠️ 2026-10-10 第三版：图标盒 **52rpx**、字形 **46rpx**（与上方 `.order-icon` 同值，推导/实测见 `.order-icon` 前的注释块）。
   ⚠️ 宫格化：`margin-right: 34.35rpx` 已删 —— 图标不再"靠左、文字在右"，
      而是**落在格子的中轴**上（`margin: auto` + 格的 `align-items: center` 双保险；button 里则靠 `text-align: center`，
      inline 级元素的 auto 外边距按规范算作 0，两者结果一致）。
   ⚠️ 格子高由内容撑开（52 + 12 + 32 = 96rpx），不用 `min-height`（改版前那个 99.24rpx 是"列表行"的高，宫格化后无意义）。
   墨迹实测（Pillow 4×，与上方同口径）：10 个字形在 46rpx 下墨迹 36.0–46.0rpx 宽 × 33.0–46.2rpx 高，
   盒 52rpx ⇒ 四周各余 ≥3.0rpx、不裁切；中心偏差 ≤0.8rpx。 */
.menu-icon { width: 52rpx; height: 52rpx; flex-shrink: 0; margin-right: auto; margin-left: auto; background: #d8d8d8; }
.menu-icon-image { background: transparent; }
/* ⚠️ 字形盒规则，与上方 `.order-icon.order-icon-font` **逐项同规格**（52rpx 盒 / 46rpx 字号 / line-height 钉成盒高）：
   · `background: transparent` —— 去掉 .menu-icon 的灰色占位底；
   · `line-height: 52rpx` + `text-align: center` —— 把字形在盒内**居中**。
     ⚠️ 这一条**不要改**：本字体 ascent/descent = 0.875/0.125em（实测），
     `line-height: 52rpx` 时半行距 = (52 − 46)/2 = **3.0rpx**，基线落在盒中心；
     若不钉（落回 `.app-icon` 的 `line-height: 1`），半行距变 0 ⇒ 字形整体**上移 3.0rpx**（贴着盒顶），
     与上排/上一版的纵向观感不一致。盒高是显式写死的，行高不会反过来撑高所在的那一格；
   · `font-size: 46rpx`（盒宽的 88.5%）—— 与上方同值，来自参考图实测（见 `.order-icon` 前注释）。
   · 选择器写成两段（`.menu-icon.menu-icon-font`）是为了稳过 `.app-icon { line-height: 1 }`（同权重时页面样式虽在后，
     但两段权重更高，不依赖 app.wxss / page.wxss 的加载顺序）—— 与上方那条同一个理由。 */
.menu-icon.menu-icon-font { display: inline-block; background: transparent; color: #1E1E1E; font-size: 46rpx; line-height: 52rpx; text-align: center; }
/**
 * ⚠️ 2026-10-10 文字规格与上方 `.order-label` **逐项同值**（字号 24rpx / 行高 32rpx / 字重 500 / 颜色 #1E1E1E /
 *    上边距 12rpx / `white-space: nowrap`），只有 `display: block` 是宫格新增的：
 *      · `display: block` 是给**客服那个原生 `<button>`** 用的：它走 block 流（见 `.menu-item-btn`），
 *        需要 `block` 才能把文字落到图标下面一行；在 `.menu-item` 的 flex 列里它就是普通 flex item，等价。
 *      · `white-space: nowrap` = **不折行**机制，与上方 `.order-label` 同一条（格子等分保证宽度也够）。
 */
.menu-label { display: block; margin-top: 12rpx; color: #1E1E1E; font-size: 24rpx; font-weight: 500; line-height: 32rpx; white-space: nowrap; }
/**
 * 退出登录（仅登录态展示）：**按钮自身就是白底圆角卡**。
 *
 * ⚠️ 2026-10-10 双层合一（用户按截图要求：「退出登录这里直接白色按钮就行，因为底色本来就是灰色的」）：
 *    原来是「外层白卡（`.logout-section`，`background: #fff` + `padding: 8rpx 16rpx`）
 *    ＋ 卡内浅灰药丸按钮（`#f5f5f5` / `border-radius: 44rpx`）」两层；页面底色本身就是灰的，
 *    所以外层白卡纯属多余 ⇒ 整条规则删除，**卡面规格搬到按钮自己身上**：
 *      · `background: #fff` = 卡面白，与上方四张卡**同一色值**；
 *      · `border-radius: 20rpx` = 卡圆角（原按钮自己的 44rpx 药丸圆角随之作废）；
 *      · `margin: 0 16rpx …` = 与四张卡**同一条左右卡槽**（16rpx 实测值），左右边界逐像素对齐；
 *      · 底部仍是 **40rpx**（不是卡间的 16rpx）：它承担的是**页面最底部留白**，
 *        原本挂在外层白卡的 `margin-bottom` 上，现在由按钮承担，**值不变 ⇒ 页面底部间距与改版前一致**；
 *      · `font-family` 也从被删的外层白卡挪到按钮上（按钮此前靠继承拿到它，删掉外层就不能再靠继承）。
 *    · `line-height: 88rpx` / `font-size: 28rpx` / `font-weight: 500` / `color: #ff5500` **逐字未改**
 *      ⇒ 文字规格与点按区都不变（88rpx ≈ 44px，达触控目标下限）。
 *    · `display: block` + `width: auto` + `padding: 0` 是**把 UA 默认显式钉住**（微信 `<button>` 默认
 *      就是 block 全宽 + 左右各 14px 内边距）：改版后按钮要独立当卡用，**不再依赖 UA 默认值**——
 *      三者叠加后按钮的**外框**与原先那个外层 `<view>` 卡完全等宽，文字仍居中（故不产生视觉变化）。
 * ⚠️ 白底 `#fff` 与页面灰 `#f5f6f8` 的对比度与上方四张卡**完全一致**（同一对色值），
 *    所以这里**有意不加边框、不加阴影/描边**：加了反而与其它卡不一致；用户只要求"白色按钮"。
 */
.logout-btn { display: block; width: auto; margin: 0 16rpx 40rpx; padding: 0; border-radius: 20rpx; background: #fff; color: #ff5500; font-family: 'PingFang SC', '苹方-简', sans-serif; font-size: 28rpx; font-weight: 500; line-height: 88rpx; }
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
