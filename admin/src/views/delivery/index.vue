<script setup lang="ts">
/**
 * 同城配送管理（运营/客服）
 * - 配送总开关（应急总闸）
 * - 履约报表（任务数/送达率/异常率/各环节时长）
 * - 同城订单查询（按商家/配送状态；配送异常可直接「异常恢复」）
 * - 任务干预（改派 / 人工回退 / 异常恢复 / 解锁收货码 / 节点时间轴）
 * - 骑手业绩（区间排行或单人明细）
 * - 退款单查询
 * - 配送费配置（全局默认 / 门店覆盖）
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  auditDeliveryCancel,
  getDeliveryOrders,
  getDeliveryRefunds,
  getDeliveryReport,
  getFeeConfig,
  getMasterSwitch,
  getRiderStats,
  getTaskTimeline,
  reassignTask,
  closeDeadOrders as requestCloseDeadOrders,
  resumeTask,
  rollbackTask,
  saveFeeConfig,
  setMasterSwitch,
  unlockTaskCode,
  type DeliveryEvent,
  type DeliveryOrderView,
  type DeliveryRefundView,
  type DeliveryReportVO,
} from '@/api/delivery'
import { getEnabledShops } from '@/api/shop'
import { getMyStaff, getMyTasks, cancelMyTask, resumeMyTask, type DeliveryStaff, type DeliveryTask } from '@/api/shop-delivery'
import type { Shop } from '@/types/shop'
import {
  DELIVERY_STATUS_OPTIONS,
  REFUND_STATUS_LABELS,
  deliveryEventLabel,
  deliveryStatusLabel,
  deliveryStatusTagType,
  refundStatusLabel,
  refundStatusTagType,
  refundTypeLabel,
  riderStatsColumnLabel,
  taskStatusLabel,
} from '@/utils/deliveryStatus'
import { operatorTypeLabel } from '@/utils/labels'
import { useTodoStore } from '@/stores/todo'

const activeTab = ref('report')

// ===== 配送总开关 =====
const masterEnabled = ref(true)
const masterLoading = ref(false)
const masterSaving = ref(false)

/** 路由（待办铃铛跳转带 ?deliveryStatus=xxx，需按 query 初始化筛选）。 */
const route = useRoute()
const todoStore = useTodoStore()

async function loadMasterSwitch(): Promise<void> {
  masterLoading.value = true
  try {
    masterEnabled.value = await getMasterSwitch()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '配送总开关查询失败')
  } finally {
    masterLoading.value = false
  }
}

/** 切换总开关（关闭=新下单同城配送直接拒绝，在途订单不受影响）。 */
async function changeMasterSwitch(value: boolean | string | number): Promise<void> {
  const next = Boolean(value)
  try {
    await ElMessageBox.confirm(
      next ? '确认恢复同城配送？恢复后新订单可正常选择配送。' : '确认暂停同城配送？暂停后**新下单**的同城配送会被直接拒绝（在途订单不受影响）。',
      '配送总开关确认',
      { type: 'warning' },
    )
  } catch {
    masterEnabled.value = !next
    return
  }
  masterSaving.value = true
  try {
    await setMasterSwitch(next)
    ElMessage.success(next ? '已恢复同城配送' : '已暂停同城配送')
  } catch (error) {
    masterEnabled.value = !next
    ElMessage.error(error instanceof Error ? error.message : '配送总开关保存失败')
  } finally {
    masterSaving.value = false
  }
}

// ===== 履约报表 =====
const reportFilters = reactive<{ merchantId: string; range: [string, string] | null }>({ merchantId: '', range: null })
const report = ref<DeliveryReportVO | null>(null)
const reportLoading = ref(false)

/** 百分比展示（后端可能返回 0~1 小数或百分数，>1 视为已是百分数）。 */
function formatRate(value: number | undefined): string {
  if (value == null) return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  const percent = num > 1 ? num : num * 100
  return `${percent.toFixed(2)}%`
}
function formatMinutes(value: number | undefined): string {
  if (value == null) return '—'
  return `${Number(value).toFixed(1)} 分钟`
}

async function loadReport(): Promise<void> {
  reportLoading.value = true
  try {
    report.value = await getDeliveryReport({
      merchantId: reportFilters.merchantId || undefined,
      startTime: reportFilters.range?.[0] || undefined,
      endTime: reportFilters.range?.[1] || undefined,
    })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '履约报表查询失败')
  } finally {
    reportLoading.value = false
  }
}

// ===== 同城订单 =====
/** 门店筛选的「全部门店」哨兵值：后端 `merchantId` 必填，这里由前端逐店查询后合并。 */
const ALL_SHOPS = 'ALL'
/**
 * 列表行：直接用订单视图（`shopId` / `shopName` / `taskId` / `taskNo` / `exceptionType` / `exceptionRemark`
 * 均由后端返回，2026-09-17 起）。
 */
type OrderRow = DeliveryOrderView

const orderFilters = reactive<{ merchantId: string; deliveryStatus: string }>({ merchantId: ALL_SHOPS, deliveryStatus: '' })
const orders = ref<OrderRow[]>([])
const ordersLoading = ref(false)
/** 门店下拉数据源（后端 `/api/admin/shop/all`）。 */
const shops = ref<Shop[]>([])

