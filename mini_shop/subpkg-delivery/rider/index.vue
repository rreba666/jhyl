<script setup lang="ts">
/**
 * 骑手工作台（对应设计稿 5 个 Tab：新任务 / 待取货 / 配送中 / 已完成 / 异常单）
 * 契约：2026-09-14 骑手端 UI 落地版（v1.4）
 * - 列表：**一个接口** `GET /api/delivery/tasks?tab=&page=&pageSize=`（返回 PageResult<RiderTaskVO>）
 * - 商品清单：折叠条件数用列表的 `totalQuantity`（总件数；`itemCount` 是明细行数），展开再调 `GET /tasks/{id}/items`
 * - 手机号明文下发，**UI 星号由前端截**；倒计时以服务端 `remainingSeconds` 为基准
 */
import { computed, ref } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import {
  acceptTask,
  claimTask,
  deliverTask,
  getRiderTasks,
  getRiderUnread,
  getTaskContact,
  getTaskItems,
  pickupTask,
  startTask,
  type RiderTask,
  type RiderTaskItem,
  type RiderTaskTab,
  type TaskNodeBody,
} from '@/api/delivery'
import { collectNodeLocation, confirmDeliverDistance, isLocationAuthorized } from '@/utils/location'
import { captureProofImages, submitProofImages } from '@/utils/delivery-proof'
import RiderGoodsBox from '@/components/delivery/RiderGoodsBox.vue'

/**
 * Tab 定义：key=前端、api=后端 tab 参数、label=展示。
 * 第 5 个 Tab 按**设计稿**叫「异常单」（`EXCEPTION`）；后端口径里 `CANCELLED` 是混排进来的，
 * 但**业务上骑手端不处理"已取消"（那是 PC 后台的范畴）**，所以不再做"异常/已取消"两色标签区分，
 * 卡片右上直接显示状态（异常=红「订单异常」）。代码里保留 `CANCELLED` 的兜底渲染，防止后端偶发返回时白屏。
 */
const TABS = [
  { key: 'new', api: 'NEW', label: '新任务' },
  { key: 'picking', api: 'PICKUP', label: '待取货' },
  { key: 'delivering', api: 'DELIVERING', label: '配送中' },
  { key: 'done', api: 'DONE', label: '已完成' },
  { key: 'exception', api: 'EXCEPTION', label: '异常单' },
] as const
type TabKey = (typeof TABS)[number]['key']

/** 各 Tab 空态文案（与 UI 设计说明一致）。 */
const EMPTY_TEXT: Record<TabKey, string> = {
  new: '暂无新任务',
  picking: '暂无待取货任务',
  delivering: '暂无配送中任务',
  done: '暂无已完成任务',
  exception: '暂无异常单',
}

/** 状态栏高度（自定义导航需避开状态栏与胶囊）。 */
const statusBarHeight = ref(0)
/** Tab 行高度（设计稿 46px）：深色头部 = 状态栏 + 44px 门店行 + Tab 行，列表从这里往下开始 */
const TABS_HEIGHT = 46
const contentTop = computed(() => statusBarHeight.value + 44 + TABS_HEIGHT)
/** 门店名（切换身份时缓存的身份卡）。 */
const shopName = ref('')

