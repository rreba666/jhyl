<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import { getCartList, normalizeDeliverySwitch, type CartItem } from '@/api/cart'
import { ADDRESS_DRAFT_KEY, cancelOrder, createOrder, getOrderDetail, type OrderDetail } from '@/api/order'
import { createPrepay, requestPayment, payByBalance, switchToBalance, switchToWechat, releasePayChannel } from '@/api/payment'
import { getEnabledShops, getDeliverableShops, type EnabledShop } from '@/api/shop'
import { quoteDelivery, isConclusiveUndeliverable, isInconclusiveEnvironmentFailure, resolveQuoteFailCode, type DeliveryQuote } from '@/api/delivery-order'
import { distanceMeters } from '@/utils/location'
import { submitInvoice } from '@/api/invoice'
import { getWalletInfo } from '@/api/user'
import { getProductDetail } from '@/api/product'
import { DIVIDEND_PURCHASE_LIMIT, PURCHASE_LIMIT_MESSAGE, getDividendQuantity, isDividendEligible } from '@/utils/dividend-limit'
import { cleanDigits, cleanText, normalizeEditableMobile, validateEmail, validateMobile, validateTaxNumber, validateText } from '@/utils/input-validation'
import { isApiRequestError, normalizeLegacyWording } from '@/utils/request'
import { isLoggedIn } from '@/utils/auth'
import { getModules, isModuleEnabled, type ModuleConfig } from '@/utils/config'
import { normalizeCoordinateSource } from '@/utils/coordinate-source'
import LoginGuide from '@/components/LoginGuide.vue'

/** 配送方式：0=物流(快递配送) 1=线下自提 2=同城配送（2026-09-19 起开放下单：需选发货门店 + 填收货地址，配送费走试算）。 */
type PickupType = 0 | 1 | 2
type InvoiceType = 'personal' | 'company'
/**
 * 商品级「配送方式」开关的下单拦截错误码与兜底文案（后端 2026-09-22 新增；2026-09-29 第十二批拆分）。
 *
 * - 自提单里含 `pickupEnabled=0` 的商品 → `13023`；
 * - 物流 / 同城单里含**对应**开关为 0 的商品 → `13024`（**错误码不变**）。
 *
 * ⚠️ 第十二批把「同城」从 `deliveryEnabled` 里拆出为独立字段 `sameCityEnabled`：
 *    `deliveryEnabled` 语义**收窄为「仅物流」**；下单时 `pickupType=0` 看它，`pickupType=2` **只看 `sameCityEnabled`**。
 * ⚠️ 后端已把 `13024` 的文案**按三档精准化**（自提被拦 / 同城被拦 / 物流被拦各一句），
 *    所以下面这些常量只作**兜底**用 —— 有后端文案时必须让后端文案透出（见 `productDeliveryErrorMessage`）。
 * 前端提前按三个开关过滤配送方式，后端这一层仍然拦截（前端过滤只是少让用户白跑一趟）。
 */
const PRODUCT_PICKUP_BLOCKED_CODE = 13023
const PRODUCT_DELIVERY_BLOCKED_CODE = 13024
const PRODUCT_PICKUP_BLOCKED_MESSAGE = '该商品不支持线下自提，请选择其他配送方式'
/** ⚠️ 第十二批起本常量只代表「物流被拦」（原为"物流/同城"共用）。 */
const PRODUCT_DELIVERY_BLOCKED_MESSAGE = '该商品不支持物流配送，请选择其他配送方式'
/** 同城被拦的兜底文案（13024 的后端文案已按三档精准化，这里只是后端没给 message 时的退路）。 */
const PRODUCT_SAME_CITY_BLOCKED_MESSAGE = '该商品不支持同城配送，请选择其他配送方式'
/** 三个开关都被关掉时的统一提示（任何配送方式后端都会拦，直接禁用下单）。 */
const PRODUCT_DELIVERY_NONE_MESSAGE = '该商品暂不支持任何配送方式'
const PAYMENT_CONTACT_NAME_MAX_LENGTH = 32
const PAYMENT_ADDRESS_MAX_LENGTH = 200
const PAYMENT_REMARK_MAX_LENGTH = 100
const PAYMENT_INVOICE_COMPANY_MAX_LENGTH = 100
const PAYMENT_INVOICE_EMAIL_MAX_LENGTH = 254

interface Address {
  name: string
  phone: string
  /** 详细地址（街道门牌，用户手填）。 */
  detail: string
  /** 省 / 市 / 区：region 选择器选，或打开表单时用定位自动填入。 */
  province: string
  city: string
  district: string
  /**
   * 收货坐标（GCJ-02）—— 同城配送下单必带。
   * ⛔ **只能**来自收货地址自身的「地图选点」（`subpkg-order/address/edit` 的 `pickOnMap`）：
   *    绝不兜底到"当前位置 / 发货门店坐标"（那是伪造数据，2026-10-08 P1 履约事故根因）。
   */
  latitude?: number
  longitude?: number
  /**
   * 坐标**来源**（后端白名单，取值见 `utils/coordinate-source.ts`）—— 与 `latitude/longitude`
   * **同生同灭**（all-or-nothing）：有坐标必须有来源，没有坐标就必须没有来源。
   *
   * ⛔ 后端 2026-10-08 起只认白名单（`MAP_PICK` / `WECHAT_ADDRESS`）：缺失或其它值一律
   *    fail-closed（试算 `failCode=NO_COORDINATE`、下单 `13026`）⇒ 前端也**绝不**凭空补一个来源。
   */
  coordinateSource?: string
}

const menuTop = ref(0)
const menuHeight = ref(32)
const navStyle = computed(() => ({ top: `${menuTop.value}px`, height: `${menuHeight.value}px` }))
const bodyTop = computed(() => menuTop.value + menuHeight.value + 10)

const items = ref<CartItem[]>([])
const selectedCartIds = ref<number[]>([])
/** 直接购买模式参数（从商品详情「立即支付」进入）。 */
const directSkuId = ref<number | null>(null)
const directProductId = ref<number | null>(null)
const directQuantity = ref(1)
const loading = ref(true)
const loadError = ref(false)
const loginGuideVisible = ref(false)

const pickupType = ref<PickupType>(0)
const selectedAddress = ref<Address | null>(null)
const selectedShop = ref<EnabledShop | null>(null)
const contactName = ref('')
const contactPhone = ref('')
const shops = ref<EnabledShop[]>([])
const orderId = ref<string | null>(null)
const existingOrder = ref<OrderDetail | null>(null)
const paying = ref(false)
const switchingToBalancePayment = ref(false)
const paymentSucceeded = ref(false)
/**
 * 支付流程是否**已收尾**（成功/失败终态），用于堵住「支付成功后仍可再次提交」的窗口。
 *
 * ⚠️ 2026-09-30 新增（审计发现，与用户反馈的「连下三单」同类）：
 *   `completePayment(id, false)` 时 `paymentSucceeded` 仍是 `false`（页面要保持"可支付"直到跳转），
 *   而它内部用 `setTimeout(500ms)` 排队 `redirectTo` 就 return，`paying` 又在 `finally` 里**立刻**置回 false
 *   ⇒ 这 **0.5 秒窗口**内 `submitPayment()` 的唯一闸门 `if (paying.value) return` **已失效**，
 *   连点「立即支付」会以**同一个 orderId 再次** `createPrepay` / `payByBalance`
 *   （余额路径二次扣款、微信路径二次拉起收银台）。
 *   ⇒ 用本标记在**进入 `completePayment` 的第一时间**就锁死后续提交（不依赖 500ms 定时器）。
 *   ⚠️ 与 `paymentSucceeded` 分开是刻意的：后者还承担「整页切到支付成功态」的 UI 语义，
 *      本标记只管**并发/重复提交**这一件事。
 */
const paymentFinalized = ref(false)
/** 微信 prepay 成功后已占用微信支付渠道，余额支付必须走安全切换接口。 */
const wechatPaymentStarted = ref(false)
/** 仅在明确收到微信收银台取消结果后展示安全切换入口。 */
const canSwitchToBalance = ref(false)
/** 支付方式：wechat=微信支付，balance=余额支付（二选一，不可混用）。 */
type PayMethod = 'wechat' | 'balance'
const payMethod = ref<PayMethod>('wechat')
/** 钱包余额（余额支付选项展示与可用性判断）。 */
const walletBalance = ref(0)
/** 倒计时基准时间，定时器每秒刷新驱动剩余时间重算。 */
const now = ref(Date.now())
let countdownTimer: ReturnType<typeof setInterval> | null = null

const addressSheetVisible = ref(false)
const shopSheetVisible = ref(false)
const addressForm = reactive<Address>({ name: '', phone: '', detail: '', province: '', city: '', district: '' })
/** 同城配送试算结果（null = 未试算或试算失败）。 */
const deliveryQuote = ref<DeliveryQuote | null>(null)
const quoteLoading = ref(false)
/** 试算失败 / 不可配送的提示文案。 */
const quoteError = ref('')
/**
 * 试算失败的**结构化失败码**（后端 11 码枚举，取值**分两类**——回执 §三，见 `quoteFailureText`）。
 * 空串 = 当前没有失败码（未试算 / 试算通过 / 后端老版本没下发）。
 * ⛔ **不得**用它判断"能不能送" —— `canDelivery` 才是唯一判据；
 *    它也**不得**被拿去过滤门店 / 置灰同城（那只能走 `isConclusiveUndeliverable`，见
 *    `shopQuoteBlocksDelivery`）。
 */
const quoteFailCode = ref('')
/**
 * 收货地址**没有真实坐标**时的提示文案。
 *
 * ⚠️⚠️ 2026-10-08 修（用户反馈「手动输入地址时超出范围也能下单」）：
 *   同城配送的范围判定**只能**基于收货地址的真实坐标（后端契约：LOCAL 渠道必须传选点坐标，
 *   且目前**不解析** `address` 文本）。此前这里用「收货地址 ?? 当前位置 ?? 发货门店」三级兜底，
 *   等于**伪造坐标**给后端 —— 退到门店坐标时后端必然判「可送」，范围校验完全失效。
 *   ⇒ 现在拿不到地址坐标就**如实阻断**：宁可让用户去地图选点，也绝不编一个坐标。
 */
const ADDRESS_NEEDS_MAP_PICK_TEXT = '该地址没有定位信息，请在地图上选点后再使用同城配送'
/**
 * 收货地址的**真实**坐标 —— 同城配送坐标的**唯一合法来源**。
 * ⚠️ 只认地址自身的定位；0 / NaN / 缺失一律视为"没有坐标"
 *    （`(0, 0)` 是几内亚湾，不可能是有效收货点）。绝不用 `??` 兜底到别的位置。
 * ⚠️ 2026-10-08 追补：坐标还必须带**可信来源**（后端白名单，见 `utils/coordinate-source.ts`）。
 *    没有来源（升版前的旧缓存 / 从地址簿选回）或来源未知 ⇒ 一律按「**没有坐标**」处理，
 *    于是试算与下单都不会带上这个坐标（后端本来也会 fail-closed，前端如实先拦住）。
 */
const addressCoords = computed(() => {
  const lat = Number(selectedAddress.value?.latitude)
  const lng = Number(selectedAddress.value?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null
  if (!normalizeCoordinateSource(selectedAddress.value?.coordinateSource)) return null
  return { lat, lng }
})
/**
 * 收货坐标的**来源**（`undefined` = 不上报来源）。
 *
 * ⛔ **all-or-nothing**：只有当 `addressCoords`（已按白名单门禁过滤）非空时才返回来源。
 *    试算与下单都只用这一个值，并且必须与坐标写在**同一个对象字面量**里 ——
 *    绝不出现"有来源没坐标"（伪造）或"有坐标没来源"（后端 `NO_COORDINATE` / `13026`）。
 */
const addressCoordinateSource = computed<string | undefined>(() => (
  addressCoords.value ? (normalizeCoordinateSource(selectedAddress.value?.coordinateSource) ?? undefined) : undefined
))
/**
 * 从「地址草稿 / 结算表单缓存」里**成对**取回坐标与来源（all-or-nothing）。
 *
 * ⛔ 存量的 `_v2` 缓存是在"只有坐标、还没有来源"的那版前端写入的 ⇒ 里面**有坐标没来源**。
 *    这种坐标来路不明，必须当作**没有坐标**：返回空对象（不继承、不上报），
 *    让用户重新地图选点。**绝不能**替它补一个来源（那是伪造来源）。
 */
function trustedCoordinateFields(raw: { latitude?: unknown; longitude?: unknown; coordinateSource?: unknown } | null | undefined): { latitude?: number; longitude?: number; coordinateSource?: string } {
  if (!raw) return {}
  const lat = Number(raw.latitude)
  const lng = Number(raw.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return {}
  const coordinateSource = normalizeCoordinateSource(raw.coordinateSource)
  if (!coordinateSource) return {}
  return { latitude: lat, longitude: lng, coordinateSource }
}
/** 地址表单里的定位状态：idle（还没试） / ok（已自动填入省市区） / fail（拿不到，需手选）。 */
const locationState = ref<'idle' | 'ok' | 'fail'>('idle')

const invoiceExpanded = ref(false)
const invoiceDrawerVisible = ref(false)
const invoiceEnabled = ref(false)
const invoiceType = ref<InvoiceType>('personal')
const invoiceSaved = ref(false)
const invoiceForm = reactive({
  name: '',
  companyName: '',
  taxNumber: '',
  email: '',
})

const remarkExpanded = ref(false)
const remark = ref('')

/** 结算表单缓存结构（第二次进入自动填入上次内容）。 */
interface PaymentFormCache {
  address: Address | null
  contactName: string
  contactPhone: string
  invoiceEnabled: boolean
  invoiceType: InvoiceType
  invoiceForm: { name: string; companyName: string; taxNumber: string; email: string }
  remark: string
}

/** 表单缓存 key（**已升版到 `_v2`**）：旧缓存的地址可能带着修复前写入的伪造坐标，改名让旧缓存自然失效。 */
const PAYMENT_FORM_CACHE_KEY = 'payment_form_cache_v2'

/**
 * 一次性清理升版前的旧 storage（`_v1`）。
 * ⚠️ 为什么必须清：旧草稿/旧表单缓存里可能带着**修复前写入的伪造坐标**
 *    （地址编辑页曾把自动定位的「当前位置」当成地址坐标写入），只要它还在，
 *    同城配送的「地址无坐标就拦住」门禁就会被旧数据满足 ⇒ 超范围仍可下单。
 */
function purgeLegacyStorage(): void {
  try {
    uni.removeStorageSync('payment_address_draft')
    uni.removeStorageSync('payment_form_cache')
  } catch { /* 忽略：清理失败不影响主流程（新 key 已保证旧数据不会被读取） */ }
}
// 在模块初始化时立即清（早于 loadFormCache / 地址草稿的任何读取）。
purgeLegacyStorage()

/** 读取上次填写的结算表单并自动填入。 */
function loadFormCache(): void {
  try {
    const cached = uni.getStorageSync(PAYMENT_FORM_CACHE_KEY) as Partial<PaymentFormCache> | undefined
    if (!cached) return
    if (cached.address) {
      const phone = normalizeEditableMobile(cached.address.phone)
      // 脱敏手机号无法还原，不能回填成可提交值，要求用户重新输入完整号码。
      if (phone) {
        selectedAddress.value = {
          name: cleanText(cached.address.name),
          phone,
          detail: cleanText(cached.address.detail),
          // 省市区/经纬度是 2026-09-19 新增字段：旧缓存里没有，缺省给空串避免 undefined 进模板
          province: cleanText(cached.address.province || ''),
          city: cleanText(cached.address.city || ''),
          district: cleanText(cached.address.district || ''),
          // ⛔ 坐标与**来源**一起取（all-or-nothing）：旧 `_v2` 缓存"有坐标没来源" ⇒ 视为没有坐标
          ...trustedCoordinateFields(cached.address),
        }
      }
    }
    if (typeof cached.contactName === 'string') contactName.value = cleanText(cached.contactName)
    if (typeof cached.contactPhone === 'string') contactPhone.value = cleanDigits(cached.contactPhone)
    if (typeof cached.invoiceEnabled === 'boolean') invoiceEnabled.value = cached.invoiceEnabled
    if (cached.invoiceType === 'personal' || cached.invoiceType === 'company') invoiceType.value = cached.invoiceType
    if (cached.invoiceForm) {
      Object.assign(invoiceForm, {
        name: cleanText(cached.invoiceForm.name),
        companyName: cleanText(cached.invoiceForm.companyName),
        taxNumber: cleanText(cached.invoiceForm.taxNumber).replace(/\s+/g, '').toUpperCase(),
        email: cleanText(cached.invoiceForm.email),
      })
    }
    // 已有发票内容时视为已填好，避免再次弹出发票抽屉
    invoiceSaved.value = Boolean(invoiceForm.name || invoiceForm.companyName)
    if (typeof cached.remark === 'string') remark.value = cleanText(cached.remark)
  } catch { /* 缓存读取失败忽略 */ }
}

/**
 * 从「新增/编辑收货地址」页返回时，回读地址草稿并回显。
 *
 * 背景（2026-09-22 真机反馈「按保存地址后回到支付页面地址消失」）：
 * 地址页在 payment 模式下是写 `ADDRESS_DRAFT_KEY` 草稿再 `navigateBack()` 的，
 * 而结算页原来**没有 onShow 刷新**（`onShow` 只 import 未使用）→ 返回后地址一直是空的。
 */
onShow(() => {
  try {
    const draft = uni.getStorageSync(ADDRESS_DRAFT_KEY) as Partial<{
      name: string; phone: string; detail: string; province: string; city: string; district: string
      latitude: number; longitude: number; coordinateSource: string
    }> | undefined
    if (!draft || !String(draft.detail || '').trim()) return
    selectedAddress.value = {
      name: cleanText(draft.name || ''),
      phone: normalizeEditableMobile(draft.phone || ''),
      detail: cleanText(draft.detail || ''),
      province: cleanText(draft.province || ''),
      city: cleanText(draft.city || ''),
      district: cleanText(draft.district || ''),
      // ⛔ 坐标与**来源**一起取（all-or-nothing，见 trustedCoordinateFields）
      ...trustedCoordinateFields(draft),
    }
  } catch { /* 草稿读取失败忽略：不影响结算页其它功能 */ }
})

/**
 * 保存结算表单到本地缓存。
 *
 * ⚠️ 地址是**整体**存进缓存的（`{ ...selectedAddress.value }`）⇒ `coordinateSource` 随坐标一起落盘；
 *    读取侧 `loadFormCache` 用 `trustedCoordinateFields` 成对取回，所以缓存里"两份数据不一致"
 *    也不会被当成可信坐标。
 */
function saveFormCache(): void {
  try {
    const addressPhone = normalizeEditableMobile(selectedAddress.value?.phone)
    const cache: PaymentFormCache = {
      address: selectedAddress.value && addressPhone ? { ...selectedAddress.value, phone: addressPhone } : null,
      contactName: contactName.value,
      contactPhone: contactPhone.value,
      invoiceEnabled: invoiceEnabled.value,
      invoiceType: invoiceType.value,
      invoiceForm: { ...invoiceForm },
      remark: remark.value,
    }
    uni.setStorageSync(PAYMENT_FORM_CACHE_KEY, cache)
  } catch { /* 缓存保存失败忽略 */ }
}

// 表单内容变化时自动缓存，下次进入自动填入
watch(
  [selectedAddress, contactName, contactPhone, invoiceEnabled, invoiceType, invoiceForm, remark],
  () => saveFormCache(),
  { deep: true },
)

/** 商品总额小计（订前价/原价总额）：历史订单取 totalAmount，新建订单累加划线价 originalPrice（回退 price）。 */
const subtotal = computed(() => {
  const orderTotal = Number(existingOrder.value?.totalAmount)
  if (Number.isFinite(orderTotal) && orderTotal > 0) return orderTotal
  return items.value.reduce((sum, item) => sum + Number(item.originalPrice ?? item.price ?? 0) * item.quantity, 0)
})
/**
 * 配送费：
 * - 历史订单：用订单上的实收运费；
 * - 新建**同城配送**订单：用试算结果（后端按发货门店 + 收货坐标算），未试算成功时为 0 且提交会被拦截；
 * - 其它（物流/自提）：由后端下单时计算，前端展示 0。
 */
const deliveryFee = computed(() => {
  if (!existingOrder.value && pickupType.value === 2) return Number(deliveryQuote.value?.deliveryFee || 0)
  // ⚠️ 后端订单里 freightAmount 恒为 0，真实运费在 deliveryFee（2026-09-19 实测）
  return Number(existingOrder.value?.deliveryFee ?? existingOrder.value?.freightAmount ?? 0)
})
/** 优惠减免额：历史订单取订单字段，新建订单 = Σ(划线价 - 现价) × 数量。 */
const discountAmount = computed(() => {
  if (existingOrder.value) return Number(existingOrder.value.discountAmount || 0)
  return items.value.reduce((sum, item) => {
    const original = Number(item.originalPrice ?? item.price ?? 0)
    const current = Number(item.price ?? 0)
    return sum + Math.max(original - current, 0) * item.quantity
  }, 0)
})
/** 实付合计：历史订单取 payAmount，新建订单 = Σ现价 × 数量 + 运费。 */
const total = computed(() => {
  const orderPay = Number(existingOrder.value?.payAmount)
  if (Number.isFinite(orderPay) && orderPay > 0) return orderPay
  const goodsPay = items.value.reduce((sum, item) => sum + Number(item.price ?? 0) * item.quantity, 0)
  return goodsPay + deliveryFee.value
})
/** 余额是否足够全额支付当前订单（不足时余额支付不可选）。 */
const balanceEnough = computed(() => walletBalance.value >= total.value)
const itemCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0))
const canRenderCheckout = computed(() => !loading.value && !loadError.value && (items.value.length > 0 || Boolean(existingOrder.value)))
const invoiceSummary = computed(() => {
  if (!invoiceEnabled.value) return '不需要发票'
  if (!invoiceSaved.value) return '请填写发票信息'
  return invoiceType.value === 'personal'
    ? `个人 · ${invoiceForm.name}`
    : `公司 · ${invoiceForm.companyName}`
})
const remarkSummary = computed(() => remark.value.trim() || '添加备注')

