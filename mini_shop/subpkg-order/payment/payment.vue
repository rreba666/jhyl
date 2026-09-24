<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getCartList, normalizeDeliverySwitch, type CartItem } from '@/api/cart'
import { ADDRESS_DRAFT_KEY, cancelOrder, createOrder, getOrderDetail, type OrderDetail } from '@/api/order'
import { createPrepay, requestPayment, payByBalance, switchToBalance } from '@/api/payment'
import { getEnabledShops, getDeliverableShops, type EnabledShop } from '@/api/shop'
import { quoteDelivery, type DeliveryQuote } from '@/api/delivery-order'
import { distanceMeters } from '@/utils/location'
import { submitInvoice } from '@/api/invoice'
import { getWalletInfo } from '@/api/user'
import { getProductDetail } from '@/api/product'
import { DIVIDEND_PURCHASE_LIMIT, PURCHASE_LIMIT_MESSAGE, getDividendQuantity, isDividendEligible } from '@/utils/dividend-limit'
import { cleanDigits, cleanText, normalizeEditableMobile, validateEmail, validateMobile, validateTaxNumber, validateText } from '@/utils/input-validation'
import { isApiRequestError } from '@/utils/request'
import { isLoggedIn } from '@/utils/auth'
import { getModules, isModuleEnabled, type ModuleConfig } from '@/utils/config'
import LoginGuide from '@/components/LoginGuide.vue'

/** 配送方式：0=物流(快递配送) 1=线下自提 2=同城配送（2026-09-19 起开放下单：需选发货门店 + 填收货地址，配送费走试算）。 */
type PickupType = 0 | 1 | 2
type InvoiceType = 'personal' | 'company'
/**
 * 商品级「配送方式」开关的下单拦截错误码与文案（后端 2026-09-22 新增，与文档 §7b ② 一致）：
 * 自提单里含 pickupEnabled=0 的商品 → 13023；物流/同城单里含 deliveryEnabled=0 的商品 → 13024。
 * 前端提前按这两个开关过滤配送方式，后端这一层仍然拦截（前端过滤只是少让用户白跑一趟）。
 */
const PRODUCT_PICKUP_BLOCKED_CODE = 13023
const PRODUCT_DELIVERY_BLOCKED_CODE = 13024
const PRODUCT_PICKUP_BLOCKED_MESSAGE = '该商品不支持线下自提，请选择其他配送方式'
const PRODUCT_DELIVERY_BLOCKED_MESSAGE = '该商品不支持物流/同城配送，请选择其他配送方式'
/** 两个开关都被关掉时的统一提示（任何配送方式后端都会拦，直接禁用下单）。 */
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
  /** 定位经纬度（同城配送下单必带；定位失败时用发货门店坐标兜底）。 */
  latitude?: number
  longitude?: number
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

const PAYMENT_FORM_CACHE_KEY = 'payment_form_cache'

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
          ...(typeof cached.address.latitude === 'number' ? { latitude: cached.address.latitude } : {}),
          ...(typeof cached.address.longitude === 'number' ? { longitude: cached.address.longitude } : {}),
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
      latitude: number; longitude: number
    }> | undefined
    if (!draft || !String(draft.detail || '').trim()) return
    selectedAddress.value = {
      name: cleanText(draft.name || ''),
      phone: normalizeEditableMobile(draft.phone || ''),
      detail: cleanText(draft.detail || ''),
      province: cleanText(draft.province || ''),
      city: cleanText(draft.city || ''),
      district: cleanText(draft.district || ''),
      ...(typeof draft.latitude === 'number' ? { latitude: draft.latitude } : {}),
      ...(typeof draft.longitude === 'number' ? { longitude: draft.longitude } : {}),
    }
  } catch { /* 草稿读取失败忽略：不影响结算页其它功能 */ }
})

/** 保存结算表单到本地缓存。 */
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

/** 加载 C 端可用门店，替换支付页中的本地假数据。 */
async function loadShops(): Promise<void> {
  try { shops.value = await getEnabledShops() }
  catch (error) { shops.value = []; console.error('门店列表加载失败', error) }
  finally { shopsLoaded.value = true }
}

