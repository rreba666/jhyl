<script setup lang="ts">
/**
 * 商家端 · 工作台首页（对应设计稿「商家端」画板 2690:31292）
 * 契约：
 * - GET /api/merchant/overview        今日订单 / 今日成交额 / 净额 + 待接单 / 待取货计数
 * - GET /api/merchant/orders?tab=     配送中 / 已完成 页签 total（只取计数）
 * - GET /api/merchant/products?status= 已上架 / 待上架 total（在售列表顺带算库存预警）
 * 四宫格统计按设计稿：订单管理 = 待配送/配送中/已完成，新增商品 = 已上架/待上架，
 * 商品管理 = 在售商品/库存预警，第四张卡 = 净额（订单口径）。
 * 范围结论：商家结算账户尚未实现，balance 是「订单口径净额」（balanceScope=ORDER_NET），
 * 展示时标注口径，不写成「可提现余额」。
 */
import { computed, ref } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import {
  countMerchantProducts,
  getMerchantOverview, getMerchantShopList, getMerchantUnread, getMyMerchantApply,
  updateMerchantShopImage,
  type MerchantApplyVO, type MerchantOverviewVO, type MerchantShopDetail,
} from '@/api/merchant'
import { getIdentity, switchIdentity, type IdentitySwitchVO, type IdentityVO } from '@/api/identity'
import { uploadFile } from '@/utils/request'
import { preloadMerchantSubscribeConfig, requestMerchantSubscribe } from '@/utils/subscribe'
// 电脑端后台（PC 控制台）的地址与文案：**唯一来源**（地址只在该模块里写一次；见其头部注释）。
import {
  MERCHANT_CONSOLE_ENTRY_SUB, MERCHANT_CONSOLE_ENTRY_TITLE, MERCHANT_CONSOLE_PASSWORD_NOTE,
  MERCHANT_CONSOLE_PASSWORD_RULE, MERCHANT_CONSOLE_SHEET_SUB, MERCHANT_CONSOLE_SHEET_TITLE,
  MERCHANT_CONSOLE_URL, merchantConsoleAccount,
} from '@/utils/merchant-console'

const statusBarHeight = ref(0)
const shopName = ref('')
/**
 * ⚠️ 顶部头像 = **门店头像**（门店自己的 `shopImage`），**不是**登录用户的人像头像。
 * 2026-10-09 修：此前这里用的是 `user.avatarUrl` ⇒ 顶部显示的是"人"的头像（没设微信头像时
 * 就是默认切图），对不上"门店"这个语义（用户反馈：「门店头像现在是默认 logo，需要商家能自己上传」）。
 * 现在唯一来源是 `GET /api/merchant/shop/list`（`ShopVO`，**含 `shopImage`**）。
 */
const shopList = ref<MerchantShopDetail[]>([])
/** 头像上传中（禁用按钮，防连点）。 */
const avatarUploading = ref(false)
/** 身份列表：顶部箭头的身份切换弹层用（一个账号多角色）。 */
const identity = ref<IdentityVO | null>(null)
const roleSheetVisible = ref(false)
const roleSwitching = ref(false)
/** 弹层当前选中的角色：'CUSTOMER' / 'MANAGER' / 'RIDER'。 */
const selectedRoleKey = ref('CUSTOMER')

const overview = ref<MerchantOverviewVO>({})
/** 四宫格计数：商品（已上架 / 待上架）。库存预警与订单计数都用后端 overview 的权威字段。 */
const onSaleCount = ref(0)
const offSaleCount = ref(0)

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '商家工作台' })
})

/** 商家端未读通知数（**拉取即清零**，主通道；不依赖微信授权）。 */
const unread = ref(0)
/** 未读轮询定时器（30s；每次拉取都会清零，故不要高频调用）。 */
let unreadTimer: ReturnType<typeof setInterval> | null = null
/** 拉取未读并直接覆盖本地角标（**不做本地累加** —— 与后端清零语义冲突）。 */
async function refreshUnread(): Promise<void> {
  try {
    unread.value = Number(await getMerchantUnread()) || 0
  } catch {
    // 未读只是提示，失败保持原值，不打断工作台
  }
}
/** 停止轮询（页面离开时必须清理）。 */
function stopUnreadTimer(): void {
  if (unreadTimer) {
    clearInterval(unreadTimer)
    unreadTimer = null
  }
}
onShow(() => {
  // ⚠️ 预取订阅配置（缓存）：点击那一刻只能同步读缓存，来不及请求接口
  void preloadMerchantSubscribeConfig()
  // 店铺名与可选身份从后端拉取（身份卡列表同源）；**门店头像单独取门店列表**（含 shopImage）
  void loadIdentity()
  void loadShopProfile()
  void loadOverview()
  void loadProductCounts()
  // 未读通知：进入即拉一次（后续 30s 轮询；每次拉取后端都会清零）
  void refreshUnread()
  stopUnreadTimer()
  unreadTimer = setInterval(() => { void refreshUnread() }, 30000)
})

// 离开页面停止轮询（否则切后台后定时器仍在跑）
onHide(stopUnreadTimer)
onUnload(stopUnreadTimer)

/** 问候语按时间段。 */
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了，注意休息'
  if (h < 12) return '早上好，生意兴隆！'
  if (h < 18) return '下午好，生意兴隆！'
  return '晚上好，生意兴隆！'
})

async function loadOverview(): Promise<void> {
  try {
    overview.value = (await getMerchantOverview()) || {}
  } catch {
    overview.value = {}
  }
}

/**
 * 商品计数（四宫格「新增商品」卡：已上架 / 待上架）。
 *
 * ✅ 2026-09-30：后端已修 `total` 的 `status` 过滤（提交 `4639d1b1`，谓词下推 SQL、
 * 移除内存二次过滤）⇒ `countMerchantProducts()` **已改回读接口的 `total`**
 * （见 `api/merchant.ts` 的口径说明），不再用"按返回条数统计"的绕过
 * —— 那个绕过在商品超过 100 条时会**偏小**。
 */
async function loadProductCounts(): Promise<void> {
  try {
    const [onSale, offSale] = await Promise.all([countMerchantProducts(1), countMerchantProducts(0)])
    onSaleCount.value = onSale
    offSaleCount.value = offSale
  } catch {
    // 忽略
  }
}

/**
 * 四宫格订单与库存计数：**全部改用后端 `overview` 的权威计数**
 * （2026-09-19 后端补齐 `deliveringCount` / `doneCount` / `lowStockCount`）。
 *
 * 在此之前前端只能自己凑：打 2 个订单列表请求取页签 total 当「配送中/已完成」，
 * 并拉在售列表在本地按阈值过滤算「库存预警」（在售商品超过 100 条时还会偏小）——
 * 这些替代方案现已全部删除，同时首页少打 2 个请求。
 */