/** 顶部说明：说清"铃铛=全平台合计"与"列表范围"的关系，避免数字对不上被当成 Bug。 */
const orderTip = computed(() => {
  if (orderFilters.merchantId === ALL_SHOPS) {
    return `已合并显示全部 ${shops.value.length} 家门店的同城订单（逐门店查询后按时间倒序合并）；待办铃铛里的「同城待接单 / 待派单 / 取消待审核」就是同一口径的全平台合计。`
  }
  if (orderFilters.merchantId) return '只显示所选门店的同城订单。待办铃铛里的同城数字是【全平台】合计，所以单看一家门店时条数会小于铃铛。'
  return '请先选择门店：同城订单接口按门店返回（平台账号必选），不选门店会查不到数据。'
})

/** 加载门店下拉（失败不阻断页面）。 */
async function loadShops(): Promise<void> {
  try {
    shops.value = await getEnabledShops()
  } catch {
    shops.value = []
  }
}

/**
 * 查询同城订单。
 * - `merchantId=ALL`：对每家门店各查一次后合并（后端不支持全平台一次查，实测留空/传 0 都是 0 条）；
 * - 指定门店：直接按门店查。
 */
/**
 * 清理历史死单（2026-09-18 后端新增 `POST /api/admin/delivery/orders/close-dead`）。
 *
 * 两步走：**先 dry-run 预览**（只出清单、不改数据）→ 把命中数与样例摆给运营看 → 确认后才真正收口。
 * 收口只改履约状态（`→ CANCELLED`），**不触发退款**（退款另行走售后/客服）。
 */
const deadClosing = ref(false)
async function closeDeadOrders(): Promise<void> {
  if (deadClosing.value) return
  deadClosing.value = true
  try {
    const preview = await requestCloseDeadOrders(true)
    if (!preview.deadOrders) {
      ElMessage.success(`未发现历史死单（扫描 ${preview.scannedOrders ?? 0} 条候选订单）`)
      return
    }
    const samples = (preview.samples || []).slice(0, 5).join('\n')
    await ElMessageBox.confirm(
      `扫描 ${preview.scannedOrders ?? 0} 条候选订单，命中 ${preview.deadOrders} 条历史死单` +
        '（订单处于在途/异常，但已没有任何未终态任务）。\n\n' +
        `${samples}${preview.deadOrders > 5 ? `\n…另有 ${preview.deadOrders - 5} 条` : ''}\n\n` +
        '收口会把这些订单的配送状态置为「已取消」，且**不触发退款**（退款请另行走售后/客服）。确认执行吗？',
      '清理历史死单',
      { type: 'warning', confirmButtonText: '确认收口', cancelButtonText: '取消' },
    )
    const result = await requestCloseDeadOrders(false)
    ElMessage.success(`已收口 ${result.closed ?? 0} 条${result.failed ? `，失败 ${result.failed} 条（状态被并发改变）` : ''}`)
    await loadOrders()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error instanceof Error ? error.message : '清理历史死单失败')
    }
  } finally {
    deadClosing.value = false
  }
}

async function loadOrders(): Promise<void> {
  const status = orderFilters.deliveryStatus || undefined
  ordersLoading.value = true
  try {
    // 2026-09-17 后端已支持「不传 merchantId = 全平台」（传 0 / 负数同样按不传处理），且每行都带
    // shopId/shopName —— 所以不再逐店查询合并（原先设了 30 店上限，门店一多就直接不让查）
    const merchantId = orderFilters.merchantId === ALL_SHOPS ? undefined : orderFilters.merchantId
    orders.value = await getDeliveryOrders({ merchantId, deliveryStatus: status })
  } catch (error) {
    orders.value = []
    ElMessage.error(error instanceof Error ? error.message : '同城订单查询失败')
  } finally {
    ordersLoading.value = false
  }
}

/** 订单列表「配送异常」恢复中标记（按钮 loading）。 */
const exceptionActing = ref(false)

/**
 * 「配送异常」订单恢复配送（`EXCEPTION → 异常前状态`）。
 *
 * 2026-09-17 后端已在订单视图里返回 `taskId`，所以直接用平台端 `resume` 接口；
 * 原先"再拉一次任务列表 + 按 orderNo 匹配"的兜底已删除（多任务历史下按 orderNo 匹配本就有歧义）。
 */
async function resumeExceptionOrder(row: DeliveryOrderView): Promise<void> {
  const taskId = row.taskId
  if (!taskId) {
    ElMessage.warning('该订单没有关联的配送任务，无法恢复')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将把订单 ${row.orderNo || ''} 的配送任务从「配送异常」恢复到异常前的节点，骑手可继续履约。确认恢复吗？`,
      '异常恢复',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' },
    )
  } catch {
    return // 用户取消
  }
  exceptionActing.value = true
  try {
    await resumeTask(taskId)
    ElMessage.success('已恢复配送（任务回到异常前的节点）')
    await loadOrders()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '异常恢复失败')
  } finally {
    exceptionActing.value = false
  }
}

/**
 * 「配送异常」订单**终止履约**（取消配送任务）。
 *
 * 2026-09-17 后端修复：任务处于 `EXCEPTION/PAUSED/在途` 时取消，**订单会同步收口为 `CANCELLED`**
 * （此前只取消任务、订单永久停在 EXCEPTION，此时 `resume` 与 `cancel-audit` 都进不去）。
 *
 * ⚠️ 该接口**只改履约状态、不退款**：是否退款属售后/客服判断（顾客拒收走骑手端拒收接口会按快照扣费后退款）。
 */
async function cancelExceptionOrder(row: DeliveryOrderView): Promise<void> {
  const targetTaskId = row.taskId
  if (!targetTaskId || !row.shopId) {
    ElMessage.warning('该订单缺少配送任务信息，无法终止履约')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将取消订单 ${row.orderNo || ''} 的配送任务，并把订单收口为「已取消」。该操作**只改履约状态、不退款**（退款请走售后/客服）。确认终止履约吗？`,
      '终止履约',
      { type: 'warning', confirmButtonText: '确认终止', cancelButtonText: '取消' },
    )
  } catch {
    return // 用户取消
  }
  exceptionActing.value = true
  try {
    await cancelMyTask(row.shopId, targetTaskId, '运营终止履约（配送异常）')
    ElMessage.success('已终止履约，订单已收口为「已取消」')
    await loadOrders()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '终止履约失败')
  } finally {
    exceptionActing.value = false
  }
}