const activeTab = ref<TabKey>('new')
const tasks = ref<RiderTask[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const loadingMore = ref(false)
const acting = ref(false)
/** 商品清单缓存（taskId → items）。 */
const itemCache = ref<Record<string, RiderTaskItem[]>>({})
/** 已展开商品清单的任务 id。 */
const expanded = ref<Record<string, boolean>>({})
/** 倒计时本地递减基准：{ [taskId]: 剩余秒数 }。 */
const remainMap = ref<Record<string, number>>({})
let tickTimer: ReturnType<typeof setInterval> | null = null
/** 未读红点轮询定时器（10s）。 */
let unreadTimer: ReturnType<typeof setInterval> | null = null
/** 工作台未读数（拉取即清零；用于「新任务」Tab 红点）。 */
const unread = ref(0)

/** 当前 Tab 的后端参数。 */
const currentApiTab = computed<RiderTaskTab>(() => (TABS.find((tab) => tab.key === activeTab.value)?.api || 'ALL') as RiderTaskTab)

/** 手机号打星号（明文下发，UI 自己截）。 */
function maskPhone(phone?: string): string {
  const value = String(phone || '').replace(/\s/g, '')
  if (value.length < 7) return value || '—'
  return `${value.slice(0, 3)}****${value.slice(-4)}`
}

/** 任务号短号：设计稿是 #001，这里用列表序号兜底。 */
/**
 * 任务短号：取**订单号后 4 位**（与商家端、后台一致）。
 * ⚠️ 此前是按列表索引本地生成 `#001` —— 同一单在骑手端显示 `#001`、商家端显示 `#4000`，
 * 对不上单；而且索引会随翻页/筛选变化（2026-09-19 用户反馈）。
 */
function shortNo(orderNo?: string): string {
  const no = String(orderNo || '')
  return no ? `#${no.slice(-4)}` : '#—'
}

/** 承诺送达时间 → HH:mm（设计稿「10:13前送达」）；服务端已判超时则明确提示。 */
function deadlineText(task: RiderTask): string {
  const remain = remainMap.value[String(task.id)]
  // remainingSeconds 为 0/负 = 已过承诺时间 → 显示"已超时"，避免"剩余 0 分钟"这种无效文案
  if (remain != null && remain <= 0) return '已超时'
  const clock = deadlineClock(task)
  if (clock) return `${clock} 前送达`
  if (remain == null) return ''
  return `剩余 ${Math.ceil(remain / 60)} 分钟`
}

/** 从 `expectedDeliverAt` 里取 `HH:mm`（取不到返回空串）。 */
function deadlineClock(task: RiderTask): string {
  const matched = String(task.expectedDeliverAt || '').match(/(\d{2}:\d{2})/)
  return matched ? matched[1] : ''
}

/**
 * 新任务卡右上承诺时限（设计稿 01：`55 分钟内（10:13前）送达`）——
 * 设计稿里这一串是**一个文本节点但带字符级样式**：`55 分钟内` 是 16px/600 橙色，
 * `（10:13前）送达` 是 14px/400 深色，因此这里拆成「主段 + 副段」两段分别渲染。
 * 剩余分钟由 `remainingSeconds`（服务端基准）折算；字段缺失时退化成「10:13 前送达」或「剩余 N 分钟」。
 */
function newTaskDeadlineParts(task: RiderTask): { main: string; extra: string } {
  const clock = deadlineClock(task)
  const remain = task.remainingSeconds
  const minutes = remain != null ? Math.ceil(Number(remain) / 60) : null
  if (minutes != null && minutes > 0 && clock) return { main: `${minutes} 分钟内`, extra: `（${clock}前）送达` }
  if (clock) return { main: `${clock} 前送达`, extra: '' }
  if (minutes != null && minutes > 0) return { main: `剩余 ${minutes} 分钟`, extra: '' }
  return { main: '', extra: '' }
}

/** 距离文案拆成「数值 + 单位」（设计稿竖条：数值 14px、单位 12px，上下两行居中）。 */
function distanceParts(text: string): { num: string; unit: string } {
  const matched = /^([\d.]+)\s*(.*)$/.exec(String(text || '').trim())
  if (!matched) return { num: String(text || ''), unit: '' }
  return { num: matched[1], unit: matched[2] || 'km' }
}

/** 竖条距离数值（设计稿 `4.1`）。 */
function distanceNum(task: RiderTask): string {
  return distanceParts(distanceText(task)).num
}

/** 竖条距离单位（设计稿 `km`）。 */
function distanceUnit(task: RiderTask): string {
  return distanceParts(distanceText(task)).unit
}

/** 送货段距离文案（设计稿左侧竖条下方：`4.1 km`）。 */
function distanceText(task: RiderTask): string {
  return task.distanceKm != null ? `${Number(task.distanceKm).toFixed(1)} km` : '—'
}

/** 卡片头部是否用短号：设计稿里新任务 / 待取货 / 配送中用 `#001`，已完成 / 异常单改用订单号。 */
const useShortNo = computed(() => activeTab.value === 'new' || activeTab.value === 'picking' || activeTab.value === 'delivering')

/**
 * 卡片右上主文案（设计稿分状态）：
 * 新任务 = 「55 分钟内（10:13前）送达」（红）；待取货 = 「55 分钟内」（橙）；
 * 配送中 / 已完成 / 异常 = 状态名（分别橙 / 绿 / 红）。
 */
function headStatusText(task: RiderTask): string {
  if (String(task.status || '') === 'ACCEPTED') {
    const remain = remainMap.value[String(task.id)]
    if (remain != null && remain <= 0) return '已超时'
    const minutes = remain != null ? Math.ceil(remain / 60) : null
    if (minutes != null && minutes > 0) return `${minutes} 分钟内`
    const clock = deadlineClock(task)
    return clock ? `${clock} 前送达` : '待取货'
  }
  return statusLabel(task)
}

/** 卡片右上补充文案（深色小字）：新任务是「（10:13前）送达」，待取货追加 `- 4.1km`，其余状态无。 */
function headStatusExtra(task: RiderTask): string {
  const status = String(task.status || '')
  if (status === 'PENDING' || status === 'ASSIGNED') return newTaskDeadlineParts(task).extra
  if (status !== 'ACCEPTED') return ''
  return task.distanceKm != null ? `- ${Number(task.distanceKm).toFixed(1)}km` : ''
}

/** 配送中地图卡：预计送达时间（`HH:mm`）。 */
function deliverEta(task: RiderTask): string {
  return deadlineClock(task) || '—'
}

/** 配送中地图卡：距离目的地（只留数字，单位写在文案里）。 */
function distanceOnly(task: RiderTask): string {
  // 优先「距目的地剩余直线距离」（骑手有位置上报时后端才算得出）；
  // null（骑手无位置/任务缺坐标）时回退配送段总距离 distanceKm —— 2026-09-17 api_doc 口径。
  const remain = task.distanceToDestinationKm
  if (remain != null) return Number(remain).toFixed(1)
  return task.distanceKm != null ? Number(task.distanceKm).toFixed(1) : '—'
}

/* ===================== 配送中地图卡（微信原生 <map>） ===================== */

/** 经纬度点。 */
type MapPoint = { latitude: number; longitude: number }

/** 骑手当前位置（进配送中列表时静默采集一次；拿不到就不显示骑手标记）。 */
const riderPoint = ref<MapPoint | null>(null)

/** 静默采集一次骑手定位：只用于在地图上画骑手位置，失败不提示、不阻断（骑手端不做实时位置上报）。 */
async function loadRiderPoint(): Promise<void> {
  // 只在**已经授权过**时顺手采一次：没授权就跳过，避免骑手一进「配送中」就被授权弹窗打扰
  // （授权动作交给取货 / 送达这类骑手主动触发的流程去申请）
  if (!(await isLocationAuthorized())) return
  const body = await collectNodeLocation(false, true)
  if (body.latitude != null && body.longitude != null) {
    riderPoint.value = { latitude: body.latitude, longitude: body.longitude }
  }
}

/** 地图中心点：优先取货门店，其次收货地址；两者都缺时给门店所在区域兜底，避免地图空白。 */
function mapCenter(task: RiderTask): MapPoint {
  if (task.pickupLat != null && task.pickupLng != null) return { latitude: Number(task.pickupLat), longitude: Number(task.pickupLng) }
  if (task.deliveryLat != null && task.deliveryLng != null) return { latitude: Number(task.deliveryLat), longitude: Number(task.deliveryLng) }
  return { latitude: 29.6085, longitude: 115.9113 }
}

/** 订单是否带坐标：一个都没有就不画地图，改显示占位文案。 */
function hasMapData(task: RiderTask): boolean {
  return (task.pickupLat != null && task.pickupLng != null) || (task.deliveryLat != null && task.deliveryLng != null)
}

/** 需要纳入视野的点（`include-points` 会自动缩放地图把这几处都框进来）。 */
function mapPoints(task: RiderTask): MapPoint[] {
  const points: MapPoint[] = []
  if (task.pickupLat != null && task.pickupLng != null) points.push({ latitude: Number(task.pickupLat), longitude: Number(task.pickupLng) })
  if (task.deliveryLat != null && task.deliveryLng != null) points.push({ latitude: Number(task.deliveryLat), longitude: Number(task.deliveryLng) })
  if (riderPoint.value) points.push(riderPoint.value)
  return points
}

/**
 * 地图标记：门店（橙水滴 + 店图标）/ 收货点（橙水滴 + 房子图标）/ 骑手当前位置（骑手插画）。
 * 门店与收货点的名字用 marker 自带 `callout`（微信原生气泡，会随地图移动）。
 */
function mapMarkers(task: RiderTask): Array<Record<string, unknown>> {
  const markers: Array<Record<string, unknown>> = []
  if (task.pickupLat != null && task.pickupLng != null) {
    markers.push({
      id: 1,
      latitude: Number(task.pickupLat),
      longitude: Number(task.pickupLng),
      iconPath: '/static/rider/map-marker-shop.png',
      width: 24,
      height: 26,
      callout: {
        content: task.pickupShopName || task.pickupAddress || '取货门店',
        color: '#1D2129',
        fontSize: 11,
        bgColor: '#FFFFFF',
        borderRadius: 6,
        padding: 6,
        display: 'ALWAYS',
      },
    })
  }
  if (task.deliveryLat != null && task.deliveryLng != null) {
    markers.push({
      id: 2,
      latitude: Number(task.deliveryLat),
      longitude: Number(task.deliveryLng),
      iconPath: '/static/rider/map-marker-dest.png',
      width: 24,
      height: 26,
      callout: {
        content: task.receiverName ? `${task.receiverName} 收货` : '收货地址',
        color: '#1D2129',
        fontSize: 11,
        bgColor: '#FFFFFF',
        borderRadius: 6,
        padding: 6,
        display: 'ALWAYS',
      },
    })
  }
  if (riderPoint.value) {
    markers.push({
      id: 3,
      latitude: riderPoint.value.latitude,
      longitude: riderPoint.value.longitude,
      iconPath: '/static/rider/rider-on-bike.png',
      width: 32,
      height: 32,
    })
  }
  return markers
}

/** 复制订单号（已完成 / 异常单卡的头部）。 */
function copyOrderNo(task: RiderTask): void {
  const no = String(task.orderNo || '')
  if (!no) return
  uni.setClipboardData({ data: no, success: () => uni.showToast({ title: '订单号已复制', icon: 'none' }) })
}

/**
 * 卡片右上状态图标（iconfont 项目 5230143）：
 * 配送中=车、已完成=绿勾、订单异常=警报；新任务/待取货/已取消按设计不带图标。
 */
function statusIcon(task: RiderTask): string {
  const status = String(task.status || '')
  if (status === 'DELIVERED') return 'rider-icon-gouxuan_tianchong'
  if (status === 'EXCEPTION') return 'rider-icon-jingbao'
  if (status === 'PICKED_UP' || status === 'DELIVERING' || status === 'NEARBY' || status === 'PAUSED') return 'rider-icon-peisongzhong'
  return ''
}

/** 右上状态：配送中 / 已完成 / 已取消 / 订单异常，其它显示承诺时间。 */
function statusLabel(task: RiderTask): string {
  const status = String(task.status || '')
  if (status === 'DELIVERED') return '已完成'
  if (status === 'CANCELLED') return '已取消'
  if (status === 'EXCEPTION') return '订单异常'
  if (status === 'PICKED_UP' || status === 'DELIVERING' || status === 'NEARBY' || status === 'PAUSED') return '配送中'
  // 新任务（PENDING/ASSIGNED）：设计稿要的是「55 分钟内（10:13前）送达」，主段在这里、副段在 headStatusExtra
  if (status === 'PENDING' || status === 'ASSIGNED') return newTaskDeadlineParts(task).main
  return deadlineText(task)
}

/** 状态颜色类。 */
function statusClass(task: RiderTask): string {
  const status = String(task.status || '')
  if (status === 'DELIVERED') return 'is-done'
  if (status === 'CANCELLED') return 'is-cancelled'
  if (status === 'EXCEPTION') return 'is-exception'
  if (status === 'ACCEPTED') return 'is-picking'
  if (status === 'PICKED_UP' || status === 'DELIVERING' || status === 'NEARBY' || status === 'PAUSED') return 'is-delivering'
  return 'is-new'
}

/**
 * 已取消兜底：业务口径上骑手端**不处理已取消**（PC 后台范畴），出参也不应含 `CANCELLED`；
 * 但万一后端返回，这里仍按灰调渲染并隐藏"联系客户"，避免白屏或误操作。
 */
function isCancelled(task: RiderTask): boolean {
  return String(task.status || '') === 'CANCELLED'
}

/** 加载任务列表（reset=true 回到第一页）。 */
async function loadTasks(reset = false): Promise<void> {
  if (reset) {
    page.value = 1
    loading.value = true
  } else {
    loadingMore.value = true
  }
  try {
    const result = await getRiderTasks(currentApiTab.value, page.value, pageSize)
    tasks.value = reset ? result.list : [...tasks.value, ...result.list]
    total.value = result.total
    // 用服务端 remainingSeconds 初始化倒计时（本地只做递减，不用本机时间换算）
    const next: Record<string, number> = {}
    result.list.forEach((task) => {
      if (task.remainingSeconds != null && task.id != null) next[String(task.id)] = Number(task.remainingSeconds)
    })
    remainMap.value = reset ? next : { ...remainMap.value, ...next }
  } catch (error) {
    if (reset) tasks.value = []
    uni.showToast({ title: error instanceof Error ? error.message : '任务加载失败', icon: 'none' })
  } finally {
    loading.value = false
    loadingMore.value = false
    // 配送中要在地图上画骑手位置：列表到位后静默采一次定位（已有则不重复采；失败不提示）
    if (activeTab.value === 'delivering' && !riderPoint.value) void loadRiderPoint()
  }
}

/** 触底加载下一页。 */
function loadMore(): void {
  if (loading.value || loadingMore.value) return
  if (tasks.value.length >= total.value) return
  page.value += 1
  void loadTasks(false)
}

/** 切换 Tab。 */
function switchTab(key: TabKey): void {
  if (activeTab.value === key) return
  activeTab.value = key
  expanded.value = {}
  void loadTasks(true)
}

/** 展开/收起商品清单（首次展开时拉取明细）。 */
async function toggleItems(task: RiderTask): Promise<void> {
  if (task.id == null) return
  const key = String(task.id)
  expanded.value[key] = !expanded.value[key]
  if (expanded.value[key] && !itemCache.value[key]) {
    try {
      itemCache.value[key] = await getTaskItems(task.id)
    } catch (error) {
      expanded.value[key] = false
      uni.showToast({ title: error instanceof Error ? error.message : '商品清单加载失败', icon: 'none' })
    }
  }
}

/** 门店名（切换身份时缓存）。 */
function loadShopName(): void {
  try {
    const cached = uni.getStorageSync('identity_entry') as { identities?: Array<{ shopName?: string }> } | ''
    if (cached && typeof cached === 'object') shopName.value = cached.identities?.[0]?.shopName || ''
  } catch { /* 忽略 */ }
}

/** 接单：发布池走 claim，指派走 accept。 */
async function doAccept(task: RiderTask): Promise<void> {
  if (acting.value || task.id == null) return
  acting.value = true
  try {
    if (String(task.status) === 'ASSIGNED') await acceptTask(task.id)
    else await claimTask(task.id)
    uni.showToast({ title: '接单成功', icon: 'success' })
    await loadTasks(true)
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '接单失败', icon: 'none' })
  } finally {
    acting.value = false
  }
}