const pendingDeliverCount = computed(
  () => Number(overview.value.pendingAcceptCount || 0) + Number(overview.value.pendingPickupCount || 0),
)
const deliveringCount = computed(() => Number(overview.value.deliveringCount || 0))
const doneCount = computed(() => Number(overview.value.doneCount || 0))
/** 库存预警：后端按「本店已上架且品牌级总量 ≤ 100」统计（阈值硬编码在后端，与商品列表页 Tab 同口径）。 */
const warningCount = computed(() => Number(overview.value.lowStockCount || 0))

/** 金额格式化：千分位 + 两位小数。 */
function money(value?: number): string {
  return (Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 今日成交额整数/小数拆分（整数 17px / 小数 13px）。 */
const amountParts = computed(() => {
  const fixed = money(overview.value.todayAmount)
  const [int, dec] = fixed.split('.')
  return { int: int || '0', dec: dec || '00' }
})

/**
 * 服务分文案（设计稿顶部数据条第三格，一位小数）。
 * 后端 overview 暂未下发 `serviceScore`，未下发时显示「—」而不是 0 —— 0 会被误读成"真实评分为 0"。
 * 字段上线后无需改代码即可自动展示。
 */
const serviceScoreText = computed(() => {
  const value = overview.value.serviceScore
  return value == null ? '—' : Number(value).toFixed(1)
})

/** 进「门店管理」（品牌商家自建 / 启停门店；后端 `/api/merchant/shop*`）。 */
function goShops(): void {
  uni.navigateTo({ url: '/subpkg-merchant/shops/index' })
}

function goOrders(): void {
  // 引导订阅「新订单」通知（⚠️ 必须在点击手势的同步链路里；模板未配置时会静默跳过）
  requestMerchantSubscribe(['NEW_ORDER'])
  uni.navigateTo({ url: '/subpkg-merchant/orders/list' })
}
function goAddProduct(): void {
  uni.navigateTo({ url: '/subpkg-merchant/products/edit' })
}
function goProducts(): void {
  uni.navigateTo({ url: '/subpkg-merchant/products/list' })
}
function goBill(): void {
  uni.navigateTo({ url: '/subpkg-merchant/bill/index' })
}
/**
 * 是否品牌主体（`MERCHANT_OWNER`）：**只有品牌主体**能看结算账户与提现（提现文档 §1）。
 * 店长（MANAGER）与店员调 `/api/merchant/settlement/**` 会返回 `13016`，
 * 所以入口对他们直接隐藏，避免点进去只看得到"没权限"。
 */
/**
 * 是否**品牌主体**（可提现）。
 *
 * ⚠️⚠️ 2026-09-23 修正：原来只看 `staffRole === 'MERCHANT_OWNER'`。
 * 而 `staffRole` 是**当前身份**的账号主角色 —— 商户切到「店长」身份时（例如刚新建的门店）
 * 它是 `MANAGER`，于是工作台的「结算与提现」入口**整个消失**，用户会以为"小程序没有提现入口"。
 * 更矛盾的是：结算页**早就准备好了** 13016「仅品牌主体可提现」的提示卡，却永远用不到
 * （`subpkg-merchant/settlement/index.vue` 的那段注释写的就是"店长/店员误入"）。
 *
 * 现在改为看 `identities` **全集**里是否存在 `MERCHANT_OWNER`。
 *
 * ⚠️ 但**「结算与提现」入口已不再用它**（2026-09-23 二次修改）：前端不该用身份判断去
 * **隐藏功能** —— 那正是"用户以为功能不存在"的根因。入口改为对所有商家端身份可见，
 * 权限交给后端（13016）与结算页的提示卡。本 computed 保留给将来"确实需要按身份区分"的场景，
 * 届时请用它、不要退回只看 staffRole。
 */
const isMerchantOwner = computed(() => {
  const list = identity.value?.identities || []
  if (list.some((item) => String(item.role || '').toUpperCase() === 'MERCHANT_OWNER')) return true
  // 兜底：identities 缺失/为空（老接口或异常场景）时退回 `staffRole` 判断
  return String(identity.value?.staffRole || '').toUpperCase() === 'MERCHANT_OWNER'
})

/** 进「结算与提现」：账户卡片 + 提现申请表单 + 账户流水/提现记录入口。 */
function goSettlement(): void {
  uni.navigateTo({ url: '/subpkg-merchant/settlement/index' })
}

// ===== 电脑端后台（PC 控制台）登录说明弹层（2026-10-10 新增，用户选了方案 B）=====
/**
 * 入口 + 弹层。为什么放在**工作台**而不是入驻页（`subpkg-merchant/apply/apply.vue`）：
 * 入驻页确实已经有「商家工号」行与「工号用于登录 PC 控制台」的提示（`apply.vue` L344 / L100-L101 / L362），
 * **但那一页在拿到商家身份之后就点不到了** —— `pages/mine/mine.vue` 的菜单过滤是
 * `if (item.key === 'merchant-apply' && identity.value?.hasBusinessIdentity) return false`
 * （契约 `merchant-entry-module.contract.ps1` 还专门把这个隐藏行为钉住），
 * 而 `/subpkg-merchant/apply/apply` 全仓**只**有那一个 `navigateTo`（grep 核实）。
 * ⇒ 把按钮放入驻页 = 真正需要它的人（已发号的商家）永远看不到。
 * 工作台是商家拿到身份后的常驻页面（「我的 → 我的身份 → 门店管理」）⇒ 入口放这里。
 * ⚠️ 没有在入驻页再放一个"同款入口"：逻辑与文案全部共用上面的模块，重复的是入口而不是真相源。
 *
 * 数据：`GET /api/merchant/apply/my`（C 端 token，契约原文「返回**最近一次**申请」，
 * 且 `data=null` = 从未申请过，**不是报错**）⇒ 只拿 `accountUsername` / `backendAccountIssued`。
 * ⛔ 不调 `/api/admin/staff/{id}/login-password`（契约：**仅中控/客服可用**）⇒ 小程序里**没有密码**。
 */
const consoleVisible = ref(false)
/** 弹层里的账号信息：**打开时才拉**（工作台首屏已经打了 4~5 个接口，不为一个弹层加首屏成本）。 */
const consoleLoading = ref(false)
/** 拉取失败（网络/接口异常）——与"查不到申请单"是**两件事**，不能混成一句话。 */
const consoleError = ref(false)
/** 已成功拿到过一次就缓存（同一页面停留期间不重复请求；失败不缓存，重开可重试）。 */
const consoleLoaded = ref(false)
const consoleApply = ref<MerchantApplyVO | null>(null)

/**
 * 弹层里「登录账号」那一格的取值：
 * 加载中 / 拉取失败 / 拿到数据后按 `merchantConsoleAccount()` 的四态（已发号 / 已发号但工号未返回 /
 * 未发号 / 未查到申请）如实显示。⛔ 任何分支都不编工号、不显示密码。
 */
const consoleAccount = computed<{ state: string; username: string; value: string; note: string }>(() => {
  if (consoleLoading.value) return { state: 'loading', username: '', value: '查询中…', note: '' }
  if (consoleError.value) {
    return {
      state: 'error',
      username: '',
      value: '账号信息查询失败',
      note: '可稍后重新打开本弹层再试；下方后台地址与密码说明不受影响。',
    }
  }
  return merchantConsoleAccount(consoleApply.value)
})

/** 打开弹层：第一次打开才拉申请状态（失败可重试）。 */
async function openConsoleGuide(): Promise<void> {
  consoleVisible.value = true
  if (consoleLoaded.value || consoleLoading.value) return
  consoleLoading.value = true
  consoleError.value = false
  try {
    consoleApply.value = await getMyMerchantApply()
    consoleLoaded.value = true
  } catch {
    // 拿不到就**如实说拿不到**：静态部分（地址 / 密码规则）照常显示，账号格不猜。
    consoleApply.value = null
    consoleError.value = true
  } finally {
    consoleLoading.value = false
  }
}

function closeConsoleGuide(): void {
  consoleVisible.value = false
}

/** 复制后台地址（长域名手输几乎必错；复制失败就如实提示手抄）。 */
function copyConsoleUrl(): void {
  uni.setClipboardData({
    data: MERCHANT_CONSOLE_URL,
    success: () => uni.showToast({ title: '后台地址已复制', icon: 'none' }),
    fail: () => uni.showToast({ title: '复制失败，请手动记录地址', icon: 'none' }),
  })
}

// ===== 门店头像（2026-10-09）：来源 `GET /api/merchant/shop/list`（`ShopVO`，含 `shopImage`）=====
//
// ⚠️ 为什么不用 `GET /api/merchant/shops`：那个端点复用 `StaffAccountVO`（账号口径，
//    只有店长/骑手/绑定微信人数），**没有 `shopImage`** ⇒ 拿不到门店图片。
//    `/api/merchant/shop/list` 返回 `ShopVO`，**含 `shopImage` 与门店名**（`api_doc.json` 逐字核对）。

/**
 * 当前门店：优先身份里带的门店 ID，其次按门头名匹配，最后取第一家**未删除**门店。
 * ⚠️ 全部取自后端真实下发值；**不造默认值、不猜坐标**（拿不到就 `null`，前端如实降级）。
 */
const currentShop = computed<MerchantShopDetail | null>(() => {
  const alive = shopList.value.filter((item) => Number(item.delFlag ?? 0) !== 1)
  const pool = alive.length ? alive : shopList.value
  if (!pool.length) return null
  const identityShopId = identity.value?.shopId ?? identity.value?.identities?.[0]?.shopId
  if (identityShopId != null) {
    const byIdentity = pool.find((item) => Number(item.id) === Number(identityShopId))
    if (byIdentity) return byIdentity
  }
  const byName = pool.find((item) => item.name && item.name === shopName.value)
  return byName || pool[0]
})

/** 顶部头像：**门店自己的 `shopImage`**，未设置时回退默认切图（放分包不占主包）。 */
const shopAvatar = computed(() => currentShop.value?.shopImage || '/subpkg-merchant/static/shop-avatar-default.png')

/**
 * 是否可上传门店头像。
 * ⚠️ 口径与「门店管理」入口一致：**只有品牌主体（`MERCHANT_OWNER`）**能写 `/api/merchant/shop*`
 * （店长/店员调它会 1004）⇒ 不做"点了必然失败"的按钮：无编辑权时头像**只读展示**。
 */
const canEditShop = computed(() => isMerchantOwner.value && currentShop.value != null)

/** 拉门店列表（门店头像的唯一来源；失败置空 ⇒ 退回默认切图，不伪造 URL）。 */
async function loadShopProfile(): Promise<void> {
  try {
    const list = await getMerchantShopList()
    shopList.value = Array.isArray(list) ? list : []
  } catch { shopList.value = [] }
}

/**
 * 选择/上传**门店头像**（最小实现：选图 → 上传 → 只改 `shopImage` → 刷新）。
 *
 * ⚠️ 走的是既有 `open-type="chooseAvatar"` 按钮（微信头像/相册/拍照任选一张）——
 * 该按钮与 `@chooseavatar` 已被 `tests/merchant-home-role.contract.ps1` 钉住，故**保留**；
 * 但**写回的目标从"用户资料"改成"门店"**（这正是本次修复的语义）。
 *
 * ⚠️ `PUT /api/merchant/shop/{id}` 的 `ShopUpdateDTO.name` 是**必填**（契约 `required = ["name"]`）
 * ⇒ `name` **原样回传**门店列表里的当前值。**读不到当前门店名就整个不发请求**（如实提示），
 * 绝不臆造一个名字去把请求凑成合法。地址/经纬度/营业时间等字段一律不发。
 */
async function onChooseAvatar(event: { detail: { avatarUrl?: string } }): Promise<void> {
  const tempPath = event.detail?.avatarUrl
  if (!tempPath || avatarUploading.value) return
  const shop = currentShop.value
  if (!shop) {
    uni.showToast({ title: '未取到门店信息，无法上传门店头像', icon: 'none' })
    return
  }
  const name = String(shop.name || '').trim()
  if (!name) {
    uni.showToast({ title: '门店名称缺失，请到门店管理查看', icon: 'none' })
    return
  }
  avatarUploading.value = true
  try {
    const shopImage = await uploadFile(tempPath)
    await updateMerchantShopImage(shop.id, { name, shopImage })
    await loadShopProfile()
    uni.showToast({ title: '门店头像已更新', icon: 'none' })
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '门店头像上传失败', icon: 'none' })
  } finally {
    avatarUploading.value = false
  }
}

