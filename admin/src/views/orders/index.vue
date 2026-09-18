<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useRoute } from 'vue-router'
import { useOrderStore } from '@/stores/order'
import { useTodoStore } from '@/stores/todo'
import DataTable from '@/components/DataTable.vue'
import type { Order, OrderAddressUpdateDTO, OrderPickupType, OrderRefundDTO, OrderStatus } from '@/types/order'
import { isVerifiedStatus } from '@/utils/orderRules'
import { retryWxShipping } from '@/api/order'
import { copyToClipboard } from '@/utils/clipboard'
import { Box, CircleCheck, CopyDocument, Delete, RefreshLeft, View } from '@element-plus/icons-vue'

const store = useOrderStore()
const todoStore = useTodoStore()
const route = useRoute()
const selected = ref<Order[]>([])
const statusTab = ref<string>('')
const detailVisible = ref(false)
const shipVisible = ref(false)
const batchShipVisible = ref(false)
const verifyVisible = ref(false)
const addressVisible = ref(false)
const refundVisible = ref(false)
const traceVisible = ref(false)
const shipFormRef = ref<FormInstance>()
const batchShipFormRef = ref<FormInstance>()
const verifyFormRef = ref<FormInstance>()
const addressFormRef = ref<FormInstance>()
const shipForm = reactive({ expressCompany: '', expressCompanyCode: '', expressNo: '' })
const batchShipForm = reactive({ expressCompany: '', expressCompanyCode: '', expressNo: '' })
const verifyForm = reactive({ orderId: '', orderNo: '', code: '' })
const addressForm = reactive<OrderAddressUpdateDTO>({ receiverName: '', receiverPhone: '', receiverAddress: '' })
const refundForm = reactive({ orderId: '', orderNo: '', reason: '' })
const dateRange = ref<[string, string] | null>(null)
const orderNoInput = ref('')
const shipRules: FormRules = {
  expressCompanyCode: [{ required: true, message: '请选择快递公司', trigger: 'change' }],
  expressNo: [{ required: true, message: '请输入快递单号', trigger: 'blur' }],
}
const verifyRules: FormRules = {
  code: [{ required: true, message: '请输入自提码', trigger: 'blur' }],
}
const addressRules: FormRules = {
  receiverName: [{ required: true, message: '请输入收货人', trigger: 'blur' }],
  receiverPhone: [{ required: true, pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号', trigger: 'blur' }],
  receiverAddress: [{ required: true, message: '请输入收货地址', trigger: 'blur' }],
}

const statusOptions: Array<{ label: string; value: OrderStatus }> = [
  { label: '待支付', value: 0 },
  { label: '已支付', value: 1 },
  { label: '已发货', value: 2 },
  { label: '已收货', value: 3 },
  { label: '已完成', value: 4 },
  { label: '已关闭', value: 5 },
  { label: '退款中', value: 6 },
  { label: '已退款', value: 7 },
  { label: '已核销', value: 8 },
]
const expressCompanyOptions = [
  { label: '顺丰速运', value: 'shunfeng' },
  { label: '圆通速递', value: 'yuantong' },
  { label: '中通快递', value: 'zhongtong' },
  { label: '申通快递', value: 'shentong' },
  { label: '韵达快递', value: 'yunda' },
  { label: '京东物流', value: 'jd' },
  { label: 'EMS', value: 'ems' },
  { label: '邮政快递包裹（国内）', value: 'youzhengguonei' },
  { label: '邮政国际包裹', value: 'youzhengguoji' },
  { label: '百世快递', value: 'huitongkuaidi' },
  { label: '极兔速递', value: 'jtexpress' },
  { label: '德邦物流', value: 'debangkuaidi' },
  { label: '天天快递', value: 'tiantian' },
  { label: '宅急送', value: 'zhaijisong' },
  { label: '中通快运', value: 'zhongtongkuaiyun' },
  { label: '韵达快运', value: 'yundakuaiyun' },
]
const hasSelection = computed(() => selected.value.length > 0)
/**
 * 是否「自提订单」形态。
 *
 * ⚠️ 2026-09-17 修：原来只认 `route.path === '/orders/pickup'`，而待办铃铛「自提待核销」跳的是
 * `/orders?statuses=1&pickupType=1`（**路径是 `/orders`**）→ 形态被判成"普通订单"，
 * 却因 query 带着 `pickupType=1` 查出了自提订单，于是普通订单列表里混进自提单、还带着「发货」操作。
 * 现在把 `?pickupType=1` 也算作自提形态。
 */
const isPickupOrder = computed(() => route.path === '/orders/pickup' || String(route.query.pickupType || '') === '1')
const pageTitle = computed(() => isPickupOrder.value ? '自提订单' : '普通订单')

/**
 * 状态页签（**按形态过滤**，2026-09-17 修）：
 * - 普通订单（物流）没有「已核销」这一说 —— 该状态码 8 只有自提订单才有；
 * - 自提订单也没有「已发货 / 已收货」；
 * - 自提订单的 1 语义是「待核销」（普通订单的 1 才是「已支付/待发货」），这里同步改标签。
 */
const visibleStatusOptions = computed(() => {
  if (isPickupOrder.value) {
    return statusOptions
      .filter((option) => option.value !== 2 && option.value !== 3)
      .map((option) => (option.value === 1 ? { label: '待核销', value: 1 as OrderStatus } : option))
  }
  return statusOptions.filter((option) => option.value !== 8)
})
const eligibleSelected = computed(() => selected.value.filter((order) => !isDeleted(order) && order.status === 1 && order.pickupType === 0))
const deletableSelected = computed(() => selected.value.filter((order) => !isDeleted(order)))
const restorableSelected = computed(() => selected.value.filter((order) => isDeleted(order)))

function statusType(status: OrderStatus): 'info' | 'warning' | 'primary' | 'success' | 'danger' {
  return ({ 0: 'info', 1: 'warning', 2: 'primary', 3: 'success', 4: 'success', 5: 'info', 6: 'warning', 7: 'danger', 8: 'success' } as const)[status]
}

/** 判断订单是否为后端标记的软删除记录。 */
function isDeleted(order: Order): boolean {
  return order.delFlag === 1
}

/** 仅已发货或已收货且未软删除的订单允许客服人工退款。 */
function isRefundable(order: Order): boolean {
  return !isDeleted(order) && (order.status === 2 || order.status === 3)
}

/** 仅已发货及后续物流订单允许查询轨迹，拦截状态异常但残留单号的数据。 */
function isTraceable(order: { pickupType: Order['pickupType']; status: OrderStatus; expressNo?: string }): boolean {
  return order.pickupType === 0 && order.status >= 2 && Boolean(order.expressNo?.trim())
}

/** 配送方式文案：0=物流配送 / 1=线下自提 / 2=同城配送。 */
function pickupTypeText(type?: OrderPickupType): string {
  if (type === 1) return '线下自提'
  if (type === 2) return '同城配送'
  return '物流配送'
}

// ===== 微信「发货信息管理」上报状态（自动上报失败时在中控手动重试） =====
/** 手动重试上报进行中。 */
const wxRetrying = ref(false)

/** 上报状态文案（0 未上报 / 1 已上报 / 2 失败 / 3 无需上报）。 */
function wxShippingText(status?: number): string {
  if (status === 1) return '已上报'
  if (status === 2) return '上报失败'
  if (status === 3) return '无需上报'
  return '未上报'
}

/** 上报状态标签颜色。 */
function wxShippingTagType(status?: number): 'success' | 'danger' | 'info' {
  if (status === 1) return 'success'
  if (status === 2) return 'danger'
  return 'info'
}

/** 手动重试微信发货信息上报（失败单据修复原因后使用；接口幂等）。 */
async function doRetryWxShipping(order: Order): Promise<void> {
  wxRetrying.value = true
  try {
    const result = await retryWxShipping(order.id)
    ElMessage.success(result?.message || '已重新提交，请稍后刷新查看结果')
    await store.fetchDetail(order.id)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '微信发货信息重试失败')
  } finally {
    wxRetrying.value = false
  }
}

// ===== 复制（发货要照着信息下快递面单） =====
/** 手机号是否被脱敏（含 `*`）——B 端后台应为明文，含 `*` 说明该环境后端未更新。 */
function isPhoneMasked(phone?: string): boolean {
  return Boolean(phone && String(phone).includes('*'))
}

/** 复制单个字段（脱敏号码给出警告，避免拿去下面单）。 */
async function copyField(value: string | undefined, label: string): Promise<void> {
  const text = String(value || '').trim()
  if (!text || text === '暂无数据') {
    ElMessage.warning(`没有可复制的${label}`)
    return
  }
  const ok = await copyToClipboard(text)
  if (!ok) {
    ElMessage.error('复制失败，请手动选中文本复制')
    return
  }
  if (text.includes('*')) ElMessage.warning(`已复制${label}，但它是脱敏号码（含 *），不能用于快递面单`)
  else ElMessage.success(`${label}已复制`)
}

/** 一键复制整段收货信息（姓名 + 电话 + 地址），便于粘贴到快递系统。 */
async function copyReceiverInfo(): Promise<void> {
  const detail = store.detail
  if (!detail) return
  const line = [detail.receiverName, detail.receiverPhone, detail.receiverAddress].filter(Boolean).join(' ')
  if (!line) {
    ElMessage.warning('暂无收货信息')
    return
  }
  const ok = await copyToClipboard(line)
  if (!ok) {
    ElMessage.error('复制失败，请手动选中文本复制')
    return
  }
  if (isPhoneMasked(detail.receiverPhone)) ElMessage.warning('已复制收货信息，但电话号码是脱敏号（含 *），不能用于快递面单')
  else ElMessage.success('收货信息已复制')
}

/** 下拉框只提交后端需要的编码，同时把对应名称写入发货 DTO。 */
function syncExpressCompany(form: { expressCompany: string; expressCompanyCode: string }, code: string): void {
  form.expressCompanyCode = code
  form.expressCompany = expressCompanyOptions.find((option) => option.value === code)?.label || ''
}

/** 切换订单状态页签，并只提交当前接口支持的状态参数。 */
function handleStatusTabChange(value: string | number): void {
  const normalizedValue = String(value)
  store.filters.status = normalizedValue === '' ? '' : Number(normalizedValue) as OrderStatus
  store.page = 1
  void loadList()
}

/** 将日期选择器的日期转换为后端要求的下单时间范围。 */
function handleDateRangeChange(value: [string, string] | null): void {
  dateRange.value = value
  store.filters.startTime = value?.[0] ? `${value[0]} 00:00:00` : ''
  store.filters.endTime = value?.[1] ? `${value[1]} 23:59:59` : ''
  store.page = 1
  void loadList()
}

/** 按订单号搜索（精确匹配），回车或点击搜索触发。 */
function searchByOrderNo(): void {
  store.filters.orderNo = orderNoInput.value.trim()
  store.page = 1
  void loadList()
}

async function showDetail(order: Order): Promise<void> {
  try {
    await store.fetchDetail(order.id)
    detailVisible.value = true
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单详情查询失败')
  }
}

/** 打开普通物流订单的地址编辑表单。 */
function openAddressEditor(): void {
  if (!store.detail || store.detail.pickupType !== 0 || store.detail.status !== 1 || isDeleted(store.detail)) return
  addressForm.receiverName = store.detail.receiverName || ''
  addressForm.receiverPhone = store.detail.receiverPhone || ''
  addressForm.receiverAddress = store.detail.receiverAddress || ''
  addressVisible.value = true
}

/** 校验并提交订单收货地址修改。 */
async function submitAddress(): Promise<void> {
  const valid = await addressFormRef.value?.validate().catch(() => false)
  if (!valid || !store.detail) return
  try {
    await ElMessageBox.confirm('确认修改该订单的收货地址吗？', '修改地址确认')
    await store.updateAddress(store.detail.id, { ...addressForm })
    addressVisible.value = false
    ElMessage.success('订单地址已修改')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '订单地址修改失败')
  }
}

