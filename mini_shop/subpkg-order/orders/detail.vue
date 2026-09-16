<script setup lang="ts">
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import { computed, reactive, ref, watch } from 'vue'
import { cancelOrder, getAddressChangeRequest, getOrderDetail, getPickupCode, receiveOrder, refundOrder, submitAddressChangeRequest, type AddressChangeRequestDTO, type OrderAddressChangeRequest, type OrderDetail, type PickupCodeVO } from '@/api/order'
import { getEnabledShops, type EnabledShop } from '@/api/shop'
import { getAfterSaleList } from '@/api/after-sale'
import { getOrderProgress, type DeliveryProgress } from '@/api/delivery-order'
import { getAuth, isLoggedIn } from '@/utils/auth'
import { isApiRequestError } from '@/utils/request'
import { cleanDigits, cleanText, validateMobile, validateText } from '@/utils/input-validation'
import LoginGuide from '@/components/LoginGuide.vue'
// @ts-ignore uqrcode 为 UMD 单文件库（随分包 subpkg-order 打包，避免主包出现未使用的 JS 文件）
import UQRCode from '@/subpkg-order/utils/uqrcode'

const order = ref<OrderDetail | null>(null)
const loading = ref(true)
const actionLoading = ref(false)
const errorMessage = ref('')
const loginGuideVisible = ref(false)
/** 自提码（独立 pickup-code 接口返回）。 */
const pickupCode = ref('')
/** 自提二维码内容（独立 pickup-code 接口返回）。 */
const pickupUrl = ref('')
/** 二维码点阵（qr.modules 二维数组，每格 isBlack 表示黑/白）。 */
const qrModules = ref<Array<Array<{ isBlack: boolean }>>>([])
const pickupPollingPaused = ref(false)
const pageVisible = ref(false)
const PICKUP_POLL_INTERVAL_MS = 15_000
const PICKUP_POLL_MAX_MS = 5 * 60 * 1000
let pickupStatusTimer: ReturnType<typeof setTimeout> | null = null
let pickupStatusStartedAt = 0
let pickupStatusInFlight = false
/** 自提门店完整信息（地址、电话，从门店列表匹配）。 */
const pickupShop = ref<EnabledShop | null>(null)
/** 当前订单是否有「处理中」的售后单（用于把退款按钮换成「售后中」）。 */
const processingAfterSale = ref(false)

/** 地址修改申请表单，内容按当前用户和订单自动缓存。 */
interface AddressChangeForm {
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  reason: string
}

const ADDRESS_CHANGE_DRAFT_PREFIX = 'address-change-draft:'
const addressChangeForm = reactive<AddressChangeForm>({
  receiverName: '',
  receiverPhone: '',
  receiverAddress: '',
  reason: '',
})
const addressChangeRequest = ref<OrderAddressChangeRequest | null>(null)
const addressChangeQueryFailed = ref(false)
const addressChangeVisible = ref(false)
const addressChangeSubmitting = ref(false)

/** 是否为待自提订单（自提且已支付待核销）。 */
const isPickupPending = computed(() => order.value?.pickupType === 1 && order.value?.status === 1)

/** 只有物流且已支付未发货的订单可以申请修改地址。 */
const canRequestAddressChange = computed(() =>
  order.value?.pickupType === 0
  && order.value?.status === 1
  && !addressChangeQueryFailed.value,
)

/** 待审核申请不能重复提交。 */
const addressChangePending = computed(() => addressChangeRequest.value?.status === 0)

/** 已拒绝申请允许恢复上次草稿后重新提交。 */
const addressChangeRejected = computed(() => addressChangeRequest.value?.status === 2)

/** 已有申请时的状态文案。 */
const addressChangeStatusText = computed(() => {
  if (addressChangeRequest.value?.status === 0) return '地址修改审核中'
  if (addressChangeRequest.value?.status === 1) return '地址修改已通过'
  if (addressChangeRequest.value?.status === 2) return '地址修改已拒绝'
  return ''
})

/** 控制“修改地址”按钮，拒绝后允许再次提交，其余已处理状态只展示结果。 */
const addressChangeActionVisible = computed(() =>
  canRequestAddressChange.value
  && !addressChangePending.value
  && (!addressChangeRequest.value || addressChangeRejected.value),
)