/** 角色展示元信息（名称/说明/图标），文案与图标取自设计稿「选择你要进入的角色」弹层。 */
function roleMeta(entry: 'CUSTOMER' | 'MANAGER' | 'RIDER'): { name: string; desc: string; icon: string } {
  if (entry === 'MANAGER') return { name: '商户管理员', desc: '上传商品，管理店铺，经营数据', icon: '/subpkg-merchant/static/role-merchant.png' }
  if (entry === 'RIDER') return { name: '骑手', desc: '接单配送，及时送达', icon: '/subpkg-merchant/static/role-rider.png' }
  return { name: '商城用户', desc: '浏览选购好物，享受品质生活', icon: '/subpkg-merchant/static/role-customer.png' }
}

/** 身份切换弹层的角色项：商城用户恒有，其余按已开通身份生成，待开通置灰。 */
const roleOptions = computed(() => {
  const list: { key: string; bindingId: number | null; disabled: boolean; name: string; desc: string; icon: string }[] = [
    { key: 'CUSTOMER', bindingId: null, disabled: false, ...roleMeta('CUSTOMER') },
  ]
  type RoleOption = { key: string; bindingId: number | null; disabled: boolean; name: string; desc: string; icon: string }
  /**
   * ⚠️⚠️ 2026-09-23 关键修正：按 entry 归并时**必须优先保留 `MERCHANT_OWNER`**。
   *
   * 入驻审核通过会**同时**授予「商家（MERCHANT_OWNER）」与「首店店长（MANAGER）」两个身份，
   * 而两者的 `targetPage` **都是 `MANAGER`**（都进本工作台）。原来这里简单地
   * "见过就跳过"，于是**第二张被丢掉**，保留的却是后端**先返回**的那张（通常正是店长）
   * ⇒ 弹层里只有一个「商户管理员」，用户**没有任何办法切到商家身份**
   * ⇒ 结算/提现页永远显示 13016「仅商户品牌主体可查看」
   * （真实反馈："我的账号是商户主体，为什么显示这个"，且弹层里确实没有商家选项）。
   *
   * 商家身份权限更高（结算/提现只认品牌主体），且店长能做的它都能做
   * ⇒ 同一入口下保留 owner 是无损的正确选择。
   */
  const byEntry = new Map<string, RoleOption & { role: string }>()
  ;(identity.value?.identities || []).forEach((item) => {
    const entry = (item.targetPage || 'CUSTOMER') as 'CUSTOMER' | 'MANAGER' | 'RIDER'
    if (entry === 'CUSTOMER') return
    const role = String(item.role || '').toUpperCase()
    const existing = byEntry.get(entry)
    if (existing && !(role === 'MERCHANT_OWNER' && existing.role !== 'MERCHANT_OWNER')) return
    byEntry.set(entry, { key: entry, bindingId: item.bindingId, disabled: Boolean(item.pending), role, ...roleMeta(entry) })
  })
  byEntry.forEach((option) => list.push({
    key: option.key,
    bindingId: option.bindingId,
    disabled: option.disabled,
    name: option.name,
    desc: option.desc,
    icon: option.icon,
  }))
  // 店长身份「内含骑手能力」（IdentityVO.deliveryCapability）：后端常常只返回一张店长卡，
  // 此时必须补一个「骑手」入口，否则门店管理员根本进不去配送页。
  // 进骑手页**不需要切换身份**（同一 token、身份仍是店长，任务接口用 C 端 token 直调），
  // 所以这一项 bindingId 保持 null，走直接跳转（见 confirmSwitch）。
  if (identity.value?.deliveryCapability && !byEntry.has('RIDER')) {
    list.push({ key: 'RIDER', bindingId: null, disabled: false, ...roleMeta('RIDER') })
  }
  return list
})