/** 是否展示「取消订单」按钮：仅从订单列表进入的待付款历史订单。 */
const showCancelOrder = computed(() => Boolean(orderId.value) && existingOrder.value?.status === 0)

/** 解析支付截止时间字符串（yyyy-MM-dd HH:mm:ss）为毫秒时间戳，iOS 需把 '-' 换成 '/'。 */
function parseExpireTime(value?: string): number {
  if (!value) return 0
  const normalized = String(value).replace(/-/g, '/')
  const t = new Date(normalized).getTime()
  return Number.isFinite(t) ? t : 0
}

/** 支付剩余秒数（仅待付款历史订单，依赖后端 payExpireTime 字符串）。 */
const payRemainingSeconds = computed(() => {
  if (!showCancelOrder.value) return 0
  const expire = parseExpireTime(existingOrder.value?.payExpireTime)
  if (!expire) return 0
  return Math.max(0, Math.floor((expire - now.value) / 1000))
})
/** 倒计时文案 HH:MM:SS。 */
const countdownText = computed(() => {
  const s = payRemainingSeconds.value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
})

/** 格式化金额，统一保留两位小数。 */
function formatMoney(value: number): string {
  return Number(value || 0).toFixed(2)
}

/** 计算单个商品的小计。 */
function productTotal(item: CartItem): number {
  return Number(item.price || 0) * item.quantity
}

/** 从购物车重新读取数据，只保留结算入口传入的记录。 */
async function loadSelectedItems(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    // resolveDeliverySwitch：让购物车条目带上商品级 pickupEnabled / deliveryEnabled，
    // 结算页据此过滤配送方式（详情走 api/cart.ts 的 30s 缓存，两种补齐共用同一批请求）
    const allItems = await getCartList({ resolveDividendEligibility: true, resolveDeliverySwitch: true })
    items.value = allItems.filter((item) => selectedCartIds.value.includes(item.cartId))
  } catch (error) {
    loadError.value = true
    console.error('确认订单商品加载失败', error)
  } finally {
    loading.value = false
  }
}

/** 立即购买模式：商品详情已静默加购物车，从购物车匹配该商品（productId+skuId）构造结算条目。 */
async function loadDirectItem(): Promise<void> {
  if (!directSkuId.value || !directProductId.value) return
  loading.value = true
  loadError.value = false
  try {
    // 直接购买：用商品详情接口构造结算条目，不依赖购物车，避免带入购物车其他商品
    const product = await getProductDetail(String(directProductId.value))
    const sku = product.skuList.find((item) => String(item.id) === String(directSkuId.value))
    if (!sku) throw new Error('商品规格不存在，请重新选择')
    items.value = [{
      cartId: -directSkuId.value,
      productId: Number(directProductId.value),
      skuId: Number(directSkuId.value),
      productName: product.name || '商品',
      productImage: product.mainImage || '',
      skuName: sku.skuName || '',
      specs: sku.specs || '',
      price: Number(sku.price || 0),
      originalPrice: Number(sku.originalPrice ?? sku.price ?? 0),
      quantity: directQuantity.value,
      checked: true,
      stock: Number(sku.stock || 0),
      dividendEligible: isDividendEligible({ dividendEnabled: product.dividendEnabled, price: sku.price }),
      // 立即购买这条路本来就拿了商品详情，商品级配送开关直接取用（不额外发请求）
      pickupEnabled: normalizeDeliverySwitch(product.pickupEnabled),
      deliveryEnabled: normalizeDeliverySwitch(product.deliveryEnabled),
      // ⚠️ 2026-10-09 修（生产商品 97 实测「后台关了同城、商城仍可选同城」）：
      //    第十二批把同城从 deliveryEnabled 拆成独立字段后，购物车链路（api/cart.ts 的 resolveProductFlags）
      //    同步补了，**这条路径漏了** ⇒ 条目上该字段是 undefined ⇒ normalizeDeliverySwitch 按 1（支持）兜底
      //    ⇒ 结算页不给「同城配送」置灰、提交前也拦不住。同城**只看本字段**，必须与上面两个一起映射。
      sameCityEnabled: normalizeDeliverySwitch(product.sameCityEnabled),
    }]
    selectedCartIds.value = []
  } catch (error) {
    loadError.value = true
    console.error('立即购买商品加载失败', error)
  } finally {
    loading.value = false
  }
}

/** 加载历史待付款订单，避免从订单列表进入时再次按购物车创建新订单。 */
async function loadExistingOrder(): Promise<void> {
  if (!orderId.value) return
  loading.value = true
  loadError.value = false
  try {
    const detail = await getOrderDetail(orderId.value)
    existingOrder.value = detail
    pickupType.value = detail.pickupType ?? 0
    if (detail.receiverName || detail.receiverPhone || detail.receiverAddress) {
      selectedAddress.value = {
        name: detail.receiverName || '',
        phone: detail.receiverPhone || '',
        detail: detail.receiverAddress || '',
        // 订单详情只回传一个完整地址串、不单独给省市区，这里留空；
        // 若这单要改成同城配送重新下单，提交校验会提示补全「所在地区」。
        province: '',
        city: '',
        district: '',
      }
    }
    if (detail.shopName) {
      selectedShop.value = {
        id: detail.pickupShopId || 0,
        name: detail.shopName,
        address: '',
      }
    }

    const detailItems = Array.isArray(detail.items) ? detail.items : []
    // 订单详情这条路径（从订单列表改单 / 重新支付）拿不到商品级配送开关，也无法按 skuId 反查（详情只给商品名），
    // 取舍：一律按后端默认值 1（支持）兜底 —— 宁可放行到后端、也不误拦用户去支付一笔已存在的订单；
    // 真不支持时后端下单会以 13023/13024 拦下，并由 getPaymentErrorMessage 展示约定文案。
    if (detailItems.length) {
      items.value = detailItems.map((item, index) => ({
        cartId: -(index + 1),
        productId: 0,
        skuId: 0,
        productName: item.productName || '订单商品',
        productImage: item.productImage || detail.firstProductImage || '',
        skuName: item.skuName || '',
        specs: '',
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 1),
        checked: true,
        stock: 0,
        pickupEnabled: 1,
        deliveryEnabled: 1,
        sameCityEnabled: 1,
      }))
    } else if (detail.totalQuantity > 0) {
      items.value = [{
        cartId: -1,
        productId: 0,
        skuId: 0,
        productName: '订单商品',
        productImage: detail.firstProductImage || '',
        skuName: '',
        specs: '',
        price: Number(detail.payAmount || 0) / detail.totalQuantity,
        quantity: detail.totalQuantity,
        checked: true,
        stock: 0,
        pickupEnabled: 1,
        deliveryEnabled: 1,
        sameCityEnabled: 1,
      }]
    }
  } catch (error) {
    loadError.value = true
    console.error('历史订单加载失败', error)
  } finally {
    loading.value = false
  }
}

function reloadCheckout(): void {
  if (orderId.value) {
    void loadExistingOrder()
    return
  }
  if (directSkuId.value && directProductId.value) {
    void loadDirectItem()
    return
  }
  void loadSelectedItems()
}

/**
 * 门店列表是否已经跑过一次（无论成功失败）。
 * ⚠️ 用途：区分「门店还在加载」与「确实一个可用门店都没有」——
 * 前者不能把「同城配送」置灰，否则进页面会先闪一下灰再恢复。
 */
const shopsLoaded = ref(false)

/**
 * 门店列表**是否加载失败**（区别于「确实一个可用门店都没有」）。
 *
 * ⚠️ 2026-09-30 修（审计发现）：原先 `loadShops` 失败时只把 `shops` 置空，
 * 而 `shopEmptyText` 会据此显示「**暂无可用门店 / 暂无门店可提供该商品**」
 * ⇒ **把网络/接口故障说成"平台没有门店"**，用户会信以为真直接弃单，
 * 且页面**没有失败提示、没有重试入口**。
 * ⇒ 现在单独记一个失败标记，由 `shopEmptyText` 给出**可区分**的文案。
 */
const shopsLoadFailed = ref(false)

/** 加载 C 端可用门店，替换支付页中的本地假数据。 */
async function loadShops(): Promise<void> {
  try {
    shops.value = await getEnabledShops()
    shopsLoadFailed.value = false
  } catch (error) {
    shops.value = []
    shopsLoadFailed.value = true
    console.error('门店列表加载失败', error)
  } finally { shopsLoaded.value = true }
}

/* ===================== 同城配送：按商品筛选可配送门店（2026-09-24 修） ===================== */

/**
 * 按「订单里商品的 skuId」筛出的可配送门店。
 *
 * ⚠️ **为什么必须要它**：`shops`（`/api/shop/all`）是「全部启用门店」。同城配送要选
 * **发货门店**，而一家门店能不能发这单，取决于它有没有这些商品 —— 只按
 * `deliveryEnabled` 过滤会把"没有该商品的门店"也列出来（真机反馈：商品只有 A 店有，
 * 弹层里却列出所有门店）。正确数据源是 `/api/shop/deliverable?skuIds=`。
 *
 * `null` = 还没得出结论（历史订单详情只给商品名、拿不到 skuId）或筛选接口失败
 * ⇒ 调用方一律**退回全量门店**，不能因为筛选接口故障就让用户下不了同城单。
 */
const deliverableShops = ref<EnabledShop[] | null>(null)

/** 是否已就当前 skuId 得出结论（成功 / 失败 / 无需筛选都算），用于避免加载中误置灰。 */
const deliverableSettled = ref(false)

/** 已按哪批 skuId 拉过，避免 `items` 多次变动时重复请求。 */
let deliverableQueryKey = ''

/**
 * 门店筛选的请求竞态 token：后发请求作废先发请求的响应。
 *
 * ⚠️ 2026-09-30 修（审计发现）：`loadDeliverableShops` 原先**没有请求归属校验**，
 * 而它的触发入口（`watch(items)` 与「重新加载」）**都没有并发闸门**
 * ⇒ 慢网下 items 先后被赋值两批、或用户连点「重新加载」时，
 * **先发后到的旧响应会覆盖新结果** ⇒ 门店列表与当前商品不匹配，
 * 用户选中后下单会被后端拒（13023 / 13024 / 超范围）。
 */
let deliverableToken = 0

/** 当前订单商品的 skuId 列表（仅 >0）；历史订单详情路径拿不到 skuId，返回空数组。 */
function itemSkuIds(): number[] {
  return items.value
    .map((item) => Number(item.skuId))
    .filter((id) => Number.isFinite(id) && id > 0)
}

/** 拉「只包含订单商品」的可配送门店（失败/拿不到 skuId 时保持 `null`，由调用方退回全量）。 */
async function loadDeliverableShops(): Promise<void> {
  const skuIds = itemSkuIds()
  if (!skuIds.length) {
    deliverableShops.value = null
    deliverableSettled.value = true
    return
  }
  const token = ++deliverableToken
  try {
    const list = await getDeliverableShops(skuIds)
    // ⚠️ 过期响应丢弃：否则旧商品的筛选结果会盖掉新商品的结果，导致门店与商品不匹配
    if (token !== deliverableToken) return
    const shopsOfProduct = Array.isArray(list) ? list : []
    deliverableShops.value = shopsOfProduct
    // 可观测性：真机 / 开发者工具 Console 里一眼看出这一层到底筛没筛
    console.info(`[shop] 按商品筛选可配送门店 skuIds=${skuIds.join(',')} → ${shopsOfProduct.length} 家（全量启用门店 ${shops.value.length} 家）`)
    if (shopsOfProduct.length && shops.value.length && shopsOfProduct.length >= shops.value.length) {
      console.warn('[shop] 「按商品筛选」的结果 ≥ 全量启用门店数 —— 请确认后端 /api/shop/deliverable 是否真的按 skuIds 过滤，或该商品确实被所有门店上架')
    }
  } catch (error) {
    if (token !== deliverableToken) return
    deliverableShops.value = null
    console.error('按商品筛选可配送门店失败，退回全量门店', error)
  } finally {
    // ⚠️ 只有最新请求能置"已得出结论"，否则旧请求结束会让新请求在做筛选时就被当成已完成
    if (token === deliverableToken) deliverableSettled.value = true
  }
}

/** 同城门店是否**还在按商品筛选中**（此时列表还是全量，置灰与试算判断都不准，先不做）。 */
const deliverablePending = computed(() => itemSkuIds().length > 0 && !deliverableSettled.value)

/**
 * 商品就绪后按 skuId 拉一次可配送门店。
 * 门店列表本身与商品是并发加载的（`Promise.all`），发起时拿不到商品，所以这里单独 watch。
 */
watch(items, () => {
  const key = itemSkuIds().slice().sort((a, b) => a - b).join(',')
  if (!key || key === deliverableQueryKey) return
  deliverableQueryKey = key
  deliverableSettled.value = false
  void loadDeliverableShops()
})

/**
 * 同城配送的候选门店 = 「能配送这批商品的门店」∩「开通了同城配送的门店」。
 * 筛选结果拿不到（`deliverableShops === null`）时退回全量门店，保住可用性。
 *
 * ⚠️ ⚠️ **自提（`pickupType=1`）不能用这个列表**（2026-09-29 更正）：
 *    这里额外过滤了 `deliveryEnabled`，而那是**同城开关**——一家店没开通同城，
 *    照样可以让顾客上门自提它自己有的商品。自提应直接用 `deliverableShops`（只按商品筛）。
 *    （此前这句注释写的是反的："自提不用这个列表"，导致自提一直被喂全量门店。）
 */
