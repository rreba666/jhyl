<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, onMounted, ref } from 'vue'
import { cancelOrder, getOrderList, receiveOrder, refundOrder, type OrderStatus, type OrderSummary } from '@/api/order'
import { getAfterSaleList, type AfterSaleRecord } from '@/api/after-sale'
import { isApiRequestError } from '@/utils/request'
import { isLoggedIn } from '@/utils/auth'
import LoginGuide from '@/components/LoginGuide.vue'

/** 订单 tab 定义。「退款售后」走售后单接口（key='aftersale'），其余走订单列表。 */
const tabs: Array<{ key: string; label: string; statuses: OrderStatus[]; pickupType?: 0 | 1 }> = [
  { key: 'all', label: '全部', statuses: [0, 1, 2, 3, 4, 6, 7, 8] },
  { key: 'pending', label: '待付款', statuses: [0] },
  { key: 'shipped', label: '待发货', statuses: [1], pickupType: 0 },
  { key: 'received', label: '待收货', statuses: [2] },
  { key: 'pickup', label: '待自提', statuses: [1], pickupType: 1 },
  { key: 'completed', label: '已完成', statuses: [3, 4, 8] },
  { key: 'aftersale', label: '退款售后', statuses: [] },
]
/** 「退款售后」tab 索引，退款成功后自动切换到该分类。 */
const AFTER_SALE_TAB_INDEX = tabs.findIndex((tab) => tab.key === 'aftersale')
/** 当前选中的 tab 索引。 */
const activeIndex = ref(0)
const list = ref<OrderSummary[]>([])
/** 售后单列表（「退款售后」tab 专用）。 */
const afterSales = ref<AfterSaleRecord[]>([])
/** 有「处理中」售后单（0待审核/2退款中/4待寄回/5待收货）的订单 ID 集合，用于隐藏退款按钮。 */
const processingOrderIds = ref<Set<string>>(new Set())
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const loaded = ref(false)
const actionLoading = ref<string | null>(null)
const navigationLoading = ref(false)
/** 当前 tab 是否为「退款售后」。 */
const isAfterSaleTab = computed(() => tabs[activeIndex.value]?.key === 'aftersale')
const empty = computed(() => loaded.value && !loading.value && !(isAfterSaleTab.value ? afterSales.value.length : list.value.length))
const loginGuideVisible = ref(false)
/** 请求竞态 token，快速切换 tab 时丢弃过期响应。 */
let requestToken = 0

/** 微信胶囊按钮位置，用于自定义导航栏精确定位。 */
const menuTop = ref(0)
const menuHeight = ref(32)
const navStyle = computed(() => ({ top: `${menuTop.value}px`, height: `${menuHeight.value}px` }))
const bodyTop = computed(() => menuTop.value + menuHeight.value)

async function load(reset = true): Promise<void> {
  if (!isLoggedIn()) {
    list.value = []
    afterSales.value = []
    loaded.value = true
    loginGuideVisible.value = true
    return
  }
  if (loading.value || loadingMore.value) return
  const token = ++requestToken
  const nextPage = reset ? 1 : page.value + 1
  const currentLength = isAfterSaleTab.value ? afterSales.value.length : list.value.length
  if (!reset && currentLength >= total.value) return
  if (reset) loading.value = true
  else loadingMore.value = true
  try {
    if (isAfterSaleTab.value) {
      const result = await getAfterSaleList(nextPage, 10)
      if (token !== requestToken) return
      afterSales.value = reset ? result.list : [...afterSales.value, ...result.list]
      page.value = result.page || nextPage
      total.value = result.total || afterSales.value.length
    } else {
      const tab = tabs[activeIndex.value]
      const [result, afterSaleResult] = await Promise.all([
        getOrderList({ page: nextPage, pageSize: 10, statuses: tab.statuses, pickupType: tab.pickupType }),
        reset ? getAfterSaleList(1, 100) : Promise.resolve(null),
      ])
      if (token !== requestToken) return
      list.value = reset ? result.list : [...list.value, ...result.list]
      page.value = result.page || nextPage
      total.value = result.total || list.value.length
      // reset 时刷新「处理中售后单」的订单集合，用于把退款按钮换成「售后中」
      if (afterSaleResult) {
        processingOrderIds.value = new Set(
          afterSaleResult.list
            .filter((record) => [0, 2, 4, 5].includes(record.status))
            .map((record) => String(record.orderId)),
        )
      }
    }
    loaded.value = true
  } catch (error) {
    if (token !== requestToken) return
    uni.showToast({ title: error instanceof Error ? error.message : (isAfterSaleTab.value ? '售后单加载失败' : '订单加载失败'), icon: 'none' })
  } finally {
    if (token === requestToken) { loading.value = false; loadingMore.value = false }
  }
}