/** 拉取身份列表：用于弹层可选角色，同时同步店名。 */
async function loadIdentity(): Promise<void> {
  try {
    identity.value = await getIdentity()
    const first = identity.value?.identities?.[0]
    shopName.value = first?.shopName || first?.merchantName || ''
  } catch { identity.value = null }
}

/** 打开身份切换弹层，默认选中当前身份（取切换缓存里的 entry）。 */
function openRoleSheet(): void {
  try {
    const cached = uni.getStorageSync('identity_entry') as IdentitySwitchVO | ''
    if (cached && typeof cached === 'object' && cached.entry) selectedRoleKey.value = cached.entry
  } catch { /* 忽略 */ }
  roleSheetVisible.value = true
}

function closeRoleSheet(): void {
  roleSheetVisible.value = false
}

/**
 * 确定切换身份（token 不变，按后端返回的 entry 决定去哪）。
 * 注意：MANAGER 的目标页就是**本页**（商家端工作台），所以原地刷新即可，不能 redirectTo 自己。
 */
async function confirmSwitch(): Promise<void> {
  const option = roleOptions.value.find((item) => item.key === selectedRoleKey.value)
  if (!option) return
  if (option.disabled) {
    uni.showToast({ title: '该身份尚未开通，请联系客服', icon: 'none' })
    return
  }
  if (roleSwitching.value) return
  // 店长内含骑手能力：骑手项不切身份（bindingId 为 null），直接进骑手工作台
  if (option.key === 'RIDER' && option.bindingId === null) {
    roleSheetVisible.value = false
    uni.navigateTo({ url: '/subpkg-delivery/rider/index' })
    return
  }
  roleSwitching.value = true
  try {
    const result = await switchIdentity(option.bindingId)
    uni.setStorageSync('identity_entry', result)
    roleSheetVisible.value = false
    if (result.entry === 'RIDER') {
      uni.redirectTo({ url: '/subpkg-delivery/rider/index' })
      return
    }
    if (result.entry === 'CUSTOMER') {
      uni.switchTab({ url: '/pages/index/index' })
      return
    }
    // MANAGER：当前就在商家端工作台，原地刷新身份与数据即可
    await loadIdentity()
    void loadOverview()
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '身份切换失败', icon: 'none' })
  } finally {
    roleSwitching.value = false
  }
}