const sameCityShops = computed(() => {
  const base = deliverableShops.value ?? shops.value
  return base.filter((shop) => shop.deliveryEnabled !== false)
})

/**
 * 门店弹层 / 置灰说明的空态文案。
 * ⚠️ 自提（1）与同城（2）都基于「按商品筛选」的结果 ⇒ 空态都该说明"这批商品没有门店能提供"；
 *    只有筛选结果拿不到（退回全量）时才说"暂无可用门店 / 没有门店开通同城"。
 */
const shopEmptyText = computed(() => {
  // ⚠️ 2026-09-30：门店列表**加载失败**时必须与「确实没有门店」区分开 ——
  // 否则会把接口故障说成"平台没有门店"，用户信以为真直接弃单、也不会去重试。
  if (shopsLoadFailed.value) return '门店列表加载失败，请点击「重新加载」重试'
  // 自提：只看有没有门店能提供这批商品
  if (pickupType.value === 1) {
    return deliverableShops.value !== null ? '暂无门店可提供该商品' : '暂无可用门店'
  }
  if (pickupType.value !== 2) return '暂无可用门店'
  return deliverableShops.value !== null ? '暂无门店可配送该商品' : '暂无门店开通同城配送'
})

/** 当前品牌模块开关（空 = 未配置/失败，按全部启用兜底）。 */
const moduleConfig = ref<ModuleConfig[] | null>(null)

/** 拉取当前品牌模块开关；失败/为空保持 null（按全部启用兜底，兼容线上）。 */
async function loadModuleConfig(): Promise<void> {
  try {
    const modules = await getModules()
    moduleConfig.value = modules && modules.length ? modules : null
  } catch {
    moduleConfig.value = null
  }
}

/** 配送方式选项：方式本体 + 「被商品级配送开关过滤掉」时的原因。 */
interface DeliveryOption {
  type: PickupType
  label: string
  /** 有值 = 该方式被已选商品的配送开关禁用：置灰但保留可点，点了用 toast 说明原因。 */
  blockedReason?: string
}

/**
 * 商品级配送开关（后端 2026-09-22 新增、**2026-09-29 第十二批拆为三个**；默认 1=支持，
 * 缺失/非法值由 normalizeDeliverySwitch 按 1 兜底）：
 * - 任一已选商品 `pickupEnabled=0` → 不提供「门店自提」（后端以 `13023` 拦）；
 * - 任一已选商品 `deliveryEnabled=0` → 不提供「快递配送」（后端以 `13024` 拦）—— ⚠️ 本批起它**只管物流**；
 * - 任一已选商品 `sameCityEnabled=0` → 不提供「同城配送」（后端同以 `13024` 拦，文案按档区分）。
 * 与「模块开关」「门店可送性」是多重叠加关系，缺一层都会出现「能选但下不了单」。
 */
const pickupBlockedByProduct = computed(() => items.value.some((item) => normalizeDeliverySwitch(item.pickupEnabled) === 0))
const deliveryBlockedByProduct = computed(() => items.value.some((item) => normalizeDeliverySwitch(item.deliveryEnabled) === 0))
/** ⚠️ 同城**独立**判断：不再复用 `deliveryBlockedByProduct`（那会让"物流被关"把同城也一起拦掉）。 */
const sameCityBlockedByProduct = computed(() => items.value.some((item) => normalizeDeliverySwitch(item.sameCityEnabled) === 0))
/** 同一批商品里**三个**开关都关掉：任何配送方式都下不了单（页面提示 + 禁用下单 + 提交拦截三重兜底）。 */
const noSupportedDeliveryMethod = computed(() => pickupBlockedByProduct.value && deliveryBlockedByProduct.value && sameCityBlockedByProduct.value)

/**
 * 取某个配送方式被「商品级配送开关」过滤掉的原因；返回空串表示该方式可选。
 * 物流(0) 用 `deliveryEnabled`、自提(1) 用 `pickupEnabled`、**同城(2) 用 `sameCityEnabled`**（第十二批拆分）。
 */
function deliveryBlockedReasonFor(type: PickupType): string {
  if (type === 1) return pickupBlockedByProduct.value ? PRODUCT_PICKUP_BLOCKED_MESSAGE : ''
  if (type === 2) return sameCityBlockedByProduct.value ? PRODUCT_SAME_CITY_BLOCKED_MESSAGE : ''
  return deliveryBlockedByProduct.value ? PRODUCT_DELIVERY_BLOCKED_MESSAGE : ''
}

/**
 * 「门店自提」的候选门店。
 *
 * ⚠️ 与同城的口径**只差一层**：自提**只按商品筛**（这家店有没有这批商品），
 * 而**不叠加** `deliveryEnabled` —— 那是同城配送开关，一家店没开通同城，
 * 照样可以让顾客上门自提它自己有的商品。
 * ⚠️ 筛选结果拿不到（`deliverableShops === null`，如历史订单详情拿不到 skuId 或接口失败）
 * 时退回全量启用门店，保住可用性（与同城的降级策略一致）。
 */
const pickupShopList = computed<EnabledShop[]>(() => deliverableShops.value ?? shops.value)

/** 有没有门店能**提供当前这批商品**（供自提置灰判定；口径同 {@link pickupShopList}）。 */
const hasPickupShop = computed(() => pickupShopList.value.length > 0)

/**
 * 有没有门店能**配送当前这批商品**（= 门店级 `deliveryEnabled` + 门店有没有这些 SKU）。
 * ⚠️ 与**商品级** `deliveryEnabled` 同名但是两回事：前者是"这家店能不能送这单"，后者是"这件商品能不能走配送"。
 */
const hasSameCityShop = computed(() => sameCityShops.value.length > 0)

/**
 * 门店层的「门店自提」阻断原因（2026-09-29 补，与同城的同一套机制）。
 *
 * ⚠️ 为什么需要：自提的门店列表现在也只列**有这批商品**的门店（见 `pickerShops`），
 * 若一家都没有，用户会一路选到「选择门店」弹层才看到空态 ⇒ 和同城一样**提前置灰并说明**。
 * ⚠️ 与同城的唯一区别：**自提不叠加 `deliveryEnabled`**（那是同城开关，没开通同城照样能上门自提），
 * 所以这里用 `pickupShopList` 而不是 `sameCityShops`。
 * ⚠️ 加载中不判定，避免先闪一下置灰再恢复（与同城保持一致的体验）。
 */
const pickupShopBlockedReason = computed(() => {
  if (!shopsLoaded.value || deliverablePending.value) return ''
  return hasPickupShop.value ? '' : shopEmptyText.value
})

/**
 * 门店层的同城配送阻断原因（2026-09-22 补）。
 *
 * 门店列表加载完却**一个开通同城配送的店都没有** → 把「同城配送」也置灰并说明，
 * 否则用户会一路选到「选择发货门店」弹层里才看到「暂无门店开通同城配送」（实测的真实场景：
 * **新入驻店铺的默认状态** —— 入驻会自动建店，但不会自动创建配送规则，
 * `delivery_rules` 没有记录 → `deliveryEnabled = false` → C 端结算页不列出该店）。
 * 文案与门店弹层里的空态保持一致；只在 `shopsLoaded` 之后判定，避免加载中先闪一下置灰。
 */
const sameCityShopBlockedReason = computed(() => {
  // 加载中（门店列表 / 按商品筛选还没回来）不判定，避免先闪一下置灰再恢复
  if (!shopsLoaded.value || deliverablePending.value) return ''
  return hasSameCityShop.value ? '' : shopEmptyText.value
})

/**
 * 可用的配送方式选项（模块开关 + 商品级配送开关 + 门店层同城可用性 **三重叠加**）。
 * 2026-09-19 起「同城配送」正式开放下单（此前是 samecity 开关占位、代码里硬编码不渲染）：
 * 选它时要选**发货门店**并填收货地址，配送费由试算接口给出。
 * 2026-09-22 起再叠两层：商品级配送开关（任一商品不支持该方式）+ 门店层（没有可用同城门店）。
 * 被过滤掉的方式**不删掉、而是置灰保留**，让用户看得到「有这个方式但当前不可用」，点了给明确原因。
 */
const deliveryOptions = computed<DeliveryOption[]>(() => {
  const modules = moduleConfig.value
  const options: DeliveryOption[] = []
  if (isModuleEnabled(modules, 'delivery')) options.push({ type: 0, label: '快递配送' })
  if (isModuleEnabled(modules, 'pickup')) options.push({ type: 1, label: '门店自提' })
  if (isModuleEnabled(modules, 'samecity')) options.push({ type: 2, label: '同城配送' })
  // 给被过滤掉的方式挂上原因（页面据此置灰 + 说明 + 拦切换/拦提交）
  return options.map((option) => {
    const blockedReason = deliveryBlockedReasonFor(option.type)
      // 同城配送再叠一层门店可用性（没有可用门店时提前置灰，别让用户白选一轮）
      || (option.type === 2 ? sameCityShopBlockedReason.value : '')
      // ⚠️ 门店自提同样叠一层（2026-09-29 补）：一家有这批商品的门店都没有时提前置灰，
      //    与同城行为对齐，别让用户点进去才看到空态。
      || (option.type === 1 ? pickupShopBlockedReason.value : '')
    return blockedReason ? { ...option, blockedReason } : option
  })
})

/** 是否还有「真正可选」的配送方式（模块开关 + 商品开关叠加后）。 */
const hasUsableDeliveryOption = computed(() => deliveryOptions.value.some((option) => !option.blockedReason))

/** 「立即支付」是否因商品级配送开关被禁用：只对新建订单生效（历史待付款订单只是去支付，不重新下单）。 */
const payBlockedByProductDelivery = computed(() => !existingOrder.value && !hasUsableDeliveryOption.value)

/** 当前选中的配送方式被商品开关禁用的原因（有值 = 提交前必须拦下并说明）。 */
const currentPickupBlockedReason = computed(
  () => deliveryOptions.value.find((option) => option.type === pickupType.value)?.blockedReason || '',
)

/**
 * 商品级配送开关导致的提示（展示在配送方式下方：toast 会被截断，且用户需要提前知道为什么不能选）。
 * 两者都不支持时给统一提示；否则逐条列出「哪个方式 + 为什么」。
 */
const productDeliveryHint = computed(() => {
  if (noSupportedDeliveryMethod.value) return `${PRODUCT_DELIVERY_NONE_MESSAGE}，请返回购物车调整商品`
  const blocked = deliveryOptions.value.filter((option) => option.blockedReason)
  if (!blocked.length) return ''
  return blocked.map((option) => `${option.label}：${option.blockedReason}`).join('；')
})

/**
 * 预试算最多几个门店。
 * 同城配送的「能不能送」是**按发货门店**算的，而门店列表可能很长，
 * 所以按「离用户定位的直线距离」升序只试算最近的前几个，避免进页面打一堆请求。
 */
const SAME_CITY_QUOTE_LIMIT = 5

/** 进页面时采到的一次定位（用于判断「同城配送」在当前定位下是否可用）。 */
const userLocation = ref<{ latitude: number; longitude: number } | null>(null)
/** 预试算结果（key = shopId）：进页面时按用户定位算一次，用于可用性判断与门店过滤。 */
const shopQuotes = ref<Record<number, DeliveryQuote>>({})
/** 是否已经跑过预试算（避免 watch 重复触发）。 */
let sameCityPrepared = false
/** 定位尝试次数：进页面一次 + 用户主动切到同城最多再补一次，避免反复弹授权框。 */
let locationAttempts = 0

/** 门店到用户定位的直线距离；没有定位或门店没有坐标时返回极大值（排到最后）。 */
function shopDistance(shop: EnabledShop): number {
  if (!userLocation.value || shop.latitude == null || shop.longitude == null) return Number.MAX_SAFE_INTEGER
  return distanceMeters(userLocation.value, { latitude: Number(shop.latitude), longitude: Number(shop.longitude) })
}

/**
 * 门店距离文案（2026-09-27 新增）：`距我约 320 米` / `距我约 1.2 公里`。
 * ⚠️ 没有定位（用户拒绝授权 / 定位失败）或门店没录坐标时返回**空串** —— 宁可不显示，
 *    也不要显示一个错的"距离"（`shopDistance` 这时返回极大值，直接格式化会变成天文数字）。
 */
function shopDistanceText(shop: EnabledShop): string {
  const meters = shopDistance(shop)
  if (!Number.isFinite(meters) || meters >= Number.MAX_SAFE_INTEGER) return ''
  if (meters < 1000) return `距我约 ${Math.max(1, Math.round(meters))} 米`
  return `距我约 ${(meters / 1000).toFixed(1)} 公里`
}

/** 门店是否录了可用于导航的坐标。 */
function canNavigateShop(shop: EnabledShop): boolean {
  return shop.latitude != null && shop.longitude != null
}

/**
 * 打开微信内置地图导航到该门店（2026-09-27 新增）。
 * ⚠️ 与「点击整行选择门店」是**两个动作** ⇒ 模板里必须 `@click.stop`，否则点导航会顺带把门店选掉。
 * ⚠️ `uni.openLocation` 只负责打开地图展示/导航，不需要位置授权（和 `getLocation` 不同）。
 */
function navigateToShop(shop: EnabledShop): void {
  if (!canNavigateShop(shop)) {
    uni.showToast({ title: '该门店未设置位置，无法导航', icon: 'none' })
    return
  }
  uni.openLocation({
    latitude: Number(shop.latitude),
    longitude: Number(shop.longitude),
    name: shop.name,
    address: shop.address || '',
    fail: () => uni.showToast({ title: '打开地图失败，请重试', icon: 'none' }),
  })
}

/**
 * 预试算的结论能否当成「**这家门店确定送不到**」—— **按类判定**，只认类别①。
 *
 * 判定链（读的时候请与代码对齐）：
 * - `canDelivery !== false` ⇒ 送得到 / 后端没给结论 ⇒ **不算**阻断；
 * - `canDelivery === false` + 码 ∈ **类别①「确定不可送」** ⇒ 算阻断（可置灰该门店）；
 * - `canDelivery === false` + 码 ∈ **类别②「不确定·环境性」** ⇒ **不算**阻断；
 * - `canDelivery === false` + **空码 / 未知码** ⇒ **不算**阻断（安全默认值）。
 *
 * ⚠️⚠️ 2026-10-08（后端 coordinateSource 闸门上线后必须这么判，否则同城配送对所有用户都进不去）：
 *   预试算用的是**用户当前定位**（不是收货地址），而它的来源只能是 `AUTO_LOCATE`，
 *   **不在后端白名单里** ⇒ 后端必然回 `canDelivery=false` + `failCode=NO_COORDINATE`。
 *   ⛔ 我们**绝不**为了让它通过而谎报 `MAP_PICK`（那是伪造来源，正是本次事故要根除的东西）。
 *   ⇒ 这类失败属于「**结论不可用**」：不能据此把「同城配送」置灰，
 *     真正的判定交给用户填好地址后的**带来源**的试算（`refreshDeliveryQuote`）。
 *
 * ⚠️⚠️ 2026-10-08 追补（后端回执 §三）—— **本函数按「类」判定，不按单个码**：
 *   后端给了**权威分类**（线上实测）：类别①「确定不可送」=
 *   {@link CONCLUSIVE_UNDELIVERABLE_FAIL_CODES}；类别②「不确定·环境性」=
 *   {@link INCONCLUSIVE_ENVIRONMENT_FAIL_CODES}。
 *   只认一两个码是**不够**的：同一商家不带来源时回 `NO_COORDINATE`、**带上 `MAP_PICK` 后回的是
 *   `SHOP_NO_COORDINATE`** ⇒ 只认前者仍会把"商家没配门店坐标"当成"确定送不到"，
 *   同城配送照样被整体禁用。⇒ 判据一律走 `api/delivery-order.ts` 的**类分类器**，
 *   本页**不再自己写任何 `code === 'XXX'` 的单码判断**（新增码因此不会再悄悄回归）。
 *
 * ⚠️ 判据方向很关键：置灰只看「**命中类别①白名单**」（`isConclusiveUndeliverable`），
 *   **不是**「不命中类别②」。空码与**未知码**都落在类别①之外 ⇒ 一律按"不确定"处理
 *   （安全默认值见 `isConclusiveUndeliverable` 的注释）。
 */
function shopQuoteBlocksDelivery(quote?: DeliveryQuote): boolean {
  if (!quote || quote.canDelivery !== false) return false
  const code = resolveQuoteFailCode(quote)
  // ⚠️ 类别②（`SHOP_NO_COORDINATE` / `MAP_SERVICE_ERROR` / `ADDRESS_UNRESOLVED` …）、空码、
  //    以及**将来新增的未知码**都不在这里 ⇒ 不算"这家门店送不到"（门店不过滤、同城不置灰）。
  return isConclusiveUndeliverable(code)
}