function selectTab(index: number): void {
  if (index === activeIndex.value) return
  if (loading.value || loadingMore.value) {
    uni.showToast({ title: '正在加载，请稍候', icon: 'none' })
    return
  }
  activeIndex.value = index
  void load(true)
}
function openDetail(order: OrderSummary): void { uni.navigateTo({ url: `/subpkg-order/orders/detail?orderId=${order.id}` }) }
function pay(order: OrderSummary): void {
  if (navigationLoading.value) return
  navigationLoading.value = true
  uni.navigateTo({
    url: `/subpkg-order/payment/payment?orderId=${order.id}`,
    fail: () => { navigationLoading.value = false },
  })
}
/** 返回上一页；无上一页（分享/直达进入）时回首页。 */
function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/index/index' })
}
async function cancel(order: OrderSummary): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = `cancel:${order.id}`
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({ title: '提示', content: '确定取消订单吗？', success: (res) => resolve(res.confirm), fail: () => resolve(false) })
  })
  if (!confirmed) { actionLoading.value = null; return }
  try { await cancelOrder(order.id); uni.showToast({ title: '订单已取消', icon: 'success' }); await load(true) }
  catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '取消订单失败', icon: 'none' }) }
  finally { actionLoading.value = null }
}

/** 确认收货（物流订单）。 */
async function receive(order: OrderSummary): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = `receive:${order.id}`
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({ title: '提示', content: '确认已收到商品吗？', success: (res) => resolve(res.confirm), fail: () => resolve(false) })
  })
  if (!confirmed) { actionLoading.value = null; return }
  try { await receiveOrder(order.id); uni.showToast({ title: '已确认收货', icon: 'success' }); await load(true) }
  catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '确认收货失败', icon: 'none' }) }
  finally { actionLoading.value = null }
}

/** 申请退款（自提订单）。 */
async function refund(order: OrderSummary): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = `refund:${order.id}`
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({ title: '提示', content: '确定申请退款吗？', success: (res) => resolve(res.confirm), fail: () => resolve(false) })
  })
  if (!confirmed) { actionLoading.value = null; return }
  try {
    await refundOrder(order.id)
    uni.showToast({ title: '退款申请已提交', icon: 'success' })
    // 提交成功后跳到「退款售后」分类，让用户看到刚提交的售后单
    activeIndex.value = AFTER_SALE_TAB_INDEX
    await load(true)
  } catch (error) {
    if (isApiRequestError(error) && error.code === 8705) {
      // 该订单已有处理中的售后单：直接跳到「退款售后」分类查看
      uni.showToast({ title: '该订单已提交过售后', icon: 'none' })
      activeIndex.value = AFTER_SALE_TAB_INDEX
      await load(true)
      return
    }
    uni.showToast({ title: error instanceof Error ? error.message : '退款申请失败', icon: 'none' })
  } finally {
    actionLoading.value = null
  }
}

/** 格式化金额：整数去掉小数位。 */
function formatAmount(value: number): string {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '')
}

/** 待收货订单物流条文案：deliveryStatus 0=已发货(运输中)，1=已送达。 */
function logisticsInfo(order: OrderSummary): { status: string; remark: string } {
  if (order.deliveryStatus === 1) return { status: '已送达', remark: '请确认收货' }
  return { status: '已发货', remark: '运输中' }
}

onMounted(() => {
  try {
    const r = uni.getMenuButtonBoundingClientRect()
    if (r) { menuTop.value = r.top; menuHeight.value = r.height }
  } catch { /* 非微信环境忽略 */ }
})