function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page">
    <!-- 背景装饰 -->
    <view class="deco">
      <view class="ellipse ellipse-a" />
      <view class="ellipse ellipse-b" />
    </view>

    <!-- 导航栏 -->
    <view class="nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="shop">
        <!-- 头像 = **门店头像**（门店自己的 shopImage；没配则默认切图）。
             ⚠️ 有编辑权（品牌主体）时是「选择/上传门店头像」按钮；无编辑权时**只读展示**，
             不做点了必然失败的入口（`/api/merchant/shop*` 写接口只对品牌主体放行）。
             ⚠️ `open-type="chooseAvatar"` 与 `@chooseavatar="onChooseAvatar"` 保持不变
             （契约钉住），但上传目标已从"用户资料"改为"门店"（见 onChooseAvatar）。 -->
        <button v-if="canEditShop" class="shop-avatar-btn" open-type="chooseAvatar" :disabled="avatarUploading" @chooseavatar="onChooseAvatar">
          <image class="shop-avatar" :src="shopAvatar" mode="aspectFill" />
        </button>
        <image v-else class="shop-avatar" :src="shopAvatar" mode="aspectFill" />
        <text class="shop-name">{{ shopName || '我的店铺' }}</text>
        <!-- 箭头：放大的身份切换入口（一个账号多角色，店长也能去配送） -->
        <view class="shop-switch" @click="openRoleSheet"><text class="shop-arrow">▾</text></view>
      </view>
    </view>

    <scroll-view class="content" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false">
        <!-- 未读通知条（2026-09-28）：商家侧通知的**主通道**，不依赖微信授权，一定能看到。
             ⚠️ 后端「拉取即清零」⇒ 这里只做展示，不做本地累加。
             ⚠️ 2026-09-29 用户反馈"点击不了" ⇒ 补上跳转：点它进订单列表
             （复用 goOrders，顺带在点击手势里引导订阅 NEW_ORDER）。 -->
        <view v-if="unread > 0" class="unread-bar" @click="goOrders">
          <view class="unread-dot" />
          <text class="unread-text">有 {{ unread }} 条新通知待处理</text>
          <text class="unread-arrow">›</text>
        </view>
      <!-- 经营数据大卡 -->
      <view class="data-card">
        <view class="data-head">
          <image class="data-head-bg" src="/subpkg-merchant/static/home-hero.png" mode="aspectFill" />
          <text class="greeting">{{ greeting }}</text>
          <text class="greeting-sub">用数据看经营，让生意更简单</text>
        </view>
        <view class="data-bar">
          <view class="metric">
            <text class="metric-label">今日订单</text>
            <text class="metric-value">{{ overview.todayOrderCount ?? 0 }}</text>
          </view>
          <view class="metric-divider" />
          <view class="metric">
            <text class="metric-label">今日成交额/元</text>
            <view class="metric-value amount">
              <text class="amount-int">{{ amountParts.int }}</text><text class="amount-dot">.</text><text class="amount-dec">{{ amountParts.dec }}</text>
            </view>
          </view>
          <view class="metric-divider" />
          <!-- 第三格按设计稿是「服务分」（不是净额）；净额口径仍在四宫格「账单」卡里展示 -->
          <view class="metric">
            <text class="metric-label">服务分</text>
            <text class="metric-value">{{ serviceScoreText }}</text>
          </view>
        </view>
      </view>

      <!-- 四宫格入口 -->
      <view class="grid">
        <view class="grid-row">
          <view class="grid-card" @click="goOrders">
            <image class="grid-bg" src="/subpkg-merchant/static/card-orders.png" mode="aspectFill" />
            <view class="grid-head">
              <view class="grid-text">
                <text class="grid-title">订单管理</text>
                <text class="grid-sub">查看订单，处理配送售后问题</text>
              </view>
              <view class="grid-arrow" style="color: #0062ff;">›</view>
            </view>
            <view class="grid-stats">
              <view class="grid-stat">
                <text class="stat-value">{{ pendingDeliverCount }}</text>
                <text class="stat-label">待配送</text>
              </view>
              <view class="stat-divider" />
              <view class="grid-stat">
                <text class="stat-value">{{ deliveringCount }}</text>
                <text class="stat-label">配送中</text>
              </view>
              <view class="stat-divider" />
              <view class="grid-stat">
                <text class="stat-value">{{ doneCount }}</text>
                <text class="stat-label">已完成</text>
              </view>
            </view>
            <!--
              ⚠️ 2026-09-30 新增口径说明（后端答复《后端答复-商家端4项问题与附录-2026-09-30》§二/Q7）：
              这三个数字全部取自 `order.delivery_status`（**同城履约状态**）⇒
              **只卖物流的商户这里会全为 0**，那是**口径**而不是故障。
              不加这行小字的话，只卖物流的商户会以为"平台把我的订单弄丢了"。
            -->
            <text class="grid-note">同城履约口径，只卖物流的商户此三项为 0</text>
          </view>
          <view class="grid-card" @click="goAddProduct">
            <image class="grid-bg" src="/subpkg-merchant/static/card-add-product.png" mode="aspectFill" />
            <view class="grid-head">
              <view class="grid-text">
                <text class="grid-title">新增商品</text>
                <text class="grid-sub">快速上架，丰富店铺</text>
              </view>
              <view class="grid-arrow" style="color: #ff8000;">›</view>
            </view>
            <view class="grid-stats">
              <view class="grid-stat">
                <text class="stat-value">{{ onSaleCount }}</text>
                <text class="stat-label">已上架</text>
              </view>
              <view class="stat-divider" />
              <view class="grid-stat">
                <text class="stat-value">{{ offSaleCount }}</text>
                <text class="stat-label">待上架</text>
              </view>
            </view>
          </view>
        </view>
        <view class="grid-row">
          <view class="grid-card" @click="goProducts">
            <image class="grid-bg" src="/subpkg-merchant/static/card-products.png" mode="aspectFill" />
            <view class="grid-head">
              <view class="grid-text">
                <text class="grid-title">商品管理</text>
                <text class="grid-sub">管理商品信息，库存价格</text>
              </view>
              <view class="grid-arrow" style="color: #00996e;">›</view>
            </view>
            <view class="grid-stats">
              <view class="grid-stat">
                <text class="stat-value">{{ onSaleCount }}</text>
                <text class="stat-label">在售商品</text>
              </view>
              <view class="stat-divider" />
              <view class="grid-stat">
                <text class="stat-value">{{ warningCount }}</text>
                <text class="stat-label">库存预警</text>
              </view>
            </view>
          </view>
          <view class="grid-card" @click="goBill">
            <image class="grid-bg" src="/subpkg-merchant/static/card-wallet.png" mode="aspectFill" />
            <view class="grid-head">
              <view class="grid-text">
                <text class="grid-title">账单</text>
                <text class="grid-sub">收支流水，资金一目了然</text>
              </view>
              <view class="grid-arrow" style="color: #4000ff;">›</view>
            </view>
            <view class="grid-stats">
              <view class="grid-stat grid-stat-full">
                <text class="stat-value">¥{{ money(overview.balance) }}</text>
                <text class="stat-label">净额（订单口径）</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 门店管理入口（2026-09-23 新增）：后端 `/api/merchant/shop*` 支持品牌商家自建/启停门店。
           与下方「结算与提现」一样用文字入口（四宫格卡片依赖 card-*.png 切图，本项无对应切图）。 -->
      <view v-if="isMerchantOwner" class="settle-entry" @click="goShops">
        <view class="settle-text">
          <text class="settle-title">门店管理</text>
          <text class="settle-sub">查看门店 · 新建门店 · 启用停用</text>
        </view>
        <view class="settle-arrow">›</view>
      </view>

      <!-- 结算与提现入口：**仅品牌主体可见**（店长/店员调结算接口返回 13016）。
           ⚠️ 2026-09-23 经过一次反复，结论记在这里，避免再折腾：
           · 曾一度把这个 `v-if` 去掉（当时的判断是"用前端身份判断隐藏功能"导致用户看不到入口）；
           · 但**线上版本验证表明原判断本来就是对的**，当时的异常是**本地测试环境**造成的
             ⇒ 已按用户要求**恢复这个 v-if**。
           · `isMerchantOwner` 现在看 `identities` **全集**（不是只看 `staffRole` 单值），
             并保留 `staffRole` 兜底 —— 比原来更准，且不影响线上既有行为。
           ⇒ 不要因为"看不到入口"的反馈就再把它去掉：先确认是不是本地环境/身份没切。 -->
      <view v-if="isMerchantOwner" class="settle-entry" @click="goSettlement">
        <view class="settle-text">
          <text class="settle-title">结算与提现</text>
          <text class="settle-sub">可提现余额 · 账户流水 · 提现记录</text>
        </view>
        <view class="settle-arrow">›</view>
      </view>

      <!-- 电脑端后台（PC 控制台）登录说明入口（2026-10-10 新增，用户选了方案 B：加按钮弹窗）。
           ⚠️ 只对**品牌主体**（`MERCHANT_OWNER`）显示：契约 `StaffAccountVO.canLoginPc`
              「是否可登录 PC 商户控制台」，而店长/核销店员走的是 **H5 核销页**（另一个地址、
              另一个客户端 `client=H5`）⇒ 对他们显示"PC 控制台登录说明"是**点了必然用不上**的入口。
           ⚠️ 与「结算与提现」同一个判断口径（`identities` 全集，不是只看 `staffRole`）。
           地址/文案全部来自 `utils/merchant-console.ts`（单一来源，本文件不写域名）。 -->
      <view v-if="isMerchantOwner" class="console-entry" @click="openConsoleGuide">
        <view class="console-text">
          <text class="console-title">{{ MERCHANT_CONSOLE_ENTRY_TITLE }}</text>
          <text class="console-sub">{{ MERCHANT_CONSOLE_ENTRY_SUB }}</text>
        </view>
        <view class="console-arrow">›</view>
      </view>
    </scroll-view>

    <!-- 身份切换弹层（设计稿：选择你要进入的角色） -->
    <view v-if="roleSheetVisible" class="role-mask" @click="closeRoleSheet">
      <view class="role-sheet" @click.stop>
        <view class="role-sheet-head">
          <view class="role-sheet-titles">
            <text class="role-sheet-title">选择你要进入的角色</text>
            <text class="role-sheet-sub">一个账号可拥有多个角色，轻松切换</text>
          </view>
          <text class="role-sheet-close" @click="closeRoleSheet">×</text>
        </view>
        <view class="role-list">
          <view
            v-for="item in roleOptions"
            :key="item.key"
            class="role-item"
            :class="{ 'is-active': selectedRoleKey === item.key, 'is-disabled': item.disabled }"
            @click="selectedRoleKey = item.key"
          >
            <image class="role-icon" :src="item.icon" mode="aspectFit" />
            <view class="role-text">
              <text class="role-name">{{ item.name }}</text>
              <text class="role-desc">{{ item.desc }}</text>
            </view>
            <view class="role-radio" :class="{ 'is-checked': selectedRoleKey === item.key }">
              <text v-if="selectedRoleKey === item.key" class="role-check">✓</text>
            </view>
          </view>
        </view>
        <view class="role-submit" :class="{ 'is-loading': roleSwitching }" @click="confirmSwitch">确定切换</view>
      </view>
    </view>

    <!-- 电脑端后台登录说明弹层（2026-10-10，用户方案 B）。
         ⚠️ 静态两块（**后台地址** / **初始密码说明**）**无条件渲染** —— 账号查不到、查询失败、
            还没发号时，地址与规则仍然要给（商家此刻最需要的就是"去哪登录"）。
            只有「登录账号」那一格随状态变化（`consoleAccount`）。
         ⛔ 这里**不显示任何密码**（小程序拿不到密码：`IssueResult.password` 由中控发号接口返回，
            `GET /api/admin/staff/{id}/login-password` 契约原文「仅中控/客服可用」）⇒ 只讲规则。 -->
    <view v-if="consoleVisible" class="console-mask" @click="closeConsoleGuide">
      <view class="console-sheet" @click.stop>
        <view class="console-sheet-head">
          <view class="console-sheet-titles">
            <text class="console-sheet-title">{{ MERCHANT_CONSOLE_SHEET_TITLE }}</text>
            <text class="console-sheet-sub">{{ MERCHANT_CONSOLE_SHEET_SUB }}</text>
          </view>
          <text class="console-sheet-close" @click="closeConsoleGuide">×</text>
        </view>

        <view class="console-row">
          <text class="console-label">后台地址</text>
          <text class="console-url">{{ MERCHANT_CONSOLE_URL }}</text>
          <text class="console-copy" @click="copyConsoleUrl">复制</text>
        </view>

        <view class="console-row">
          <text class="console-label">登录账号</text>
          <text class="console-value">{{ consoleAccount.value }}</text>
        </view>

        <view class="console-block">
          <text class="console-block-title">初始密码</text>
          <text class="console-block-text">{{ MERCHANT_CONSOLE_PASSWORD_RULE }}</text>
          <text class="console-block-text">{{ MERCHANT_CONSOLE_PASSWORD_NOTE }}</text>
        </view>

        <!-- 状态说明：未发号 / 工号未返回 / 未查到申请 / 查询失败时各说各的话（不混用）。 -->
        <text v-if="consoleAccount.note" class="console-note">{{ consoleAccount.note }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 未读通知条（商家工作台）：黄色细条，不弹窗 */
.unread-bar { display: flex; align-items: center; margin: 12rpx 24rpx 0; padding: 18rpx 22rpx; border: 1rpx solid #ffe1a6; border-radius: 16rpx; background: #fff8e6; }
.unread-dot { flex-shrink: 0; width: 14rpx; height: 14rpx; margin-right: 14rpx; border-radius: 50%; background: #ff9f0a; }
.unread-text { flex: 1; min-width: 0; color: #a15c00; font-size: 26rpx; line-height: 36rpx; }
/* 箭头：让未读条"看起来能点"（2026-09-29 补，此前只有文字、用户以为点不了） */
.unread-arrow { flex-shrink: 0; margin-left: 12rpx; color: #b07d33; font-size: 34rpx; line-height: 36rpx; }
.page {
  position: relative;
  /* ⚠️ 2026-09-22 修（用户反馈"顶部应该固定、不该跟着滚"）：
     原来这里是 `min-height: 100vh`（页面自身可滚动），而 `.content` 的高度写死成
     `calc(100vh - 92rpx)` —— **没有减去状态栏高度**（导航实际高 = 状态栏 + 92rpx）→
     两者相加比一屏还高 → 页面整体滚动 → 顶部导航（门店名 / 头像 / 身份箭头）跟着一起滚。
     现在改成「页面不滚、只让 scroll-view 滚」：导航天然固定在顶部，`.content` 用 flex 吃剩余高度
     （顺带把状态栏高度也算进去了，不用再手写 calc）。 */
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  box-sizing: border-box;
  background: #f2f3f7;
}
.deco {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 585rpx; /* 304px */
  overflow: hidden;
}
.ellipse {
  position: absolute;
  width: 585rpx;
  height: 585rpx;
  border-radius: 50%;
}
.ellipse-a {
  top: -160rpx;
  left: -60rpx;
  background: #f3edff;
}
.ellipse-b {
  top: -200rpx;
  right: -120rpx;
  background: #d6e4ff;
}

.nav {
  position: relative;
  z-index: 1;
  padding-left: 31rpx;
}
.shop {
  display: flex;
  align-items: center;
  height: 92rpx; /* 48px */
}
/* 头像按钮：清掉 button 默认样式，只保留点击区 */
.shop-avatar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 62rpx;
  height: 62rpx;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  line-height: 1;
}
.shop-avatar-btn::after { border: none; }
/* 头像（两种形态共用：可上传的 button 内 / 无编辑权的只读 image） */
.shop-avatar {
  flex: none;
  width: 62rpx;
  height: 62rpx;
  border: 1rpx solid rgba(0, 0, 0, 0.06);
  border-radius: 50%;
  background: #ffffff;
  box-sizing: border-box;
}
.shop-name {
  margin-left: 19rpx;
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 500;
}
/* 身份切换入口：白圆托底把箭头放大（设计稿箭头仅 7x4，实际太小不好点） */
.shop-switch {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  margin-left: 10rpx;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2rpx 8rpx rgba(29, 33, 41, 0.08);
}
.shop-arrow {
  color: #ff5500;
  font-size: 32rpx;
  line-height: 1;
}

.content {
  position: relative;
  z-index: 1;
  /* ⚠️ 2026-09-22 修：原为 `height: calc(100vh - 92rpx)` —— 漏算状态栏高度导致整页可滚（见 .page 注释）。
     改为吃父级剩余空间（`.page` 已是 flex column + 固定 100vh），导航因此固定、只有这里滚动。 */
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 23rpx;
}

/* 数据大卡 */
.data-card {
  border-radius: 23rpx;
  overflow: hidden;
  background: #ffffff;
}
.data-head {
  position: relative;
  padding: 69rpx 38rpx 0;
  padding-bottom: 46rpx;
  background: linear-gradient(135deg, #eef3ff 0%, #fff6ee 100%);
  overflow: hidden;
}
/* 欢迎卡背景插画（设计切图） */
.data-head-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
.greeting {
  position: relative;
  z-index: 1;
  display: block;
  color: #1d2129;
  font-size: 38rpx;
  font-weight: 600;
}
.greeting-sub {
  position: relative;
  z-index: 1;
  display: block;
  margin-top: 8rpx;
  color: #86909c;
  font-size: 23rpx;
}
.data-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 23rpx 46rpx;
  background: #ffffff;
}
.metric {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}
.metric-value {
  color: #1d2129;
  font-size: 33rpx;
  font-weight: 500;
  line-height: 1;
}
.metric-value.amount {
  display: flex;
  align-items: baseline;
}
.amount-int {
  font-size: 33rpx;
  font-weight: 500;
}
.amount-dot {
  font-size: 31rpx;
  font-weight: 500;
}
.amount-dec {
  font-size: 25rpx;
  font-weight: 500;
}
.metric-label {
  color: #86909c;
  font-size: 23rpx;
}
.metric-divider {
  flex: none;
  width: 2rpx;
  height: 69rpx;
  background: #e6e7eb;
}

/* 四宫格 */
.grid {
  margin-top: 23rpx;
}
.grid-row {
  display: flex;
  gap: 23rpx;
  margin-bottom: 23rpx;
}
.grid-card {
  position: relative;
  flex: 1;
  border-radius: 23rpx;
  background: #ffffff;
  overflow: hidden;
}
/* 卡片头部插画（设计切图）：只铺上半部，下半部保持白底放统计 */
.grid-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 227rpx;
}
/* 头部区固定 118px（= 插画高度），统计区因此从 118px 开始，与设计稿一致 */
.grid-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  box-sizing: border-box;
  height: 227rpx;
  padding: 31rpx;
}
.grid-text {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
}
.grid-title {
  display: block;
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
}
.grid-sub {
  display: block;
  margin-top: 8rpx;
  color: #86909c;
  font-size: 23rpx;
  line-height: 31rpx;
}
/* 卡片箭头：白圆托底 + 彩色箭头（颜色由模板内联 style 给出，与设计稿一致） */
.grid-arrow {
  position: relative;
  z-index: 1;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46rpx;
  height: 46rpx;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2rpx 8rpx rgba(29, 33, 41, 0.10);
  font-size: 31rpx;
  line-height: 1;
}
/*
 * 统计区：设计稿 60px 高（上下各 10px 内边距），无上边框。
 * ⚠️ 必须 relative + z-index 1：卡片插画是绝对定位（.grid-bg，高 227rpx），
 * 静态定位的统计行会被它整片盖住 —— 表现就是「只有标签隐约可见、数字完全不见」。
 */
.grid-stats {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  height: 115rpx;
  padding: 19rpx 0;
  background: #ffffff;
}
.grid-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}
.grid-stat-full {
  align-items: center;
}
/**
 * 四宫格订单卡的口径说明小字。
 *
 * ⚠️ 2026-09-30 新增（后端答复 §二/Q7 的建议）：待配送/配送中/已完成取自
 * `order.delivery_status`（**同城履约口径**）⇒ 只卖物流的商户三项恒为 0。
 * 不加这行说明会被误读成"平台把我的订单弄丢了"。
 * ⚠️ `.grid-stats` 是白底固定高度块，故本行需要 `position: relative` + `z-index: 1`
 *    才能压在卡片插画（`.grid-bg`）之上。
 */
.grid-note {
  position: relative;
  z-index: 1;
  display: block;
  padding: 0 24rpx 16rpx;
  font-size: 20rpx;
  line-height: 28rpx;
  color: #8a8f99;
}
/* 统计项之间的竖直分隔线（设计稿 0×32，颜色未标注，取与其它分隔线一致的 #E6E7EB） */
.stat-divider {
  flex: none;
  width: 2rpx;
  height: 61rpx;
  background: #e6e7eb;
}
.stat-value {
  color: #1d2129;
  font-size: 27rpx;
  font-weight: 500;
  line-height: 42rpx;
}
.stat-label {
  color: #86909c;
  font-size: 21rpx;
  line-height: 36rpx;
}
/* ===== 身份切换弹层（设计稿「选择你要进入的角色」） ===== */
.role-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.45);
}
.role-sheet {
  display: flex;
  flex-direction: column;
  padding: 31rpx 31rpx 42rpx;
  border-radius: 23rpx 23rpx 0 0;
  background: #f6f7f9;
}
.role-sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 23rpx;
}
.role-sheet-titles { flex: 1; min-width: 0; }
.role-sheet-title {
  display: block;
  color: #1d2129;
  font-size: 35rpx;
  font-weight: 600;
  line-height: 50rpx;
}
.role-sheet-sub {
  display: block;
  margin-top: 4rpx;
  color: #86909c;
  font-size: 25rpx;
  line-height: 42rpx;
}
.role-sheet-close {
  flex: none;
  margin-left: 16rpx;
  color: #1d2129;
  font-size: 44rpx;
  line-height: 44rpx;
}
.role-list { display: flex; flex-direction: column; gap: 23rpx; }
.role-item {
  display: flex;
  align-items: center;
  padding: 31rpx;
  border-radius: 23rpx;
  background: #ffffff;
}
.role-item.is-active { background: #fff4e8; }
.role-item.is-disabled { opacity: 0.5; }
.role-icon { flex: none; width: 77rpx; height: 77rpx; }
.role-text { flex: 1; min-width: 0; margin-left: 16rpx; }
.role-name {
  display: block;
  color: #1d2129;
  font-size: 27rpx;
  font-weight: 600;
  line-height: 42rpx;
}
.role-desc {
  display: block;
  margin-top: 2rpx;
  color: #86909c;
  font-size: 25rpx;
  line-height: 42rpx;
}
.role-radio {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46rpx;
  height: 46rpx;
  border: 2rpx solid #d7dbe0;
  border-radius: 50%;
  box-sizing: border-box;
}
.role-radio.is-checked { border-color: #ff5500; background: #ff5500; }
.role-check { color: #ffffff; font-size: 26rpx; line-height: 1; }
.role-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  margin-top: 31rpx;
  border-radius: 23rpx;
  color: #ffffff;
  background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%);
  font-size: 31rpx;
  font-weight: 600;
}
.role-submit.is-loading { opacity: 0.6; }

/* ===== 结算与提现入口（仅品牌主体可见） ===== */
.settle-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0;
  margin-bottom: 23rpx;
  padding: 31rpx;
  border-radius: 23rpx;
  background: #ffffff;
}
.settle-text { flex: 1; min-width: 0; }
.settle-title {
  display: block;
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
}
.settle-sub {
  display: block;
  margin-top: 8rpx;
  color: #86909c;
  font-size: 23rpx;
}
.settle-arrow {
  flex: none;
  margin-left: 15rpx;
  color: #c9cdd4;
  font-size: 34rpx;
  line-height: 1;
}