/**
 * 当前定位下「同城配送」是否可选。
 * - 定位拿不到（未授权/失败）→ 返回 true（**不置灰**，避免误拦；真正下单时仍会按收货地址试算拦截）；
 * - 定位成功但**所有**候选门店都"**确定**送不到"（类别①）→ false（选项置灰，点击给提示）；
 * - 只要有一家能送、或**有任何一家落在类别② / 未知码 / 空码**（不确定）→ true。
 *
 * ⚠️⚠️ 2026-10-08 **P0 修复（用户反馈「同城配送对所有商品不可用」）**：
 *   此前实现是 `!quotes.some(shopQuoteBlocksDelivery)`，语义 = 「**每一家**都得能送」，
 *   与本函数上面那句「只要有一家能送 → true」**正好相反**，也与 `pickerShops` 的兜底口径不一致
 *   ⇒ **一家门店不可送就"连坐"整个同城配送**。而进页面预试算**刻意不带** `coordinateSource`
 *   （当前定位不是用户在地图上选的收货点，标 `MAP_PICK` 属**谎报来源**，被硬规则禁止），
 *   后端因此对**每一家**都 fail-closed 回 `NO_COORDINATE` ⇒ 只要这个码没被识别出来，
 *   同城配送就对所有商品、所有用户、所有环境一律置灰。
 *   ⇒ 现行口径：**只有"全部候选门店都（按类别①）确定不可送"才置灰**（`every`），
 *     与 `pickerShops`（`quotable.length ? quotable : deliverable`）取**同一个判据**。
 * ⚠️ 本判据**不得**再用 `.some(` —— 那等于"任意一家有结论不可送就禁用"（见契约 11m-1）。
 */
const sameCityAvailable = computed(() => {
  if (!userLocation.value) return true
  const quotes = Object.values(shopQuotes.value)
  if (!quotes.length) return true
  return !quotes.every(shopQuoteBlocksDelivery)
})

/**
 * 置灰的具体原因：取预试算里任一「**有结论地**不可送」门店的后端 reason
 * （后端会带上距离，如「超出配送范围（当前距离约 1397.1 公里）」），展示在页面上而不是塞进 toast（会被截断）。
 * ⚠️ 与 `sameCityAvailable` 用**同一个判据**（`shopQuoteBlocksDelivery`），否则会出现"没置灰却显示置灰原因"。
 *    本文案**只在 `!sameCityAvailable` 时渲染**（模板 `v-if`），而那时是"每一家都有结论地不可送"
 *    ⇒ 取任一家的 reason 都是有结论的，不会把"结论不可用"（含空码）当原因展示出来。
 */
const sameCityUnavailableReason = computed(() => {
  const blocked = Object.values(shopQuotes.value).find(shopQuoteBlocksDelivery)
  return blocked?.reason && blocked.reason !== 'ok' ? blocked.reason : '超出同城配送范围'
})

/**
 * 进页面时定位一次，并对候选门店并发预试算 —— 外市用户买同城配送必然送不到，
 * 靠这一步在**下单前**就把「同城配送」置灰，而不是等提交时才报错。
 * 定位失败静默处理（不弹错、不阻塞），并允许后续切到同城时再补一次定位。
 *
 * ⚠️ 2026-10-08（后端 coordinateSource 闸门）：这里传的是**用户当前定位**，来源只能是
 *    `AUTO_LOCATE`（不在白名单）⇒ 后端一律回 `NO_COORDINATE`，**拿不到"能不能送"的结论**。
 *    ⛔ 绝不谎报 `MAP_PICK` 来"修好"它；本轮结果只当**参考**，不再参与置灰
 *    （见 `shopQuoteBlocksDelivery`，它只认类别①「确定不可送」）。
 *    真正的判定在用户填好收货地址后由 `refreshDeliveryQuote`（带可信来源）做。
 */
async function prepareSameCity(): Promise<void> {
  locationAttempts += 1
  try {
    const located = await new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
      uni.getLocation({
        type: 'gcj02',
        success: (res) => resolve({ latitude: Number(res.latitude), longitude: Number(res.longitude) }),
        fail: () => reject(new Error('定位失败')),
      })
    })
    userLocation.value = located
  } catch {
    userLocation.value = null
    return
  }
  const candidates = sameCityShops.value
  if (!candidates.length) return
  const nearest = [...candidates].sort((a, b) => shopDistance(a) - shopDistance(b)).slice(0, SAME_CITY_QUOTE_LIMIT)
  const results = await Promise.all(nearest.map(async (shop) => {
    try {
      // ⛔ 刻意**不带** coordinateSource：这是"当前位置"，不是用户在地图上选的收货点 ——
      //    给它标 `MAP_PICK` 就是谎报来源。后端因此会 fail-closed（预期内，见上面的说明）。
      const quote = await quoteDelivery({
        merchantId: shop.id,
        goodsAmount: subtotal.value,
        receiverLat: userLocation.value?.latitude,
        receiverLng: userLocation.value?.longitude,
      })
      return quote
    } catch {
      return null
    }
  }))
  const map: Record<number, DeliveryQuote> = {}
  nearest.forEach((shop, index) => {
    const quote = results[index]
    if (quote) map[shop.id] = quote
  })
  shopQuotes.value = map
}

/** 门店与模块配置就绪后跑一次预试算（只跑一次）。 */
watch([shops, moduleConfig, deliverableShops], () => {
  if (sameCityPrepared) return
  if (!shops.value.length) return
  // 商品就绪后门店列表会按商品再筛一次：等筛完再试算，否则先拿全量门店白试算一轮
  if (deliverablePending.value) return
  // 同城被商品级配送开关过滤掉时不必试算（试算了也选不了），省掉几个无意义的试算请求
  if (!deliveryOptions.value.some((option) => option.type === 2 && !option.blockedReason)) return
  sameCityPrepared = true
  void prepareSameCity()
})

/**
 * 门店弹层数据源。
 *
 * ⚠️ **自提（pickupType=1）与同城（2）的门店口径应当一致**：都只能选**有这批商品**的门店。
 *    （2026-09-29 修：此前自提直接返回 `shops.value`＝全部启用门店，真机反馈"商品只有 A 店有，
 *      自提却列出所有门店"。）
 * ⚠️ 但两者**不能共用 `sameCityShops`** —— 那里还额外过滤了 `deliveryEnabled`（**同城开关**），
 *    而自提与同城开关无关：一家店没开通同城，照样可以让顾客上门自提自己有的商品。
 *    ⇒ 自提只用 `deliverableShops`（口径 = `shop_product.status=1` 上架关系，与下单拦截同源）。
 * ⚠️ 物流（0）不选门店，保持原样返回。
 * ⚠️ 同城若预试算已出结果，进一步只列**确定能送到或结论不可用**的门店（类别①的门店列出来也没意义）。
 *    ⚠️ 2026-10-08：这里的"送不到"必须是**类别①「确定不可送」**（`shopQuoteBlocksDelivery`
 *    ⇒ `isConclusiveUndeliverable`）—— **类别②「不确定 · 环境性」一律不得过滤门店**
 *    （后端回执 §三）：`NO_COORDINATE`（当前定位没有可信来源）、`SHOP_NO_COORDINATE`（商家未配
 *    门店坐标）、`MAP_SERVICE_ERROR`、`ADDRESS_UNRESOLVED`、`COORDINATE_INVALID` 以及**未知码**
 *    **全部不算**，否则门店列表会被清空 / 只剩一家。
 * ⚠️ 别再退回 `shops.value` 给自提/同城 —— 那是全量启用门店，会把没有该商品的门店也列出来。
 */
const pickerShops = computed(() => {
  // 自提：只按商品筛，不看 deliveryEnabled（同城开关与自提无关）—— 复用 pickupShopList，避免两处口径漂移
  if (pickupType.value === 1) return pickupShopList.value
  // 物流：不涉及门店选择
  if (pickupType.value !== 2) return shops.value
  const deliverable = sameCityShops.value
  const quotable = deliverable.filter((shop) => !shopQuoteBlocksDelivery(shopQuotes.value[shop.id]))
  return quotable.length ? quotable : deliverable
})
/** 门店弹层标题随配送方式变化。 */
const shopSheetTitle = computed(() => (pickupType.value === 2 ? '选择发货门店' : '选择门店'))

/**
 * 收货地址完整串：省市区 + 详细地址。
 * ⚠️ 去重：用户很容易把省市区又手写进「详细地址」（例如定位已填入省市区，详细地址里又写了一遍
 * 「江西省九江市柴桑区庐山北路168号」），直接拼接会出现「江西省九江市柴桑区江西省九江市柴桑区」。
 * 这里按「详细地址里是否已含省市区（或市+区 / 区）」逐级判断，命中就不再重复拼。
 */
function fullAddress(address: Address | null): string {
  if (!address) return ''
  const region = [address.province, address.city, address.district].filter(Boolean).join('')
  const detail = String(address.detail || '').trim()
  if (!region) return detail
  if (detail.includes(region)) return detail
  const cityDistrict = [address.city, address.district].filter(Boolean).join('')
  if (cityDistrict && detail.startsWith(cityDistrict)) return `${address.province || ''}${detail}`.trim()
  const district = String(address.district || '')
  if (district && detail.startsWith(district)) return `${address.province || ''}${address.city || ''}${detail}`.trim()
  return `${region}${detail}`
}

/** region 选择器当前值（必须省市区三段齐全才算已选）。 */
const regionPickerValue = computed(() => [addressForm.province, addressForm.city, addressForm.district].filter(Boolean))
/** 省市区展示文案（未选时给占位）。 */
const regionText = computed(() => (regionPickerValue.value.length === 3 ? regionPickerValue.value.join(' ') : '请选择所在地区'))

/** region 三级联动选择器回调：写入省 / 市 / 区。 */
function onRegionChange(event: { detail?: { value?: string[] } }): void {
  const [province = '', city = '', district = ''] = event?.detail?.value || []
  addressForm.province = province
  addressForm.city = city
  addressForm.district = district
}

/**
 * 用定位自动填入省市区（**历史遗留：原「配送地址」弹层用的，弹层已改成独立整页**
 * `subpkg-order/address/edit`，该弹层的模板已删除 ⇒ 本函数与 `saveAddress` 目前**不可达**）。
 *
 * 只填**用户还没填**的字段（不覆盖手动修改）；任何失败都静默降级为手选 ——
 * 省市区可以手选，不能因为定位失败就卡住下单。
 * 微信 `getLocation` 的 `geocode` 会附带 address（省/市/区），但部分基础库或未开通位置服务时拿不到，
 * 所以这里对字段名也做了兼容取值。
 *
 * ⛔⛔ 2026-10-08：这里**不得**再写 `addressForm` 的经纬度（已删除）。
 *    自动定位拿到的是"用户当前站在哪"，与用户填写的收货地址**无关** ⇒ 拿它当收货坐标
 *    就是伪造数据（同城配送范围校验会失效），而且它没有可信来源（白名单外的 `AUTO_LOCATE`）
 *    ⇒ 后端 `fail-closed`、前端也按"没有坐标"处理。要坐标只能去地址页**地图选点**。
 */
async function locateForAddress(): Promise<void> {
  try {
    const result = await new Promise<{ latitude: number; longitude: number; address?: Record<string, string> }>((resolve, reject) => {
      uni.getLocation({
        type: 'gcj02',
        geocode: true,
        success: (res) => resolve(res as unknown as { latitude: number; longitude: number; address?: Record<string, string> }),
        fail: () => reject(new Error('定位失败')),
      })
    })
    locationState.value = 'ok'
    // ⛔ 2026-10-08：**不写** `addressForm` 的经纬度（原 `addressForm.latitude/longitude = ...` 已删除）。
    //    自动定位 = 用户当前所在位置，与收货地址无关，也没有可信来源（白名单外的 AUTO_LOCATE）
    //    ⇒ 拿它当收货坐标就是伪造数据。要做同城配送，只能去地址页「地图选点」。
    const address = result.address || {}
    const province = String(address.province || '')
    const city = String(address.city || '')
    const district = String(address.district || '')
    if (!addressForm.province && province) addressForm.province = province
    if (!addressForm.city && city) addressForm.city = city
    if (!addressForm.district && district) addressForm.district = district
  } catch {
    // 定位被拒 / 超时 / 没返回省市区：静默降级为手选
    locationState.value = 'fail'
  }
}

/** 地址表单底部的定位状态提示（区分「已自动填入」与「没能定位，请手选」）。 */
const addressTipText = computed(() => {
  if (locationState.value === 'ok') return '已按当前位置自动填入所在地区，可手动修改'
  if (locationState.value === 'fail') return '未能获取定位，请手动选择所在地区'
  return '正在尝试按当前位置填入所在地区…'
})

/** 距离展示：不足 1km 保留两位（0.19km），否则一位；无值给占位。 */
function formatDistance(km?: number): string {
  const value = Number(km)
  if (!Number.isFinite(value)) return '--'
  return value < 1 ? `${value.toFixed(2)}km` : `${value.toFixed(1)}km`
}

/**
 * 试算是否用了「发货门店坐标」这层最后的兜底（收货地址没有定位、页面定位也没拿到时）。
 * 这种情况算出来的距离恒为 0 —— 不能只显示「距离 0km」让人以为就在隔壁，要说明是按门店估算的。
 */
const quoteUsingShopFallback = computed(
  () => pickupType.value === 2 && !!selectedAddress.value && selectedAddress.value.latitude == null
    && userLocation.value == null && !!selectedShop.value,
)

/**
 * 试算失败码 → 用户引导文案。
 *
 * ⚠️⚠️ 2026-10-08 追补（后端回执 §三）：**按类分流，不再按单个码分流**（分类器在
 *   `api/delivery-order.ts`：`isConclusiveUndeliverable` / `isInconclusiveEnvironmentFailure`）。
 *   本页**不再自己写任何 `code === 'XXX'` 的单码判断**（新增码不会再悄悄回归）。
 *
 * 分工（⚠️ 别搞反）：
 * - **`canDelivery` 才是"能不能送"的唯一判据**：只有它为 `false` 时才调这里；
 *   后端老版本不下发 `failCode` ⇒ `failCode` 为空也**绝不**当成成功；
 * - ⚠️ 原因码本身**两个字段名都读**（`failCode` ?? `quoteFailCode`，见 `resolveQuoteFailCode`；
 *   字段名歧义已向后端提问）—— 这里**不要**绕过该函数去直接读响应对象的原始字段，
 *   否则读错名字就会退回 `default` 分支：`reason` 仍能展示（后端文案可直接给用户看），
 *   但「去地图选点」这类**可执行引导会消失**；
 * - **类别②（不确定·环境性）**：出路**一律**是「去地图选点」（回执 §三）——
 *   逐码只允许在这**同一条出路**下换措辞，**绝不**允许退回"该地址不可配送"的口径；
 * - **类别①（确定不可送）**：用后端 `reason`（已可直接给用户看，例如
 *   「超出配送范围（当前距离约 12.3 公里）」），逐码保留文案；
 * - **未知码 / 空码**（不在任何一类里）：与类别②同路 —— 后端 `reason` 优先，没给就按"不确定"提示。
 */
function quoteFailureText(quote: DeliveryQuote | null | undefined): string {
  const reason = quote?.reason && quote.reason !== 'ok' ? quote.reason : ''
  const code = resolveQuoteFailCode(quote)
  // ── 类别②「不确定 · 环境性」：统一走「去地图选点」（页面另给可点按钮，见 `quoteNeedsMapPick`）
  if (isInconclusiveEnvironmentFailure(code)) {
    switch (code) {
      // 没有可信坐标（缺失 / 来源不在白名单）⇒ 唯一出路就是去地图选点
      case 'NO_COORDINATE':
        return ADDRESS_NEEDS_MAP_PICK_TEXT
      // 坐标越界 / (0,0) ⇒ 让用户重新选点
      case 'COORDINATE_INVALID':
        return '收货坐标无效，请在地图上重新选点'
      // 地图服务侧问题（未接入 / 配额 / 连接失败）与地址解析失败 ⇒ 同一出路
      case 'MAP_SERVICE_ERROR':
      case 'ADDRESS_UNRESOLVED':
        return reason || '地图服务暂不可用，请在地图上选点后重试'
      // 商家门店坐标未配置：如实转述后端 reason，但**照样**是"去地图选点"这条出路（回执 §三）
      case 'SHOP_NO_COORDINATE':
        return reason || ADDRESS_NEEDS_MAP_PICK_TEXT
      default:
        return ADDRESS_NEEDS_MAP_PICK_TEXT
    }
  }
  // ── 类别①「确定不可送」+ 未知码：后端 reason 已是用户可读文案，原样透出
  switch (code) {
    case 'OUT_OF_RANGE':
    case 'MIN_AMOUNT':
    case 'SHOP_CLOSED':
    case 'NOT_IN_DELIVERY_HOURS':
    case 'DELIVERY_DISABLED':
    case 'GOODS_NOT_PROVIDED':
      return reason || '该地址当前不可配送'
    default:
      return reason || '该地址超出配送范围'
  }
}

/**
 * 试算失败是否属于「**去地图选点**就能解决 / 至少该先去做**」的一类（用于展示可点入口，
 * 而不是只丢一句提示）。
 * 覆盖：本地判定没有可信坐标（含旧缓存"有坐标没来源"）、以及**任何类别②**的后端码
 * （回执 §三：类别② 一律"视为不确定 ⇒ 提示用户请在地图上选点"；
 * 此前只覆盖 `NO_COORDINATE` / `COORDINATE_INVALID`，`SHOP_NO_COORDINATE` /
 * `MAP_SERVICE_ERROR` / `ADDRESS_UNRESOLVED` 拿不到这个可执行入口）。
 */
const quoteNeedsMapPick = computed(() => pickupType.value === 2 && !!selectedAddress.value
  && (!addressCoords.value || isInconclusiveEnvironmentFailure(quoteFailCode.value)))

/**
 * 同城配送试算：发货门店 + 收货地址齐了才调，用于展示配送费 / 距离 / 预计送达与可送性。
 * 试算失败**不静默按 0 收运费** —— 保留错误文案，并在提交时拦截。
 */