// ===== 任务干预 =====
const taskId = ref('')
const taskNo = ref('')
const reassignTarget = ref('')
const rollbackReason = ref('')
const timeline = ref<DeliveryEvent[]>([])
const timelineLoading = ref(false)

function requireTaskId(): string | null {
  const value = String(taskId.value).trim()
  if (!value) {
    ElMessage.warning('请输入配送任务 ID（taskId）')
    return null
  }
  return value
}

/** 运营强制改派骑手。 */
async function doReassign(): Promise<void> {
  const id = requireTaskId()
  if (!id) return
  const person = String(reassignTarget.value).trim()
  if (!person) {
    ElMessage.warning('请输入新骑手（staffId）')
    return
  }
  try {
    await ElMessageBox.confirm(`确认把任务 ${id} 改派给骑手 ${person} 吗？`, '改派确认', { type: 'warning' })
    await reassignTask(id, { newPersonId: person })
    ElMessage.success('已改派')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '改派失败')
  }
}

/** 人工回退最近一步节点。 */
async function doRollback(): Promise<void> {
  const id = requireTaskId()
  if (!id) return
  const reason = rollbackReason.value.trim()
  if (!reason) {
    ElMessage.warning('请填写回退原因')
    return
  }
  try {
    await ElMessageBox.confirm(`确认将任务 ${id} 回退一步？仅能回退最近一步（不跳步）。`, '回退确认', { type: 'warning' })
    await rollbackTask(id, reason)
    ElMessage.success('已回退一步')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '回退失败')
  }
}

/** 解锁收货码（错 5 次锁定 10 分钟）。 */
async function doUnlock(): Promise<void> {
  const id = requireTaskId()
  if (!id) return
  try {
    await ElMessageBox.confirm(`确认解锁任务 ${id} 的收货码？`, '解锁确认', { type: 'warning' })
    await unlockTaskCode(id)
    ElMessage.success('收货码已解锁')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '解锁失败')
  }
}

/** 任务干预页签：异常恢复（`EXCEPTION → 异常前状态`）。 */
async function doResume(): Promise<void> {
  const id = requireTaskId()
  if (!id) return
  try {
    await ElMessageBox.confirm(
      `确认把任务 ${id} 从「配送异常」恢复到异常前的节点？仅对处于「配送异常」的任务有效。`,
      '异常恢复确认',
      { type: 'warning' },
    )
    await resumeMyTask(interveneShopId.value, id)
    ElMessage.success('已恢复（任务回到异常前的节点）')
    await loadInterveneTasks()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '恢复失败')
  }
}

/** 查询节点时间轴（按 taskNo）；可选传 task 直接带上任务号，省得手输。 */
async function loadTimeline(task?: DeliveryTask): Promise<void> {
  const no = String(task?.taskNo || taskNo.value).trim()
  if (!no) {
    ElMessage.warning('请选择任务或输入配送任务号（taskNo）')
    return
  }
  taskNo.value = no
  timelineLoading.value = true
  try {
    timeline.value = await getTaskTimeline(no)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '节点时间轴查询失败')
  } finally {
    timelineLoading.value = false
  }
}

// ===== 任务干预：任务选择器（避免手输 taskId / taskNo） =====
/** 干预用的门店（同城任务按门店查）。 */
const interveneShopId = ref('')
/** 该门店的配送任务（选中一条即可自动填 taskId / taskNo）。 */
const interveneTasks = ref<DeliveryTask[]>([])
/** 该门店的配送员（改派用下拉，避免手输 staffId）。 */
const interveneStaff = ref<DeliveryStaff[]>([])
const interveneLoading = ref(false)

/** 载入所选门店的配送任务 + 配送员（平台账号必须带 shopId）。 */
async function loadInterveneTasks(): Promise<void> {
  if (!interveneShopId.value) {
    interveneTasks.value = []
    interveneStaff.value = []
    return
  }
  interveneLoading.value = true
  try {
    const [tasks, staff] = await Promise.all([
      getMyTasks(interveneShopId.value),
      getMyStaff(interveneShopId.value).catch(() => [] as DeliveryStaff[]),
    ])
    interveneTasks.value = tasks
    interveneStaff.value = staff
  } catch (error) {
    interveneTasks.value = []
    interveneStaff.value = []
    ElMessage.error(error instanceof Error ? error.message : '本店配送任务查询失败')
  } finally {
    interveneLoading.value = false
  }
}

/** 选中任务 → 自动填 taskId / taskNo / 当前骑手，并可一键查时间轴。 */
function onInterveneTaskChange(taskIdValue: string | number): void {
  const task = interveneTasks.value.find((item) => String(item.id) === String(taskIdValue))
  if (!task) return
  taskId.value = String(task.id ?? '')
  taskNo.value = String(task.taskNo ?? '')
  reassignTarget.value = task.deliveryPersonId ? String(task.deliveryPersonId) : ''
  timeline.value = []
}