/** 金额明细：小计（商品总额）、优惠减免、配送费、实付。 */
const amountSummary = computed(() => {
  // 商品总额（订前价/原价总额）：优先订单 totalAmount，缺失回退明细累加
  const subtotal = Number(order.value?.totalAmount || 0)
    || (order.value?.items || []).reduce((sum, item) => sum + (Number(item.subtotal ?? 0) || Number(item.price ?? 0) * Number(item.quantity ?? 1)), 0)
  const freight = Number(order.value?.freightAmount || 0)
  // 优惠减免金额（整单累计）
  const discount = Number(order.value?.discountAmount || 0)
  // 实付金额
  const total = Number(order.value?.payAmount || 0) || subtotal - discount + freight
  return { subtotal, freight, discount, total }
})

/** 生成自提二维码点阵：用 uqrcode 计算 modules，交给模板 v-for 渲染，规避 Vue3 小程序 canvas 兼容问题。 */
function drawPickupQrcode(url: string): void {
  try {
    const qr = new UQRCode()
    qr.data = url
    qr.make()
    qrModules.value = qr.modules as Array<Array<{ isBlack: boolean }>>
  } catch {
    /* 二维码生成失败时静默，仍保留自提码文本兜底 */
    qrModules.value = []
  }
}

/** 清理自提状态检测计时器；页面隐藏和核销完成都会调用。 */
function stopPickupStatusPolling(): void {
  if (pickupStatusTimer) clearTimeout(pickupStatusTimer)
  pickupStatusTimer = null
}

/** 将轻量自提接口结果同步到二维码和订单状态。返回 true 表示进入终态。 */
function applyPickupCodeInfo(info: PickupCodeVO): boolean {
  pickupCode.value = info.pickupCode || ''
  pickupUrl.value = info.pickupUrl || ''
  if (info.pickupUrl) drawPickupQrcode(info.pickupUrl)
  else qrModules.value = []

  const terminal = info.status === 8 || !info.pickupCode
  if (order.value && info.status !== order.value.status) {
    order.value.status = info.status
    if (info.status === 8) order.value.statusDesc = '已核销'
  }
  if (terminal) {
    if (terminal && order.value) {
      order.value.statusDesc = '已核销'
    }
    pickupCode.value = ''
    pickupUrl.value = ''
    qrModules.value = []
    stopPickupStatusPolling()
  }
  return terminal
}

/** 在页面可见且订单待自提时安排下一次检测，超时后暂停自动检测。 */
function schedulePickupStatusPolling(orderId: string): void {
  if (!isPickupPending.value || !pageVisible.value || pickupStatusTimer) return
  if (!pickupStatusStartedAt) pickupStatusStartedAt = Date.now()
  if (Date.now() - pickupStatusStartedAt >= PICKUP_POLL_MAX_MS) {
    pickupPollingPaused.value = true
    stopPickupStatusPolling()
    return
  }
  pickupStatusTimer = setTimeout(() => {
    pickupStatusTimer = null
    void pollPickupStatus(orderId)
  }, PICKUP_POLL_INTERVAL_MS)
}

/** 轮询自提状态，单次请求完成后才安排下一次，避免网络慢时叠加请求。 */
async function pollPickupStatus(orderId: string): Promise<void> {
  if (!pageVisible.value || !isPickupPending.value || pickupStatusInFlight) return
  if (Date.now() - pickupStatusStartedAt >= PICKUP_POLL_MAX_MS) {
    pickupPollingPaused.value = true
    stopPickupStatusPolling()
    return
  }
  pickupStatusInFlight = true
  try {
    const info = await getPickupCode(orderId)
    if (!pageVisible.value || String(order.value?.id) !== String(orderId)) return
    const terminal = applyPickupCodeInfo(info)
    if (!terminal) schedulePickupStatusPolling(orderId)
  } catch {
    // 轮询失败不清空当前二维码，下一轮或手动刷新继续尝试。
    schedulePickupStatusPolling(orderId)
  } finally {
    pickupStatusInFlight = false
  }
}

/** 开始当前可见页面的自提状态检测。 */
function startPickupStatusPolling(orderId: string): void {
  if (!pageVisible.value || !isPickupPending.value) return
  pickupPollingPaused.value = false
  if (!pickupStatusStartedAt) pickupStatusStartedAt = Date.now()
  schedulePickupStatusPolling(orderId)
}

/** 用户主动刷新自提状态，并重新开始短时自动检测窗口。 */
async function refreshPickupStatus(): Promise<void> {
  const orderId = order.value?.id
  if (!orderId || !isPickupPending.value || pickupStatusInFlight) return
  stopPickupStatusPolling()
  pickupStatusStartedAt = Date.now()
  pickupPollingPaused.value = false
  pickupStatusInFlight = true
  try {
    const info = await getPickupCode(String(orderId))
    const terminal = applyPickupCodeInfo(info)
    if (!terminal) schedulePickupStatusPolling(String(orderId))
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '状态刷新失败', icon: 'none' })
    schedulePickupStatusPolling(String(orderId))
  } finally {
    pickupStatusInFlight = false
  }
}