async function refreshDeliveryQuote(): Promise<void> {
  if (pickupType.value !== 2 || !selectedShop.value || !selectedAddress.value) {
    deliveryQuote.value = null
    quoteError.value = ''
    quoteFailCode.value = ''
    return
  }
  const address = selectedAddress.value
  const coords = addressCoords.value
  // ⚠️ 没有真实坐标 ⇒ **不试算**（绝不拿别的位置冒充），如实告知原因；
  //    提交侧另有拦截（见 submitPayment），二者共同保证「无坐标不可能下单成功」。
  if (!coords) {
    deliveryQuote.value = null
    // 本地就能断定后端会判 `NO_COORDINATE`（坐标缺失或来源不可信）⇒ 先按同一口径给引导
    quoteFailCode.value = 'NO_COORDINATE'
    quoteError.value = ADDRESS_NEEDS_MAP_PICK_TEXT
    return
  }
  quoteLoading.value = true
  quoteError.value = ''
  quoteFailCode.value = ''
  try {
    const quote = await quoteDelivery({
      merchantId: selectedShop.value.id,
      goodsAmount: subtotal.value,
      // 坐标**只**来自收货地址自身的定位（见 addressCoords），绝不兜底到当前位置 / 发货门店
      receiverLat: coords.lat,
      receiverLng: coords.lng,
      // 坐标来源：**只**取地址自身记录的可信来源（`addressCoords` 已按白名单门禁过滤过 ⇒ 这里必非空）
      coordinateSource: addressCoordinateSource.value,
      address: fullAddress(address),
    })
    deliveryQuote.value = quote
    if (quote && quote.canDelivery === false) {
      // ⚠️ 两个字段名都读（`failCode` ?? `quoteFailCode`）—— 契约字段名在后端交付物里自相矛盾，
      //    已向后端提问；读错会让「去地图选点」按钮不出现（见 `resolveQuoteFailCode`）
      quoteFailCode.value = resolveQuoteFailCode(quote)
      quoteError.value = quoteFailureText(quote)
    }
  } catch {
    deliveryQuote.value = null
    quoteError.value = '配送费试算失败，请重试'
  } finally {
    quoteLoading.value = false
  }
}

/** 同城相关的输入变化时重新试算（300ms 防抖，避免连续选择反复打接口）。 */
let quoteTimer: ReturnType<typeof setTimeout> | null = null
watch([pickupType, selectedShop, selectedAddress, subtotal], () => {
  if (quoteTimer) clearTimeout(quoteTimer)
  quoteTimer = setTimeout(() => { void refreshDeliveryQuote() }, 300)
})

/** 读取微信页面参数并初始化页面布局。 */
onLoad(async (options?: Record<string, string | undefined>) => {
  orderId.value = options?.orderId || null
  selectedCartIds.value = String(options?.cartIds || '')
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
  // 直接购买模式：商品详情「立即支付」进入，带 skuId + productId
  const skuId = Number(options?.skuId)
  const productId = Number(options?.productId)
  if (Number.isFinite(skuId) && skuId > 0 && Number.isFinite(productId) && productId > 0) {
    directSkuId.value = skuId
    directProductId.value = productId
    directQuantity.value = Number(options?.quantity || 1) || 1
  }
  if (!isLoggedIn()) {
    loading.value = false
    loginGuideVisible.value = true
    return
  }
  // 非历史订单：自动填入上次填写的表单内容（地址、联系方式、发票、备注）
  if (!orderId.value) loadFormCache()
  if (orderId.value) {
    await Promise.all([loadExistingOrder(), loadBalance(), loadModuleConfig()])
    return
  }
  if (directSkuId.value && directProductId.value) {
    await Promise.all([loadDirectItem(), loadShops(), loadBalance(), loadModuleConfig()])
    return
  }
  await Promise.all([loadSelectedItems(), loadShops(), loadBalance(), loadModuleConfig()])
})

/**
 * 页面卸载（用户返回 / 跳走）时**释放支付通道占用** —— 2026-09-29 第十二批新增。
 *
 * ⚠️ 为什么必须做：占位不主动释放的话会一直卡到后端自动过期（第十二批起统一 2 分钟；
 *    **此前"余额占用"永不过期** ⇒ 微信支付会永久报「已选择余额支付」，是死锁）。
 * ⚠️ 只在「有订单且尚未确认支付成功」时调用：`release-channel` 幂等、且**只释放占用、不动已成功的支付**，
 *    但已成功后就没必要再打一次。
 * ⚠️ 失败静默：最坏结果只是多等一次自动清理，不该在页面销毁时报错打扰用户。
 *
 * ⚠️ **刻意不放在「微信支付取消」分支里**：那条链路要保留 `switchToBalance`（改用余额）的可能性，
 *    而 `switch-to-balance` 自己会先释放微信占位再扣余额 —— 提前释放反而会让"改用余额"失效。
 */
onUnload(() => {
  // ⚠️⚠️ 2026-09-30 修 **ReferenceError（用户报障根因）**：
  //    此处原先直接引用 `currentOrderId`，但它只是 `completePayment` / `submitPay` /
  //    `refreshPaymentStatus` 等函数的**局部参数**，**不是页面级变量**
  //    ⇒ 每次离开本页都抛 `ReferenceError: currentOrderId is not defined`（真机堆栈指向本行）。
  //    后果：`onUnload` 在抛错处**中断** ⇒ 支付成功后 `redirectTo` 的卸载/跳转流程异常
  //    ⇒ 用户表现为「**付完款卡在确认订单页**」，进而**重复下单**（本次事故连下三单）。
  //    页面级保存订单号的是 `orderId`（ref）⇒ 这里必须取 `orderId.value`。
  //    ⚠️ 同类误用本文件共 **2 处**（另一处见 `selectPayMethod` 的 switchToWechat 分支），已一并修正。
  const unloadingOrderId = orderId.value
  if (!unloadingOrderId || paymentSucceeded.value) return
  void releasePayChannel(unloadingOrderId).catch(() => { /* 静默：释放失败最坏只是多等一次自动清理 */ })
})

/** 页面重新显示时关闭残留的发票抽屉；并从「配送地址」页读回刚保存的地址草稿。 */
onShow(() => {
  invoiceDrawerVisible.value = false
  try {
    const draft = uni.getStorageSync(ADDRESS_DRAFT_KEY) as Address | ''
    if (draft && typeof draft === 'object') {
      selectedAddress.value = {
        name: draft.name || '',
        phone: draft.phone || '',
        detail: draft.detail || '',
        province: draft.province || '',
        city: draft.city || '',
        district: draft.district || '',
        // ⛔ 坐标与**来源**一起取（all-or-nothing）：草稿里"有坐标没来源"（升版前写入）⇒ 当作没有坐标
        ...trustedCoordinateFields(draft),
      }
      uni.removeStorageSync(ADDRESS_DRAFT_KEY)
      // 地址变了，同城配送费/距离要重算
      void refreshDeliveryQuote()
    }
  } catch { /* 忽略 */ }
})

onMounted(() => {
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect) {
      menuTop.value = rect.top
      menuHeight.value = rect.height
    }
  } catch (error) {
    console.warn('获取微信胶囊位置失败', error)
  }
  // 待付款订单的支付倒计时：每秒刷新基准时间
  countdownTimer = setInterval(() => { now.value = Date.now() }, 1000)
})

onUnmounted(() => {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
})

/** 切换配送方式，保留两种方式下已经填写的本地内容。 */
function changePickupType(type: PickupType): void {
  // 商品级配送开关：该方式被已选商品禁用时不允许切换，用 toast 说清原因（与「超出同城范围」同一套做法）
  const blockedReason = deliveryOptions.value.find((option) => option.type === type)?.blockedReason
  if (blockedReason) {
    uni.showToast({ title: blockedReason, icon: 'none' })
    return
  }
  // 同城配送：当前定位送不到就拦下给提示（选项本身是置灰样式，但仍可点，点了要说明原因）
  if (type === 2 && !sameCityAvailable.value) {
    uni.showToast({ title: '当前定位超出同城配送范围，请选择其他配送方式', icon: 'none' })
    return
  }
  pickupType.value = type
  // 之前定位失败过：切到同城时再补一次（用户可能刚在系统里打开定位）；最多补一次，避免反复弹授权框
  if (type === 2 && !userLocation.value && locationAttempts < 2) {
    void prepareSameCity()
  }
}

/**
 * 配送方式叠加过滤后的自动校正（模块开关 + 商品级开关）：
 * 当前方式被任一层过滤掉时，自动切到第一个**真正可选**的方式（如只买自提则默认自提）；
 * 一个可选方式都没有时保持当前值不动 —— 绝不自动切到已被过滤掉的方式，
 * 由 productDeliveryHint 提示 + 提交前拦截兜住。
 */
function applyModuleFilter(): void {
  const usable = deliveryOptions.value.filter((option) => !option.blockedReason)
  if (usable.some((option) => option.type === pickupType.value)) return
  if (usable.length > 0) pickupType.value = usable[0].type
}

// 模块开关或已选商品的配送开关变化后都要重新校正（商品开关要等购物车/商品详情加载完才有值）
watch(deliveryOptions, () => applyModuleFilter())

/** 读取钱包余额，供余额支付选项展示与可用性判断。 */
async function loadBalance(): Promise<void> {
  try {
    walletBalance.value = Number((await getWalletInfo()).balance || 0)
  } catch {
    walletBalance.value = 0
  }
}

/**
 * 选择支付方式；余额不足时禁止切到余额支付并引导微信。
 *
 * ⚠️ 2026-09-29 第十二批：**从「余额支付」切回「微信支付」时要通知后端**。
 * 余额通道一旦被占用，不切走的话微信侧会一直报「已选择余额支付」——
 * 第十二批之前该占用**永不过期**（后端从不清理），会造成永久死锁；
 * 现在后端每分钟自动清理，但仍应**主动切换**，别让用户干等。
 * ⚠️ 后端 `switch-to-wechat` 幂等、且会先确认支付状态，重复/多余调用都安全。
 */
function selectPayMethod(method: PayMethod): void {
  if (method === 'balance' && !balanceEnough.value) {
    uni.showToast({ title: '余额不足，请使用微信支付', icon: 'none' })
    return
  }
  const previous = payMethod.value
  payMethod.value = method
  // ⚠️ 2026-09-30 修 **ReferenceError（与 onUnload 同一类作用域误用）**：
  //    此处原先也引用了不存在的 `currentOrderId` ⇒ 每次从「余额」切回「微信」都抛错，
  //    导致 `switchToWechat` **永远不会被调用** ——
  //    也就是说「切回微信时通知后端释放余额占位」这件事**从接入起就没生效过**，
  //    只能依赖后端每分钟的自动清理（第十二批加这个调用正是为了主动释放）。
  const switchingOrderId = orderId.value
  if (previous === 'balance' && method === 'wechat' && switchingOrderId && !paymentSucceeded.value) {
    // 切换失败**不阻断**：用户仍可直接走微信支付，后端会自行清理残留占用
    void switchToWechat(switchingOrderId).catch(() => { /* 静默：释放/切换失败最坏只是多等一次自动清理 */ })
  }
}

/**
 * 打开「配送地址」**独立页面**。
 * 原方案是弹层，但弹层里塞不下「省市区选择 + 自动定位 + 地图选点」，
 * 说明文字还会被挤到表单下方（2026-09-19 用户要求改成整页）。
 * 当前地址写进 storage 作为草稿，页面保存后返回，由 onShow 读回。
 */
function openAddressEditor(): void {
  stashAddressDraft()
  // ⚠️ 必须带 mode=payment（2026-09-22 修）：不带参数时地址页按「地址簿模式」走 ——
    // 保存只写后端、不写 ADDRESS_DRAFT_KEY 草稿，也不渲染「选择已有地址」入口，
    // 于是结算页既选不了地址、也不会自动回填（真机反馈）。
    uni.navigateTo({ url: '/subpkg-order/address/edit?mode=payment' })
}

/** 把当前地址写进草稿 storage（供地址页回填；没有地址就清掉，避免上一单的地址串进这一单）。 */
function stashAddressDraft(): void {
  try {
    if (selectedAddress.value) uni.setStorageSync(ADDRESS_DRAFT_KEY, selectedAddress.value)
    else uni.removeStorageSync(ADDRESS_DRAFT_KEY)
  } catch { /* 忽略 */ }
}

/**
 * **可执行**入口：直达地址页的**地图选点**（`pick=map`）。
 *
 * 用途：同城配送试算因为「没有可信坐标」/「坐标无效」失败时，光有一句提示不够 ——
 * 用户点这个按钮直接进地址页并把地图选点拉起来，选完返回即可重算
 * （草稿里带着当前地址，用户取消选点也不会丢内容）。
 */
function openAddressMapPicker(): void {
  stashAddressDraft()
  uni.navigateTo({ url: '/subpkg-order/address/edit?mode=payment&pick=map' })
}

/**
 * 校验并保存本地地址（**历史遗留：原「配送地址」弹层用的，模板已删除 ⇒ 目前不可达**）。
 *
 * ⛔ 2026-10-08：不再从这里带坐标（原 `...addressForm.latitude ? { latitude } : {}` 已删除）——
 *    该弹层的坐标只可能来自自动定位（来源是白名单外的 `AUTO_LOCATE`），属于"来路不明的坐标"。
 *    同城配送的坐标一律由地址页「地图选点」写入并带 `MAP_PICK` 来源（见 `trustedCoordinateFields`）。
 */
function saveAddress(): void {
  const name = validateText(addressForm.name, { label: '收货人姓名', maxLength: PAYMENT_CONTACT_NAME_MAX_LENGTH })
  const phone = validateMobile(normalizeEditableMobile(addressForm.phone))
  const detail = validateText(addressForm.detail, { label: '详细地址', maxLength: PAYMENT_ADDRESS_MAX_LENGTH })
  if (!name.ok) {
    uni.showToast({ title: name.message, icon: 'none' })
    return
  }
  if (!phone.ok) {
    uni.showToast({ title: phone.message, icon: 'none' })
    return
  }
  if (!detail.ok) {
    uni.showToast({ title: detail.message, icon: 'none' })
    return
  }
  selectedAddress.value = {
    name: name.value,
    phone: phone.value,
    detail: detail.value,
    province: addressForm.province,
    city: addressForm.city,
    district: addressForm.district,
  }
  addressSheetVisible.value = false
  // 地址变化后重算同城配送费（试算 watch 也会兜一次，这里显式调一次让反馈更即时）
  void refreshDeliveryQuote()
}

/** 打开本地门店选择抽屉。 */
function openShopPicker(): void {
  shopSheetVisible.value = true
}

/** 保存本地选择的门店。 */
function chooseShop(shop: EnabledShop): void {
  selectedShop.value = shop
  shopSheetVisible.value = false
}

/** 展开发票区域；需要发票时继续打开填写抽屉。 */
function toggleInvoice(): void {
  invoiceExpanded.value = !invoiceExpanded.value
}

/** 设置是否需要发票，并在开启时进入发票填写流程。 */
function setInvoiceEnabled(enabled: boolean): void {
  invoiceEnabled.value = enabled
  invoiceExpanded.value = true
  if (enabled) {
    invoiceSaved.value = false
    invoiceDrawerVisible.value = true
  } else {
    invoiceSaved.value = false
    invoiceDrawerVisible.value = false
  }
}

/** 切换个人或公司发票类型。 */
function changeInvoiceType(type: InvoiceType): void {
  invoiceType.value = type
  invoiceSaved.value = false
}

/** 校验并保存发票信息。 */
function normalizeInvoiceForm(): boolean {
  const email = validateEmail(invoiceForm.email)
  if (!email.ok || email.value.length > PAYMENT_INVOICE_EMAIL_MAX_LENGTH) {
    uni.showToast({ title: email.ok ? '电子邮箱不能超过254个字符' : email.message, icon: 'none' })
    return false
  }
  if (invoiceType.value === 'personal') {
    const name = validateText(invoiceForm.name, { label: '发票姓名', maxLength: PAYMENT_CONTACT_NAME_MAX_LENGTH })
    if (!name.ok) {
      uni.showToast({ title: name.message, icon: 'none' })
      return false
    }
    invoiceForm.name = name.value
    invoiceForm.email = email.value
    invoiceForm.companyName = cleanText(invoiceForm.companyName)
    invoiceForm.taxNumber = cleanText(invoiceForm.taxNumber).replace(/\s+/g, '').toUpperCase()
    return true
  }

  const companyName = validateText(invoiceForm.companyName, { label: '公司名称', maxLength: PAYMENT_INVOICE_COMPANY_MAX_LENGTH })
  const taxNumber = validateTaxNumber(invoiceForm.taxNumber)
  if (!companyName.ok) {
    uni.showToast({ title: companyName.message, icon: 'none' })
    return false
  }
  if (!taxNumber.ok) {
    uni.showToast({ title: taxNumber.message, icon: 'none' })
    return false
  }
  invoiceForm.name = cleanText(invoiceForm.name)
  invoiceForm.companyName = companyName.value
  invoiceForm.taxNumber = taxNumber.value
  invoiceForm.email = email.value
  return true
}

function completeInvoice(): void {
  if (!normalizeInvoiceForm()) return
  invoiceSaved.value = true
  invoiceDrawerVisible.value = false
}

/** 关闭发票抽屉，不清除已填写的本地内容。 */
function closeInvoiceDrawer(): void {
  invoiceDrawerVisible.value = false
}