/**
 * 「开始配送」节点（`PICKED_UP → DELIVERING`）。
 *
 * ⚠️ 设计稿的配送中卡片只有 导航 / 联系客户 / 确认送达 三个按钮，**没有单独的「开始配送」按钮**，
 * 但后端状态机要求先 start 才能 delivered（`/delivered` 只接受 `DELIVERING`/`NEARBY`），
 * 而「配送中」Tab 又会把 `PICKED_UP` 的任务一起列出来 —— 不补这一步的话，
 * 任务会永远停在 `PICKED_UP`，一点「确认送达」就报「任务状态已变化，无法确认送达」。
 * 所以：取货成功后自动补一次，送达前再兜底补一次（见 doDeliver）。
 *
 * 定位尽力而为：`NodeBody` 的坐标字段非必填，拿不到坐标也提交，只是少一个轨迹点。
 */
async function startDelivery(taskId: number | string): Promise<boolean> {
  try {
    const body = await collectNodeLocation(false, true)
    await startTask(taskId, body)
    return true
  } catch {
    return false
  }
}

/** 确认取货（定位可选：拿不到定位也允许取货）。 */
async function doPickup(task: RiderTask): Promise<void> {
  if (acting.value || task.id == null) return
  acting.value = true
  try {
    // 取货允许没有定位（required=false，失败返回空对象），不阻断主流程
    const body = await collectNodeLocation(false)
    await pickupTask(task.id, body)
    // 取货成功后立刻进入「配送中」（设计稿没有单独的「开始配送」按钮，见 startDelivery 注释）
    await startDelivery(task.id)
    uni.showToast({ title: '已确认取货', icon: 'success' })
    await loadTasks(true)
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '确认取货失败', icon: 'none' })
  } finally {
    acting.value = false
  }
}