onLoad((options?: Record<string, string | undefined>) => {
  const status = Number(options?.status)
  const pickupType = options?.pickupType !== undefined && options.pickupType !== '' ? (Number(options.pickupType) as 0 | 1) : undefined
  if (options?.tab === 'aftersale' || status === 6 || status === 7) {
    // 售后入口（tab=aftersale 或退款中/已退款状态）直接落到「退款售后」分类
    activeIndex.value = AFTER_SALE_TAB_INDEX
  } else if (Number.isInteger(status) && status >= 0 && status <= 8) {
    // 待发货(status=1,物流) 与 待自提(status=1,自提) 需用 pickupType 区分
    const matched = tabs.findIndex((t) => t.statuses.includes(status as OrderStatus) && (pickupType === undefined || t.pickupType === pickupType))
    activeIndex.value = matched >= 0 ? matched : 0
  }
  void load(true)
})
onShow(() => {
  navigationLoading.value = false
  if (loaded.value) void load(true)
})
</script>

<template>
  <view class="page">
    <!-- 自定义导航栏，与胶囊按钮同一行 -->
    <view class="nav" :style="navStyle"><view class="nav-back" @click="goBack"><text class="back-icon">‹</text></view><text class="title">我的订单</text></view>
    <view class="tabs" :style="{ marginTop: bodyTop + 'px' }">
      <view v-for="(tab, index) in tabs" :key="tab.label" class="tab" :class="{ active: activeIndex === index }" @click="selectTab(index)">{{ tab.label }}</view>
    </view>
    <scroll-view class="list" scroll-y @scrolltolower="load(false)">
      <view v-show="loading && !(isAfterSaleTab ? afterSales.length : list.length)" class="state">加载中...</view>

      <!-- 售后单列表（退款售后分类） -->
      <template v-if="isAfterSaleTab">
        <view v-for="record in afterSales" :key="record.id" class="order-card">
          <view class="card-head"><text class="card-title">{{ record.typeDesc }}</text><text class="card-status">{{ record.statusDesc }}</text></view>
          <text class="card-time">{{ record.createTime }}</text>
          <view class="card-goods">
            <view class="goods-info">
              <text class="goods-name">售后单号：{{ record.afterSaleNo }}</text>
              <text class="goods-meta">关联订单：{{ record.orderNo }}</text>
              <text v-if="record.reason" class="goods-meta">申请原因：{{ record.reason }}</text>
              <text class="goods-price">退款金额：¥{{ formatAmount(record.refundAmount) }}</text>
            </view>
          </view>
          <text v-if="record.rejectReason" class="card-reject">驳回原因：{{ record.rejectReason }}</text>
        </view>
      </template>

      <!-- 订单列表（其余分类） -->
      <template v-else>
        <view v-for="order in list" :key="order.id" class="order-card" @click="openDetail(order)">
          <view class="card-head"><text class="card-title">{{ order.pickupType === 1 ? (order.shopName || '门店自提') : order.orderNo }}</text><text class="card-status">{{ order.statusDesc }}</text></view>
          <text class="card-time">{{ order.createTime }}</text>

          <!-- 物流状态条（仅待收货，两态：已发货/已送达） -->
          <view v-if="order.status === 2" class="logistics" @click.stop="openDetail(order)">
            <view class="logi-icon" />
            <text class="logi-status">{{ logisticsInfo(order).status }}</text>
            <text class="logi-remark">{{ logisticsInfo(order).remark }}</text>
            <text class="logi-arrow">›</text>
          </view>

          <view class="card-goods">
            <image v-if="order.firstProductImage" class="goods-img" :src="order.firstProductImage" mode="aspectFill" />
            <view v-else class="goods-img placeholder" />
            <view class="goods-info">
              <text class="goods-name">{{ order.firstProductName || '商品' }}</text>
              <text class="goods-meta">共{{ order.totalQuantity }}件</text>
              <text class="goods-price">实付款：¥{{ formatAmount(order.payAmount) }}</text>
            </view>
          </view>

          <view class="card-actions">
            <template v-if="order.status === 0">
              <text class="btn outline" :class="{ disabled: !!actionLoading }" @click.stop="cancel(order)">{{ actionLoading === 'cancel:' + order.id ? '处理中...' : '取消订单' }}</text>
              <text class="btn primary" :class="{ disabled: navigationLoading }" @click.stop="pay(order)">{{ navigationLoading ? '打开中...' : '去支付' }}</text>
            </template>
            <text v-if="order.status === 1 && order.pickupType === 0" class="btn outline" @click.stop="openDetail(order)">查看详情</text>
            <template v-if="order.status === 2">
              <text class="btn outline" @click.stop="openDetail(order)">查看物流</text>
              <text v-if="order.deliveryStatus === 1" class="btn primary" :class="{ disabled: !!actionLoading }" @click.stop="receive(order)">{{ actionLoading === 'receive:' + order.id ? '处理中...' : '确认收货' }}</text>
            </template>
            <template v-if="order.status === 1 && order.pickupType === 1">
              <text v-if="processingOrderIds.has(String(order.id))" class="btn outline">售后中</text>
              <text v-else class="btn outline" :class="{ disabled: !!actionLoading }" @click.stop="refund(order)">{{ actionLoading === 'refund:' + order.id ? '处理中...' : '退款' }}</text>
              <text class="btn primary" @click.stop="openDetail(order)">去自提</text>
            </template>
          </view>
        </view>
      </template>

      <view v-show="empty" class="state">{{ isAfterSaleTab ? '暂无售后单' : '暂无订单' }}</view><view v-show="loadingMore" class="more">加载中...</view>
    </scroll-view>

    <LoginGuide v-model="loginGuideVisible" />
  </view>