/** 最终校验结算页所有用户输入，防止缓存或绕过抽屉直接提交脏值。 */
function validateCheckoutInputs(isExistingOrder: boolean): boolean {
  const normalizedRemark = validateText(remark.value, { label: '订单备注', maxLength: PAYMENT_REMARK_MAX_LENGTH, required: false })
  if (!normalizedRemark.ok) {
    uni.showToast({ title: normalizedRemark.message, icon: 'none' })
    return false
  }
  remark.value = normalizedRemark.value

  if (!isExistingOrder && pickupType.value === 0 && selectedAddress.value) {
    const name = validateText(selectedAddress.value.name, { label: '收货人姓名', maxLength: PAYMENT_CONTACT_NAME_MAX_LENGTH })
    const phone = validateMobile(normalizeEditableMobile(selectedAddress.value.phone))
    const detail = validateText(selectedAddress.value.detail, { label: '详细地址', maxLength: PAYMENT_ADDRESS_MAX_LENGTH })
    if (!name.ok) {
      uni.showToast({ title: name.message, icon: 'none' })
      return false
    }
    if (!phone.ok) {
      uni.showToast({ title: phone.message, icon: 'none' })
      return false
    }
    if (!detail.ok) {
      uni.showToast({ title: detail.message, icon: 'none' })
      return false
    }
    selectedAddress.value = { name: name.value, phone: phone.value, detail: detail.value }
  }

  if (!isExistingOrder && pickupType.value === 1) {
    const name = validateText(contactName.value, { label: '自提联系人姓名', maxLength: PAYMENT_CONTACT_NAME_MAX_LENGTH })
    const phone = validateMobile(contactPhone.value, '自提联系人手机号')
    if (!name.ok) {
      uni.showToast({ title: name.message, icon: 'none' })
      return false
    }
    if (!phone.ok) {
      uni.showToast({ title: phone.message, icon: 'none' })
      return false
    }
    contactName.value = name.value
    contactPhone.value = phone.value
  }

  if (invoiceEnabled.value && invoiceSaved.value && !normalizeInvoiceForm()) return false
  return true
}

/**
 * 商品级「配送方式」开关的下单拦截码 → 用户可读文案（`13023` 自提 / `13024` 物流·同城）。
 *
 * ⚠️ 2026-09-29 第十二批：后端已把 `13024` 的文案**按三档精准化**
 * （自提被拦 / **同城被拦** / 物流被拦各一句）⇒ 这里**优先让后端文案透出**。
 * 此前是"本地常量直接覆盖后端"，会把后端那句精准文案盖成笼统的「不支持物流/同城配送」✗。
 * ⇒ 仅当后端**没给** message 时才退回本地常量兜底。
 * 返回空串表示不是这两类错误，交给调用方继续按原文案处理。
 */
function productDeliveryErrorMessage(code: number, backendMessage?: string): string {
  const fallback = code === PRODUCT_PICKUP_BLOCKED_CODE
    ? PRODUCT_PICKUP_BLOCKED_MESSAGE
    : code === PRODUCT_DELIVERY_BLOCKED_CODE
      ? PRODUCT_DELIVERY_BLOCKED_MESSAGE
      : ''
  if (!fallback) return ''
  return (backendMessage || '').trim() || fallback
}

/** 将红包商品购买机会错误转换为面向用户的业务提示。 */
function getPaymentErrorMessage(error: unknown): string {
  // 后端历史文案仍可能下发旧词（业务已统一改称「红包」）：先归一化，再做关键词匹配与展示，确保用户看不到旧词。
  // ⚠️ 2026-09-27：改用 utils/request 的统一实现，此前这里自己写了一份 `.replace(/旧词/g,'红包')` —— 那份会
  // 把「「部分」+「红包」」毁成「部红包包」，也会把后端的「旧词+红包」变成「红包红包」（今华有肽已踩过同样两个坑）。
  const message = normalizeLegacyWording(error instanceof Error ? error.message : '')
  // 商品级配送开关：⚠️ 2026-09-29 第十二批起**优先用后端文案** ——
  // 后端已把 13024 按「自提 / 同城 / 物流」三档精准化，用本地常量覆盖会把精准文案盖成笼统一句。
  // 只有后端没给 message 时才退回本地兜底常量。
  if (isApiRequestError(error)) {
    const deliveryMessage = productDeliveryErrorMessage(error.code, message)
    if (deliveryMessage) return deliveryMessage
  }
  if (message.includes('购买机会不足') || message.includes('无法购买该红包商品')) {
    return '一个账号一个补贴周期内最多同时存在三件商品哦'
  }
  return message || '支付未完成'
}

/** 仅将微信收银台明确返回的取消视为可切换，网络/系统错误不能直接切余额。 */
function isWechatPaymentCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return /(cancel|user_cancel|取消|关闭|返回)/i.test(message)
}

/** 余额支付切换的业务码；同时兼容旧后端仅返回提示文案的版本。 */
function isBalanceInsufficientError(error: unknown): boolean {
  return (isApiRequestError(error) && error.code === 7000)
    || (error instanceof Error && error.message.includes('余额不足'))
}

/** 订单进入已支付及后续履约状态后，不再允许重复支付。 */
function isOrderPaid(status: unknown): boolean {
  return [1, 2, 3, 4, 8].includes(Number(status))
}

/**
 * 支付成功后，**尽最大努力**跳到订单详情页。
 *
 * ## ⚠️⚠️ 为什么需要这么"兜"（2026-10-01 经 7 轮真机排查得出）
 *
 * 本页在「刚完成支付」这个时刻调 uni 的路由 API，会反复抛
 * `Cannot read properties of undefined (reading 'index')`：
 * - 栈**全部落在本分包产物**（`subpkg-order/app-service.js` / `payment.js`），
 *   而**全项目源码搜 `.index` 零命中** ⇒ 是打包进来的 **uni/Vue 页面运行时**在读它；
 * - 报错**位置每次都不一样**（观测到列号 `20240 / 20643 / 20646 / 20927 / 20950 / 21198`，
 *   覆盖 `showToast` / `redirectTo` / `navigateTo` / `setTimeout` 内）⇒
 *   **不是"某个 API 用错了"，而是这个时刻的页面栈上下文整体不可靠**；
 * - ⚠️⚠️ **最要命的一点**：这些 API 是**同步抛错**的，而 `fail` 回调**不会触发**
 *   ⇒ 原来那套 `navigateTo → redirectTo → reLaunch` 的 `fail` 降级链**形同虚设**；
 * - ⚠️ 且未捕获的异常会被**微信自动弹窗**展示给用户（截图里那个英文弹窗就是它，
 *   不是我们的 `showModal`）。
 *
 * ⇒ 因此改为：**逐个 API 都就地 `try/catch`**，任何一个"受理成功"（同步没抛）就停止；
 *   若同步抛错则试下一个；三个都抛错才提示用户（并强调钱已付、勿重复支付）。
 *   ⚠️ 同时也接 `fail` 回调：偏好 API **同步没抛但异步失败**的情况也能继续往下试。
 */
function jumpToOrderDetail(detailUrl: string): void {
  // ⚠️ 顺序按"页面栈操作从小到大"排：`navigateTo` 只 push、`redirectTo` 关当前页、
  //    `reLaunch` 清空整个栈 —— 操作越少越不容易踩到上面那个上下文问题。
  const attempts: ReadonlyArray<{ name: string; run: (onFail: () => void) => void }> = [
    { name: 'navigateTo', run: (onFail) => uni.navigateTo({ url: detailUrl, fail: onFail }) },
    { name: 'redirectTo', run: (onFail) => uni.redirectTo({ url: detailUrl, fail: onFail }) },
    { name: 'reLaunch', run: (onFail) => uni.reLaunch({ url: detailUrl, fail: onFail }) },
  ]

  /** 从第 index 个开始尝试；全部失败则提示"钱已付"。 */
  const attemptAt = (index: number): void => {
    if (index >= attempts.length) {
      // ⚠️ 三个路由 API 都失败：页面栈上下文已坏，只能明确告知（防止用户重复支付）
      try {
        uni.showModal({
          title: '支付已完成',
          content: '订单已支付成功，但页面跳转失败。请返回「我的订单」查看，切勿重复支付。',
          showCancel: false,
          confirmText: '知道了',
        })
      } catch (error) {
        // 连提示都失败就只能记日志了 —— 支付结果本身已经成功，不再上抛
        recordPayError(error, { step: 'paid-modal-throw', nonFatal: true, paidAlready: true })
      }
      return
    }
    const attempt = attempts[index]
    try {
      attempt.run(() => attemptAt(index + 1))
    } catch (error) {
      // ⚠️ **同步抛错**（真机上的实际表现）：`fail` 不会触发，只能在这里接着试下一个
      recordPayError(error, { step: `jump-${attempt.name}-throw`, nonFatal: true, paidAlready: true })
      attemptAt(index + 1)
    }
  }

  attemptAt(0)
}

/** 统一提交支付成功后的发票，并按支付来源决定留在当前页还是跳转订单详情。 */
async function completePayment(currentOrderId: string, stayOnPage: boolean): Promise<void> {
  // ⚠️ 2026-09-30：**第一件事就上锁** —— 支付到此已成功，无论后续发票/跳转是否顺利，
  //    都不允许再提交一次支付（详见 `paymentFinalized` 的注释）。
  paymentFinalized.value = true
  let invoiceError: unknown = null
  if (invoiceEnabled.value) {
    try {
      const detail = existingOrder.value?.orderNo ? existingOrder.value : await getOrderDetail(currentOrderId)
      if (!detail.orderNo) throw new Error('订单号获取失败')
      await submitInvoice({
        type: invoiceType.value === 'company' ? 2 : 1,
        ...(invoiceType.value === 'company'
          ? { companyName: invoiceForm.companyName.trim(), taxNo: invoiceForm.taxNumber.trim() }
          : { personalName: invoiceForm.name.trim() }),
        email: invoiceForm.email.trim(),
        orderIds: detail.orderNo,
      })
    } catch (error) { invoiceError = error }
  }

  canSwitchToBalance.value = false
  wechatPaymentStarted.value = false
  /**
   * ⚠️⚠️ 2026-10-01 **收敛版**（经 5 轮真机排查后的最终结论）
   *
   * 已确认的事实：
   *   · `uni.showToast` 与 `uni.redirectTo` 在这个时机**都会**抛
   *     `Cannot read properties of undefined (reading 'index')`（真机列 `20247` / `21198`）；
   *   · 该错误来自 **uni ↔ 微信基础库的桥接层**（栈里有 `lib/WASubContext.js`），**与业务无关**；
   *   · ⚠️ 前几轮我给它们加 try/catch、加"是否已跳走"判断、加降级链，
   *     **反而把跳转弄坏了**（用户反馈「**之前能跳**」⇒ 旧版只有 `fail` 回调、反而正常）。
   *
   * ⇒ 本次收敛为**最小改动**，逐条对应上面的教训：
   *   ① `paymentSucceeded = stayOnPage` —— **恢复旧版语义**，不再在跳转前整页切成成功态
   *      （那会把 `v-else` 的结算页整块销毁重建，与即将发生的路由切换打架）；
   *   ② `showToast` **仍包** try/catch，但目的只是**让流程继续往下走** ——
   *      它抛错会中断本函数，导致后面的跳转**压根执行不到**（这正是"之前不跳"的原因之一）；
   *   ③ `redirectTo` **不包** try/catch，只用 `fail` 回调降级 ——
   *      `fail` 是"路由是否成功"的**权威信号**；而 try/catch 抓的是"同步抛错"，
   *      真机上它常常"**抛错但已经跳成功**"，包住它就会误判并重复跳；
   *   ④ 那条桥接层噪音由 `App.vue` 的 `onError` **统一过滤**，不再打扰排查。
   */
  paymentSucceeded.value = stayOnPage
  try {
    uni.showToast({ title: invoiceError ? '支付成功，发票申请失败' : '支付成功', icon: invoiceError ? 'none' : 'success' })
  } catch (error) {
    // ⚠️ **吞掉但继续**：否则中断本函数，下面那段跳转就执行不到了
    recordPayError(error, { step: 'complete-payment-showtoast', nonFatal: true, paidAlready: true })
  }
  if (!stayOnPage) {
    const detailUrl = `/subpkg-order/orders/detail?orderId=${currentOrderId}`
    // ⚠️ 先切「支付成功」态：既给用户明确反馈（此场景 toast 不可用，见上方注释），
    //    又**禁掉支付按钮** —— 防止用户停在结算页再次点击支付（重复下单风险）。
    paymentSucceeded.value = true
    jumpToOrderDetail(detailUrl)
    return
  }

  try { existingOrder.value = await getOrderDetail(currentOrderId) } catch { /* 支付已成功，订单刷新失败不阻断结果展示 */ }
}

/** 微信支付结果异常时查询订单，避免把未知状态误判为未支付。 */
async function refreshPaymentStatus(currentOrderId: string, fallbackMessage: string): Promise<void> {
  try {
    const detail = await getOrderDetail(currentOrderId)
    existingOrder.value = detail
    if (isOrderPaid(detail.status)) {
      await completePayment(currentOrderId, true)
      return
    }
  } catch { /* 订单查询失败时保留兜底提示 */ }
  uni.showToast({ title: fallbackMessage, icon: 'none' })
}

/** 用户确认切换后调用后端安全接口，不直接调用旧余额支付接口。 */
async function switchToBalancePayment(): Promise<void> {
  const currentOrderId = orderId.value
  if (!currentOrderId || switchingToBalancePayment.value || paymentSucceeded.value) return
  if (!balanceEnough.value) {
    canSwitchToBalance.value = false
    payMethod.value = 'wechat'
    uni.showToast({ title: '余额不足，请重新选择微信支付', icon: 'none' })
    return
  }

  switchingToBalancePayment.value = true
  try {
    await switchToBalance(currentOrderId)
    await completePayment(currentOrderId, true)
  } catch (error) {
    canSwitchToBalance.value = false
    if (isApiRequestError(error) && error.code === 4001) {
      await refreshPaymentStatus(currentOrderId, '微信支付已成功，请刷新订单状态')
    } else if (isApiRequestError(error) && error.code === 5000) {
      uni.showToast({ title: '微信支付状态确认中，请稍后查询', icon: 'none' })
    } else if (isBalanceInsufficientError(error)) {
      wechatPaymentStarted.value = false
      payMethod.value = 'wechat'
      uni.showToast({ title: '余额不足，请重新选择微信支付', icon: 'none' })
    } else {
      uni.showToast({ title: getPaymentErrorMessage(error), icon: 'none' })
    }
  } finally {
    switchingToBalancePayment.value = false
  }
}

/** 校验结算信息，创建订单后获取支付签名并调起微信支付。 */
/**
 * 记录支付链路异常（真机排查用）。
 *
 * ⚠️⚠️ 2026-10-01 诊断（用户反馈「**使用余额支付时**弹
 * `Cannot read properties of undefined (reading 'index')`」）：
 *
 *    `submitPayment` 的 `catch` 会**把异常吞掉并转成 toast** ⇒
 *    `App.vue` 的 `onError`（**只收"未处理的错误"**）**永远看不到它**
 *    ⇒ 这正是此前一直拿不到堆栈、只能靠猜的原因。
 *
 * ⇒ 所以在这里**展示给用户之前**，先把**完整堆栈 + 出错时的上下文**塞进本地缓存。
 *    真机复现后取回方式（开发者工具 Console 里执行，或在同一个小程序里加个临时按钮）：
 *
 * ```js
 * uni.getStorageSync('__last_pay_error__')
 * ```
 *
 * ⚠️ 该 key 与 `App.vue` 的 `__last_app_error__` **刻意分开**：
 *    那个是全局未处理错误，这个是"被支付流程捕获"的错误，来源不同、混在一起会互相覆盖。
 */
function recordPayError(error: unknown, context: Record<string, unknown>): void {
  try {
    const payload = {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : '(无 stack)',
      context,
      // 页面栈快照：能看出是否与"页面已卸载/栈已满"有关
      pages: (() => {
        try {
          return getCurrentPages().map((page) => page?.route || '?').join(' > ')
        } catch {
          return '(取不到页面栈)'
        }
      })(),
      at: new Date().toISOString(),
    }
    console.error('[pay-error]', payload)
    uni.setStorageSync('__last_pay_error__', payload)
  } catch {
    // ⚠️ 记录本身失败绝不能影响支付主流程
  }
}