/** 拉取自提二维码信息（仅自提订单；核销/退款后后端置 null，二维码自动失效）。 */
async function loadPickupCode(orderId: string): Promise<void> {
  if (order.value?.pickupType !== 1) { pickupCode.value = ''; pickupUrl.value = ''; qrModules.value = []; return }
  try {
    const info = await getPickupCode(orderId)
    applyPickupCodeInfo(info)
  } catch {
    pickupCode.value = ''; pickupUrl.value = ''; qrModules.value = []
  }
}

/** 生成当前用户、当前订单专属的地址修改草稿缓存键。 */
function getAddressChangeDraftKey(orderId: string): string | null {
  const userId = Number(getAuth()?.userId)
  if (!Number.isInteger(userId) || userId <= 0 || !orderId) return null
  return `${ADDRESS_CHANGE_DRAFT_PREFIX}${userId}:${orderId}`
}

/** 只允许完整手机号进入可编辑表单，避免把后端脱敏值当成提交数据。 */
function isEditableAddressChangePhone(value: unknown): boolean {
  return validateMobile(value).ok
}

/** 判断地址修改表单是否存在可缓存内容。 */
function hasAddressChangeFormValue(): boolean {
  return Object.values(addressChangeForm).some((value) => value.trim().length > 0)
}

/** 读取当前用户当前订单的地址修改草稿，并校验字段类型。 */
function loadAddressChangeDraft(orderId: string): AddressChangeForm | null {
  const key = getAddressChangeDraftKey(orderId)
  if (!key) return null
  try {
    const cached = uni.getStorageSync(key) as Partial<AddressChangeForm> | undefined
    if (!cached || typeof cached !== 'object') return null
    const cachedPhone = typeof cached.receiverPhone === 'string' ? cached.receiverPhone : ''
    const normalizedPhone = validateMobile(cachedPhone)
    return {
      receiverName: cleanText(cached.receiverName),
      receiverPhone: normalizedPhone.ok ? normalizedPhone.value : '',
      receiverAddress: cleanText(cached.receiverAddress),
      reason: cleanText(cached.reason),
    }
  } catch {
    // 本地缓存读取失败时回退到订单当前地址。
    return null
  }
}

/** 保存当前用户当前订单的地址修改草稿，失败时不影响正常提交。 */
function saveAddressChangeDraft(orderId: string): void {
  const key = getAddressChangeDraftKey(orderId)
  if (!key) return
  try {
    uni.setStorageSync(key, {
      receiverName: cleanText(addressChangeForm.receiverName),
      receiverPhone: cleanDigits(addressChangeForm.receiverPhone),
      receiverAddress: cleanText(addressChangeForm.receiverAddress),
      reason: cleanText(addressChangeForm.reason),
    })
  } catch {
    // 本地缓存写入失败时仍允许用户继续提交。
  }
}

/** 查询当前订单最新的地址修改申请，查询失败时保守隐藏申请入口。 */
async function loadAddressChangeRequest(orderId: string): Promise<void> {
  addressChangeQueryFailed.value = false
  try {
    addressChangeRequest.value = await getAddressChangeRequest(orderId)
  } catch {
    addressChangeRequest.value = null
    addressChangeQueryFailed.value = true
  }
}

/** 同城配送进度（含骑手信息）；非配送单或未进配送中时后端返回 progress=null，此处保持隐藏。 */
const deliveryProgress = ref<DeliveryProgress | null>(null)

/**
 * 加载同城配送进度（进度条 + 骑手姓名 + 明文手机号 + 承诺送达时间）。
 * 只有配送单才有数据；非配送单/接口报错一律静默隐藏，不影响订单详情主体。
 */
async function loadDeliveryProgress(orderNo?: string): Promise<void> {
  if (!orderNo) {
    deliveryProgress.value = null
    return
  }
  try {
    const data = await getOrderProgress(orderNo)
    deliveryProgress.value = data && (data.progress != null || data.riderId != null) ? data : null
  } catch {
    deliveryProgress.value = null
  }
}

/** 联系骑手：骑手手机号明文下发，直接拨号。 */
function callRider(): void {
  const phone = String(deliveryProgress.value?.riderPhone || '')
  if (!phone) {
    uni.showToast({ title: '暂无骑手联系方式', icon: 'none' })
    return
  }
  uni.makePhoneCall({ phoneNumber: phone })
}

