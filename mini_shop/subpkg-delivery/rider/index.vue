<script setup lang="ts">
/**
 * 骑手工作台（对应设计稿：新任务 / 待取货 / 配送中 / 已完成 / 异常·取消）
 * 契约：2026-09-14 骑手端 UI 落地版（v1.4）
 * - 列表：**一个接口** `GET /api/delivery/tasks?tab=&page=&pageSize=`（返回 PageResult<RiderTaskVO>）
 * - 商品清单：折叠条件数用列表的 `itemCount`，展开再调 `GET /tasks/{id}/items`
 * - 手机号明文下发，**UI 星号由前端截**；倒计时以服务端 `remainingSeconds` 为基准
 */
import { computed, ref } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import {
  EXCEPTION_TYPES,
  acceptTask,
  claimTask,
  deliverTask,
  getRiderTasks,
  getRiderUnread,
  getTaskContact,
  getTaskItems,
  pickupTask,
  type RiderTask,
  type RiderTaskItem,
  type RiderTaskTab,
  type TaskNodeBody,
} from '@/api/delivery'

/**
 * Tab 定义：key=前端、api=后端 tab 参数、label=展示。
 * 注意：最后一个 Tab 后端是「异常 + 已取消」混排（`EXCEPTION` 含 `CANCELLED`），
 * 因此文案定为「异常/取消」，卡片上用红/灰两种小标签区分（见 exceptionTagText）。
 */
const TABS = [
  { key: 'new', api: 'NEW', label: '新任务' },
  { key: 'picking', api: 'PICKUP', label: '待取货' },
  { key: 'delivering', api: 'DELIVERING', label: '配送中' },
  { key: 'done', api: 'DONE', label: '已完成' },
  { key: 'exception', api: 'EXCEPTION', label: '异常/取消' },
] as const
type TabKey = (typeof TABS)[number]['key']