async function submitPayment(): Promise<void> {
  // ⚠️ 2026-09-30：`paymentFinalized` 是「支付已收尾」的**同步锁** ——
  //    原先只看 `paying`，而它在支付成功后会被 `finally` 立刻置回 false（此时页面还没跳走）
  //    ⇒ 存在约 0.5s 可重复提交的窗口（详见 `paymentFinalized` 注释）。
  if (paying.value || paymentFinalized.value) return
  const isExistingOrder = Boolean(orderId.value)
  if (!items.value.length && !isExistingOrder) {
    uni.showToast({ title: '没有可结算的商品', icon: 'none' })
    return
  }
  if (!isExistingOrder && getDividendQuantity(items.value) > DIVIDEND_PURCHASE_LIMIT) {
    uni.showToast({ title: PURCHASE_LIMIT_MESSAGE, icon: 'none' })
    return
  }
  if (!isExistingOrder && deliveryOptions.value.length === 0) {
    uni.showToast({ title: '当前未开通配送方式，暂无法下单', icon: 'none' })
    return
  }
  // 商品级配送开关（2026-09-22）：先拦「整批商品任何方式都不支持」，再拦「当前方式被商品开关过滤」，
  // 文案与后端 13023/13024 一致，避免用户提交后只看到一句错误码提示
  if (!isExistingOrder && noSupportedDeliveryMethod.value) {
    uni.showToast({ title: `${PRODUCT_DELIVERY_NONE_MESSAGE}，请返回购物车调整商品`, icon: 'none' })
    return
  }
  if (!isExistingOrder && currentPickupBlockedReason.value) {
    uni.showToast({ title: currentPickupBlockedReason.value, icon: 'none' })
    return
  }
  if (!isExistingOrder && pickupType.value === 0 && !selectedAddress.value) {
    uni.showToast({ title: '请先添加配送地址', icon: 'none' })
    openAddressEditor()
    return
  }
  if (!isExistingOrder && pickupType.value === 1 && !selectedShop.value) {
    uni.showToast({ title: '请选择自提门店', icon: 'none' })
    openShopPicker()
    return
  }
  if (!isExistingOrder && pickupType.value === 1 && (!contactName.value.trim() || !contactPhone.value.trim())) {
    uni.showToast({ title: '请填写完整的自提联系方式', icon: 'none' })
    return
  }
  // 同城配送：必须先选发货门店、填完整收货地址（含省市区，后端按完整地址与坐标配送）
  if (!isExistingOrder && pickupType.value === 2 && !selectedShop.value) {
    uni.showToast({ title: '请选择发货门店', icon: 'none' })
    openShopPicker()
    return
  }
  if (!isExistingOrder && pickupType.value === 2 && !selectedAddress.value) {
    uni.showToast({ title: '请先添加配送地址', icon: 'none' })
    openAddressEditor()
    return
  }
  if (!isExistingOrder && pickupType.value === 2 && selectedAddress.value
    && !(selectedAddress.value.province && selectedAddress.value.city && selectedAddress.value.district)) {
    uni.showToast({ title: '请在配送地址里补全所在地区', icon: 'none' })
    openAddressEditor()
    return
  }
  // ⚠️ 2026-10-08 新增：同城配送**必须有真实收货坐标** —— 没有就绝不放行。
  //    不能依赖上面那条「试算返回不可送」的拦截：无坐标时我们**故意不试算**（deliveryQuote 为 null），
  //    那条拦截的 `deliveryQuote.value &&` 条件会短路，等于放行。
  //    ⚠️ 坐标"不真实"包含**没有可信来源**（旧缓存 / 地址簿选回）—— `addressCoords` 已按白名单门禁过滤。
  if (!isExistingOrder && pickupType.value === 2 && selectedAddress.value && !addressCoords.value) {
    uni.showToast({ title: ADDRESS_NEEDS_MAP_PICK_TEXT, icon: 'none' })
    // 提示之后**直接**把用户送进地图选点（可执行），别让他自己找入口
    openAddressMapPicker()
    return
  }
  // 试算说不可送就不放行（超配送范围 / 门店未开配送等），提示以后端 reason 为准。
  // ⚠️ 2026-10-08：这里**不看失败码的类别** —— 走到这里时用户已经给出**可信来源**的收货坐标，
  //    `canDelivery=false` 就是后端对该门店/该地址的**权威结论**（类别①与类别②都拦：
  //    类别②的出路是让用户去地图选点，而"选了点仍然 false"依旧不能放行）。
  //    类别分流只作用于**预试算**（进页面用当前位置试算，无可信来源）：那里绝不能用
  //    "不确定"结论去置灰整个同城配送（回执 §三）。
  if (!isExistingOrder && pickupType.value === 2 && deliveryQuote.value && deliveryQuote.value.canDelivery === false) {
    uni.showToast({ title: quoteError.value || '该地址超出配送范围', icon: 'none' })
    return
  }
  if (!validateCheckoutInputs(isExistingOrder)) {
    return
  }
  if (invoiceEnabled.value && !invoiceSaved.value) {
    invoiceDrawerVisible.value = true
    invoiceExpanded.value = true
    return
  }
  paying.value = true
  /**
   * ⚠️⚠️ 2026-10-01 **分步埋点**（真机排查 `Cannot read properties of undefined (reading 'index')`）。
   *
   * 为什么需要它：
   *   · 真机堆栈指向**压缩产物** `subpkg-order/app-service.js:1779:20240`
   *     （该行有两万多字符，无法直接阅读，也没有上传 Source Map）；
   *   · 而**源码里搜不到任何 `.index`**（全项目 `.index` 零命中）⇒ 静态推断已到极限。
   * ⇒ 用「步骤名」把范围缩到**具体哪一次调用**：复现后看 `__last_pay_error__.context.step`
   *    就知道炸在 `create-order` / `balance-pay` / `complete-payment` 中的哪一步。
   */
  let payStep = 'start'
  try {
    payStep = 'read-order-id'
    let currentOrderId = orderId.value
    if (!currentOrderId) {
      // 立即购买走直接下单（items），购物车结算走 cartIds，二者互斥避免把购物车其他商品带入
      const isDirectBuy = Boolean(directSkuId.value && directProductId.value)
      payStep = 'create-order'
      const created = await createOrder({
        ...(isDirectBuy
          ? { items: [{ skuId: directSkuId.value as number, quantity: directQuantity.value }] }
          : { cartIds: selectedCartIds.value }),
        pickupType: pickupType.value,
        ...((pickupType.value === 0 || pickupType.value === 2) && selectedAddress.value ? {
          receiverName: selectedAddress.value.name,
          receiverPhone: selectedAddress.value.phone,
          // 完整地址 = 省市区 + 详细地址；没填省市区时退化成原来的「只有详细地址」
          receiverAddress: fullAddress(selectedAddress.value) || selectedAddress.value.detail,
          ...(selectedAddress.value.province ? { receiverProvince: selectedAddress.value.province } : {}),
          ...(selectedAddress.value.city ? { receiverCity: selectedAddress.value.city } : {}),
          ...(selectedAddress.value.district ? { receiverDistrict: selectedAddress.value.district } : {}),
        } : {}),
        ...(pickupType.value === 1 && selectedShop.value ? { pickupShopId: selectedShop.value.id, receiverName: contactName.value.trim(), receiverPhone: contactPhone.value.trim() } : {}),
        ...(pickupType.value === 2 && selectedShop.value ? {
          // 发货门店：后端 OrderCreateDTO.merchantId 收的就是门店 ID
          merchantId: selectedShop.value.id,
          // ⚠️ 2026-10-08 修：同城坐标**只提交收货地址自身的真实定位**（见 addressCoords）。
          //    此前这里是「收货地址 ?? 当前位置 ?? 发货门店」三级兜底 —— 等于**伪造坐标**给后端
          //    （退到发货门店坐标时，后端拿门店自己的位置判「能否送到」，必然可送）。
          //    无坐标的情况在 submitPayment 里已被拦截（ADDRESS_NEEDS_MAP_PICK_TEXT），
          //    这里保持「有真实坐标才带」，绝不用别的位置顶上。
          // ⚠️ 2026-10-08 追补（后端 coordinateSource **必填**）：坐标与**来源**必须同时提交 ——
          //    所以三者写在**同一个对象字面量**里、共用**同一个条件**
          //    （`addressCoords` 已要求来源可信 ⇒ 单独发坐标/单独发来源都不可能发生）。
          ...(addressCoords.value && addressCoordinateSource.value
            ? {
                receiverLat: addressCoords.value.lat,
                receiverLng: addressCoords.value.lng,
                coordinateSource: addressCoordinateSource.value,
              }
            : {}),
        } : {}),
        ...(remark.value.trim() ? { remark: remark.value.trim() } : {}),
      })
      payStep = 'create-order-return'
      const id = created.orderId ?? created.id
      if (id == null) throw new Error('创建订单未返回订单 ID')
      currentOrderId = String(id)
      orderId.value = currentOrderId
    }
    if (payMethod.value === 'balance') {
      payStep = 'balance-pay'
      if (wechatPaymentStarted.value) {
        if (canSwitchToBalance.value) {
          payStep = 'switch-to-balance'
          await switchToBalancePayment()
        } else {
          uni.showToast({ title: '微信支付状态确认中，请稍后查询', icon: 'none' })
        }
        return
      }
      // 尚未拉起微信支付时，余额支付可直接走原有同步接口
      await payByBalance(currentOrderId)
      payStep = 'balance-pay-done'
    } else {
      payStep = 'wechat-prepay'
      // 微信支付：获取签名并调起微信收银台
      const prepay = await createPrepay(currentOrderId)
      wechatPaymentStarted.value = true
      payStep = 'wechat-request-payment'
      await requestPayment(prepay)
      payStep = 'wechat-payment-done'
    }
    payStep = 'complete-payment'
    await completePayment(currentOrderId, false)
    payStep = 'done'
  } catch (error) {
    // ⚠️ 2026-10-01：**先记诊断**再决定怎么提示 —— 本 catch 会吞掉异常，
    //    导致 `App.vue` 的 `onError` 拿不到它（详见 `recordPayError` 的注释）。
    recordPayError(error, {
      step: payStep,
      // ⚠️ 走到 `complete-payment` 才炸 ⇒ `payByBalance` 已成功、钱已扣，
      //    这是「收尾 UI 失败」而非「支付失败」，排查时必须区分开（见 completePayment 注释）
      paidAlready: payStep === 'complete-payment' || payStep === 'done',
      payMethod: payMethod.value,
      pickupType: pickupType.value,
      isExistingOrder: Boolean(orderId.value),
      wechatPaymentStarted: wechatPaymentStarted.value,
      invoiceEnabled: invoiceEnabled.value,
      itemCount: items.value.length,
    })
    if (wechatPaymentStarted.value && orderId.value) {
      if (isWechatPaymentCancelled(error)) {
        canSwitchToBalance.value = true
        payMethod.value = 'wechat'
        uni.showToast({ title: '微信支付已取消，可改用余额支付', icon: 'none' })
      } else {
        await refreshPaymentStatus(orderId.value, '支付结果未知，请稍后查询订单状态')
      }
      return
    }
    uni.showToast({ title: getPaymentErrorMessage(error), icon: 'none' })
  } finally { paying.value = false }
}

/** 取消当前待付款订单（二次确认后调用后端取消接口并返回）。 */
async function cancelExistingOrder(): Promise<void> {
  if (!orderId.value || paying.value) return
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({ title: '提示', content: '确定取消该订单吗？', success: (res) => resolve(res.confirm), fail: () => resolve(false) })
  })
  if (!confirmed) return
  paying.value = true
  try {
    await cancelOrder(orderId.value)
    uni.showToast({ title: '订单已取消', icon: 'success' })
    // ⚠️ 2026-10-01：原来这里是 `setTimeout(() => uni.navigateBack(), 500)` ——
    //    与支付跳转同一个坑：**在定时器回调里调路由 API** 会踩到
    //    `Cannot read properties of undefined (reading 'index')`（真机实测栈落
    //    `at <setTimeout callback function>`）。这里改成**直接返回**：
    //    代价只是 toast 可能来不及看清，而"返回成功"比"看全 toast"重要得多。
    uni.navigateBack()
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '取消订单失败', icon: 'none' })
  } finally { paying.value = false }
}

/** 返回购物车重新选择商品。 */
function backToCart(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1 })
    return
  }
  uni.switchTab({ url: '/pages/cart/cart' })
}
</script>