async function load(orderId: string, silent = false): Promise<void> {
  if (!silent) loading.value = true
  try {
    order.value = await getOrderDetail(orderId)
    await Promise.all([loadPickupCode(orderId), loadPickupShop(), loadAfterSaleFlag(orderId), loadAddressChangeRequest(orderId), loadDeliveryProgress(order.value?.orderNo)])
  }
  catch (error) { if (!silent) errorMessage.value = error instanceof Error ? error.message : '订单详情加载失败' }
  finally {
    loading.value = false
    if (pageVisible.value && order.value?.id) startPickupStatusPolling(String(order.value.id))
  }
}

/** 查询当前订单是否存在处理中的售后单（0待审核/2退款中/4待寄回/5待收货）。 */
async function loadAfterSaleFlag(orderId: string): Promise<void> {
  try {
    const result = await getAfterSaleList(1, 100)
    processingAfterSale.value = result.list.some(
      (record) => String(record.orderId) === String(orderId) && [0, 2, 4, 5].includes(record.status),
    )
  } catch {
    processingAfterSale.value = false
  }
}

/** 加载自提门店完整信息（地址、电话），订单详情仅返回门店名。 */
async function loadPickupShop(): Promise<void> {
  pickupShop.value = null
  if (order.value?.pickupType !== 1) return
  const shopId = order.value.pickupShopId
  if (!shopId) return
  try {
    const shops = await getEnabledShops()
    pickupShop.value = shops.find((shop) => shop.id === shopId) || null
  } catch {
    pickupShop.value = null
  }
}

/** 打开地图导航到自提门店；无经纬度时兜底复制地址。 */
function openMap(): void {
  const shop = pickupShop.value
  if (!shop) return
  if (shop.latitude != null && shop.longitude != null) {
    uni.openLocation({
      latitude: Number(shop.latitude),
      longitude: Number(shop.longitude),
      name: shop.name,
      address: shop.address,
      scale: 16,
    })
    return
  }
  if (shop.address) {
    uni.setClipboardData({ data: shop.address, success: () => uni.showToast({ title: '地址已复制', icon: 'none' }) })
  }
}

/** 初始化地址修改表单：优先恢复草稿，其次恢复被拒绝申请的新地址，最后使用订单当前地址。 */
function openAddressChangeForm(): void {
  if (!order.value?.id || !canRequestAddressChange.value) return
  if (addressChangePending.value) {
    uni.showToast({ title: '地址修改正在审核中', icon: 'none' })
    return
  }

  const draft = loadAddressChangeDraft(String(order.value.id))
  const rejectedRequest = addressChangeRejected.value ? addressChangeRequest.value : null
  const rejectedPhone = isEditableAddressChangePhone(rejectedRequest?.newReceiverPhone) ? rejectedRequest?.newReceiverPhone : ''
  const orderPhone = isEditableAddressChangePhone(order.value.receiverPhone) ? order.value.receiverPhone : ''
  Object.assign(addressChangeForm, draft || {
    receiverName: cleanText(rejectedRequest?.newReceiverName || order.value.receiverName || ''),
    receiverPhone: cleanDigits(rejectedPhone || orderPhone),
    receiverAddress: cleanText(rejectedRequest?.newReceiverAddress || order.value.receiverAddress || ''),
    reason: cleanText(rejectedRequest?.reason || ''),
  })
  addressChangeVisible.value = true
}

/** 关闭地址修改表单，已填写内容由监听器保留在本地草稿中。 */
function closeAddressChangeForm(): void {
  addressChangeVisible.value = false
}

/** 校验地址修改申请字段，校验通过后才允许调用后端接口。 */
function validateAddressChangeForm(): boolean {
  const name = validateText(addressChangeForm.receiverName, { label: '收货人姓名', maxLength: 32 })
  const phone = validateMobile(addressChangeForm.receiverPhone)
  const address = validateText(addressChangeForm.receiverAddress, { label: '详细地址', maxLength: 200 })
  const reason = validateText(addressChangeForm.reason, { label: '修改原因', maxLength: 255, required: false })
  if (!name.ok) {
    uni.showToast({ title: name.message, icon: 'none' })
    return false
  }
  if (!phone.ok) {
    uni.showToast({ title: phone.message, icon: 'none' })
    return false
  }
  if (!address.ok) {
    uni.showToast({ title: address.message, icon: 'none' })
    return false
  }
  if (!reason.ok) {
    uni.showToast({ title: reason.message, icon: 'none' })
    return false
  }
  Object.assign(addressChangeForm, {
    receiverName: name.value,
    receiverPhone: phone.value,
    receiverAddress: address.value,
    reason: reason.value,
  })
  return true
}