/** 各 Tab 空态文案（与 UI 设计说明一致）。 */
const EMPTY_TEXT: Record<TabKey, string> = {
  new: '暂无新任务',
  picking: '暂无待取货任务',
  delivering: '暂无配送中任务',
  done: '暂无已完成任务',
  exception: '暂无异常/取消单',
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
function shortNo(index: number): string {
  return `#${String(index + 1).padStart(3, '0')}`
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
 * 新任务卡右上承诺时限（设计稿 01：`55 分钟内（10:13前）送达`）。
 * 剩余分钟由 `remainingSeconds`（服务端基准）折算；字段缺失时退化成「10:13 前送达」或「剩余 N 分钟」。
 */
function newTaskDeadline(task: RiderTask): string {
  const clock = deadlineClock(task)
  const remain = task.remainingSeconds
  const minutes = remain != null ? Math.ceil(Number(remain) / 60) : null
  if (minutes != null && minutes > 0 && clock) return `${minutes} 分钟内（${clock}前）送达`
  if (clock) return `${clock} 前送达`
  if (minutes != null && minutes > 0) return `剩余 ${minutes} 分钟`
  return ''
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

/** 卡片右上补充文案：设计稿里**只有待取货**在时限后追加 `- 4.1km`。 */
function headStatusExtra(task: RiderTask): string {
  if (String(task.status || '') !== 'ACCEPTED') return ''
  return task.distanceKm != null ? `- ${Number(task.distanceKm).toFixed(1)}km` : ''
}

/** 配送中地图卡：预计送达时间（`HH:mm`）。 */
function deliverEta(task: RiderTask): string {
  return deadlineClock(task) || '—'
}

/** 配送中地图卡：距离目的地（只留数字，单位写在文案里）。 */
function distanceOnly(task: RiderTask): string {
  return task.distanceKm != null ? Number(task.distanceKm).toFixed(1) : '—'
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
  if (status === 'PICKED_UP' || status === 'DELIVERING' || status === 'NEARBY') return 'rider-icon-peisongzhong'
  return ''
}

/** 右上状态：配送中 / 已完成 / 已取消 / 订单异常，其它显示承诺时间。 */
function statusLabel(task: RiderTask): string {
  const status = String(task.status || '')
  if (status === 'DELIVERED') return '已完成'
  if (status === 'CANCELLED') return '已取消'
  if (status === 'EXCEPTION') return '订单异常'
  if (status === 'PICKED_UP' || status === 'DELIVERING' || status === 'NEARBY') return '配送中'
  // 新任务（PENDING/ASSIGNED）：设计稿要的是「55 分钟内（10:13前）送达」
  if (status === 'PENDING' || status === 'ASSIGNED') return newTaskDeadline(task)
  return deadlineText(task)
}

/** 状态颜色类。 */
function statusClass(task: RiderTask): string {
  const status = String(task.status || '')
  if (status === 'DELIVERED') return 'is-done'
  if (status === 'CANCELLED') return 'is-cancelled'
  if (status === 'EXCEPTION') return 'is-exception'
  if (status === 'ACCEPTED') return 'is-picking'
  if (status === 'PICKED_UP' || status === 'DELIVERING' || status === 'NEARBY') return 'is-delivering'
  return 'is-new'
}

/** 已取消（后端把 `CANCELLED` 并进「异常/取消」Tab，卡片上要与真异常区分）。 */
function isCancelled(task: RiderTask): boolean {
  return String(task.status || '') === 'CANCELLED'
}

/**
 * 「异常/取消」Tab 的区分标签文案：
 * - `CANCELLED` → 「已取消」（订单被取消，非骑手责任）；
 * - `EXCEPTION` → 「异常 · {异常类型中文}」，类型缺失时兜底「异常」。
 */
function exceptionTagText(task: RiderTask): string {
  if (isCancelled(task)) return '已取消'
  const matched = EXCEPTION_TYPES.find((item) => item.value === String(task.exceptionType || ''))
  return matched ? `异常 · ${matched.label}` : '异常'
}

/** 区分标签配色：异常=红，已取消=灰。 */
function exceptionTagClass(task: RiderTask): string {
  return isCancelled(task) ? 'is-cancelled' : 'is-exception'
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

/** 采集定位（start/nearby/delivered 必采；pickup 可选，失败不阻断）。 */
function buildNodeBody(): Promise<TaskNodeBody> {
  return new Promise((resolve, reject) => {
    uni.getLocation({
      type: 'gcj02',
      success: (res) => resolve({ latitude: res.latitude, longitude: res.longitude, accuracy: res.accuracy }),
      fail: () => reject(new Error('获取定位失败，请开启定位权限后重试')),
    })
  })
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

/** 确认取货（定位可选：拿不到定位也允许取货）。 */
async function doPickup(task: RiderTask): Promise<void> {
  if (acting.value || task.id == null) return
  acting.value = true
  try {
    const body = await buildNodeBody().catch(() => ({}))
    await pickupTask(task.id, body)
    uni.showToast({ title: '已确认取货', icon: 'success' })
    await loadTasks(true)
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '确认取货失败', icon: 'none' })
  } finally {
    acting.value = false
  }
}

/** 确认送达（必采定位；启用收货码的任务请到详情页先校验收货码）。 */
async function doDeliver(task: RiderTask): Promise<void> {
  if (acting.value || task.id == null) return
  if (task.pickupCodeRequired) {
    uni.showToast({ title: '该单需收货码，请进详情页核销', icon: 'none' })
    openDetail(task)
    return
  }
  acting.value = true
  try {
    const body = await buildNodeBody()
    await deliverTask(task.id, body)
    uni.showToast({ title: '已确认送达', icon: 'success' })
    await loadTasks(true)
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
        <view v-for="(task, index) in tasks" :key="task.id" class="card">
          <!-- 头部（设计稿）：新任务/待取货/配送中用短号 `#001`；已完成/异常单用订单号 + 复制 -->
          <view class="card-head">
            <text v-if="useShortNo" class="order-no">{{ shortNo(index) }}</text>
            <view v-else class="order-no-plain">
              <text class="order-no-text">{{ task.orderNo || '—' }}</text>
              <text class="order-no-copy" @click="copyOrderNo(task)"><text class="rider-icon rider-icon-fuzhi" /></text>
            </view>
            <!-- 状态（图标 + 文字，颜色由 statusClass 决定，图标用字色） -->
            <view class="card-status card-status-wrap" :class="statusClass(task)">
              <text v-if="statusIcon(task)" class="rider-icon status-icon" :class="statusIcon(task)" />
              <text>{{ headStatusText(task) }}<text v-if="headStatusExtra(task)" class="status-km"> {{ headStatusExtra(task) }}</text></text>
            </view>
          </view>

          <!-- 「异常/取消」Tab 的区分标签：异常（红，含异常类型）/ 已取消（灰） -->
          <view v-if="activeTab === 'exception'" class="tag-row">
            <text class="state-tag" :class="exceptionTagClass(task)">{{ exceptionTagText(task) }}</text>
          </view>

          <!--
            新任务：按设计稿 01 呈现 —— 左侧距离竖条（取货点 `0 km` → 骑手插画 → 送货 `N km`）+ 右侧取送信息。
            竖条中间的骑手图即设计交付的 `rider-badge.png`（72×222，与设计稿里 24×74 的比例完全一致）。
          -->
          <template v-if="activeTab === 'new'">
            <view class="new-route">
              <view class="distance-bar">
                <text class="distance-text">0 km</text>
                <image class="distance-rider" src="/static/rider/rider-badge.png" mode="aspectFit" />
                <text class="distance-text">{{ distanceText(task) }}</text>
              </view>
              <view class="new-route-info">
                <view>
                  <text class="route-name">{{ task.pickupAddress || '取货点' }}</text>
                  <text class="route-tag">本店自取</text>
                </view>
                <text class="route-name route-dest">{{ task.deliveryAddress || '收货地址' }}</text>
              </view>
            </view>
          </template>

          <!-- 其它 Tab：收货人（打星）+ 地址；配送中再加一张地图卡 -->
          <template v-else>
            <view class="receiver-row">
              <text class="receiver-name">{{ task.receiverName || '收货人' }}</text>
              <text class="receiver-phone">{{ maskPhone(task.receiverPhone) }}</text>
            </view>
            <text class="address">{{ task.deliveryAddress || '—' }}</text>
            <text v-if="activeTab === 'exception' && task.exceptionRemark" class="exception-text">异常说明：{{ task.exceptionRemark }}</text>
            <!-- 配送中：地图卡（设计稿 06 的 Frame 133：地图底图 + 预计送达标签 + 骑手位置 + 店铺与距离气泡） -->
            <view v-if="activeTab === 'delivering'" class="map-card">
              <image class="map-bg" src="/static/rider/map-bg.jpg" mode="aspectFill" />
              <view class="map-eta">
                <view class="map-eta-dot" />
                <text class="map-eta-text">预计 {{ deliverEta(task) }} 送达</text>
              </view>
              <view class="map-distance"><text class="map-distance-text">距离目的地还有 {{ distanceOnly(task) }}km</text></view>
              <image class="map-rider" src="/static/rider/rider-on-bike.png" mode="aspectFit" />
              <view class="map-shop"><text class="map-shop-text">{{ task.pickupAddress || '取货门店' }}</text></view>
            </view>
          </template>

          <!-- 商品清单（设计稿：仅「新任务」与「待取货」卡有折叠条，配送中/已完成/异常无） -->
          <view v-if="activeTab === 'new' || activeTab === 'picking'" class="goods-row" @click="toggleItems(task)">
            <text class="goods-text">商品清单（{{ task.itemCount ?? 0 }} 件）</text>
            <text class="goods-arrow" :class="{ 'is-open': expanded[String(task.id)] }">›</text>
          </view>
          <view v-if="(activeTab === 'new' || activeTab === 'picking') && expanded[String(task.id)]" class="goods-list">
            <view v-for="(item, itemIndex) in (itemCache[String(task.id)] || [])" :key="itemIndex" class="goods-item">
              <image v-if="item.productImage" class="goods-image" :src="item.productImage" mode="aspectFill" />
              <view class="goods-info">
                <text class="goods-name">{{ item.productName }}</text>
                <text v-if="item.skuSpec" class="goods-spec">{{ item.skuSpec }}</text>
              </view>
              <view class="goods-right">
                <text class="goods-qty">× {{ item.quantity }}</text>
                <text v-if="item.price != null" class="goods-price">¥{{ Number(item.price).toFixed(2) }}</text>
              </view>
            </view>
            <view v-if="!(itemCache[String(task.id)] || []).length" class="goods-empty">暂无商品明细</view>
          </view>

          <!-- 动作区（按钮宽度按设计稿比例：待取货 128:214、配送中 92:116:126、已完成/异常 1:1） -->
          <view class="actions">
            <template v-if="activeTab === 'new'">
              <button class="btn btn-primary btn-block" :disabled="acting" @click="doAccept(task)">接单</button>
            </template>
            <template v-else-if="activeTab === 'picking'">
              <button class="btn btn-ghost" style="flex: 128" @click="callCustomer(task)"><text class="rider-icon rider-icon-dianhua btn-icon" />联系顾客</button>
              <button class="btn btn-primary" style="flex: 214" :disabled="acting" @click="doPickup(task)">确认取货</button>
            </template>
            <template v-else-if="activeTab === 'delivering'">
              <button class="btn btn-ghost" style="flex: 92" @click="navigate(task)"><text class="rider-icon rider-icon-daohang btn-icon" />导航</button>
              <button class="btn btn-ghost" style="flex: 116" @click="callCustomer(task)"><text class="rider-icon rider-icon-dianhua btn-icon" />联系客户</button>
              <button class="btn btn-primary" style="flex: 126" :disabled="acting" @click="doDeliver(task)">确认送达</button>
            </template>
            <template v-else>
              <button class="btn btn-detail" @click="openDetail(task)">详情</button>
              <!-- 已取消的单不必再联系客户 -->
              <button v-if="!isCancelled(task)" class="btn btn-ghost" @click="callCustomer(task)"><text class="rider-icon rider-icon-dianhua btn-icon" />联系客户</button>
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
.card { margin-bottom: 16rpx; padding: 24rpx; border-radius: 24rpx; background: #fff; }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16rpx; }
.order-no { padding: 2rpx 12rpx; border-radius: 6rpx; background: #fff6ed; color: #ff7d00; font-size: 30rpx; font-weight: 600; }
/* 已完成 / 异常单卡头部：订单号（灰） + 复制 */
.order-no-plain { display: flex; align-items: center; }
.order-no-text { color: #86909c; font-size: 29rpx; }
.order-no-copy { margin-left: 12rpx; color: #86909c; font-size: 31rpx; }
/* ===== 配送中卡的地图区域（设计稿 Frame 133：350×168 → 673×323rpx）===== */
.map-card { position: relative; width: 100%; height: 323rpx; margin-top: 20rpx; overflow: hidden; border-radius: 16rpx; }
.map-bg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
.map-eta { position: absolute; top: 23rpx; left: 23rpx; display: flex; align-items: center; height: 50rpx; padding: 0 14rpx; border-radius: 8rpx; background: #fff4e8; }
.map-eta-dot { width: 12rpx; height: 12rpx; margin-right: 8rpx; border-radius: 50%; background: #ff5500; }
.map-eta-text { color: #ff5500; font-size: 27rpx; }
.map-distance { position: absolute; top: 90rpx; left: 50%; display: flex; align-items: center; height: 58rpx; padding: 0 20rpx; border-radius: 9999rpx; background: #fff; transform: translateX(-50%); }
.map-distance-text { color: #1d2129; font-size: 21rpx; white-space: nowrap; }
.map-rider { position: absolute; top: 150rpx; left: 50%; width: 77rpx; height: 77rpx; transform: translateX(-50%); }
.map-shop { position: absolute; bottom: 66rpx; left: 35rpx; display: flex; align-items: center; height: 46rpx; padding: 0 16rpx; border-radius: 9999rpx; background: #fff; }
.map-shop-text { color: #1d2129; font-size: 21rpx; }
.card-status { font-size: 28rpx; font-weight: 600; }
/* 状态区：图标 + 文字（图标 20px → 38rpx；颜色继承 .card-status.is-xxx） */
.card-status-wrap { display: flex; align-items: center; }
.status-icon { margin-right: 8rpx; font-size: 38rpx; }
/* 按钮内的图标（16px → 31rpx） */
.btn-icon { margin-right: 8rpx; font-size: 31rpx; }
.status-km { margin-left: 8rpx; font-weight: 500; }
.card-status.is-new { color: #ff0000; }
.card-status.is-picking { color: #ff7d00; }
.card-status.is-delivering { color: #ff7d00; }
.card-status.is-done { color: #00b42a; }
.card-status.is-exception { color: #f53f3f; }
.card-status.is-cancelled { color: #86909c; }
/* 「异常/取消」Tab 的区分标签 */
.tag-row { display: flex; align-items: center; margin-bottom: 12rpx; }
.state-tag { padding: 4rpx 12rpx; border-radius: 6rpx; font-size: 22rpx; }
.state-tag.is-exception { color: #ff0000; background: #ffece8; }
.state-tag.is-cancelled { color: #86909c; background: #f2f3f7; }
.route-row { display: flex; align-items: center; justify-content: space-between; margin-top: 10rpx; }
.route-name { flex: 1; min-width: 0; overflow: hidden; color: #1d2129; font-size: 28rpx; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
.route-km { flex-shrink: 0; margin-left: 16rpx; color: #86909c; font-size: 24rpx; }
/* ===== 新任务卡片（设计稿 01_新任务_商品清单未展开）===== */
.new-route { display: flex; align-items: stretch; gap: 16rpx; margin-top: 4rpx; }
/* 左侧距离竖条：设计稿 Frame 45（36×150@390 → 72×288rpx），胶囊浅灰底 */
.distance-bar { display: flex; flex: none; flex-direction: column; align-items: center; justify-content: space-between; width: 72rpx; padding: 12rpx 0; background: #f6f7f9; border-radius: 9999rpx; }
.distance-text { color: #1d2129; font-size: 30rpx; font-weight: 500; white-space: nowrap; }
/* 骑手插画：设计稿 24×74@390 → 46×142rpx（rider-badge.png 为 3 倍图，足够清晰） */
.distance-rider { width: 46rpx; height: 142rpx; }
.new-route-info { display: flex; flex: 1; min-width: 0; flex-direction: column; justify-content: space-between; }
.new-route-info .route-name { flex: none; font-size: 34rpx; }
.route-tag { display: block; margin-top: 4rpx; color: #86909c; font-size: 27rpx; }
.route-dest { margin-top: 20rpx; }
.pickup-tag { display: inline-flex; margin-top: 10rpx; padding: 4rpx 12rpx; border-radius: 6rpx; background: #fff6ed; }
.pickup-tag-text { color: #ff7d00; font-size: 22rpx; }
.receiver-row { display: flex; align-items: center; margin-bottom: 8rpx; }
.receiver-name { color: #1d2129; font-size: 34rpx; font-weight: 600; }
.receiver-phone { margin-left: 16rpx; color: #1d2129; font-size: 32rpx; }
.address { display: block; color: #86909c; font-size: 27rpx; line-height: 38rpx; }
.exception-text { display: block; margin-top: 10rpx; color: #ff0000; font-size: 26rpx; line-height: 36rpx; }
/* 商品清单 */
.goods-row { display: flex; align-items: center; justify-content: space-between; height: 92rpx; margin-top: 20rpx; padding: 0 20rpx; border-radius: 24rpx; background: #f6f7f9; }
.goods-text { color: #1d2129; font-size: 26rpx; }
.goods-arrow { color: #86909c; font-size: 30rpx; line-height: 1; transition: transform .2s; }
.goods-arrow.is-open { transform: rotate(90deg); }
.goods-list { margin-top: 16rpx; }
.goods-item { display: flex; align-items: center; padding: 12rpx 0; }
.goods-image { width: 72rpx; height: 72rpx; flex-shrink: 0; border-radius: 8rpx; background: #f2f3f7; }
.goods-info { flex: 1; min-width: 0; margin-left: 16rpx; }
.goods-name { display: block; overflow: hidden; color: #1d2129; font-size: 26rpx; white-space: nowrap; text-overflow: ellipsis; }
.goods-spec { display: block; margin-top: 4rpx; color: #86909c; font-size: 22rpx; }
.goods-right { flex-shrink: 0; margin-left: 16rpx; text-align: right; }
.goods-qty { display: block; color: #1d2129; font-size: 24rpx; }
.goods-price { display: block; margin-top: 4rpx; color: #86909c; font-size: 22rpx; }
.goods-empty { padding: 16rpx 0; color: #86909c; font-size: 24rpx; text-align: center; }
/* 按钮 */
.actions { display: flex; gap: 16rpx; margin-top: 22rpx; }
.btn { flex: 1; margin: 0; border-radius: 20rpx; font-size: 29rpx; line-height: 92rpx; }
.btn::after { border: 0; }
.btn-block { flex: none; width: 100%; }
.btn-primary { color: #fff; background: #ff5500; }
.btn-primary[disabled] { opacity: .6; }
.btn-ghost { color: #1d2129; background: #f6f7f9; }
/* 「详情」按钮底色比其它次要按钮略深（设计稿 #F1F2F4 vs #F6F7F9） */
.btn-detail { color: #1d2129; background: #f1f2f4; }
.list-footer { padding: 24rpx 0 8rpx; color: #86909c; font-size: 24rpx; text-align: center; }
</style>