/**
 * 任务干预四个动作的**状态白名单**（2026-09-18）。
 *
 * 原先四个按钮只看「taskId 填没填」，选一个已 `DELIVERED`/`CANCELED` 的任务时按钮全亮，
 * 点下去必被后端状态机拒（`13003`）—— 不会写坏数据，但白报错、容易被当成系统故障。
 * 白名单依据各接口文档：
 * - **改派**：未送达均可（`ASSIGNED/ACCEPTED/PICKED_UP/DELIVERING/NEARBY/PAUSED`）
 * - **异常恢复**：仅 `EXCEPTION`/`PAUSED`（`resume` 的硬要求）
 * - **回退**：`DELIVERED/NEARBY/DELIVERING`（回退链 `DELIVERED→NEARBY→DELIVERING→PICKED_UP`，到 `PICKED_UP` 已无路可退）
 * - **解锁收货码**：受理后到送达前（`ACCEPTED`~`PAUSED`）
 */
const INTERVENE_ACTIONS: Record<'reassign' | 'resume' | 'rollback' | 'unlock', readonly string[]> = {
  reassign: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'DELIVERING', 'NEARBY', 'PAUSED'],
  resume: ['EXCEPTION', 'PAUSED'],
  rollback: ['DELIVERED', 'NEARBY', 'DELIVERING'],
  unlock: ['ACCEPTED', 'PICKED_UP', 'DELIVERING', 'NEARBY', 'PAUSED'],
}

/** 当前所选任务（下拉选中的那条；手动只填 taskId 时为 null）。 */
const interveneTask = computed(() => interveneTasks.value.find((item) => String(item.id) === String(taskId.value)) || null)

/**
 * 所选任务的状态是否允许该动作。
 * ⚠️ 手动输入 taskId（未从下拉选）时拿不到任务状态 → **不拦**，交给后端状态机校验，
 * 避免把原有的"手输 ID"路径一并禁掉。
 */
function canIntervene(action: keyof typeof INTERVENE_ACTIONS): boolean {
  const task = interveneTask.value
  if (!task) return Boolean(String(taskId.value).trim())
  return INTERVENE_ACTIONS[action].includes(String(task.status || ''))
}

/** 动作按钮的禁用原因（给 `title` 用；返回空串表示可点）。 */
function interveneHint(action: keyof typeof INTERVENE_ACTIONS): string {
  const task = interveneTask.value
  if (!task) return String(taskId.value).trim() ? '' : '请先选择配送任务'
  if (!canIntervene(action)) return `任务当前状态「${taskStatusLabel(task.status)}」不支持该操作`
  return ''
}

// ===== 骑手业绩 =====
const riderFilters = reactive<{ range: string; riderId: string }>({ range: 'DAY', riderId: '' })
const riderStats = ref<Record<string, unknown> | Array<Record<string, unknown>> | null>(null)
const riderLoading = ref(false)

/** 业绩结果列（数据为数组时按首行 keys 生成表头）。 */
const riderColumns = computed<string[]>(() => {
  const data = riderStats.value
  const rows = Array.isArray(data) ? data : data ? [data] : []
  return rows.length ? Object.keys(rows[0] || {}) : []
})
/** 业绩结果行（统一成数组渲染）。 */
const riderRows = computed<Array<Record<string, unknown>>>(() => {
  const data = riderStats.value
  if (Array.isArray(data)) return data
  return data ? [data] : []
})

async function loadRiderStats(): Promise<void> {
  riderLoading.value = true
  try {
    riderStats.value = await getRiderStats({ range: riderFilters.range, riderId: riderFilters.riderId || undefined })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '骑手业绩查询失败')
  } finally {
    riderLoading.value = false
  }
}

// ===== 退款单 =====
const refundFilters = reactive<{ orderNo: string; status: string }>({ orderNo: '', status: '' })
const refunds = ref<DeliveryRefundView[]>([])
const refundLoading = ref(false)

async function loadRefunds(): Promise<void> {
  refundLoading.value = true
  try {
    refunds.value = await getDeliveryRefunds({ orderNo: refundFilters.orderNo, status: refundFilters.status || undefined })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '退款单查询失败')
  } finally {
    refundLoading.value = false
  }
}

// ===== 配送费配置 =====
const feeQuery = reactive<{ merchantId: string }>({ merchantId: '' })
const feeCurrent = ref<Record<string, unknown> | null>(null)
/** 后端返回的配送费提示（平台统一设置 / 改价只影响新下单等）。 */
const feeHint = computed(() => String(feeCurrent.value?.hint || ''))
const feeLoading = ref(false)
const feeSaving = ref(false)
const feeForm = reactive<{ merchantId: string; feeType: string; feeConfig: string; enabled: number; remark: string }>({
  merchantId: '',
  feeType: 'FIXED',
  feeConfig: '{"fixedFee":5.0}',
  enabled: 1,
  remark: '',
})

async function loadFeeConfig(): Promise<void> {
  feeLoading.value = true
  try {
    feeCurrent.value = await getFeeConfig(feeQuery.merchantId || undefined)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '配送费配置查询失败')
  } finally {
    feeLoading.value = false
  }
}

/** 按费类型填充 feeConfig 模板，减少手输 JSON 出错。 */
function applyFeeTemplate(): void {
  if (feeForm.feeType === 'FIXED') feeForm.feeConfig = '{"fixedFee":5.0}'
  else feeForm.feeConfig = '{"fixedFee":3.0,"distanceStep":{"freeKm":3,"perKmFee":1.0}}'
}