/** 提交地址修改申请，成功后刷新服务端订单和审核状态。 */
async function submitAddressChange(): Promise<void> {
  if (!order.value?.id || addressChangeSubmitting.value || !validateAddressChangeForm()) return
  addressChangeSubmitting.value = true
  const orderId = String(order.value.id)
  const data: AddressChangeRequestDTO = {
    receiverName: addressChangeForm.receiverName,
    receiverPhone: addressChangeForm.receiverPhone,
    receiverAddress: addressChangeForm.receiverAddress,
    reason: addressChangeForm.reason,
  }
  saveAddressChangeDraft(orderId)
  try {
    await submitAddressChangeRequest(orderId, data)
    addressChangeVisible.value = false
    uni.showToast({ title: '地址修改申请已提交', icon: 'success' })
    await load(orderId, true)
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '地址修改申请提交失败', icon: 'none' })
  } finally {
    addressChangeSubmitting.value = false
  }
}

// 表单打开期间持续保存，保证用户下次打开同一订单时能恢复最近一次内容。
watch(addressChangeForm, () => {
  if (addressChangeVisible.value && order.value?.id && hasAddressChangeFormValue()) {
    saveAddressChangeDraft(String(order.value.id))
  }
}, { deep: true })

async function action(type: 'cancel' | 'receive' | 'refund'): Promise<void> {
  if (!order.value || actionLoading.value) return
  actionLoading.value = true
  try {
    if (type === 'cancel') await cancelOrder(order.value.id)
    if (type === 'receive') await receiveOrder(order.value.id)
    if (type === 'refund') {
      await refundOrder(order.value.id)
      uni.showToast({ title: '退款申请已提交', icon: 'success' })
      // 退款成功后跳转到退款售后分类，查看售后单进度
      uni.redirectTo({ url: '/subpkg-order/orders/list?tab=aftersale' })
      return
    }
    uni.showToast({ title: type === 'cancel' ? '订单已取消' : '操作成功', icon: 'success' })
    await load(String(order.value.id))
  } catch (error) {
    if (type === 'refund' && isApiRequestError(error) && error.code === 8705) {
      // 该订单已有处理中的售后单：跳到退款售后分类查看
      uni.showToast({ title: '该订单已提交过售后', icon: 'none' })
      uni.redirectTo({ url: '/subpkg-order/orders/list?tab=aftersale' })
      return
    }
    uni.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
  } finally { actionLoading.value = false }
}
/** 状态栏高度：本页为自定义导航（navigationStyle: custom），需自行避开状态栏与右上角胶囊按钮。 */
const statusBarHeight = ref(0)
/** 正文起始位置 = 状态栏 + 导航栏(44px)。 */
const contentTop = computed(() => statusBarHeight.value + 44)

/** 自定义导航栏返回按钮。 */
function goBack(): void {
  uni.navigateBack()
}

onLoad((options?: Record<string, string | undefined>) => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  if (!options?.orderId) { errorMessage.value = '订单参数缺失'; loading.value = false; return }
  if (!isLoggedIn()) {
    loading.value = false
    loginGuideVisible.value = true
    return
  }
  void load(options.orderId)
})
onShow(() => {
  pageVisible.value = true
  stopPickupStatusPolling()
  pickupStatusStartedAt = 0
  pickupPollingPaused.value = false
  // 从核销等流程返回时静默刷新订单状态（如已支付 → 已核销）
  if (order.value?.id) void load(String(order.value.id), true)
})
onHide(() => {
  pageVisible.value = false
  stopPickupStatusPolling()
})
onUnload(() => {
  pageVisible.value = false
  stopPickupStatusPolling()
})