/** 没拿到定位时的二次确认：确认后仍以「不带定位」提交送达（后端两个字段本就是可选）。 */
function confirmDeliverWithoutLocation(): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title: '未获取到位置',
      content: '本次送达将不记录定位。可在「设置 - 位置信息」开启权限后重试，是否继续送达？',
      confirmText: '继续送达',
      cancelText: '去开启定位',
      success: (res) => {
        if (res.confirm) return resolve(true)
        // 拒绝过授权时微信不再自动弹窗，这里顺带把设置页打开
        uni.openSetting({ complete: () => resolve(false) })
      },
      fail: () => resolve(false),
    })
  })
}

/** 确认送达（优先带定位；启用收货码的任务请到详情页先校验收货码）。 */
async function doDeliver(task: RiderTask): Promise<void> {
  if (acting.value || task.id == null) return
  if (task.pickupCodeRequired) {
    uni.showToast({ title: '该单需收货码，请进详情页核销', icon: 'none' })
    openDetail(task)
    return
  }
  acting.value = true
  try {
    // 兜底：列表任务可能还停在 PICKED_UP（例如取货时自动 start 没成功），送达前补一次
    if (String(task.status || '') === 'PICKED_UP') {
      const started = await startDelivery(task.id)
      if (!started) {
        uni.showToast({ title: '任务状态已变化，请下拉刷新后重试', icon: 'none' })
        await loadTasks(true)
        return
      }
    }
    // 位置软提醒：离收货点太远先二次确认（只提醒不拦截 —— 室内定位飘移很常见）
    if (!(await confirmDeliverDistance({ latitude: task.deliveryLat, longitude: task.deliveryLng }))) return
    // 引导拍送达照片（可跳过；跳过之后可在「已完成」详情页 24h 内补传）
    const proofKeys = await captureProofImages()
    // 先静默取一次定位：拿到就带上；拿不到则二次确认后按「无定位」提交
    let body: TaskNodeBody = {}
    try {
      body = await collectNodeLocation(true, true)
    } catch {
      const goOn = await confirmDeliverWithoutLocation()
      if (!goOn) return
    }
    await deliverTask(task.id, body)
    uni.showToast({ title: '已确认送达', icon: 'success' })
    await loadTasks(true)
    // 凭证必须在**送达之后**提交（后端口径：送达后 24h 内）；失败不打断流程，延后提示以免盖掉成功 toast
    if (proofKeys.length) {
      try {
        await submitProofImages(task.id, proofKeys, task.receiverName)
      } catch {
        setTimeout(() => uni.showToast({ title: '送达照片上传失败，可在详情页补传', icon: 'none' }), 1600)
      }
    }
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '确认送达失败', icon: 'none' })
  } finally {
    acting.value = false
  }
}