/** 打开客服人工退款表单。 */
function openRefund(order: Order): void {
  if (!isRefundable(order)) return
  refundForm.orderId = order.id
  refundForm.orderNo = order.orderNo
  refundForm.reason = ''
  refundVisible.value = true
}

/** 二次确认后提交人工全额退款。 */
async function submitRefund(): Promise<void> {
  if (!refundForm.orderId) return
  const reason = refundForm.reason.trim()
  if (reason.length > 200) {
    ElMessage.warning('退款原因不能超过 200 个字符')
    return
  }
  try {
    await ElMessageBox.confirm(`确认对订单“${refundForm.orderNo}”执行全额退款吗？退款将通过微信异步到账，请确认。`, '客服人工退款二次确认', { type: 'warning', confirmButtonText: '确认退款', cancelButtonText: '取消' })
    const payload: OrderRefundDTO = { reason: reason || null }
    await store.refund(refundForm.orderId, payload)
    refundVisible.value = false
    ElMessage.success('退款申请已提交')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '订单退款失败')
  }
}

/** 查询物流轨迹；无快递单号时不调用接口。 */
async function openTrace(): Promise<void> {
  if (!store.detail || !isTraceable(store.detail)) return
  traceVisible.value = true
  try {
    await store.fetchTrace(store.detail.id)
  } catch (error) {
    traceVisible.value = false
    ElMessage.error(error instanceof Error ? error.message : '物流轨迹查询失败')
  }
}