async function submitFeeConfig(): Promise<void> {
  try {
    JSON.parse(feeForm.feeConfig)
  } catch {
    ElMessage.error('feeConfig 必须是合法 JSON')
    return
  }
  feeSaving.value = true
  try {
    await saveFeeConfig({
      merchantId: feeForm.merchantId ? Number(feeForm.merchantId) : 0,
      feeType: feeForm.feeType,
      feeConfig: feeForm.feeConfig,
      enabled: feeForm.enabled,
      remark: feeForm.remark || undefined,
    })
    ElMessage.success('配送费配置已保存')
    await loadFeeConfig()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '配送费配置保存失败')
  } finally {
    feeSaving.value = false
  }
}

/** 切换门店：选「全部门店」或具体门店都直接查；若被清空则回到「全部门店」。 */
function onShopChange(): void {
  if (!orderFilters.merchantId) orderFilters.merchantId = ALL_SHOPS
  void loadOrders()
}

/**
 * 运营代商家审核用户取消申请（`CANCEL_REQUESTED`）。
 * 铃铛「取消待审核」跳进本页原本**没有任何操作入口**，只能看着数字干着急，这里补上兜底通道。
 */
async function auditCancel(row: OrderRow, approve: boolean): Promise<void> {
  if (!row.orderNo) return
  try {
    const result = await ElMessageBox.prompt(
      approve
        ? '同意取消：订单转「已取消」，按订单快照的取消政策扣费后退款，并停止配送任务。可填备注（可选）。'
        : '驳回取消：恢复申请前的配送状态、配送任务回到原节点继续履约。请填写驳回原因（用户可见）。',
      approve ? '同意取消' : '驳回取消',
      { inputPattern: approve ? /.*/ : /\S+/, inputErrorMessage: '请填写驳回原因', type: 'warning' },
    )
    await auditDeliveryCancel(row.orderNo, approve, result.value || undefined)
    ElMessage.success(approve ? '已同意取消并触发退款' : '已驳回取消申请，履约已恢复')
    await loadOrders()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '取消申请审核失败')
  }
}

/**
 * 按路由 query 初始化筛选（待办铃铛跳转：`/delivery?deliveryStatus=xxx`）。
 * 注意：必须同时用 watch 监听 query —— 在**同一模块内**连续点铃铛（如同城待接单 → 同城待派单）
 * 路径不变、只有 query 变，组件不会重新挂载，不 watch 就会"点了没反应"。
 */
function applyQuery(): void {
  const deliveryStatus = route.query.deliveryStatus
  if (typeof deliveryStatus === 'string' && deliveryStatus !== '') {
    orderFilters.deliveryStatus = deliveryStatus
    activeTab.value = 'orders' // 直接切到「同城订单」页签
  }
}

/** 重新套用 URL 筛选并刷新（待办铃铛信号；200ms 去重避免与路由变化重复请求）。 */
let lastTodoApply = 0
watch(() => todoStore.clickTick, () => {
  const now = Date.now()
  if (now - lastTodoApply < 200) return
  lastTodoApply = now
  applyQuery()
  void loadOrders()
})

watch(() => route.query.deliveryStatus, () => {
  applyQuery()
  void loadOrders()
})