</template>

<style>
.page { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: #f6f6f6; color: #242526; }
.nav { position: fixed; left: 0; right: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: #fff; box-sizing: border-box; }
.nav-back { position: absolute; left: 16rpx; display: flex; align-items: center; justify-content: center; width: 64rpx; height: 64rpx; }.back-icon { font-size: 48rpx; line-height: 1; color: #222; }
.title { font-size: 32rpx; font-weight: 700; }
.tabs { display: flex; width: 100%; height: 82rpx; flex-shrink: 0; background: #fff; }
.tab { flex: 1; display: flex; align-items: center; justify-content: center; height: 82rpx; color: #888; font-size: 26rpx; border-bottom: 4rpx solid transparent; box-sizing: border-box; }
.tab.active { color: #222; border-color: #222; font-weight: 700; }
.list { flex: 1; min-height: 0; padding: 20rpx 24rpx; box-sizing: border-box; }
.order-card { margin-bottom: 20rpx; padding: 26rpx 30rpx; background: #fff; border-radius: 16rpx; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.card-title { color: #303030; font-size: 30rpx; font-weight: 600; max-width: 420rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-status { color: #916448; font-size: 28rpx; flex-shrink: 0; }
.card-time { display: block; margin-top: 8rpx; color: #959595; font-size: 26rpx; }
.logistics { display: flex; align-items: center; margin-top: 20rpx; padding: 14rpx 20rpx; background: rgba(224, 215, 206, 0.27); border-radius: 8rpx; }
.logi-icon { width: 40rpx; height: 40rpx; margin-right: 12rpx; border: 2rpx solid #c9b8a8; border-radius: 50%; flex-shrink: 0; }
.logi-status { color: #000; font-size: 26rpx; font-weight: 600; flex-shrink: 0; }
.logi-remark { flex: 1; min-width: 0; margin-left: 14rpx; color: #959595; font-size: 26rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.logi-arrow { margin-left: 8rpx; color: #959595; font-size: 36rpx; line-height: 1; }
.card-goods { display: flex; margin-top: 24rpx; }
.goods-img { width: 196rpx; height: 264rpx; flex-shrink: 0; background: #d8d8d8; border-radius: 8rpx; }
.goods-img.placeholder { background: #d8d8d8; }
.goods-info { display: flex; flex: 1; min-width: 0; flex-direction: column; margin-left: 24rpx; }
.goods-name { color: #0a0a0a; font-size: 28rpx; line-height: 1.4; }
.goods-meta { margin-top: 18rpx; color: #8e8e8e; font-size: 26rpx; }
.goods-price { margin-top: auto; color: #8e8e8e; font-size: 26rpx; }
.card-reject { display: block; margin-top: 16rpx; color: #d40000; font-size: 24rpx; }
.card-actions { display: flex; justify-content: flex-end; gap: 16rpx; margin-top: 24rpx; }
.btn { display: flex; align-items: center; justify-content: center; min-width: 160rpx; height: 52rpx; padding: 0 24rpx; border-radius: 8rpx; font-size: 26rpx; box-sizing: border-box; }
.btn.disabled { opacity: .5; }
.btn.outline { color: #000; border: 2rpx solid #222; }
.btn.primary { color: #916448; background: rgba(192, 172, 155, 0.49); }
.state, .more { padding: 120rpx 0; color: #999; text-align: center; font-size: 26rpx; }.more { padding: 28rpx 0; }
</style>