/** 联系顾客（列表已有明文号码，直接拨号；同时留取号日志）。 */
async function callCustomer(task: RiderTask): Promise<void> {
  if (task.id == null) return
  try {
    const phone = (await getTaskContact(task.id, '配送联系')) || task.receiverPhone || ''
    if (!phone) {
      uni.showToast({ title: '未获取到号码', icon: 'none' })
      return
    }
    uni.makePhoneCall({ phoneNumber: phone })
  } catch {
    // 取号失败时退回列表里的明文号码
    if (task.receiverPhone) uni.makePhoneCall({ phoneNumber: task.receiverPhone })
    else uni.showToast({ title: '取号失败', icon: 'none' })
  }
}

/** 导航到收货地址。 */
function navigate(task: RiderTask): void {
  if (task.deliveryLat == null || task.deliveryLng == null) {
    uni.showToast({ title: '该订单缺少坐标，无法导航', icon: 'none' })
    return
  }
  uni.openLocation({
    latitude: Number(task.deliveryLat),
    longitude: Number(task.deliveryLng),
    name: task.receiverName || '收货地址',
    address: task.deliveryAddress || '',
    fail: () => uni.showToast({ title: '打开地图失败', icon: 'none' }),
  })
}

/** 进入订单详情。 */
function openDetail(task: RiderTask): void {
  if (task.id == null) return
  uni.navigateTo({ url: `/subpkg-delivery/rider/detail?taskId=${task.id}` })
}

/**
 * 卡片点击进详情。
 *
 * 「配送中」的底部按钮只有 导航 / 联系客户 / 确认送达（设计稿就是这三个），详情页才有「上报异常」，
 * 所以卡片本体要能点进去；「新任务」还没接单、详情页没有对应形态，点击不响应。
 */
function openCard(task: RiderTask): void {
  if (activeTab.value === 'new') return
  openDetail(task)
}

/** 返回上一页（不切换身份）。 */
function goBack(): void {
  uni.navigateBack()
}

onLoad((options?: Record<string, string | undefined>) => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  // 支持从外部带 Tab 进入（门店管理页「抢单配送」→ ?tab=new，直接落到可抢单列表）
  const requested = String(options?.tab || '').toLowerCase()
  const matched = TABS.find((tab) => tab.key === requested || tab.api.toLowerCase() === requested)
  if (matched) activeTab.value = matched.key
})
/** 拉取未读数（后端拉取即清零），用于「新任务」Tab 红点。 */
async function refreshUnread(): Promise<void> {
  try {
    unread.value = await getRiderUnread()
  } catch {
    // 红点是增强提示，失败静默，不影响列表
  }
}