async function openShip(order: Order): Promise<void> {
  shipForm.expressCompany = ''
  shipForm.expressCompanyCode = ''
  shipForm.expressNo = ''
  shipVisible.value = true
  try {
    await store.fetchDetail(order.id)
  } catch {
    /* 详情加载失败不影响打开发货弹窗，提交时仍会阻止空详情。 */
  }
}

async function submitShip(): Promise<void> {
  const valid = await shipFormRef.value?.validate().catch(() => false)
  if (!valid || !store.detail) return
  try {
    await store.ship(store.detail.id, { ...shipForm })
    shipVisible.value = false
    ElMessage.success('订单已发货')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单发货失败')
  }
}

function openBatchShip(): void {
  if (!eligibleSelected.value.length) return
  batchShipForm.expressCompany = ''
  batchShipForm.expressCompanyCode = ''
  batchShipForm.expressNo = ''
  if (eligibleSelected.value.length !== selected.value.length) {
    ElMessage.info(`已跳过 ${selected.value.length - eligibleSelected.value.length} 个不可发货订单`)
  }
  batchShipVisible.value = true
}

async function submitBatchShip(): Promise<void> {
  const valid = await batchShipFormRef.value?.validate().catch(() => false)
  if (!valid || !eligibleSelected.value.length) return
  try {
    await ElMessageBox.confirm(`确认批量发货 ${eligibleSelected.value.length} 个订单吗？`, '批量发货确认')
    const result = await store.shipOrders(eligibleSelected.value.map((order) => order.id), { ...batchShipForm })
    batchShipVisible.value = false
    selected.value = []
    if (result.failedIds.length) {
      ElMessage.warning(`发货成功 ${result.successIds.length} 个，失败 ${result.failedIds.length} 个`)
    } else {
      ElMessage.success(`已批量发货 ${result.successIds.length} 个订单`)
    }
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量发货失败')
  }
}

function isDeletable(order: Order): boolean {
  return !isDeleted(order)
}

async function removeOrder(order: Order): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除订单“${order.orderNo}”吗？删除后订单将从后台列表移除。`, '删除订单二次确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    await store.removeOrder(order.id)
    selected.value = []
    ElMessage.success('订单已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '订单删除失败')
  }
}

async function removeSelected(): Promise<void> {
  if (!deletableSelected.value.length) {
    ElMessage.info('请选择要删除的订单')
    return
  }
  const skippedCount = selected.value.length - deletableSelected.value.length
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${deletableSelected.value.length} 个订单吗？删除后订单将从后台列表移除。`, '批量删除订单二次确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    const result = await store.removeOrders(deletableSelected.value.map((order) => order.id))
    selected.value = []
    const skippedMessage = skippedCount ? `，已跳过 ${skippedCount} 个已删除订单` : ''
    if (result.failedIds.length) {
      ElMessage.warning(`删除成功 ${result.successIds.length} 个，失败 ${result.failedIds.length} 个${skippedMessage}`)
    } else {
      ElMessage.success(`已删除 ${result.successIds.length} 个订单${skippedMessage}`)
    }
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}