</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <!-- 自定义导航栏：标题相对导航条略上移（原生导航栏标题位置不可调，故改为自绘） -->
    <view class="nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">订单详情</text>
      </view>
    </view>

    <view v-show="loading" class="state">加载中...</view><view v-show="!loading && errorMessage" class="state error">{{ errorMessage }}</view>
    <scroll-view v-show="!loading && !errorMessage && order" class="content" scroll-y>
      <!-- 状态横幅（居中标签） -->
      <view class="status-banner"><text class="status-banner-text">{{ order?.statusDesc }}</text></view>

      <!-- 同城配送进度 + 骑手（仅有配送数据时展示；进度只展示不伪造） -->
      <view v-if="deliveryProgress" class="delivery-card">
        <view class="delivery-head">
          <text class="delivery-stage">{{ deliveryProgress.stage || '配送中' }}</text>
          <text v-if="deliveryProgress.remainingSeconds != null" class="delivery-eta">剩余 {{ Math.max(0, Math.ceil(deliveryProgress.remainingSeconds / 60)) }} 分钟</text>
          <text v-else-if="deliveryProgress.expectedDeliverAt" class="delivery-eta">{{ deliveryProgress.expectedDeliverAt }} 前送达</text>
        </view>
        <view v-if="deliveryProgress.progress != null" class="delivery-bar">
          <view class="delivery-bar-inner" :style="{ width: `${Math.min(100, Math.round(deliveryProgress.progress * 100))}%` }" />
        </view>
        <view v-if="deliveryProgress.riderName" class="delivery-rider">
          <text class="delivery-rider-name">配送骑手：{{ deliveryProgress.riderName }}</text>
          <text class="delivery-call" @click="callRider">联系骑手</text>
        </view>
      </view>

      <!-- 自提二维码（仅自提订单） -->
      <view v-if="order?.pickupType === 1 && pickupUrl" class="card qrcode-card">
        <text class="qrcode-title">请凭二维码取货</text>
        <view class="qr-grid"><view v-for="(row, rowI) in qrModules" :key="rowI" class="qr-row"><view v-for="(cell, colI) in row" :key="colI" class="qr-cell" :class="{ 'is-dark': cell.isBlack }" /></view></view>
        <text class="qrcode-code">{{ pickupCode }}</text>
        <text class="qrcode-tip">到店出示此码给店员扫码核销</text>
      </view>

      <!-- 自提信息（仅自提订单） -->
      <view v-if="order?.pickupType === 1" class="card">
        <view class="line"><text>自提时间</text><text>{{ pickupShop?.openTime || '--' }}</text></view>
        <view class="line"><text>店主电话</text><text>{{ pickupShop?.phone || '--' }}</text></view>
        <view class="line"><text>自提地址</text><text class="right">{{ pickupShop?.address || order?.shopName || '--' }}</text></view>
        <view v-if="isPickupPending" class="pickup-status-row">
          <text>{{ pickupPollingPaused ? '自动检测已暂停' : '等待门店核销，状态会自动更新' }}</text>
          <text class="pickup-refresh" @click="refreshPickupStatus">刷新状态</text>
        </view>
        <view class="line map-line" @click="openMap"><text>地图</text><text class="right map-arrow">›</text></view>
      </view>

      <!-- 配送信息（仅物流订单） -->
      <view v-if="order?.pickupType === 0" class="card">
        <view class="line"><text>配送方式</text><text>物流配送</text></view>
        <view v-if="order?.receiverName" class="line"><text>收货人</text><text>{{ order.receiverName }} {{ order.receiverPhone }}</text></view>
        <view v-if="order?.receiverAddress" class="line"><text>收货地址</text><text class="right">{{ order.receiverAddress }}</text></view>
        <view v-if="addressChangeRequest" class="address-change-status">
          <text>{{ addressChangeStatusText }}</text>
          <text v-if="addressChangeRejected && addressChangeRequest.rejectReason" class="address-change-reason">{{ addressChangeRequest.rejectReason }}</text>
        </view>
        <view v-if="addressChangeActionVisible" class="address-change-action" @click="openAddressChangeForm">修改地址</view>
      </view>

      <!-- 商品清单 + 金额明细 -->
      <view class="card">
        <view v-for="(item, index) in order?.items || []" :key="`${item.productName}-${index}`" class="item"><image v-if="item.productImage" class="item-image" :src="item.productImage" mode="aspectFill" /><view v-else class="item-image" /><view class="item-info"><text>{{ item.productName || '商品' }}</text><text class="muted">{{ item.skuName || '' }}</text></view><text>×{{ item.quantity || 1 }}</text></view>
        <view class="amount">
          <view class="amount-line"><text>小计</text><text>¥{{ amountSummary.subtotal.toFixed(2) }}</text></view>
          <view class="amount-line"><text>优惠减免</text><text class="discount-text">-¥{{ amountSummary.discount.toFixed(2) }}</text></view>
          <view class="amount-line"><text>配送费</text><text>{{ order?.pickupType === 1 ? '(门店自提) ' : '' }}¥{{ amountSummary.freight.toFixed(2) }}</text></view>
          <view class="amount-line amount-total"><text>实付</text><text>¥{{ amountSummary.total.toFixed(2) }}</text></view>
        </view>
      </view>

      <view class="actions"><button v-if="order?.status === 0" :disabled="actionLoading" @click="action('cancel')">取消订单</button><button v-if="order?.status === 2" :disabled="actionLoading" @click="action('receive')">确认收货</button><button v-if="order?.status === 1 && processingAfterSale" disabled>售后中</button><button v-else-if="order?.status === 1" :disabled="actionLoading" @click="action('refund')">申请退款</button></view>
    </scroll-view>

    <!-- 地址修改申请表单：只创建审核申请，不直接更新订单地址。 -->
    <view v-if="addressChangeVisible" class="address-change-mask" @click="closeAddressChangeForm">
      <view class="address-change-sheet" @click.stop>
        <view class="address-change-header"><text class="address-change-title">修改收货地址</text><text class="address-change-close" @click="closeAddressChangeForm">×</text></view>
        <view class="address-change-field"><text class="address-change-label">姓名<span class="address-change-required">*</span></text><input v-model="addressChangeForm.receiverName" class="address-change-input" maxlength="32" placeholder="请输入收货人姓名" placeholder-class="input-placeholder" /></view>
        <view class="address-change-field"><text class="address-change-label">手机号<span class="address-change-required">*</span></text><input v-model="addressChangeForm.receiverPhone" class="address-change-input" type="number" maxlength="11" placeholder="请输入手机号" placeholder-class="input-placeholder" /></view>
        <view class="address-change-field"><text class="address-change-label">详细地址<span class="address-change-required">*</span></text><input v-model="addressChangeForm.receiverAddress" class="address-change-input" maxlength="200" placeholder="请输入详细地址" placeholder-class="input-placeholder" /></view>
        <view class="address-change-reason-field"><text class="address-change-label">修改原因</text><textarea v-model="addressChangeForm.reason" class="address-change-textarea" maxlength="255" placeholder="请输入修改原因（选填）" placeholder-class="input-placeholder" /></view>
        <view class="address-change-submit" :class="{ disabled: addressChangeSubmitting }" @click="submitAddressChange">{{ addressChangeSubmitting ? '提交中...' : '提交审核' }}</view>
      </view>
    </view>

    <LoginGuide v-model="loginGuideVisible" />
  </view>