onShow(() => {
  loadShopName()
  void loadTasks(true)
  void refreshUnread()
  // 未读红点轮询：10s（原先 30s 偏慢；如仍嫌慢可直接调小此值）
  if (unreadTimer) clearInterval(unreadTimer)
  unreadTimer = setInterval(() => { void refreshUnread() }, 10000)
  // 倒计时：纯本地递减（基准是服务端返回的 remainingSeconds）
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = setInterval(() => {
    const next: Record<string, number> = { ...remainMap.value }
    Object.keys(next).forEach((key) => { next[key] = Math.max(0, next[key] - 1) })
    remainMap.value = next
  }, 1000)
})
onUnload(() => {
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = null
  if (unreadTimer) clearInterval(unreadTimer)
  unreadTimer = null
})
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <!-- 深色头部（设计稿 Frame 35）：门店行 + 5 Tab 同处 #0F0F11 -->
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <!-- 门店 logo + 门店名（设计稿 Frame 38：32px 圆底 + 20px logo + 白色店名） -->
        <view class="shop-row">
          <image class="shop-logo" src="/static/logo.png" mode="aspectFit" />
          <text class="shop-name">{{ shopName || '骑手工作台' }}</text>
        </view>
      </view>

      <!-- 5 个 Tab（设计稿：激活 #FF5500 + 底部下划线，未激活 #D7DBE0） -->
      <view class="tabs">
        <view v-for="tab in TABS" :key="tab.key" class="tab" @click="switchTab(tab.key)">
          <view class="tab-label-wrap">
            <text class="tab-text" :class="{ 'is-active': activeTab === tab.key }">{{ tab.label }}</text>
            <!-- 新任务未读红点（10s 轮询刷新） -->
            <view v-if="tab.key === 'new' && unread > 0" class="tab-dot" />
          </view>
          <view class="tab-line" :class="{ 'is-active': activeTab === tab.key }" />
        </view>
      </view>
    </view>

    <scroll-view class="list" scroll-y @scrolltolower="loadMore">
      <view v-if="loading" class="state">加载中…</view>
      <view v-else-if="!tasks.length" class="state">{{ EMPTY_TEXT[activeTab] }}</view>
      <template v-else>
        <!--
          卡片整体可点进详情：设计稿的「配送中」只有 导航 / 联系客户 / 确认送达 三个按钮，
          **没有「详情」入口**，而「上报异常」只在详情页里 —— 不放开车卡就进不去（2026-09-17 用户反馈）。
          「新任务」还没接单、详情页没有对应形态，所以不放开点击。
        -->
        <view
          v-for="(task, index) in tasks"
          :key="task.id"
          class="card"
          :class="{ 'is-clickable': activeTab !== 'new' }"
          hover-class="card-pressed"
          @click="openCard(task)"
        >
          <!-- 头部（设计稿）：新任务/待取货/配送中用短号 `#001`；已完成/异常单用订单号 + 复制 -->
          <view class="card-head">
            <text v-if="useShortNo" class="order-no">{{ shortNo(task.orderNo) }}</text>
            <view v-else class="order-no-plain">
              <text class="order-no-text">{{ task.orderNo || '—' }}</text>
              <text class="order-no-copy" @click.stop="copyOrderNo(task)"><text class="rider-icon rider-icon-fuzhi" /></text>
            </view>
            <!-- 状态（图标 + 文字，颜色由 statusClass 决定，图标用字色） -->
            <view class="card-status card-status-wrap" :class="statusClass(task)">
              <text v-if="statusIcon(task)" class="rider-icon status-icon" :class="statusIcon(task)" />
              <text class="status-main">{{ headStatusText(task) }}</text>
              <text v-if="headStatusExtra(task)" class="status-extra">{{ headStatusExtra(task) }}</text>
            </view>
          </view>

          <!--
            新任务：按设计稿 01 呈现 —— 左侧距离竖条（取货点 `0 km` → 骑手插画 → 送货 `N km`）+ 右侧取送信息。
            竖条中间的骑手图即设计交付的 `rider-badge.png`（72×222，与设计稿里 24×74 的比例完全一致）；
            上下距离文案在稿中是**窄框内自动折行的两行**（数值 14px / 单位 12px），所以这里拆成两个 text 纵向排列。
          -->
          <template v-if="activeTab === 'new'">
            <view class="new-route">
              <view class="distance-bar">
                <view class="distance-text">
                  <text class="distance-num">0</text>
                  <text class="distance-unit">km</text>
                </view>
                <image class="distance-rider" src="/static/rider/rider-badge.png" mode="aspectFit" />
                <view class="distance-text">
                  <text class="distance-num">{{ distanceNum(task) }}</text>
                  <text class="distance-unit">{{ distanceUnit(task) }}</text>
                </view>
              </view>
              <view class="new-route-info">
                <view>
                  <text class="route-name">{{ task.pickupShopName || task.pickupAddress || '取货点' }}</text>
                  <text class="route-tag">到店取货</text>
                </view>
                <!-- 地址块（设计稿 01 的 Frame 50：地址 + 商品清单，两者间距 4px） -->
                <view class="dest-block">
                  <text class="route-name">{{ task.deliveryAddress || '收货地址' }}</text>
                  <!--
                    商品清单在**右侧信息列内**（与店名/地址同宽），而不是整卡全宽
                    —— 设计稿 01/02 里 Frame 57 的 x 与右侧列一致、宽 302，2026-09-17 核对
                  -->
                  <RiderGoodsBox
                    :quantity="task.totalQuantity ?? task.itemCount ?? 0"
                    :expanded="!!expanded[String(task.id)]"
                    :items="itemCache[String(task.id)] || []"
                    @toggle="toggleItems(task)"
                  />
                </view>
              </view>
            </view>
          </template>

          <!-- 其它 Tab：收货人（打星）+ 地址；配送中再加一张地图卡 -->
          <template v-else>
            <view class="receiver-row">
              <text class="receiver-name">{{ task.receiverName || '收货人' }}</text>
              <text class="receiver-phone">{{ maskPhone(task.receiverPhone) }}</text>
            </view>
            <!-- 地址行：设计稿里地址前有一个灰色位置小图标（16px → 31rpx） -->
            <view class="address-row">
              <text class="rider-icon rider-icon-weizhi1 address-icon" />
              <text class="address">{{ task.deliveryAddress || '—' }}</text>
            </view>
            <text v-if="activeTab === 'exception' && task.exceptionRemark" class="exception-text">异常说明：{{ task.exceptionRemark }}</text>
            <!--
              配送中：地图卡（设计稿 06 的 Frame 133）
              设计稿这里是静态示意图；实现改用**微信原生 <map>**：门店 / 收货点打点 + 骑手当前位置，
              视野由 include-points 自动缩放。map 是原生组件、会盖住普通节点，所以卡上气泡必须用
              <cover-view> 写在 map 内部（气泡里的文字也只能是 cover-view）。
            -->
            <view v-if="activeTab === 'delivering' && hasMapData(task)" class="map-card">
              <map
                class="map-view"
                :latitude="mapCenter(task).latitude"
                :longitude="mapCenter(task).longitude"
                :markers="mapMarkers(task)"
                :include-points="mapPoints(task)"
                :scale="14"
              >
                <cover-view class="map-eta">
                  <cover-view class="map-eta-dot" />
                  <cover-view class="map-eta-text">预计 {{ deliverEta(task) }} 送达</cover-view>
                </cover-view>
                <cover-view class="map-distance">
                  <cover-view class="map-distance-text">距离目的地还有</cover-view>
                  <cover-view class="map-distance-km">{{ distanceOnly(task) }}km</cover-view>
                </cover-view>
              </map>
            </view>
            <!-- v-if / v-else-if 必须相邻（中间不放注释），所以这里的说明写在分支内部 -->
            <view v-else-if="activeTab === 'delivering'" class="map-card map-card-empty">
              <!-- 门店与收货地址都没有坐标时地图画不出来，给一句占位说明 -->
              <text class="map-empty-text">该订单缺少坐标，无法显示地图</text>
            </view>
            <!--
              待取货：设计稿 03/04 的商品清单是**整卡全宽**的（Frame 88 宽 350），
              位置在「位置图标 + 地址」下方，两者间距 12px——与「新任务」放进右侧列不同，2026-09-17 核对
            -->
            <RiderGoodsBox
              v-if="activeTab === 'picking'"
              class="goods-full"
              :quantity="task.totalQuantity ?? task.itemCount ?? 0"
              :expanded="!!expanded[String(task.id)]"
              :items="itemCache[String(task.id)] || []"
              @toggle="toggleItems(task)"
            />
          </template>

          <!-- 动作区（按钮宽度按设计稿比例：待取货 128:214、配送中 92:116:126、已完成/异常 1:1） -->
          <view class="actions">
            <template v-if="activeTab === 'new'">
              <button class="btn btn-primary btn-block" :disabled="acting" @click.stop="doAccept(task)">接单</button>
            </template>
            <template v-else-if="activeTab === 'picking'">
              <button class="btn btn-ghost" style="flex: 128" @click.stop="callCustomer(task)"><text class="rider-icon rider-icon-dianhua btn-icon" />联系顾客</button>
              <button class="btn btn-primary" style="flex: 214" :disabled="acting" @click.stop="doPickup(task)">确认取货</button>
            </template>
            <template v-else-if="activeTab === 'delivering'">
              <button class="btn btn-ghost" style="flex: 92" @click.stop="navigate(task)"><text class="rider-icon rider-icon-daohang btn-icon" />导航</button>
              <button class="btn btn-ghost" style="flex: 116" @click.stop="callCustomer(task)"><text class="rider-icon rider-icon-dianhua btn-icon" />联系客户</button>
              <button class="btn btn-primary" style="flex: 126" :disabled="acting" @click.stop="doDeliver(task)">确认送达</button>
            </template>
            <template v-else>
              <button class="btn btn-detail" @click.stop="openDetail(task)">详情</button>
              <!-- 已取消的单不必再联系客户 -->
              <button v-if="!isCancelled(task)" class="btn btn-ghost" @click.stop="callCustomer(task)"><text class="rider-icon rider-icon-dianhua btn-icon" />联系客户</button>
            </template>
          </view>
        </view>

        <view class="list-footer">{{ loadingMore ? '加载中…' : (tasks.length >= total ? '没有更多了' : '上拉加载更多') }}</view>
      </template>
    </scroll-view>
  </view>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; background: #f2f3f7; }