/** 批量恢复软删除订单，跳过当前选择中的正常订单。 */
async function restoreSelected(): Promise<void> {
  if (!restorableSelected.value.length) {
    ElMessage.info('请选择要恢复的订单')
    return
  }
  try {
    await ElMessageBox.confirm(`确认恢复选中的 ${restorableSelected.value.length} 个订单吗？`, '批量恢复订单二次确认', { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' })
    const result = await store.restoreOrders(restorableSelected.value.map((order) => order.id))
    selected.value = []
    if (result.failedIds.length) {
      ElMessage.warning(`恢复成功 ${result.successIds.length} 个，失败 ${result.failedIds.length} 个`)
    } else {
      ElMessage.success(`已恢复 ${result.successIds.length} 个订单`)
    }
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量恢复失败')
  }
}

/** 打开自提订单手工核销弹窗。 */
function openVerify(order: Order): void {
  verifyForm.orderId = order.id
  verifyForm.orderNo = order.orderNo
  verifyForm.code = ''
  verifyVisible.value = true
}

/** 校验自提码并提交后台手工核销。 */
async function submitVerify(): Promise<void> {
  const valid = await verifyFormRef.value?.validate().catch(() => false)
  if (!valid) return
  try {
    await store.verify(verifyForm.orderId, { code: verifyForm.code.trim() })
    verifyVisible.value = false
    ElMessage.success('订单核销成功')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单核销失败')
  }
}

async function loadList(): Promise<void> {
  // 形态决定配送方式：自提页 = 1（线下自提），普通订单页 = 0（物流配送）。
  // ⚠️ 2026-09-17 修：原先普通订单页会"保留 URL 里的 pickupType=1/2"，导致从待办「自提待核销」
  // 跳进来时**页面仍是普通订单形态**、列表却查出自提订单（甚至能给自提订单填物流单号发货）。
  // 现在 `isPickupOrder` 已兼容 `?pickupType=1`（视为自提形态），这里按形态定值即可。
  store.filters.pickupType = isPickupOrder.value ? 1 : 0
  try {
    await store.fetchList()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单列表查询失败')
  }
}

/**
 * 从 URL query 初始化筛选并透传给列表接口（待办铃铛跳转用）：
 * - `/orders?statuses=1&pickupType=0` 待发货订单
 * - `/orders?statuses=1&pickupType=1` 自提待核销
 * - `/orders?wxShippingStatus=2` 微信发货上报失败
 */
function applyQueryFilters(): void {
  const statuses = route.query.statuses
  const status = route.query.status
  const pickupType = route.query.pickupType
  const wxShippingStatus = route.query.wxShippingStatus
  const rawStatus = typeof statuses === 'string' && statuses !== '' ? statuses : (typeof status === 'string' ? status : '')
  if (rawStatus !== '' && !Number.isNaN(Number(rawStatus))) {
    store.filters.status = Number(rawStatus) as OrderStatus
    statusTab.value = String(Number(rawStatus)) // 同步页签高亮
  }
  if (pickupType === '0' || pickupType === '1') {
    store.filters.pickupType = Number(pickupType) as OrderPickupType
  }
  if (typeof wxShippingStatus === 'string' && wxShippingStatus !== '' && !Number.isNaN(Number(wxShippingStatus))) {
    store.filters.wxShippingStatus = Number(wxShippingStatus)
  }
}

/**
 * 路由变化时（含**同一页面内 query 变化**）重置筛选并应用 URL 条件。
 * ⚠️ 必须监听 `route.fullPath` 而不是 `route.path`：待办铃铛在**同一模块内**连续点击时
 * （普通订单 → 待发货 / 自提待核销 / 微信上报失败）路径不变、只有 query 变，
 * 只听 path 会"点了没反应"。只有 path 真的变了才重置 pickupType 等（避免 query 跳转被重置覆盖）。
 */
watch(() => route.fullPath, () => {
  const path = route.path
  if (path !== '/orders' && path !== '/orders/pickup') return
  selected.value = []
  statusTab.value = ''
  store.resetFilters()
  store.filters.pickupType = path === '/orders/pickup' ? 1 : 0
  dateRange.value = null
  // reset 之后再应用 URL query，避免被 reset 清掉
  applyQueryFilters()
  void loadList()
})

/** 待办铃铛点击信号：重复点同一项时路由不变、router 不会重新导航，需要重新套用 URL 筛选（200ms 去重）。 */
let lastTodoApply = 0
watch(() => todoStore.clickTick, () => {
  const now = Date.now()
  if (now - lastTodoApply < 200) return
  lastTodoApply = now
  selected.value = []
  statusTab.value = ''
  store.resetFilters()
  store.filters.pickupType = isPickupOrder.value ? 1 : 0
  dateRange.value = null
  applyQueryFilters()
  void loadList()
})

onMounted(() => {
  applyQueryFilters()
  void loadList()
})
</script>

<template>
  <section class="page-container">
    <div class="page-heading">
      <div><h1>{{ pageTitle }}</h1><p>{{ isPickupOrder ? '管理到店提货订单及核销流程。' : '管理普通订单状态、履约流程和物流信息。' }}</p></div>
      <el-button v-if="!isPickupOrder" @click="loadList">刷新</el-button>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form inline class="order-filter-form">
        <el-form-item label="订单号"><el-input v-model="orderNoInput" placeholder="输入订单号" clearable style="width: 220px" @keyup.enter="searchByOrderNo" @clear="searchByOrderNo" /></el-form-item>
        <el-form-item><el-button type="primary" @click="searchByOrderNo">搜索</el-button></el-form-item>
        <el-form-item label="下单时间"><el-date-picker :model-value="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" @update:model-value="handleDateRangeChange" /></el-form-item>
        <el-form-item v-if="!isPickupOrder" label="微信发货上报">
          <el-select v-model="store.filters.wxShippingStatus" clearable placeholder="全部" style="width: 160px" @change="loadList">
            <el-option label="未上报" :value="0" />
            <el-option label="已上报" :value="1" />
            <el-option label="上报失败" :value="2" />
            <el-option label="无需上报" :value="3" />
          </el-select>
        </el-form-item>
        <el-form-item><el-button @click="store.resetFilters(); dateRange = null; orderNoInput = ''; void loadList()">重置</el-button></el-form-item>
      </el-form>
    </el-card>

    <el-tabs v-model="statusTab" class="order-status-tabs" @tab-change="handleStatusTabChange">
      <el-tab-pane label="全部" name="" />
      <el-tab-pane v-for="option in visibleStatusOptions" :key="option.value" :label="option.label" :name="String(option.value)" />
    </el-tabs>

    <template v-if="isPickupOrder">
      <el-card shadow="never" class="content-card">
         <div class="toolbar">
           <div><strong>自提订单</strong><span class="toolbar-count">共 {{ store.total }} 条</span></div>
           <div class="toolbar-actions pickup-order-actions">
           <span v-if="hasSelection" class="selection-tip">已选择 {{ selected.length }} 项</span>
             <el-button type="warning" plain :disabled="!restorableSelected.length || store.restoring" :loading="store.restoring" @click="restoreSelected"><el-icon><RefreshLeft /></el-icon>批量恢复</el-button>
             <el-button type="danger" plain :disabled="!deletableSelected.length || store.deleting" :loading="store.deleting" @click="removeSelected">批量删除</el-button>
           </div>
         </div>
         <DataTable :data="store.list" :loading="store.loading" :total="store.total" :page="store.page" :page-size="store.pageSize" @selection-change="selected = $event" @page-change="store.page = $event; void loadList()" @size-change="store.pageSize = $event; store.page = 1; void loadList()">
          <el-table-column prop="orderNo" label="订单号" min-width="200" />
          <el-table-column label="商品" min-width="220"><template #default="{ row }"><div class="order-product"><el-image v-if="row.firstProductImage" :src="row.firstProductImage" class="order-image" fit="cover" /><span>{{ row.totalQuantity }} 件商品</span></div></template></el-table-column>
          <el-table-column label="订单金额" width="120"><template #default="{ row }">¥ {{ Number(row.payAmount || 0).toFixed(2) }}</template></el-table-column>
          <el-table-column prop="createTime" label="下单时间" min-width="180" />
          <el-table-column prop="shopName" label="自提门店" min-width="150"><template #default="{ row }">{{ row.shopName || '暂无数据' }}</template></el-table-column>
          <el-table-column label="核销状态" width="120"><template #default="{ row }"><el-tag :type="isVerifiedStatus(row.status) ? 'success' : 'warning'">{{ isVerifiedStatus(row.status) ? '已核销' : '待核销' }}</el-tag></template></el-table-column>
          <el-table-column label="订单状态" width="130"><template #default="{ row }"><div class="order-status"><el-tag :type="statusType(row.status)">{{ row.statusDesc }}</el-tag></div></template></el-table-column>
          <el-table-column label="操作" fixed="right" width="240"><template #default="{ row }"><div class="operator-actions"><el-button size="small" type="primary" @click="showDetail(row)"><el-icon><View /></el-icon>详情</el-button><el-button v-if="row.status === 1 && row.pickupType === 1" size="small" type="success" :loading="store.verifying" @click="openVerify(row)"><el-icon><CircleCheck /></el-icon>核销</el-button><el-button size="small" type="danger" :disabled="!isDeletable(row) || store.deleting" :loading="store.deleting" title="删除订单" @click="removeOrder(row)"><el-icon><Delete /></el-icon>删除</el-button></div></template></el-table-column>
        </DataTable>
      </el-card>
    </template>

    <template v-else>
      <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <div><strong>订单列表</strong><span class="toolbar-count">共 {{ store.total }} 条</span></div>
        <div class="toolbar-actions">
          <span v-if="hasSelection" class="selection-tip">已选择 {{ selected.length }} 项</span>
          <el-button type="primary" plain :disabled="!eligibleSelected.length || store.shipping" :loading="store.shipping" @click="openBatchShip">批量发货</el-button>
          <el-button type="warning" plain :disabled="!restorableSelected.length || store.restoring" :loading="store.restoring" @click="restoreSelected"><el-icon><RefreshLeft /></el-icon>批量恢复</el-button>
          <el-button type="danger" plain :disabled="!deletableSelected.length || store.deleting" :loading="store.deleting" @click="removeSelected">批量删除</el-button>
        </div>
      </div>
      <DataTable
        :data="store.list"
        :loading="store.loading"
        :total="store.total"
        :page="store.page"
        :page-size="store.pageSize"
        @selection-change="selected = $event"
        @page-change="store.page = $event; void loadList()"
        @size-change="store.pageSize = $event; store.page = 1; void loadList()"
      >
        <el-table-column prop="orderNo" label="订单号" min-width="190" />
        <el-table-column label="配送方式" width="110"><template #default="{ row }">{{ pickupTypeText(row.pickupType) }}</template></el-table-column>
        <el-table-column label="商品" min-width="220">
          <template #default="{ row }">
            <div class="order-product">
              <el-image v-if="row.firstProductImage" :src="row.firstProductImage" class="order-image" fit="cover" />
              <div class="order-product-text">
                <span v-if="row.firstProductName" class="order-product-name">{{ row.firstProductName }}</span>
                <span class="order-product-count">{{ row.totalQuantity }} 件商品</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="下单时间" min-width="180" />
        <el-table-column label="实付金额" width="130"><template #default="{ row }">¥ {{ Number(row.payAmount || 0).toFixed(2) }}</template></el-table-column>
        <el-table-column label="订单状态" width="190">
          <template #default="{ row }">
            <div class="order-status">
              <el-tag :type="statusType(row.status)">{{ row.statusTextByType || row.statusDesc }}</el-tag>
              <el-tag v-if="row.wxShippingStatus === 2" type="danger" effect="plain" :title="`微信发货信息上报失败：${row.wxShippingErrmsg || '原因未返回'}（可在订单详情里重试）`">微信上报失败</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" fixed="right" width="240"><template #default="{ row }"><div class="operator-actions"><el-button size="small" type="primary" @click="showDetail(row)"><el-icon><View /></el-icon>详情</el-button><el-button v-if="row.status === 1 && row.pickupType === 0" size="small" type="primary" @click="openShip(row)"><el-icon><Box /></el-icon>发货</el-button><el-button size="small" type="danger" :disabled="!isDeletable(row) || store.deleting" :loading="store.deleting" title="删除订单" @click="removeOrder(row)"><el-icon><Delete /></el-icon>删除</el-button></div></template></el-table-column>
      </DataTable>
      </el-card>
    </template>

    <el-dialog v-model="detailVisible" title="订单详情" width="820px" append-to-body>
      <el-skeleton v-if="store.detailLoading" :rows="8" animated />
      <template v-else-if="store.detail">
        <el-steps :active="Math.min(store.detail.status, 3)" finish-status="success" align-center><el-step title="提交订单" /><el-step title="支付" /><el-step title="发货" /><el-step title="完成" /></el-steps>
        <el-divider />
        <el-descriptions :column="2" border><el-descriptions-item label="订单号">{{ store.detail.orderNo }}</el-descriptions-item><el-descriptions-item label="订单状态"><span class="order-status"><el-tag :type="statusType(store.detail.status)">{{ store.detail.statusDesc }}</el-tag><el-tag v-if="isDeleted(store.detail)" type="danger" effect="plain">已删除</el-tag></span></el-descriptions-item><el-descriptions-item label="配送方式">{{ pickupTypeText(store.detail.pickupType) }}</el-descriptions-item><el-descriptions-item v-if="store.detail.pickupType === 1" label="核销状态">{{ isVerifiedStatus(store.detail.status) ? '已核销' : '待核销' }}</el-descriptions-item><el-descriptions-item v-if="store.detail.pickupType === 1" label="自提门店">{{ store.detail.shopName || '暂无数据' }}</el-descriptions-item><el-descriptions-item v-if="store.detail.pickupType === 1" label="自提码">{{ store.detail.pickupCode || '暂无数据' }}</el-descriptions-item><el-descriptions-item v-if="store.detail.pickupType === 1" label="物流轨迹"><el-empty :image-size="48" description="暂无物流轨迹" /></el-descriptions-item><el-descriptions-item v-if="store.detail.pickupType !== 1" label="收货人">{{ store.detail.receiverName || '暂无数据' }}</el-descriptions-item><el-descriptions-item label="买家手机号">{{ store.detail.buyerPhone || '暂无数据' }}<el-button v-if="store.detail.buyerPhone" link type="primary" :icon="CopyDocument" @click="copyField(store.detail?.buyerPhone, '买家手机号')">复制</el-button></el-descriptions-item><el-descriptions-item v-if="store.detail.pickupType !== 1" label="联系电话"><span :class="{ 'phone-masked': isPhoneMasked(store.detail.receiverPhone) }">{{ store.detail.receiverPhone || '暂无数据' }}</span><el-button link type="primary" :icon="CopyDocument" @click="copyField(store.detail?.receiverPhone, '联系电话')">复制</el-button></el-descriptions-item><el-descriptions-item v-if="store.detail.pickupType !== 1" label="收货地址" :span="2"><div class="address-detail-row"><span>{{ store.detail.receiverAddress || '暂无数据' }}</span><span class="address-actions"><el-button link type="primary" :icon="CopyDocument" @click="copyField(store.detail?.receiverAddress, '收货地址')">复制</el-button><el-button v-if="store.detail.status === 1 && store.detail.pickupType === 0 && !isDeleted(store.detail)" link type="primary" @click="openAddressEditor">修改地址</el-button></span></div></el-descriptions-item><el-descriptions-item v-if="store.detail.pickupType === 0" label="快递公司">{{ store.detail.expressCompany || '暂无数据' }}</el-descriptions-item><el-descriptions-item v-if="store.detail.pickupType === 0" label="物流单号">{{ store.detail.expressNo || '暂无数据' }}</el-descriptions-item><el-descriptions-item v-if="store.detail.pickupType === 0" label="物流轨迹"><el-button v-if="isTraceable(store.detail)" link type="primary" :disabled="!isTraceable(store.detail) || store.traceLoading" :loading="store.traceLoading" @click="openTrace">物流轨迹</el-button><el-empty v-else :image-size="48" description="暂无物流轨迹" /></el-descriptions-item><el-descriptions-item label="商品总额">¥ {{ Number(store.detail.totalAmount || 0).toFixed(2) }}</el-descriptions-item><el-descriptions-item label="实付金额">¥ {{ Number(store.detail.payAmount || 0).toFixed(2) }}</el-descriptions-item></el-descriptions>
        <!-- 微信发货上报（仅物流订单）：自动上报失败时可在这里看原因并重试 -->
        <template v-if="store.detail.pickupType === 0">
          <el-divider>微信发货上报</el-divider>
          <el-alert
            v-if="store.detail.wxShippingStatus === 2"
            type="error"
            :closable="false"
            show-icon
            class="wx-alert"
            :title="`上报失败：${store.detail.wxShippingErrmsg || '原因未返回'}。常见原因：该快递公司没有配置微信运力码（请联系后端/运营核对快递映射）或微信未开通「发货信息管理」。修好后点右侧「重试上报」。`"
          />
          <el-alert
            v-else-if="store.detail.wxShippingStatus === 3"
            type="info"
            :closable="false"
            show-icon
            class="wx-alert"
            :title="`无需上报：${store.detail.wxShippingErrmsg || '支付已超过 7 天或订单已退款关闭，微信侧不再接收上报'}`"
          />
          <div class="wx-row">
            <span class="wx-label">上报状态</span>
            <el-tag :type="wxShippingTagType(store.detail.wxShippingStatus)">{{ wxShippingText(store.detail.wxShippingStatus) }}</el-tag>
            <span class="wx-label">上报时间</span>
            <span>{{ store.detail.wxShippingUploadTime || '—' }}</span>
            <el-button
              v-if="store.detail.wxShippingStatus === 0 || store.detail.wxShippingStatus === 2"
              type="primary"
              plain
              size="small"
              :loading="wxRetrying"
              @click="doRetryWxShipping(store.detail)"
            >重试上报</el-button>
          </div>
        </template>
        <el-divider>商品明细</el-divider>
        <el-table :data="store.detail.items" border><el-table-column prop="productName" label="商品名称" min-width="220" /><el-table-column prop="skuName" label="规格" min-width="150" /><el-table-column prop="price" label="单价" width="110" /><el-table-column prop="quantity" label="数量" width="90" /><el-table-column prop="subtotal" label="小计" width="110" /></el-table>
      </template>
       <el-empty v-else description="暂无订单详情" />
       <template #footer><el-button v-if="store.detail && isRefundable(store.detail)" type="warning" :loading="store.refunding" @click="openRefund(store.detail)">客服人工退款</el-button><el-button @click="detailVisible = false">关闭</el-button></template>
     </el-dialog>

    <el-dialog v-model="addressVisible" title="修改收货地址" width="560px" append-to-body>
      <el-form ref="addressFormRef" :model="addressForm" :rules="addressRules" label-width="90px">
        <el-form-item label="收货人" prop="receiverName"><el-input v-model="addressForm.receiverName" maxlength="30" show-word-limit /></el-form-item>
        <el-form-item label="手机号" prop="receiverPhone"><el-input v-model="addressForm.receiverPhone" maxlength="11" /></el-form-item>
        <el-form-item label="收货地址" prop="receiverAddress"><el-input v-model="addressForm.receiverAddress" type="textarea" :rows="3" maxlength="200" show-word-limit /></el-form-item>
      </el-form>
      <template #footer><el-button @click="addressVisible = false">取消</el-button><el-button type="primary" @click="submitAddress">确认修改</el-button></template>
    </el-dialog>

    <el-dialog v-model="shipVisible" title="订单发货" width="620px" append-to-body>
      <!-- 发货前把「照着填面单」需要的信息摆出来：订单号 / 收货人 / 电话 / 地址 / 商品，并支持一键复制 -->
      <template v-if="store.detail">
        <el-alert
          v-if="isPhoneMasked(store.detail.receiverPhone)"
          type="warning"
          :closable="false"
          show-icon
          class="ship-alert"
          title="联系电话是后端返回的脱敏号码（含 *），不能用于快递面单。后端已确认「B 端后台一律明文」；若这里仍出现脱敏号，说明该环境后端未更新。"
        />
        <el-descriptions :column="2" border size="small" class="ship-info">
          <el-descriptions-item label="订单号">
            {{ store.detail.orderNo }}
            <el-button link type="primary" :icon="CopyDocument" @click="copyField(store.detail?.orderNo, '订单号')">复制</el-button>
          </el-descriptions-item>
          <el-descriptions-item label="收货人">{{ store.detail.receiverName || '暂无数据' }}</el-descriptions-item>
          <el-descriptions-item label="联系电话">
            <span :class="{ 'phone-masked': isPhoneMasked(store.detail.receiverPhone) }">{{ store.detail.receiverPhone || '暂无数据' }}</span>
            <el-button link type="primary" :icon="CopyDocument" @click="copyField(store.detail?.receiverPhone, '联系电话')">复制</el-button>
          </el-descriptions-item>
          <el-descriptions-item label="配送方式">{{ pickupTypeText(store.detail.pickupType) }}</el-descriptions-item>
          <el-descriptions-item label="收货地址" :span="2">
            {{ store.detail.receiverAddress || '暂无数据' }}
            <el-button link type="primary" :icon="CopyDocument" @click="copyField(store.detail?.receiverAddress, '收货地址')">复制</el-button>
          </el-descriptions-item>
          <el-descriptions-item label="商品" :span="2">
            <span v-if="store.detail.items?.length">
              {{ store.detail.items.map((item) => `${item.productName}${item.skuName ? `(${item.skuName})` : ''}×${item.quantity}`).join('，') }}
            </span>
            <span v-else>暂无商品明细</span>
          </el-descriptions-item>
        </el-descriptions>
        <div class="ship-copy-row">
          <el-button size="small" :icon="CopyDocument" @click="copyReceiverInfo">一键复制收货信息（姓名+电话+地址）</el-button>
          <span class="muted">用于粘贴到快递下单系统</span>
        </div>
        <el-divider />
      </template>
      <el-form ref="shipFormRef" :model="shipForm" :rules="shipRules" label-width="90px"><el-form-item label="快递公司" prop="expressCompanyCode"><el-select v-model="shipForm.expressCompanyCode" placeholder="请选择快递公司" style="width: 100%" @change="syncExpressCompany(shipForm, $event)"><el-option v-for="option in expressCompanyOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select></el-form-item><el-form-item label="快递单号" prop="expressNo"><el-input v-model="shipForm.expressNo" placeholder="请输入快递单号" /></el-form-item></el-form>
      <template #footer><el-button @click="shipVisible = false">取消</el-button><el-button type="primary" :loading="store.shipping" @click="submitShip">确认发货</el-button></template>
    </el-dialog>

    <el-dialog v-model="batchShipVisible" title="批量发货" width="520px" append-to-body>
      <el-alert type="info" :closable="false" show-icon class="ship-alert" title="批量发货只写快递公司与单号；如需按收货信息下快递面单，请逐个订单用「发货」弹窗（里面有收货信息与一键复制）。" />
      <el-form ref="batchShipFormRef" :model="batchShipForm" :rules="shipRules" label-width="90px"><el-form-item label="快递公司" prop="expressCompanyCode"><el-select v-model="batchShipForm.expressCompanyCode" placeholder="请选择快递公司" style="width: 100%" @change="syncExpressCompany(batchShipForm, $event)"><el-option v-for="option in expressCompanyOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select></el-form-item><el-form-item label="快递单号" prop="expressNo"><el-input v-model="batchShipForm.expressNo" placeholder="请输入快递单号" /></el-form-item></el-form>
      <template #footer><el-button @click="batchShipVisible = false">取消</el-button><el-button type="primary" :loading="store.shipping" @click="submitBatchShip">确认批量发货</el-button></template>
    </el-dialog>

    <el-dialog v-model="verifyVisible" title="手工核销自提订单" width="520px" append-to-body>
      <el-form ref="verifyFormRef" :model="verifyForm" :rules="verifyRules" label-width="90px"><el-form-item label="订单号"><el-input v-model="verifyForm.orderNo" disabled /></el-form-item><el-form-item label="自提码" prop="code"><el-input v-model="verifyForm.code" placeholder="请输入客户提供的自提码" /></el-form-item></el-form>
      <template #footer><el-button @click="verifyVisible = false">取消</el-button><el-button type="primary" :loading="store.verifying" @click="submitVerify">确认核销</el-button></template>
    </el-dialog>

    <el-dialog v-model="refundVisible" title="客服人工退款" width="560px" append-to-body>
      <el-form label-width="90px"><el-form-item label="订单号"><el-input v-model="refundForm.orderNo" disabled /></el-form-item><el-form-item label="退款原因"><el-input v-model="refundForm.reason" type="textarea" :rows="4" maxlength="200" show-word-limit placeholder="请输入退款原因，可为空" /></el-form-item></el-form>
      <template #footer><el-button @click="refundVisible = false">取消</el-button><el-button type="warning" :loading="store.refunding" @click="submitRefund">确认退款</el-button></template>
    </el-dialog>

    <el-dialog v-model="traceVisible" title="物流轨迹" width="680px" append-to-body>
      <el-skeleton v-if="store.traceLoading" :rows="5" animated />
      <template v-else-if="store.trace">
        <el-descriptions :column="2" border><el-descriptions-item label="快递公司">{{ store.trace.com || '暂无数据' }}</el-descriptions-item><el-descriptions-item label="物流单号">{{ store.trace.nu || '暂无数据' }}</el-descriptions-item><el-descriptions-item label="物流状态" :span="2">{{ store.trace.stateDesc || '暂无数据' }}</el-descriptions-item></el-descriptions>
        <el-empty v-if="store.trace && !store.trace.traces.length" description="暂无物流节点" />
        <el-timeline v-else class="trace-timeline"><el-timeline-item v-for="(item, index) in store.trace.traces" :key="`${item.time}-${index}`" :timestamp="item.time">{{ item.context }}</el-timeline-item></el-timeline>
      </template>
      <el-empty v-else description="暂无物流轨迹" />
    </el-dialog>
  </section>
</template>

<style scoped>
.order-product { display: flex; align-items: center; gap: 10px; }
.order-image { width: 38px; height: 38px; border-radius: 4px; flex-shrink: 0; }
.order-filter-form .el-form-item { margin-bottom: 0; }
.order-filter-form .el-date-editor { width: 280px; }
.order-status { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.order-status-tabs { margin-bottom: 16px; }
.order-status-tabs :deep(.el-tabs__header) { margin-bottom: 0; }
.address-detail-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.address-actions { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; }
/* 商品列：商品名 + 件数两行 */
.order-product-text { display: flex; min-width: 0; flex-direction: column; }
.order-product-name { overflow: hidden; color: var(--el-text-color-primary); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.order-product-count { color: var(--el-text-color-secondary); font-size: 12px; }
/* 微信发货上报 */
.wx-alert { margin-bottom: 10px; }
.wx-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 13px; }
.wx-label { color: var(--el-text-color-secondary); }
.wx-link { margin-left: auto; color: var(--el-color-primary); font-size: 12px; text-decoration: none; }
/* 发货弹窗：收货信息区 */
.ship-alert { margin-bottom: 12px; }
.ship-info { margin-bottom: 10px; }
.ship-info :deep(.el-descriptions__label) { width: 92px; }
.ship-copy-row { display: flex; align-items: center; gap: 10px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
/* 后端脱敏号（含 *）：标红提醒，避免拿去下快递面单 */
.phone-masked { color: var(--el-color-danger); font-weight: 600; }
</style>