<template>
    <view class="pg">
      <view class="nav" :style="navStyle">
        <image class="brand-mark back-button" src="/static/left_arrow.png" mode="aspectFit" @click="backToCart" />
        <text class="nav-title">确认订单</text>
      </view>

    <view v-if="paymentSucceeded" class="payment-success-state">
      <view class="success-icon">✓</view>
      <text class="success-title">支付成功</text>
      <text class="success-description">订单已完成支付，当前页面不会自动退出</text>
    </view>

    <scroll-view
      v-else
      v-show="canRenderCheckout"
      class="content"
      scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false"
      :style="{ paddingTop: `${bodyTop}px` }"
    >
      <view class="section delivery-section">
        <text class="section-title">配送方式</text>
        <view class="pickup-options">
          <view
            v-for="option in deliveryOptions"
            :key="option.type"
            class="pickup-option"
            :class="{ active: pickupType === option.type, disabled: option.type === 2 && !sameCityAvailable }"
            :style="option.blockedReason ? 'opacity: 0.45' : ''"
            @click="changePickupType(option.type)"
          >
            <view class="radio" :class="{ active: pickupType === option.type }"><view class="radio-dot" /></view>
            <text>{{ option.label }}</text>
          </view>
        </view>
        <!-- 超出同城范围：把后端给的具体距离显示出来（toast 会被截断，这里不会） -->
        <text v-if="!sameCityAvailable" class="quote-error">{{ sameCityUnavailableReason }}，请选择其他配送方式</text>
        <!-- 商品级配送开关：哪些配送方式因为「商品不支持」被置灰（后端会以 13023/13024 拦，这里提前说明） -->
        <text v-if="productDeliveryHint" class="quote-error">{{ productDeliveryHint }}</text>
      </view>

      <view v-show="pickupType === 0 || pickupType === 2" class="section address-section">
        <view class="section-row" @click="openAddressEditor">
          <view>
            <view class="row-heading">
              <text class="section-title">配送信息</text>
              <text class="action-text">添加新地址</text>
            </view>
            <text v-if="selectedAddress" class="address-value">{{ selectedAddress.name }} {{ selectedAddress.phone }}</text>
            <text v-if="selectedAddress" class="address-detail">{{ selectedAddress.detail }}</text>
            <text v-else class="placeholder-text">请添加您的配送地址</text>
          </view>
          <text class="arrow">›</text>
        </view>
      </view>

      <view v-show="pickupType === 1" class="section pickup-section">
        <view class="section-row" @click="openShopPicker">
          <view>
            <text class="section-title">选择门店</text>
            <text v-if="selectedShop" class="address-value">{{ selectedShop.name }}</text>
            <text v-if="selectedShop" class="address-detail">{{ selectedShop.address }}</text>
            <text v-else class="placeholder-text">请选择门店地址</text>
          </view>
          <text class="arrow">›</text>
        </view>
      </view>

      <!-- 同城配送：发货门店（必选）+ 试算结果（配送费 / 距离 / 是否可送） -->
      <view v-show="pickupType === 2" class="section pickup-section">
        <view class="section-row" @click="openShopPicker">
          <view>
            <text class="section-title">发货门店<span class="required">*</span></text>
            <text v-if="selectedShop" class="address-value">{{ selectedShop.name }}</text>
            <text v-if="selectedShop" class="address-detail">{{ selectedShop.address }}</text>
            <text v-else class="placeholder-text">请选择发货门店</text>
          </view>
          <text class="arrow">›</text>
        </view>
        <text v-if="quoteError" class="quote-error">{{ quoteError }}</text>
        <text v-else-if="quoteLoading" class="quote-hint">配送费试算中...</text>
        <text v-else-if="deliveryQuote" class="quote-hint">距离 {{ formatDistance(deliveryQuote.distanceKm) }} · 预计 {{ deliveryQuote.estimatedDeliveryMinutes }} 分钟送达{{ quoteUsingShopFallback ? '（按发货门店估算）' : '' }}</text>
        <!-- 缺可信坐标 / 坐标无效（failCode=NO_COORDINATE / COORDINATE_INVALID）：给**可执行**入口 ——
             一键进地址页并把地图选点拉起来，而不是只丢一句提示让用户自己找 -->
        <view v-if="quoteNeedsMapPick" class="quote-action" @click="openAddressMapPicker">
          <text class="quote-action-text">去地图选点</text>
        </view>
      </view>

      <view v-show="pickupType === 1" class="section contact-section">
        <text class="section-title">联系方式</text>
        <view class="form-line">
          <text class="form-label">姓名<span class="required">*</span></text>
        <input v-model="contactName" class="form-input" maxlength="32" placeholder="请输入" placeholder-class="input-placeholder" />
        </view>
        <view class="form-line">
          <text class="form-label">手机号<span class="required">*</span></text>
          <input v-model="contactPhone" class="form-input" type="number" maxlength="11" placeholder="请输入" placeholder-class="input-placeholder" />
        </view>
      </view>

      <view class="section products-section">
        <text class="section-title">{{ items.length === 1 ? '一件商品' : `${items.length}件商品` }}</text>
        <view v-for="item in items" :key="item.cartId" class="product-row">
          <image v-if="item.productImage" class="product-image" :src="item.productImage" mode="aspectFill" />
          <view v-else class="product-image product-placeholder" />
          <view class="product-info">
            <text class="product-name">{{ item.productName }}</text>
            <text v-if="item.skuName && item.skuName !== '1'" class="product-spec">{{ item.skuName }}</text>
            <view class="product-bottom">
              <text class="quantity">数量：{{ item.quantity }}</text>
              <text class="product-price">¥ {{ formatMoney(productTotal(item)) }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="section amount-section">
        <view class="amount-row"><text>小计</text><text>¥{{ formatMoney(subtotal) }}</text></view>
        <view class="amount-row"><text>优惠券</text><text class="discount-text">-¥{{ formatMoney(discountAmount) }}</text></view>
        <view class="amount-row"><text>配送费</text><text>{{ pickupType === 1 ? '(门店自提) ' : '' }}¥{{ formatMoney(deliveryFee) }}</text></view>
        <view class="amount-row total-row"><text>合计</text><text>¥{{ formatMoney(total) }}</text></view>
      </view>

      <view class="section pay-method-section">
        <text class="section-title">支付方式</text>
        <view class="pay-method-options">
          <view class="pay-method-option" :class="{ active: payMethod === 'wechat' }" @click="selectPayMethod('wechat')">
            <view class="radio" :class="{ active: payMethod === 'wechat' }"><view class="radio-dot" /></view>
            <text>微信支付</text>
          </view>
          <view class="pay-method-option" :class="{ active: payMethod === 'balance', disabled: !balanceEnough }" @click="selectPayMethod('balance')">
            <view class="radio" :class="{ active: payMethod === 'balance' }"><view class="radio-dot" /></view>
            <text>余额支付（¥{{ formatMoney(walletBalance) }}）</text>
          </view>
        </view>
      </view>

      <view v-if="canSwitchToBalance" class="switch-balance-card">
        <view class="switch-balance-copy">
          <text class="switch-balance-title">微信支付已取消</text>
          <text class="switch-balance-description">可安全切换为余额支付，不会重复扣款</text>
        </view>
        <button class="switch-balance-button" :disabled="switchingToBalancePayment" @click="switchToBalancePayment">
          {{ switchingToBalancePayment ? '处理中...' : '改用余额支付' }}
        </button>
      </view>

      <view class="section invoice-section">
        <view class="section-row compact-row" @click="toggleInvoice">
          <text class="section-title">发票信息</text>
          <view class="row-summary"><text>{{ invoiceSummary }}</text><text class="plus">＋</text></view>
        </view>
        <view v-show="invoiceExpanded" class="invoice-options">
          <view class="invoice-option" :class="{ active: !invoiceEnabled }" @click="setInvoiceEnabled(false)">
            <view class="radio" :class="{ active: !invoiceEnabled }"><view class="radio-dot" /></view>
            <text>不需要发票</text>
          </view>
          <view class="invoice-option" :class="{ active: invoiceEnabled }" @click="setInvoiceEnabled(true)">
            <view class="radio" :class="{ active: invoiceEnabled }"><view class="radio-dot" /></view>
            <text>需要发票</text>
          </view>
        </view>
      </view>

      <view class="section remark-section">
        <view class="section-row compact-row" @click="remarkExpanded = !remarkExpanded">
          <text class="section-title">备注</text>
          <view class="row-summary"><text>{{ remarkSummary }}</text><text class="plus">＋</text></view>
        </view>
        <textarea
          v-show="remarkExpanded"
          v-model="remark"
          class="remark-input"
          maxlength="100"
          placeholder="请输入备注"
          placeholder-class="input-placeholder"
        />
      </view>
      <view class="content-bottom-space" />
    </scroll-view>

    <view v-show="loading" class="state-view"><text>加载中...</text></view>
    <view v-show="!loading && loadError" class="state-view">
      <text>订单商品加载失败</text>
      <text class="state-action" @click="reloadCheckout">重新加载</text>
    </view>
    <view v-show="!loading && !loadError && !items.length && !orderId" class="state-view">
      <text>没有可结算的商品</text>
      <text class="state-action" @click="backToCart">返回购物车</text>
    </view>

    <view v-show="canRenderCheckout && !paymentSucceeded" class="paybar">
      <view v-if="showCancelOrder" class="cancel-order" @click="cancelExistingOrder"><view class="cancel-icon" /><text>取消</text></view>
      <view class="total-block"><text class="currency">¥</text><text class="total-price">{{ formatMoney(total) }}</text><text v-if="!showCancelOrder" class="count-label">共{{ itemCount }}件</text></view>
      <view class="pay-now" :class="{ disabled: !items.length || paying || switchingToBalancePayment || payBlockedByProductDelivery }" @click="submitPayment">
        <text v-if="showCancelOrder && countdownText" class="countdown">{{ countdownText }}</text>
        <text>{{ paying || switchingToBalancePayment ? '处理中...' : '立即支付' }}</text>
      </view>
    </view>

    <view v-show="shopSheetVisible" class="mask" @click="shopSheetVisible = false">
      <view class="sheet shop-sheet" @click.stop>
        <view class="sheet-head"><text class="sheet-title">{{ shopSheetTitle }}</text><text class="sheet-close" @click="shopSheetVisible = false">×</text></view>
        <view v-for="shop in pickerShops" :key="shop.id" class="shop-option" :class="{ selected: selectedShop?.id === shop.id }" @click="chooseShop(shop)">
          <view class="shop-main">
            <text class="shop-name">{{ shop.name }}</text>
            <text class="shop-address">{{ shop.address }}</text>
            <!-- 距离与电话同一行：距离是新增的（算出来的直线距离），电话沿用原有字段 -->
            <view class="shop-meta">
              <text v-if="shopDistanceText(shop)" class="shop-distance-text">{{ shopDistanceText(shop) }}</text>
              <text class="shop-distance">{{ shop.phone || (pickupType === 2 ? '支持同城配送' : '支持到店自提') }}</text>
            </view>
          </view>
          <!-- ⚠️ @click.stop：导航是独立动作，不能顺带触发整行的「选择该门店」 -->
          <view v-if="canNavigateShop(shop)" class="shop-nav" @click.stop="navigateToShop(shop)">导航</view>
        </view>
        <text v-if="!pickerShops.length" class="shop-empty">{{ shopEmptyText }}</text>
      </view>
    </view>

    <view v-if="invoiceDrawerVisible" class="mask invoice-mask" @tap="closeInvoiceDrawer">
      <view class="sheet invoice-sheet" @tap.stop>
        <view class="sheet-head"><text class="sheet-title">发票信息</text><text class="sheet-close" @tap="closeInvoiceDrawer">×</text></view>
        <view class="invoice-type-row">
          <view class="type-choice" :class="{ active: invoiceType === 'personal' }" @click="changeInvoiceType('personal')"><view class="radio" :class="{ active: invoiceType === 'personal' }"><view class="radio-dot" /></view><text>个人</text></view>
          <view class="type-choice" :class="{ active: invoiceType === 'company' }" @click="changeInvoiceType('company')"><view class="radio" :class="{ active: invoiceType === 'company' }"><view class="radio-dot" /></view><text>公司</text></view>
        </view>
        <view v-show="invoiceType === 'personal'" class="drawer-fields">
          <view class="sheet-form-line"><text class="form-label">姓名<span class="required">*</span></text><input v-model="invoiceForm.name" class="sheet-input" maxlength="32" placeholder="请输入" placeholder-class="input-placeholder" /></view>
          <view class="sheet-form-line"><text class="form-label">电子邮箱<span class="required">*</span></text><input v-model="invoiceForm.email" class="sheet-input" maxlength="254" type="text" placeholder="请输入" placeholder-class="input-placeholder" /></view>
        </view>
        <view v-show="invoiceType === 'company'" class="drawer-fields">
          <view class="sheet-form-line"><text class="form-label">公司名称<span class="required">*</span></text><input v-model="invoiceForm.companyName" class="sheet-input" maxlength="100" placeholder="请输入" placeholder-class="input-placeholder" /></view>
          <view class="sheet-form-line"><text class="form-label">纳税人识别号<span class="required">*</span></text><input v-model="invoiceForm.taxNumber" class="sheet-input" maxlength="20" placeholder="请输入" placeholder-class="input-placeholder" /></view>
          <view class="sheet-form-line"><text class="form-label">电子邮箱<span class="required">*</span></text><input v-model="invoiceForm.email" class="sheet-input" maxlength="254" type="text" placeholder="请输入" placeholder-class="input-placeholder" /></view>
        </view>
        <view class="sheet-submit" @click="completeInvoice">完成</view>
      </view>
    </view>

    <LoginGuide v-model="loginGuideVisible" />
  </view>
</template>

<style>
.pg { height: 100vh; background: #fff; color: #222; overflow: hidden; }
.nav { position: fixed; left: 0; right: 0; z-index: 20; display: flex; align-items: center; padding-left: 24rpx; background: #fff; box-sizing: border-box; }
.brand-mark { width: 42rpx; height: 42rpx; }
.back-button { flex-shrink: 0; }
.nav-title { margin-left: 22rpx; color: #222; font-size: 30rpx; font-weight: 600; }
.content { height: 100vh; padding: 0 24rpx; box-sizing: border-box; }
.section { padding: 30rpx 0; border-bottom: 1px solid #eee; }
.section-title { color: #252525; font-size: 28rpx; font-weight: 600; }
.delivery-section { padding-top: 24rpx; }
.pickup-options, .invoice-options, .pay-method-options { display: flex; gap: 24rpx; margin-top: 30rpx; }
.pickup-option, .invoice-option, .pay-method-option { display: flex; flex: 1; align-items: center; min-height: 72rpx; padding: 0 24rpx; box-sizing: border-box; background: #f7f7f7; color: #555; font-size: 25rpx; }
.pickup-option.active, .invoice-option.active, .pay-method-option.active { color: #222; font-weight: 600; }
.pay-method-option.disabled { opacity: .45; }
.radio { width: 34rpx; height: 34rpx; margin-right: 14rpx; border: 2rpx solid #888; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-sizing: border-box; flex-shrink: 0; }
.radio.active { border-color: #222; }
.radio-dot { width: 18rpx; height: 18rpx; border-radius: 50%; background: transparent; }
.radio.active .radio-dot { background: #222; }
.section-row { display: flex; align-items: center; justify-content: space-between; min-height: 86rpx; }
.section-row > view:first-child { flex: 1; min-width: 0; }
.row-heading { display: flex; align-items: center; justify-content: space-between; }
.action-text { color: #222; font-size: 24rpx; font-weight: 600; }
.address-value, .address-detail, .placeholder-text { display: block; margin-top: 14rpx; font-size: 24rpx; }
.address-value { color: #333; }
.address-detail, .placeholder-text { color: #aaa; }
.arrow { padding-left: 20rpx; color: #222; font-size: 48rpx; font-weight: 300; line-height: 1; }
.contact-section { padding-top: 28rpx; }
.form-line, .sheet-form-line { display: flex; align-items: center; min-height: 78rpx; margin-top: 22rpx; padding: 0 28rpx; background: #f7f7f7; box-sizing: border-box; }
.form-label { flex-shrink: 0; color: #333; font-size: 25rpx; white-space: nowrap; }
.required { color: #222; margin-left: 4rpx; }
.form-input { flex: 1; min-width: 0; margin-left: 26rpx; color: #333; font-size: 25rpx; }
.input-placeholder { color: #aaa; }
.products-section { padding-bottom: 26rpx; }
.product-row { display: flex; min-width: 0; margin-top: 28rpx; }
.product-image { width: 216rpx; height: 216rpx; flex-shrink: 0; background: #d9d9d9; }
.product-placeholder { background: #d9d9d9; }
.product-info { display: flex; flex: 1; min-width: 0; flex-direction: column; justify-content: space-between; padding: 4rpx 0 4rpx 26rpx; }
.product-name { color: #222; font-size: 26rpx; font-weight: 600; line-height: 1.45; }
.product-spec { margin-top: 10rpx; color: #999; font-size: 22rpx; }
.product-bottom { display: flex; align-items: baseline; justify-content: space-between; gap: 10rpx; }
.quantity { color: #999; font-size: 22rpx; }
.product-price { color: #222; font-size: 30rpx; font-weight: 700; white-space: nowrap; }
.amount-section { padding: 22rpx 0; }
.amount-row { display: flex; align-items: center; justify-content: space-between; min-height: 58rpx; color: #999; font-size: 24rpx; }
.amount-row .discount-text { color: #d40000; }
.amount-row.total-row { color: #222; font-size: 26rpx; font-weight: 700; }
.invoice-section, .remark-section { padding: 0; }
.compact-row { min-height: 94rpx; }
.row-summary { display: flex; align-items: center; max-width: 68%; color: #333; font-size: 24rpx; text-align: right; }
.row-summary text:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plus { margin-left: 16rpx; color: #333; font-size: 32rpx; }
.invoice-options { margin: 0 0 28rpx; }
.remark-input { width: 100%; min-height: 130rpx; margin-bottom: 26rpx; padding: 22rpx; background: #f7f7f7; box-sizing: border-box; color: #333; font-size: 24rpx; }
.content-bottom-space { height: 180rpx; }
.switch-balance-card { display: flex; align-items: center; justify-content: space-between; gap: 20rpx; margin: 20rpx 0 0; padding: 24rpx 22rpx; border: 1rpx solid #e7e7e7; border-radius: 14rpx; background: #fafafa; box-sizing: border-box; }
.switch-balance-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.switch-balance-title { color: #222; font-size: 26rpx; font-weight: 600; }
.switch-balance-description { margin-top: 8rpx; color: #888; font-size: 22rpx; line-height: 1.45; }
.switch-balance-button { flex-shrink: 0; height: 64rpx; margin: 0; padding: 0 24rpx; border: 0; border-radius: 32rpx; color: #fff; background: #222; font-size: 24rpx; line-height: 64rpx; }
.switch-balance-button::after { border: 0; }
.switch-balance-button[disabled] { opacity: .56; }
.payment-success-state { position: absolute; top: 50%; right: 40rpx; left: 40rpx; display: flex; flex-direction: column; align-items: center; transform: translateY(-50%); }
.success-icon { display: flex; align-items: center; justify-content: center; width: 108rpx; height: 108rpx; border-radius: 50%; color: #fff; background: #222; font-size: 64rpx; font-weight: 300; }
.success-title { margin-top: 28rpx; color: #222; font-size: 36rpx; font-weight: 700; }
.success-description { margin-top: 14rpx; color: #999; font-size: 24rpx; text-align: center; }
.state-view { position: absolute; top: 45%; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; color: #999; font-size: 26rpx; }
.state-action { margin-top: 26rpx; color: #222; text-decoration: underline; }
.paybar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex; align-items: center; justify-content: space-between; padding: 18rpx 24rpx calc(18rpx + env(safe-area-inset-bottom)); background: #fff; box-shadow: 0 -4rpx 18rpx rgba(0, 0, 0, .08); box-sizing: border-box; }
.total-block { display: flex; align-items: baseline; min-width: 0; }
.currency { color: #222; font-size: 28rpx; font-weight: 700; }
.total-price { margin-left: 4rpx; color: #222; font-size: 34rpx; font-weight: 700; }
.count-label { margin-left: 12rpx; color: #999; font-size: 22rpx; }
.pay-now { display: flex; align-items: center; justify-content: center; gap: 12rpx; width: 420rpx; height: 82rpx; background: #050505; color: #fff; font-size: 28rpx; }
.pay-now.disabled { background: #aaa; }
.cancel-order { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 96rpx; flex-shrink: 0; color: #959595; font-size: 22rpx; }
.cancel-icon { position: relative; width: 40rpx; height: 40rpx; margin-bottom: 6rpx; border: 2rpx solid #c4c4c4; border-radius: 50%; box-sizing: border-box; }
.cancel-icon::before, .cancel-icon::after { content: ''; position: absolute; left: 50%; top: 50%; width: 22rpx; height: 2rpx; background: #999; }
.cancel-icon::before { transform: translate(-50%, -50%) rotate(45deg); }
.cancel-icon::after { transform: translate(-50%, -50%) rotate(-45deg); }
.countdown { font-size: 26rpx; font-weight: 600; }
.mask { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .68); }
.sheet { width: 100%; max-height: 86vh; padding: 30rpx 28rpx calc(30rpx + env(safe-area-inset-bottom)); background: #fff; box-sizing: border-box; overflow-y: auto; }
.sheet-head { display: flex; align-items: center; justify-content: center; min-height: 54rpx; }
.sheet-title { color: #222; font-size: 30rpx; font-weight: 700; }
.sheet-close { position: absolute; right: 30rpx; color: #888; font-size: 42rpx; font-weight: 300; line-height: 1; }
.sheet-form-line { margin-top: 22rpx; }
.sheet-input { flex: 1; min-width: 0; margin-left: 24rpx; color: #333; font-size: 25rpx; }
.sheet-submit { display: flex; align-items: center; justify-content: center; height: 82rpx; margin-top: 34rpx; background: #050505; color: #fff; font-size: 28rpx; }
.shop-sheet { padding-bottom: calc(36rpx + env(safe-area-inset-bottom)); }
.shop-option { display: flex; align-items: center; justify-content: space-between; padding: 28rpx 0; border-bottom: 1px solid #eee; }
.shop-option.selected { background: #fafafa; }
.shop-name, .shop-address { display: block; }
.shop-name { color: #222; font-size: 27rpx; font-weight: 600; }
.shop-address { margin-top: 10rpx; color: #999; font-size: 23rpx; }
.shop-distance { color: #999; font-size: 22rpx; }
/* 门店行（2026-09-27）：左侧信息区 + 右侧独立「导航」按钮 */
.shop-main { flex: 1; min-width: 0; }
.shop-meta { display: flex; align-items: center; gap: 12rpx; margin-top: 6rpx; }
.shop-distance-text { color: #ff5500; font-size: 22rpx; }
.shop-nav { flex-shrink: 0; margin-left: 16rpx; padding: 8rpx 20rpx; border: 1rpx solid #ff5500; border-radius: 999rpx; color: #ff5500; font-size: 22rpx; line-height: 1.4; }
.invoice-mask { align-items: flex-end; }
.invoice-sheet { max-height: 88vh; }
.invoice-type-row { display: flex; gap: 84rpx; margin: 34rpx 0 18rpx; }
.type-choice { display: flex; align-items: center; color: #555; font-size: 26rpx; }
.type-choice.active { color: #222; font-weight: 600; }
.drawer-fields { min-height: 0; }
/* ===== 同城配送：试算提示与地址表单省市区 ===== */
/* 超出同城配送范围时的置灰样式：仍可点击（点了给「请选择其他配送方式」的提示） */
.pickup-option.disabled { opacity: 0.45; }
.quote-hint { display: block; margin-top: 12rpx; color: #86909c; font-size: 23rpx; }
.quote-error { display: block; margin-top: 12rpx; color: #f53f3f; font-size: 23rpx; }
/* 试算失败但"去地图选点就能解决"时的可点入口（与地址页的地图选点卡同色系） */
.quote-action { display: flex; align-items: center; justify-content: center; height: 68rpx; margin-top: 16rpx; border-radius: 12rpx; background: #fff4e8; }
.quote-action-text { color: #ff5500; font-size: 24rpx; font-weight: 600; }
.shop-empty { display: block; padding: 40rpx 0; color: #86909c; font-size: 25rpx; text-align: center; }
/* 省市区三级联动：必须与 .sheet-input 保持同一套间距与字号，否则文字会与左侧标签贴在一起 */
.sheet-picker { flex: 1; min-width: 0; margin-left: 24rpx; padding: 20rpx 0; }
.sheet-picker-value { color: #333; font-size: 25rpx; }
.sheet-picker-placeholder { color: #bbb; font-size: 25rpx; }
</style>