.header { position: fixed; top: 0; right: 0; left: 0; z-index: 30; background: #0f0f11; }
.nav-inner { position: relative; display: flex; align-items: center; justify-content: center; height: 44px; }
.nav-back { position: absolute; top: 50%; left: 24rpx; color: #fff; font-size: 46rpx; line-height: 1; transform: translateY(-50%); }
/* ===== 深色头部（设计稿 Frame 35：#0F0F11，门店行与 Tab 同处一块）===== */
.shop-row { display: flex; align-items: center; max-width: 62%; }
.shop-logo { box-sizing: border-box; width: 64rpx; height: 64rpx; margin-right: 12rpx; padding: 12rpx; border-radius: 50%; background: #f6f7f9; }
.shop-name { max-width: 100%; overflow: hidden; color: #fff; font-size: 32rpx; font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.tabs { display: flex; height: 46px; }
.tab { position: relative; display: flex; flex: 1; align-items: center; justify-content: center; }
.tab-label-wrap { position: relative; display: inline-flex; align-items: center; }
.tab-dot { position: absolute; top: -4rpx; right: -14rpx; width: 14rpx; height: 14rpx; border-radius: 50%; background: #ff0000; }
.tab-text { color: #d7dbe0; font-size: 28rpx; }
.tab-text.is-active { color: #ff5500; font-weight: 600; }
.tab-line { position: absolute; bottom: 0; left: 50%; width: 84rpx; height: 4rpx; border-radius: 2rpx; background: transparent; transform: translateX(-50%); }
.tab-line.is-active { background: #ff5500; }
.list { flex: 1; min-height: 0; padding: 20rpx 24rpx 40rpx; box-sizing: border-box; }
.state { padding: 140rpx 0; color: #86909c; font-size: 28rpx; text-align: center; }
.card { margin-bottom: 16rpx; padding: 0 24rpx 24rpx; border-radius: 24rpx; background: #fff; }
/* 卡片可点进详情时的按下反馈（设计稿没有明确态，给一个很淡的背景变化，提示"这整块能点"） */
.card-pressed { background: #f7f8fa; }
/* 头部按设计稿 Frame 82：高 50px（→96rpx）、内容垂直居中；与下方信息区相距 16px（→31rpx，即 Frame 53 上内边距） */
.card-head { display: flex; align-items: center; justify-content: space-between; height: 96rpx; margin-bottom: 31rpx; }
.order-no { padding: 2rpx 12rpx; border-radius: 6rpx; background: #fff6ed; color: #ff7d00; font-size: 31rpx; font-weight: 600; line-height: 46rpx; }
/* 已完成 / 异常单卡头部：订单号（灰） + 复制 */
.order-no-plain { display: flex; align-items: center; }
.order-no-text { color: #86909c; font-size: 29rpx; }
.order-no-copy { margin-left: 12rpx; color: #86909c; font-size: 31rpx; }
/* ===== 配送中卡的地图区域（设计稿 06 的 Frame 133：350×168 → 673×323rpx；与上方收货信息间距 8px → 15rpx）===== */
.map-card { position: relative; width: 100%; height: 323rpx; margin-top: 15rpx; overflow: hidden; border-radius: 16rpx; }
/* 地图本体是微信原生组件，圆角直接给它更稳（原生组件不一定被父级 overflow 裁切） */
.map-view { width: 100%; height: 100%; border-radius: 16rpx; }
/* 订单缺坐标时的占位（灰底 + 说明） */
.map-card-empty { display: flex; align-items: center; justify-content: center; background: #f6f7f9; }
.map-empty-text { color: #86909c; font-size: 24rpx; }
/* 下面两个气泡是 <cover-view>：只能盖在 map 之上，且只支持有限 CSS（flex / 定位 / 背景 / 圆角 / 字体 / 内外边距） */
.map-eta { position: absolute; top: 23rpx; left: 23rpx; display: flex; flex-direction: row; align-items: center; height: 50rpx; padding: 0 14rpx; border-radius: 8rpx; background: #fff4e8; }
.map-eta-dot { width: 12rpx; height: 12rpx; margin-right: 8rpx; border-radius: 50%; background: #ff5500; }
.map-eta-text { color: #ff5500; font-size: 27rpx; }
/* 距离气泡：cover-view 对 transform 支持不稳，这里用「固定宽度 + margin-left 负半宽 + 内容居中」代替 left:50%+translateX */
.map-distance { position: absolute; top: 90rpx; left: 50%; display: flex; flex-direction: row; align-items: center; justify-content: center; width: 340rpx; height: 58rpx; margin-left: -170rpx; border-radius: 9999rpx; background: #fff; }
.map-distance-text { color: #1d2129; font-size: 21rpx; }
/* 距离数值在稿中是 11px/510 橙色（同一文本节点里的字符级样式） */
.map-distance-km { margin-left: 6rpx; color: #ff5500; font-size: 21rpx; font-weight: 500; }
/* 状态区：配送中/已完成/异常单的状态名统一 14px/500（→27rpx）；新任务是承诺时间 16px/600（→31rpx），由 .is-new 覆盖。
   新任务那串「55 分钟内（10:13前）送达」在稿中是**一个文本节点带字符级样式**，故拆成主段 + 副段两段渲染 */
.card-status { font-size: 27rpx; font-weight: 500; }
.card-status-wrap { display: flex; align-items: center; }
.status-icon { margin-right: 8rpx; font-size: 38rpx; }
/* 按钮内的图标（16px → 31rpx） */
.btn-icon { margin-right: 8rpx; font-size: 31rpx; }
.status-extra { margin-left: 2rpx; color: #1d2129; font-size: 27rpx; font-weight: 400; }
.card-status.is-new { color: #ff7d00; font-size: 31rpx; font-weight: 600; }
.card-status.is-picking { color: #ff7d00; }
.card-status.is-delivering { color: #ff7d00; }
.card-status.is-done { color: #00b42a; }
.card-status.is-exception { color: #f53f3f; }
.card-status.is-cancelled { color: #86909c; }
.route-row { display: flex; align-items: center; justify-content: space-between; margin-top: 10rpx; }
.route-name { flex: 1; min-width: 0; overflow: hidden; color: #1d2129; font-size: 28rpx; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
.route-km { flex-shrink: 0; margin-left: 16rpx; color: #86909c; font-size: 24rpx; }
/* ===== 新任务卡片（设计稿 01_新任务_商品清单未展开）===== */
.new-route { display: flex; align-items: flex-start; gap: 16rpx; }
/* 左侧距离竖条：设计稿 Frame 45（36×150px → 70×288rpx），胶囊浅灰底，上下内边距 8px→16rpx */
.distance-bar { display: flex; flex: none; box-sizing: border-box; flex-direction: column; align-items: center; justify-content: space-between; width: 70rpx; height: 288rpx; padding: 16rpx 8rpx; background: #f6f7f9; border-radius: 9999rpx; }
/* 距离文案：稿中是 28px 窄框内自动折行的两行（数值 14px/500 + 单位 12px/400，行高 12px），每块 26px→50rpx */
.distance-text { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 54rpx; height: 50rpx; color: #1d2129; }
.distance-num { font-size: 27rpx; font-weight: 500; line-height: 23rpx; }
.distance-unit { font-size: 23rpx; font-weight: 400; line-height: 23rpx; }
/* 骑手插画：设计稿 24×74px → 46×142rpx（rider-badge.png 为 3 倍图，足够清晰） */
.distance-rider { width: 46rpx; height: 142rpx; }
/* 右侧取送信息：设计稿 Frame 68 竖向 gap 24px → 46rpx，与竖条顶部对齐 */
.new-route-info { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 46rpx; }
.new-route-info .route-name { flex: none; font-size: 35rpx; }
.route-tag { display: block; margin-top: 4rpx; color: #86909c; font-size: 27rpx; }
.pickup-tag { display: inline-flex; margin-top: 10rpx; padding: 4rpx 12rpx; border-radius: 6rpx; background: #fff6ed; }
.pickup-tag-text { color: #ff7d00; font-size: 22rpx; }
/* 收货人 + 电话：稿中都是 18px（姓名 600、电话 590）→ 35rpx，两者间距 12px→23rpx */
.receiver-row { display: flex; align-items: center; margin-bottom: 12rpx; }
.receiver-name { color: #1d2129; font-size: 35rpx; font-weight: 600; }
.receiver-phone { margin-left: 23rpx; color: #1d2129; font-size: 35rpx; }
/* 地址行：位置图标 16px→31rpx + 灰字地址，图标与文字间距 4px→8rpx */
.address-row { display: flex; align-items: center; }
.address-icon { flex-shrink: 0; margin-right: 8rpx; color: #86909c; font-size: 31rpx; }
.address { display: block; flex: 1; min-width: 0; color: #86909c; font-size: 27rpx; line-height: 38rpx; }
.exception-text { display: block; margin-top: 10rpx; color: #ff0000; font-size: 26rpx; line-height: 36rpx; }
/* 地址块（设计稿 01 的 Frame 50）：地址 + 商品清单，两者间距 4px→8rpx */
.dest-block { display: flex; flex-direction: column; gap: 8rpx; }
/* 待取货的商品清单：整卡全宽，与上方「位置图标 + 地址」间距 12px→23rpx（设计稿 03 的 Frame 50 gap） */
.goods-full { margin-top: 23rpx; }
/* 按钮 */
.actions { display: flex; gap: 16rpx; margin-top: 22rpx; }
/* 按钮：稿中配送中/已完成/异常单是 44px 高、14px/600（→85rpx / 27rpx）；新任务「接单」是主按钮 48px 高、16px/600（→92rpx / 31rpx），由 .btn-block 覆盖。
   另：小程序 button 默认带左右 14px 内边距，会把「联系客户」挤成两行 → 显式清掉并禁止换行 */
.btn { flex: 1; height: 85rpx; margin: 0; padding: 0 8rpx; border-radius: 20rpx; font-size: 27rpx; line-height: 85rpx; white-space: nowrap; }
.btn::after { border: 0; }
.btn-block { flex: none; width: 100%; height: 92rpx; font-size: 31rpx; line-height: 92rpx; }
.btn-primary { color: #fff; background: #ff5500; }
.btn-primary[disabled] { opacity: .6; }
.btn-ghost { color: #1d2129; background: #f6f7f9; }
/* 「详情」按钮底色比其它次要按钮略深（设计稿 #F1F2F4 vs #F6F7F9） */
.btn-detail { color: #1d2129; background: #f1f2f4; }
.list-footer { padding: 24rpx 0 8rpx; color: #86909c; font-size: 24rpx; text-align: center; }
</style>