/* ===== 电脑端后台（PC 控制台）登录说明（2026-10-10） =====
   入口行沿用「结算与提现」那张白卡的排版（同一页面上两个同类入口不该长得不一样）。 */
.console-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 23rpx;
  padding: 31rpx;
  border-radius: 23rpx;
  background: #ffffff;
}
.console-text { flex: 1; min-width: 0; }
.console-title {
  display: block;
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
}
.console-sub {
  display: block;
  margin-top: 8rpx;
  color: #86909c;
  font-size: 23rpx;
}
.console-arrow {
  flex: none;
  margin-left: 15rpx;
  color: #c9cdd4;
  font-size: 34rpx;
  line-height: 1;
}
/* 弹层：底部上滑的白卡（与身份弹层同一套层级/遮罩口径，z-index 100 = 页面内最高）。 */
.console-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.45);
}
.console-sheet {
  padding: 31rpx 31rpx 46rpx;
  border-radius: 23rpx 23rpx 0 0;
  background: #ffffff;
}
.console-sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 23rpx;
}
.console-sheet-titles { flex: 1; min-width: 0; }
.console-sheet-title {
  display: block;
  color: #1d2129;
  font-size: 35rpx;
  font-weight: 600;
  line-height: 50rpx;
}
.console-sheet-sub {
  display: block;
  margin-top: 4rpx;
  color: #86909c;
  font-size: 25rpx;
  line-height: 42rpx;
}
.console-sheet-close {
  flex: none;
  margin-left: 16rpx;
  color: #1d2129;
  font-size: 44rpx;
  line-height: 44rpx;
}
.console-row {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f2f4f7;
}
.console-label {
  flex: none;
  width: 130rpx;
  color: #86909c;
  font-size: 26rpx;
}
/* 地址是长域名 ⇒ 允许换行（不省略号截断，截断后商家抄都抄不全）。 */
.console-url {
  flex: 1;
  min-width: 0;
  color: #1d2129;
  font-size: 26rpx;
  line-height: 40rpx;
  word-break: break-all;
}
.console-copy {
  flex: none;
  margin-left: 16rpx;
  padding: 6rpx 18rpx;
  border-radius: 8rpx;
  color: #ff5500;
  background: #fff4e8;
  font-size: 24rpx;
}
.console-value {
  flex: 1;
  min-width: 0;
  color: #1d2129;
  font-size: 28rpx;
  line-height: 40rpx;
}
/* 密码说明：只讲**规则**，不显示任何密码值。 */
.console-block { margin-top: 23rpx; padding: 23rpx; border-radius: 16rpx; background: #f6f7f9; }
.console-block-title {
  display: block;
  color: #1d2129;
  font-size: 27rpx;
  font-weight: 600;
}
.console-block-text {
  display: block;
  margin-top: 8rpx;
  color: #4e5969;
  font-size: 24rpx;
  line-height: 38rpx;
}
.console-note {
  display: block;
  margin-top: 23rpx;
  color: #86909c;
  font-size: 24rpx;
  line-height: 38rpx;
}
</style>