/* ===================== 同城配送：按商品筛选可配送门店（2026-09-25 修） ===================== */

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
  try {
    const list = await getDeliverableShops(skuIds)
    deliverableShops.value = Array.isArray(list) ? list : []
  } catch (error) {
    deliverableShops.value = null
    console.error('按商品筛选可配送门店失败，退回全量门店', error)
  } finally {
    deliverableSettled.value = true
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
 * ⚠️ 自提（`pickupType=1`）**不用**这个列表：门店级 `deliveryEnabled` 只影响同城，不影响自提。
 */
const sameCityShops = computed(() => {
  const base = deliverableShops.value ?? shops.value
  return base.filter((shop) => shop.deliveryEnabled !== false)
})

/**
 * 门店弹层 / 置灰说明的空态文案。
 * 同城区分两种情况：按商品筛过 = 「这批商品没有门店能送」；退回全量 = 「没有门店开通同城配送」。
 */
const shopEmptyText = computed(() => {
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
 * 商品级配送开关（后端 2026-09-22 新增，默认 1=支持；缺失/非法值由 normalizeDeliverySwitch 按 1 兜底）：
 * - 任一已选商品 pickupEnabled=0 → 不提供「门店自提」（后端会以 13023 拦）；
 * - 任一已选商品 deliveryEnabled=0 → 不提供「快递配送」与「同城配送」（后端会以 13024 拦）。
 * 与「模块开关」「同城可送性」是三重叠加关系，缺一层都会出现「能选但下不了单」。
 */
const pickupBlockedByProduct = computed(() => items.value.some((item) => normalizeDeliverySwitch(item.pickupEnabled) === 0))
const deliveryBlockedByProduct = computed(() => items.value.some((item) => normalizeDeliverySwitch(item.deliveryEnabled) === 0))
/** 同一批商品里两个开关都关掉：任何配送方式都下不了单（页面提示 + 禁用下单 + 提交拦截三重兜底）。 */
const noSupportedDeliveryMethod = computed(() => pickupBlockedByProduct.value && deliveryBlockedByProduct.value)

/**
 * 取某个配送方式被「商品级配送开关」过滤掉的原因；返回空串表示该方式可选。
 * 物流(0) 与同城(2) 共用 deliveryEnabled，自提(1) 用 pickupEnabled。
 */
function deliveryBlockedReasonFor(type: PickupType): string {
  if (type === 1) return pickupBlockedByProduct.value ? PRODUCT_PICKUP_BLOCKED_MESSAGE : ''
  return deliveryBlockedByProduct.value ? PRODUCT_DELIVERY_BLOCKED_MESSAGE : ''
}

/**
 * 有没有门店能**配送当前这批商品**（= 门店级 `deliveryEnabled` + 门店有没有这些 SKU）。
 * ⚠️ 与**商品级** `deliveryEnabled` 同名但是两回事：前者是"这家店能不能送这单"，后者是"这件商品能不能走配送"。
 */
const hasSameCityShop = computed(() => sameCityShops.value.length > 0)

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
 * 当前定位下「同城配送」是否可选。
 * - 定位拿不到（未授权/失败）→ 返回 true（**不置灰**，避免误拦；真正下单时仍会按收货地址试算拦截）；
 * - 定位成功但所有试算门店都送不到 → false（选项置灰，点击给提示）；
 * - 只要有一家能送 → true。
 */
const sameCityAvailable = computed(() => {
  if (!userLocation.value) return true
  const quotes = Object.values(shopQuotes.value)
  if (!quotes.length) return true
  return quotes.some((quote) => quote.canDelivery !== false)
})

/**
 * 置灰的具体原因：取预试算里任一「不可送」门店的后端 reason
 * （后端会带上距离，如「超出配送范围（当前距离约 1397.1 公里）」），展示在页面上而不是塞进 toast（会被截断）。
 */
const sameCityUnavailableReason = computed(() => {
  const blocked = Object.values(shopQuotes.value).find((quote) => quote.canDelivery === false)
  return blocked?.reason && blocked.reason !== 'ok' ? blocked.reason : '超出同城配送范围'
})

/**
 * 进页面时定位一次，并对候选门店并发预试算 —— 外市用户买同城配送必然送不到，
 * 靠这一步在**下单前**就把「同城配送」置灰，而不是等提交时才报错。
 * 定位失败静默处理（不弹错、不阻塞），并允许后续切到同城时再补一次定位。
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
 * 门店弹层数据源：同城配送只列**能配送这批商品且开通了同城配送**的门店；
 * 若预试算已出结果，则进一步只列**当前定位能送到**的门店（送不到的列出来也没意义）。
 * ⚠️ 别再退回 `shops.value` —— 那是全量启用门店，会把没有该商品的门店也列出来。
 */
const pickerShops = computed(() => {
  if (pickupType.value !== 2) return shops.value
  const deliverable = sameCityShops.value
  const quotable = deliverable.filter((shop) => {
    const quote = shopQuotes.value[shop.id]
    return !quote || quote.canDelivery !== false
  })
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
 * 用定位自动填入省市区（打开配送地址表单时调用）。
 *
 * 只填**用户还没填**的字段（不覆盖手动修改）；任何失败都静默降级为手选 ——
 * 省市区可以手选，不能因为定位失败就卡住下单。
 * 微信 `getLocation` 的 `geocode` 会附带 address（省/市/区），但部分基础库或未开通位置服务时拿不到，
 * 所以这里对字段名也做了兼容取值。
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
    addressForm.latitude = Number(result.latitude)
    addressForm.longitude = Number(result.longitude)
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
 * 同城配送试算：发货门店 + 收货地址齐了才调，用于展示配送费 / 距离 / 预计送达与可送性。
 * 试算失败**不静默按 0 收运费** —— 保留错误文案，并在提交时拦截。
 */
async function refreshDeliveryQuote(): Promise<void> {
  if (pickupType.value !== 2 || !selectedShop.value || !selectedAddress.value) {
    deliveryQuote.value = null
    quoteError.value = ''
    return
  }
  const address = selectedAddress.value
  quoteLoading.value = true
  quoteError.value = ''
  try {
    const quote = await quoteDelivery({
      merchantId: selectedShop.value.id,
      goodsAmount: subtotal.value,
      // 坐标优先级：收货地址自身的定位 → 进页面时采到的当前位置 → 发货门店坐标（最后兜底）
      receiverLat: address.latitude ?? userLocation.value?.latitude ?? selectedShop.value.latitude,
      receiverLng: address.longitude ?? userLocation.value?.longitude ?? selectedShop.value.longitude,
      address: fullAddress(address),
    })
    deliveryQuote.value = quote
    if (quote && quote.canDelivery === false) {
      quoteError.value = quote.reason && quote.reason !== 'ok' ? quote.reason : '该地址超出配送范围'
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
        ...(draft.latitude != null ? { latitude: Number(draft.latitude) } : {}),
        ...(draft.longitude != null ? { longitude: Number(draft.longitude) } : {}),
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

/** 选择支付方式；余额不足时禁止切到余额支付并引导微信。 */
function selectPayMethod(method: PayMethod): void {
  if (method === 'balance' && !balanceEnough.value) {
    uni.showToast({ title: '余额不足，请使用微信支付', icon: 'none' })
    return
  }
  payMethod.value = method
}

/**
 * 打开「配送地址」**独立页面**。
 * 原方案是弹层，但弹层里塞不下「省市区选择 + 自动定位 + 地图选点」，
 * 说明文字还会被挤到表单下方（2026-09-19 用户要求改成整页）。
 * 当前地址写进 storage 作为草稿，页面保存后返回，由 onShow 读回。
 */
function openAddressEditor(): void {
  try {
    if (selectedAddress.value) uni.setStorageSync(ADDRESS_DRAFT_KEY, selectedAddress.value)
    else uni.removeStorageSync(ADDRESS_DRAFT_KEY)
  } catch { /* 忽略 */ }
  // ⚠️ 必须带 mode=payment（2026-09-22 修）：不带参数时地址页按「地址簿模式」走 ——
    // 保存只写后端、不写 ADDRESS_DRAFT_KEY 草稿，也不渲染「选择已有地址」入口，
    // 于是结算页既选不了地址、也不会自动回填（真机反馈）。
    uni.navigateTo({ url: '/subpkg-order/address/edit?mode=payment' })
}

/** 校验并保存本地地址。 */
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
    ...(addressForm.latitude != null ? { latitude: addressForm.latitude } : {}),
    ...(addressForm.longitude != null ? { longitude: addressForm.longitude } : {}),
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
 * 商品级「配送方式」开关的下单拦截码 → 用户可读文案（13023 自提 / 13024 物流同城）。
 * 返回空串表示不是这两类错误，交给调用方继续按原文案处理。
 */
function productDeliveryErrorMessage(code: number): string {
  if (code === PRODUCT_PICKUP_BLOCKED_CODE) return PRODUCT_PICKUP_BLOCKED_MESSAGE
  if (code === PRODUCT_DELIVERY_BLOCKED_CODE) return PRODUCT_DELIVERY_BLOCKED_MESSAGE
  return ''
}

/** 将红包商品购买机会错误转换为面向用户的业务提示。 */
function getPaymentErrorMessage(error: unknown): string {
  // 后端历史文案仍可能下发旧词（业务已统一改称「红包」）：先归一化，再做关键词匹配与展示，确保用户看不到旧词。
  // 说明：旧词用 \u 转义写成 /\u5206\u7EA2/，既保留兼容匹配，又不让源码出现该字样。
  const message = (error instanceof Error ? error.message : '').replace(/\u5206\u7EA2/g, '红包')
  // 商品级配送开关：后端文案已定，这里用本地常量兜一层，避免后端改词时前端提示含混
  if (isApiRequestError(error)) {
    const deliveryMessage = productDeliveryErrorMessage(error.code)
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

/** 统一提交支付成功后的发票，并按支付来源决定留在当前页还是跳转订单详情。 */
async function completePayment(currentOrderId: string, stayOnPage: boolean): Promise<void> {
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
  paymentSucceeded.value = stayOnPage
  uni.showToast({ title: invoiceError ? '支付成功，发票申请失败' : '支付成功', icon: invoiceError ? 'none' : 'success' })
  if (!stayOnPage) {
    setTimeout(() => { uni.redirectTo({ url: `/subpkg-order/orders/detail?orderId=${currentOrderId}` }) }, 500)
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
async function submitPayment(): Promise<void> {
  if (paying.value) return
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
  // 试算说不可送就不放行（超配送范围 / 门店未开配送等），提示以后端 reason 为准
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
  try {
    let currentOrderId = orderId.value
    if (!currentOrderId) {
      // 立即购买走直接下单（items），购物车结算走 cartIds，二者互斥避免把购物车其他商品带入
      const isDirectBuy = Boolean(directSkuId.value && directProductId.value)
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
          // 同城必须带坐标：收货地址定位 → 当前位置 → 发货门店坐标（依次兜底）
          receiverLat: selectedAddress.value?.latitude ?? userLocation.value?.latitude ?? selectedShop.value.latitude,
          receiverLng: selectedAddress.value?.longitude ?? userLocation.value?.longitude ?? selectedShop.value.longitude,
        } : {}),
        ...(remark.value.trim() ? { remark: remark.value.trim() } : {}),
      })
      const id = created.orderId ?? created.id
      if (id == null) throw new Error('创建订单未返回订单 ID')
      currentOrderId = String(id)
      orderId.value = currentOrderId
    }
    if (payMethod.value === 'balance') {
      if (wechatPaymentStarted.value) {
        if (canSwitchToBalance.value) {
          await switchToBalancePayment()
        } else {
          uni.showToast({ title: '微信支付状态确认中，请稍后查询', icon: 'none' })
        }
        return
      }
      // 尚未拉起微信支付时，余额支付可直接走原有同步接口
      await payByBalance(currentOrderId)
    } else {
      // 微信支付：获取签名并调起微信收银台
      const prepay = await createPrepay(currentOrderId)
      wechatPaymentStarted.value = true
      await requestPayment(prepay)
    }
    await completePayment(currentOrderId, false)
  } catch (error) {
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
    setTimeout(() => { uni.navigateBack() }, 500)
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
      scroll-y
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
          <view><text class="shop-name">{{ shop.name }}</text><text class="shop-address">{{ shop.address }}</text></view>
          <text class="shop-distance">{{ shop.phone || (pickupType === 2 ? '支持同城配送' : '支持到店自提') }}</text>
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
.shop-empty { display: block; padding: 40rpx 0; color: #86909c; font-size: 25rpx; text-align: center; }
/* 省市区三级联动：必须与 .sheet-input 保持同一套间距与字号，否则文字会与左侧标签贴在一起 */
.sheet-picker { flex: 1; min-width: 0; margin-left: 24rpx; padding: 20rpx 0; }
.sheet-picker-value { color: #333; font-size: 25rpx; }
.sheet-picker-placeholder { color: #bbb; font-size: 25rpx; }
</style>