</template>

<style>
.page { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; background: #f6f6f6; color: #242526; }
/* 自定义导航栏：标题居中并相对导航条上移一点点，避免视觉偏下 */
.nav { position: fixed; top: 0; right: 0; left: 0; z-index: 30; background: #fff; }
.nav-inner { position: relative; height: 44px; }
.nav-back { position: absolute; top: 50%; left: 24rpx; color: #1d2129; font-size: 46rpx; line-height: 1; transform: translateY(-50%); }
.nav-title { position: absolute; top: 50%; left: 50%; color: #1d2129; font-size: 34rpx; font-weight: 600; line-height: 1; transform: translate(-50%, -58%); }
.content { flex: 1; min-height: 0; padding: 24rpx; box-sizing: border-box; }
.status-banner { display: flex; justify-content: center; margin-bottom: 18rpx; padding: 22rpx; background: rgba(145, 100, 72, 0.13); border-radius: 10rpx; }.status-banner-text { color: #916448; font-size: 32rpx; font-weight: 700; }
/* 同城配送进度卡片 */
.delivery-card { margin-bottom: 18rpx; padding: 22rpx; background: #fff; border-radius: 12rpx; }
.delivery-head { display: flex; align-items: center; justify-content: space-between; }
.delivery-stage { color: #1f2329; font-size: 30rpx; font-weight: 600; }
.delivery-eta { color: #ff5500; font-size: 26rpx; }
.delivery-bar { height: 10rpx; margin-top: 16rpx; border-radius: 5rpx; background: #f2f3f7; overflow: hidden; }
.delivery-bar-inner { height: 100%; border-radius: 5rpx; background: linear-gradient(90deg, #ffb341, #ff5500); transition: width .4s ease; }
.delivery-rider { display: flex; align-items: center; justify-content: space-between; margin-top: 16rpx; }
.delivery-rider-name { color: #4e5969; font-size: 26rpx; }
.delivery-call { color: #ff5500; font-size: 26rpx; }
.card { margin-bottom: 18rpx; padding: 26rpx; background: #fff; border-radius: 10rpx; }
.line { display: flex; justify-content: space-between; gap: 24rpx; padding: 18rpx 0; color: #555; font-size: 25rpx; border-bottom: 1px solid #f2f2f2; }.line:last-child { border-bottom: 0; }.right { flex: 1; text-align: right; }
.pickup-status-row { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; padding: 18rpx 0; color: #916448; font-size: 23rpx; border-bottom: 1px solid #f2f2f2; }.pickup-refresh { flex-shrink: 0; color: #222; text-decoration: underline; }
.map-line { align-items: center; }.map-arrow { color: #959595; font-size: 36rpx; line-height: 1; }
.item { display: flex; align-items: center; gap: 16rpx; padding: 16rpx 0; }.item-image { width: 84rpx; height: 84rpx; flex-shrink: 0; background: #e9e7dd; }.item-info { display: flex; flex: 1; flex-direction: column; gap: 8rpx; font-size: 25rpx; }.muted { color: #999; font-size: 22rpx; }
.amount { margin-top: 10rpx; padding-top: 14rpx; border-top: 1px solid #f2f2f2; }.amount-line { display: flex; justify-content: space-between; padding: 10rpx 0; color: #8e8e8e; font-size: 24rpx; }.amount-line .discount-text { color: #d40000; }.amount-total { color: #222; font-weight: 700; }
.actions { display: flex; gap: 16rpx; padding-bottom: 48rpx; }button { flex: 1; margin: 0; color: #fff; background: #222; border-radius: 6rpx; font-size: 26rpx; }button::after { border: 0; }.state { padding: 220rpx 24rpx; color: #999; text-align: center; }.error { color: #c44; }
.qrcode-card { display: flex; flex-direction: column; align-items: center; padding: 30rpx 26rpx; }.qrcode-title { font-size: 28rpx; font-weight: 600; color: #333; margin-bottom: 20rpx; }.qr-grid { padding: 10rpx; background: #fff; border: 1rpx solid #e6e8eb; }.qr-row { display: flex; }.qr-cell { width: 10rpx; height: 10rpx; }.qr-cell.is-dark { background: #000; }.qrcode-code { margin-top: 16rpx; font-size: 30rpx; letter-spacing: 4rpx; color: #222; font-weight: 600; }.qrcode-tip { margin-top: 10rpx; font-size: 22rpx; color: #999; }
.address-change-status { display: flex; flex-direction: column; gap: 8rpx; margin-top: 18rpx; padding-top: 18rpx; color: #916448; font-size: 23rpx; border-top: 1px solid #f2f2f2; }.address-change-reason { color: #a35c5c; line-height: 1.5; }.address-change-action { display: flex; align-items: center; justify-content: center; height: 68rpx; margin-top: 18rpx; color: #fff; background: #222; border-radius: 6rpx; font-size: 25rpx; }
.address-change-mask { position: fixed; inset: 0; z-index: 70; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .68); }
.address-change-sheet { width: 100%; max-height: 88vh; padding: 28rpx 28rpx calc(28rpx + env(safe-area-inset-bottom)); background: #fff; border-radius: 24rpx 24rpx 0 0; box-sizing: border-box; overflow-y: auto; }
.address-change-header { position: relative; display: flex; align-items: center; justify-content: center; min-height: 70rpx; }.address-change-title { color: #222; font-size: 30rpx; font-weight: 700; }.address-change-close { position: absolute; top: 50%; right: 0; color: #888; font-size: 42rpx; font-weight: 300; line-height: 1; transform: translateY(-50%); }
.address-change-field { display: flex; align-items: center; min-height: 78rpx; margin-top: 16rpx; padding: 0 22rpx; background: #f7f7f7; box-sizing: border-box; }.address-change-label { flex: 0 0 132rpx; color: #333; font-size: 25rpx; white-space: nowrap; }.address-change-required { margin-left: 4rpx; color: #d40000; }.address-change-input { flex: 1; min-width: 0; height: 78rpx; color: #333; font-size: 25rpx; }
.address-change-reason-field { margin-top: 16rpx; padding: 20rpx 22rpx; background: #f7f7f7; box-sizing: border-box; }.address-change-reason-field .address-change-label { display: block; }.address-change-textarea { width: 100%; min-height: 140rpx; margin-top: 14rpx; color: #333; font-size: 25rpx; line-height: 1.5; }.address-change-submit { display: flex; align-items: center; justify-content: center; height: 82rpx; margin-top: 24rpx; color: #fff; background: #050505; border-radius: 6rpx; font-size: 28rpx; }.address-change-submit.disabled { opacity: .55; pointer-events: none; }
</style>