onMounted(async () => {
  void loadMasterSwitch()
  void loadReport()
  // 门店下拉（同城订单按门店查；默认「全部门店」= 逐店合并，进来就有数据）
  await loadShops()
  applyQuery()
  // 预载同城订单
  void loadOrders()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div>
        <h1>同城配送管理</h1>
        <p>运营/客服视角：配送总开关、履约报表、同城订单、任务干预、骑手业绩、退款单与配送费配置。</p>
      </div>
      <div class="heading-actions">
        <span class="master-label">配送总开关</span>
        <el-switch
          :model-value="masterEnabled"
          :loading="masterLoading || masterSaving"
          active-text="开启"
          inactive-text="暂停"
          @change="changeMasterSwitch"
        />
      </div>
    </div>

    <el-alert
      title="配送总开关为应急总闸：关闭后【新下单】的同城配送会被直接拒绝，在途订单不受影响。"
      type="warning"
      :closable="false"
      show-icon
      class="tip"
    />

    <el-tabs v-model="activeTab" class="delivery-tabs">
      <!-- 履约报表 -->
      <el-tab-pane label="履约报表" name="report">
        <el-card shadow="never" class="content-card">
          <el-form inline @submit.prevent="loadReport">
            <el-form-item label="门店">
              <el-select v-model="reportFilters.merchantId" filterable clearable placeholder="全平台（不选门店=各门店合计）" style="width: 260px">
                <el-option v-for="shop in shops" :key="shop.id" :label="`${shop.name || '未命名门店'}（${shop.id}）`" :value="shop.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="时间范围">
              <el-date-picker v-model="reportFilters.range" type="datetimerange" value-format="YYYY-MM-DD HH:mm:ss" start-placeholder="开始" end-placeholder="结束" />
            </el-form-item>
            <el-form-item><el-button type="primary" :loading="reportLoading" @click="loadReport">查询</el-button></el-form-item>
          </el-form>
          <div class="metric-grid" v-loading="reportLoading">
            <div class="metric"><span class="metric-label">任务总数</span><strong>{{ report?.totalTasks ?? '—' }}</strong></div>
            <div class="metric"><span class="metric-label">已送达</span><strong>{{ report?.deliveredTasks ?? '—' }}</strong></div>
            <div class="metric"><span class="metric-label">异常任务</span><strong>{{ report?.exceptionTasks ?? '—' }}</strong></div>
            <div class="metric"><span class="metric-label">送达率</span><strong>{{ formatRate(report?.deliveryRate) }}</strong></div>
            <div class="metric"><span class="metric-label">异常率</span><strong>{{ formatRate(report?.exceptionRate) }}</strong></div>
            <div class="metric"><span class="metric-label">平均接单时长</span><strong>{{ formatMinutes(report?.avgAcceptMinutes) }}</strong></div>
            <div class="metric"><span class="metric-label">平均备货时长</span><strong>{{ formatMinutes(report?.avgPrepareMinutes) }}</strong></div>
            <div class="metric"><span class="metric-label">平均配送时长</span><strong>{{ formatMinutes(report?.avgDeliveryMinutes) }}</strong></div>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- 同城订单 -->
      <el-tab-pane label="同城订单" name="orders">
        <el-card shadow="never" class="content-card">
          <el-alert :title="orderTip" type="info" :closable="false" show-icon class="tip" />
          <el-form inline @submit.prevent="loadOrders">
            <el-form-item label="门店">
              <el-select
                v-model="orderFilters.merchantId"
                filterable
                clearable
                placeholder="请选择门店"
                style="width: 260px"
                @change="onShopChange"
              >
                <el-option label="全部门店（逐店合并）" :value="ALL_SHOPS" />
                <el-option v-for="shop in shops" :key="shop.id" :label="`${shop.name || '未命名门店'}（${shop.id}）`" :value="shop.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="配送状态">
              <el-select v-model="orderFilters.deliveryStatus" clearable placeholder="全部" style="width: 180px">
                <el-option v-for="item in DELIVERY_STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item><el-button type="primary" :loading="ordersLoading" @click="loadOrders">查询</el-button></el-form-item>
            <!-- 历史死单收口（2026-09-18 后端新增接口）：先 dry-run 预览命中哪些单，确认后再执行；只改履约状态、不退款 -->
            <el-form-item>
              <el-button type="warning" plain :loading="deadClosing" @click="closeDeadOrders">清理历史死单</el-button>
            </el-form-item>
          </el-form>
          <el-empty v-if="!ordersLoading && !orders.length" description="暂无符合条件的同城订单" :image-size="72" />
          <el-table v-else v-loading="ordersLoading" :data="orders" border size="small" max-height="520">
            <el-table-column prop="orderNo" label="订单号" min-width="180" />
            <el-table-column label="门店" min-width="150">
              <template #default="{ row }">{{ row.shopName ? `${row.shopName}（${row.shopId}）` : (orderFilters.merchantId === ALL_SHOPS ? '—' : orderFilters.merchantId) }}</template>
            </el-table-column>
            <el-table-column label="配送状态" width="170">
              <template #default="{ row }">
                <el-tag :type="deliveryStatusTagType(row.deliveryStatus)" effect="light">{{ deliveryStatusLabel(row.deliveryStatus) }}</el-tag>
                <!-- 异常类型/说明（2026-09-17 后端新增字段）：异常单的原因直接在这里看到 -->
                <div v-if="row.exceptionType || row.exceptionRemark" class="status-note">
                  {{ [row.exceptionType, row.exceptionRemark].filter(Boolean).join('：') }}
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="receiverName" label="收货人" width="110" />
            <el-table-column prop="receiverPhone" label="电话" width="130" />
            <el-table-column prop="receiverAddress" label="收货地址" min-width="220" />
            <el-table-column label="商品额" width="100"><template #default="{ row }">¥ {{ Number(row.goodsAmount || 0).toFixed(2) }}</template></el-table-column>
            <el-table-column label="配送费" width="100"><template #default="{ row }">¥ {{ Number(row.deliveryFee || 0).toFixed(2) }}</template></el-table-column>
            <el-table-column label="实付" width="100"><template #default="{ row }">¥ {{ Number(row.payAmount || 0).toFixed(2) }}</template></el-table-column>
            <el-table-column prop="createTime" label="下单时间" min-width="170" />
            <el-table-column label="操作" width="250" fixed="right">
              <template #default="{ row }">
                <!-- 需要运营介入的两种状态；铃铛跳进来即可直接处理 -->
                <div v-if="row.deliveryStatus === 'CANCEL_REQUESTED'" class="operator-actions">
                  <el-button size="small" type="danger" plain @click="auditCancel(row, true)">同意取消</el-button>
                  <el-button size="small" @click="auditCancel(row, false)">驳回</el-button>
                </div>
                <!-- 配送异常：骑手上报后任务卡在 EXCEPTION。① 恢复 → 回异常前节点继续送；② 终止履约 → 取消任务并把订单收口为已取消（不退款） -->
                <div v-else-if="row.deliveryStatus === 'EXCEPTION'" class="operator-actions">
                  <el-button size="small" type="warning" plain :loading="exceptionActing" @click="resumeExceptionOrder(row)">异常恢复</el-button>
                  <el-button size="small" type="danger" plain :loading="exceptionActing" @click="cancelExceptionOrder(row)">终止履约</el-button>
                </div>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 任务干预 -->
      <el-tab-pane label="任务干预" name="intervene">
        <el-card shadow="never" class="content-card">
          <el-alert title="选门店 → 选任务（自动带出 taskId / taskNo / 当前骑手），也可以手动输入 ID。改派 / 回退 / 解锁收货码都作用于所选任务。" type="info" :closable="false" show-icon class="tip" />
          <el-form label-width="130px" size="small" class="intervene-form">
            <el-form-item label="门店">
              <el-select v-model="interveneShopId" filterable clearable placeholder="请选择门店" style="width: 260px" @change="loadInterveneTasks">
                <el-option v-for="shop in shops" :key="shop.id" :label="`${shop.name || '未命名门店'}（${shop.id}）`" :value="shop.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="选择配送任务">
              <el-select
                v-model="taskId"
                filterable
                clearable
                :loading="interveneLoading"
                :disabled="!interveneShopId"
                placeholder="先选门店，再选任务"
                style="width: 420px"
                @change="onInterveneTaskChange"
              >
                <el-option
                  v-for="task in interveneTasks"
                  :key="task.id"
                  :label="`${task.taskNo || task.id} · ${taskStatusLabel(task.status)} · ${task.receiverName || '收货人'}`"
                  :value="String(task.id)"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="配送任务 ID">
              <el-input v-model="taskId" placeholder="taskId，如 10001" style="max-width: 240px" />
              <span class="muted">（选择任务后自动填充）</span>
            </el-form-item>
            <el-form-item label="强制改派给骑手">
              <div class="row-inline">
                <el-select v-model="reassignTarget" filterable clearable :disabled="!interveneShopId" placeholder="选择本店配送员" style="width: 260px">
                  <el-option
                    v-for="person in interveneStaff"
                    :key="person.id"
                    :label="`${person.name || '未命名'}（${person.id}）${person.phone ? ' · ' + person.phone : ''}`"
                    :value="String(person.id)"
                  />
                </el-select>
                <el-button
                  type="warning"
                  plain
                  :disabled="!canIntervene('reassign') || !reassignTarget"
                  :title="interveneHint('reassign') || (!reassignTarget ? '请先选择新骑手' : '')"
                  @click="doReassign"
                >强制改派</el-button>
              </div>
            </el-form-item>
            <el-form-item label="配送异常">
              <div class="row-inline">
                <el-button
                  type="warning"
                  plain
                  :disabled="!canIntervene('resume')"
                  :title="interveneHint('resume')"
                  @click="doResume"
                >异常恢复（EXCEPTION → 异常前状态）</el-button>
                <span class="muted">骑手上报异常后任务会卡在「配送异常」，运营恢复后回到异常前的节点继续履约</span>
              </div>
            </el-form-item>
            <el-form-item label="人工回退原因">
              <div class="row-inline">
                <el-input v-model="rollbackReason" placeholder="如：骑手误点送达" style="width: 260px" />
                <el-button
                  type="warning"
                  plain
                  :disabled="!canIntervene('rollback') || timeline.length < 2"
                  :title="interveneHint('rollback') || (timeline.length < 2 ? '请先查询该任务的节点时间轴（至少 2 个节点才能回退）' : '')"
                  @click="doRollback"
                >回退最近一步</el-button>
              </div>
            </el-form-item>
            <el-form-item label="收货码">
              <el-button :disabled="!canIntervene('unlock')" :title="interveneHint('unlock')" @click="doUnlock">解锁收货码（错 5 次锁定 10 分钟）</el-button>
            </el-form-item>
            <el-divider />
            <el-form-item label="任务号">
              <div class="row-inline">
                <el-input v-model="taskNo" placeholder="taskNo（选择任务后自动填充）" style="width: 300px" />
                <el-button type="primary" :loading="timelineLoading" @click="loadTimeline()">查询节点时间轴</el-button>
              </div>
            </el-form-item>
          </el-form>
          <el-table v-if="timeline.length" v-loading="timelineLoading" :data="timeline" border size="small" max-height="360">
            <el-table-column prop="occurredAt" label="发生时间" min-width="170" />
            <el-table-column label="节点" width="170">
              <template #default="{ row }">
                <span>{{ deliveryEventLabel(row.eventType) }}</span>
                <small v-if="deliveryEventLabel(row.eventType) !== row.eventType" class="code-text">{{ row.eventType }}</small>
              </template>
            </el-table-column>
            <el-table-column label="操作方" width="120"><template #default="{ row }">{{ operatorTypeLabel(row.operatorType) }}</template></el-table-column>
            <el-table-column prop="operatorId" label="操作人" width="100" />
            <el-table-column prop="locationText" label="位置" min-width="180" />
            <el-table-column prop="remark" label="备注" min-width="160" />
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 骑手业绩 -->
      <el-tab-pane label="骑手业绩" name="rider">
        <el-card shadow="never" class="content-card">
          <el-form inline @submit.prevent="loadRiderStats">
            <el-form-item label="统计区间">
              <el-select v-model="riderFilters.range" style="width: 140px">
                <el-option label="今日 DAY" value="DAY" /><el-option label="本周 WEEK" value="WEEK" />
                <el-option label="本月 MONTH" value="MONTH" /><el-option label="全部 ALL" value="ALL" />
              </el-select>
            </el-form-item>
            <el-form-item label="骑手 ID"><el-input v-model="riderFilters.riderId" clearable placeholder="留空=全平台排行" style="width: 180px" /></el-form-item>
            <el-form-item><el-button type="primary" :loading="riderLoading" @click="loadRiderStats">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="riderLoading" :data="riderRows" border size="small" max-height="520">
            <el-table-column v-for="key in riderColumns" :key="key" :prop="key" :label="riderStatsColumnLabel(key)" min-width="130" />
          </el-table>
          <el-empty v-if="!riderLoading && !riderRows.length" description="暂无数据，点击查询" />
        </el-card>
      </el-tab-pane>

      <!-- 退款单 -->
      <el-tab-pane label="退款单" name="refunds">
        <el-card shadow="never" class="content-card">
          <el-form inline @submit.prevent="loadRefunds">
            <el-form-item label="订单号"><el-input v-model="refundFilters.orderNo" clearable placeholder="订单号" style="width: 200px" /></el-form-item>
            <el-form-item label="状态">
              <el-select v-model="refundFilters.status" clearable placeholder="全部状态" style="width: 160px">
                <el-option v-for="(label, code) in REFUND_STATUS_LABELS" :key="code" :label="label" :value="code" />
              </el-select>
            </el-form-item>
            <el-form-item><el-button type="primary" :loading="refundLoading" @click="loadRefunds">查询</el-button></el-form-item>
          </el-form>
          <el-table v-loading="refundLoading" :data="refunds" border size="small" max-height="520">
            <el-table-column prop="refundNo" label="退款单号" min-width="170" />
            <el-table-column prop="orderNo" label="订单号" min-width="170" />
            <el-table-column label="类型" width="130">
              <template #default="{ row }">
                <span>{{ refundTypeLabel(row.refundType) }}</span>
                <small v-if="refundTypeLabel(row.refundType) !== row.refundType" class="code-text">{{ row.refundType }}</small>
              </template>
            </el-table-column>
            <el-table-column label="申请金额" width="110"><template #default="{ row }">¥ {{ Number(row.applyAmount || 0).toFixed(2) }}</template></el-table-column>
            <el-table-column label="商品退款" width="110"><template #default="{ row }">¥ {{ Number(row.goodsRefundAmount || 0).toFixed(2) }}</template></el-table-column>
            <el-table-column label="配送费退" width="110"><template #default="{ row }">¥ {{ Number(row.deliveryFeeRefundAmount || 0).toFixed(2) }}</template></el-table-column>
            <el-table-column label="扣费" width="100"><template #default="{ row }">¥ {{ Number(row.deductAmount || 0).toFixed(2) }}</template></el-table-column>
            <el-table-column label="批准金额" width="110"><template #default="{ row }">¥ {{ Number(row.approvedAmount || 0).toFixed(2) }}</template></el-table-column>
            <el-table-column label="状态" width="130">
              <template #default="{ row }">
                <el-tag :type="refundStatusTagType(row.status)" effect="light">{{ refundStatusLabel(row.status) }}</el-tag>
                <small v-if="refundStatusLabel(row.status) !== row.status" class="code-text">{{ row.status }}</small>
              </template>
            </el-table-column>
            <el-table-column prop="retryCount" label="重试" width="80" />
            <el-table-column prop="failureReason" label="失败原因" min-width="160" />
            <el-table-column prop="createTime" label="创建时间" min-width="170" />
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 配送费配置 -->
      <el-tab-pane label="配送费配置" name="fee">
        <el-card shadow="never" class="content-card">
          <el-alert title="配送费由平台统一设置：merchantId 留空或 0 = 全局默认；填门店 ID = 为该门店设置覆盖价。" type="info" :closable="false" show-icon class="tip" />
          <el-form label-width="130px" size="small" class="fee-form">
            <el-form-item label="查询门店 ID">
              <div class="row-inline">
                <el-input v-model="feeQuery.merchantId" placeholder="留空=全局默认" style="width: 200px" />
                <el-button :loading="feeLoading" @click="loadFeeConfig">查询当前配置</el-button>
              </div>
            </el-form-item>
          </el-form>
          <el-alert v-if="feeHint" :title="feeHint" type="info" :closable="false" show-icon class="tip" />
          <pre v-if="feeCurrent" class="json-view">{{ JSON.stringify(feeCurrent, null, 2) }}</pre>
          <el-divider />
          <el-form label-width="130px" size="small" class="fee-form">
            <el-form-item label="生效门店 ID"><el-input v-model="feeForm.merchantId" placeholder="留空或 0 = 全局默认" style="width: 240px" /></el-form-item>
            <el-form-item label="计费方式">
              <el-radio-group v-model="feeForm.feeType" @change="applyFeeTemplate">
                <el-radio-button value="FIXED">固定运费</el-radio-button>
                <el-radio-button value="DISTANCE_STEP">阶梯运费</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="feeConfig(JSON)"><el-input v-model="feeForm.feeConfig" type="textarea" :rows="3" style="max-width: 520px" /></el-form-item>
            <el-form-item label="启用"><el-switch v-model="feeForm.enabled" :active-value="1" :inactive-value="0" /></el-form-item>
            <el-form-item label="备注"><el-input v-model="feeForm.remark" placeholder="可选" style="max-width: 320px" /></el-form-item>
            <el-form-item><el-button type="primary" :loading="feeSaving" @click="submitFeeConfig">保存配送费配置</el-button></el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<style scoped>
/* 配送状态列的副行：异常类型/说明（后端 2026-09-17 新增字段），异常单不必跳任务时间轴就能看出原因 */
.status-note { margin-top: 4px; color: #909399; font-size: 12px; line-height: 1.4; }
.heading-actions { display: flex; align-items: center; gap: 10px; }
.master-label { color: var(--vben-muted); font-size: 14px; }
.tip { margin-bottom: 16px; }
.content-card { margin-bottom: 16px; }
.code-text { display: block; color: var(--vben-muted); font-size: 12px; }
.metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 8px; }
.metric { display: flex; flex-direction: column; gap: 6px; padding: 18px; border: 1px solid var(--vben-border); border-radius: var(--vben-card-radius); background: var(--vben-surface); }
.metric-label { color: var(--vben-muted); font-size: 13px; }
.metric strong { font-size: 24px; font-weight: 700; }
.row-inline { display: flex; align-items: center; gap: 10px; }
.intervene-form, .fee-form { max-width: 720px; }
.json-view { max-height: 280px; overflow: auto; padding: 14px; border: 1px solid var(--vben-border); border-radius: 8px; background: var(--vben-surface); color: var(--vben-text); font-size: 13px; line-height: 20px; }
@media (max-width: 900px) { .metric-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
