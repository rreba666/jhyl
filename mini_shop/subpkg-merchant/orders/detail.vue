<script setup lang="ts">
/**
 * 商家端 · 订单详情（对应设计稿「订单详情」4 形态 + 自提，只读）
 * 契约（api_doc.json GET /api/merchant/orders/{orderNo}）：
 * - 各形态需要的字段都下发，null = 该形态没有这一行
 * - 配送时长 deliveryDurationMinutes 由后端算好（净时长=取货→送达，已扣暂停）
 * - proofs[] 为送达照片 objectKey，拼 URL 走 /api/image/
 * 范围结论：订单只读，无操作按钮；骑手信息可拨号（联系骑手）。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  DELIVERY_STATUS_TEXT,
  createMerchantDeliveryTask,
  finishPreparation,
  getDeliveryStaff,
  getMerchantOrderDetail,
  maskPhone,
  type DeliveryAssignmentType,
  type DeliveryStaffVO,
  type MerchantOrderDetailVO,
} from '@/api/merchant'
import { resolveImageUrl } from '@/utils/request'
import { formatDateTime, formatClock } from '@/utils/datetime'

const statusBarHeight = ref(0)
const contentTop = computed(() => statusBarHeight.value + 44)

const orderNo = ref('')
const order = ref<MerchantOrderDetailVO | null>(null)
const loading = ref(true)
const errorMsg = ref('')

onLoad((options) => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '订单详情' })
  orderNo.value = String(options?.orderNo || '')
  if (!orderNo.value) {
    loading.value = false
    errorMsg.value = '缺少订单号'
    return
  }
  void loadDetail()
})

async function loadDetail(): Promise<void> {
  loading.value = true
  errorMsg.value = ''
  try {
    order.value = await getMerchantOrderDetail(orderNo.value)
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '加载失败'
  } finally {
    loading.value = false
  }
}

// ===== 履约动作（仅同城配送）=====
// 2026-09-19 新增：小程序商家端此前**只有只读订单**，商家看到「待接单」却推不动，
// 于是骑手端永远拿不到任务（用户连着反馈两次）。这里补齐「接单 → 备货完成 → 安排配送」。

/** 是否正在提交（防重复点击）。 */
const acting = ref(false)
/** 安排配送弹层。 */
const assignVisible = ref(false)
const assigning = ref(false)
const assignMode = ref<DeliveryAssignmentType>('PUBLISH_CLAIM')
const staffLoading = ref(false)
const staffList = ref<DeliveryStaffVO[]>([])
const selectedStaffId = ref<number | null>(null)

/** 三种配送方式与说明（对应后端 `assignmentType`）。 */
const ASSIGN_OPTIONS: { type: DeliveryAssignmentType; label: string; desc: string }[] = [
  { type: 'MERCHANT_SELF', label: '商家自送', desc: '本店自己送，不占用骑手' },
  { type: 'ASSIGN_TO_PERSON', label: '指派骑手', desc: '指定本店某位配送员' },
  { type: 'PUBLISH_CLAIM', label: '发布领取', desc: '发到本店待领取池，骑手抢单' },
]

/** 当前配送节点（`WAIT_ACCEPT` / `ACCEPTED` / `WAIT_ASSIGN` …）。 */
const deliveryNode = computed(() => String(order.value?.deliveryStatus || ''))
/** 只有同城配送订单需要商家履约（物流/自提不走这套）。 */
const isSameCity = computed(() => order.value?.pickupType === 2)
/**
 * 可「备货完成」的阶段。
 * ⚠️ **包含 `WAIT_ACCEPT`（待接单）** —— 2026-09-19 用户反馈：订单一多不可能一单一单点
 * 「接单 → 备货完成 → 安排配送」，商家只该按一个「备货完成」；
 * 接单与开始备货这两步由 `finishPreparation()` 自动补齐（见 `api/merchant.ts`）。
 */
const canFinishPrepare = computed(
  () => isSameCity.value && ['WAIT_ACCEPT', 'ACCEPTED', 'PREPARING'].includes(deliveryNode.value),
)
/** 已备货完成、还没派单时，可手动安排配送（指派骑手 / 商家自送）；批量场景默认已自动发布领取。 */
const canAssign = computed(() => isSameCity.value && deliveryNode.value === 'WAIT_ASSIGN')
const showActions = computed(() => canFinishPrepare.value || canAssign.value)

/** 统一动作执行：提交 → toast → 重新拉详情（状态会随之后退）。 */
async function runAction(task: () => Promise<unknown>, successText: string): Promise<void> {
  if (acting.value) return
  acting.value = true
  try {
    await task()
    uni.showToast({ title: successText, icon: 'success' })
    await loadDetail()
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
  } finally {
    acting.value = false
  }
}

/**
 * 备货完成 —— 商家端**主路径**。
 * 按当前状态补齐前置步骤（接单 / 开始备货），最后**自动发布到本店待领取池**给骑手抢单；
 * 想指定骑手或自送时，备货完成后用「安排配送」。
 */
function finishPreparing(): void {
  void runAction(
    () => finishPreparation(orderNo.value, deliveryNode.value, 'PUBLISH_CLAIM'),
    '已备货完成，已发布给骑手',
  )
}

/** 打开安排配送弹层。 */
function openAssign(): void {
  assignVisible.value = true
  assignMode.value = 'PUBLISH_CLAIM'
  selectedStaffId.value = null
}

/** 选择配送方式；选「指派骑手」时加载本店配送员。 */
function chooseAssignMode(type: DeliveryAssignmentType): void {
  assignMode.value = type
  selectedStaffId.value = null
  if (type === 'ASSIGN_TO_PERSON' && !staffList.value.length) void loadStaff()
}

/** 加载本店配送员（失败只提示，不影响改用其它方式）。 */
async function loadStaff(): Promise<void> {
  staffLoading.value = true
  try {
    staffList.value = await getDeliveryStaff()
  } catch {
    staffList.value = []
  } finally {
    staffLoading.value = false
  }
}

/** 确认安排配送：建配送任务。 */
function confirmAssign(): void {
  if (assigning.value) return
  if (assignMode.value === 'ASSIGN_TO_PERSON' && selectedStaffId.value == null) {
    uni.showToast({ title: '请选择要指派的骑手', icon: 'none' })
    return
  }
  assigning.value = true
  void (async () => {
    try {
      await createMerchantDeliveryTask({
        orderNo: orderNo.value,
        assignmentType: assignMode.value,
        ...(assignMode.value === 'ASSIGN_TO_PERSON' && selectedStaffId.value != null
          ? { deliveryPersonId: selectedStaffId.value }
          : {}),
      })
      assignVisible.value = false
      uni.showToast({ title: '已安排配送', icon: 'success' })
      await loadDetail()
    } catch (error) {
      uni.showToast({ title: error instanceof Error ? error.message : '安排配送失败', icon: 'none' })
    } finally {
      assigning.value = false
    }
  })()
}

/** 详情形态：picking 待取货 / delivering 配送中 / done 已完成 / exception 异常 / plain 其它（物流/自提）。 */
const stage = computed<'picking' | 'delivering' | 'done' | 'exception' | 'plain'>(() => {
  const o = order.value
  if (!o) return 'plain'
  const ds = String(o.deliveryStatus || '')
  if (ds === 'EXCEPTION') return 'exception'
  if (ds === 'DELIVERED' || ds === 'COMPLETED') return 'done'
  if (['ACCEPTED', 'PREPARING', 'WAIT_ASSIGN', 'ASSIGNED'].includes(ds)) return 'picking'
  if (['PICKED_UP', 'DELIVERING', 'NEARBY', 'PAUSED'].includes(ds)) return 'delivering'
  // 自提已核销（pickupType=1 且 status=8）也算完成
  if (o.pickupType === 1 && o.status === 8) return 'done'
  return 'plain'
})

/** 状态头主文案。 */
const headText = computed(() => {
  const o = order.value
  if (!o) return ''
  if (stage.value === 'picking') return '待取货'
  if (stage.value === 'delivering') return '配送中'
  if (stage.value === 'done') return '已完成'
  if (stage.value === 'exception') return `${o.deliveryPersonName || '骑手'}-配送异常`
  return o.statusDesc || ''
})

/** 状态头副文案（异常单的「请尽快处理该订单」；完成态的「送达时间」）。 */
const headSub = computed(() => {
  const o = order.value
  if (!o) return ''
  if (stage.value === 'exception') return '请尽快处理该订单'
  if (stage.value === 'done' && o.deliveredAt) return `送达时间：${formatClock(o.deliveredAt)}`
  return ''
})

/** 骑手胶囊文案（picking / delivering / exception 右侧）。 */
const riderText = computed(() => {
  const o = order.value
  if (!o) return ''
  const name = o.deliveryPersonName || '骑手'
  const status = DELIVERY_STATUS_TEXT[String(o.deliveryStatus || '')] || ''
  return status ? `${name}-${status}` : name
})

/** 进度条：当前走到第几个节点（1 待取货 / 2 配送中 / 3 已完成）。 */
const progressIndex = computed(() => {
  if (stage.value === 'delivering') return 2
  if (stage.value === 'done') return 3
  return 1
})
/** 是否显示进度条（配送三态显示，异常/其它不显示）。 */
const showProgress = computed(() => ['picking', 'delivering', 'done'].includes(stage.value))

/** 商品合计（详情口径优先 goodsAmount）。 */
const goodsAmount = computed(() => order.value?.goodsAmount ?? order.value?.totalAmount ?? 0)
/** 送达照片 URL 列表。 */
const proofUrls = computed(() => (order.value?.proofs || []).map((key) => resolveImageUrl(key)).filter(Boolean))

function money(value?: number | null): string {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  return num.toFixed(2).replace(/\.?0+$/, '')
}

function copyOrderNo(): void {
  const no = order.value?.orderNo
  if (!no) return
  uni.setClipboardData({ data: no })
}

/** 联系骑手（拨号）。 */
function callRider(): void {
  const phone = order.value?.deliveryPersonPhone
  if (!phone) return
  uni.makePhoneCall({ phoneNumber: phone, fail: () => {} })
}

/** 预览送达照片。 */
function previewProof(url: string): void {
  uni.previewImage({ urls: proofUrls.value, current: url })
}

function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <!-- 顶部栏（灰底，透出页面底色） -->
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <text class="nav-back" @click="goBack">‹</text>
      <text class="nav-title">订单详情</text>
    </view>

    <scroll-view v-if="order" class="content" scroll-y>
      <!-- 订单主卡 -->
      <view class="card">
        <!-- 状态头 -->
        <view class="head" :class="stage">
          <view class="head-left">
            <text v-if="stage === 'exception'" class="rider-icon rider-icon-jingbao head-icon is-exception" />
            <text v-else-if="stage === 'done'" class="rider-icon rider-icon-gouxuan_tianchong head-icon is-done" />
            <text v-else-if="stage === 'picking'" class="rider-icon rider-icon-shijian head-icon is-picking" />
            <text v-else-if="stage === 'delivering'" class="rider-icon rider-icon-peisongzhong head-icon is-picking" />
            <text class="head-text">{{ headText }}</text>
          </view>
          <view v-if="riderText && stage !== 'exception'" class="rider-pill" @click="callRider">
            <view class="rider-avatar" />
            <text class="rider-name">{{ riderText }}</text>
          </view>
        </view>
        <text v-if="headSub" class="head-sub">{{ headSub }}</text>

        <!-- 异常原因条 -->
        <view v-if="stage === 'exception' && order.exceptionRemark" class="exception-bar">
          <text class="exception-label">异常原因：</text>
          <text class="exception-text">{{ order.exceptionRemark }}</text>
        </view>

        <!-- 收货人 -->
        <view class="receiver">
          <text class="receiver-name">{{ order.receiverName || '收货人' }}</text>
          <text class="receiver-phone">{{ maskPhone(order.receiverPhone) }}</text>
        </view>
        <view v-if="order.receiverAddress" class="address-row">
          <text class="addr-icon">📍</text>
          <text class="address">{{ order.receiverAddress }}</text>
        </view>
        <view v-else-if="order.shopName" class="address-row">
          <text class="addr-icon">🏪</text>
          <text class="address">{{ order.shopName }}</text>
        </view>

        <!-- 配送进度条（3 节点 + 2 连接线交错） -->
        <view v-if="showProgress" class="progress">
          <view class="progress-node">
            <view class="progress-dot" :class="progressIndex >= 1 ? 'is-active' : ''" />
            <text class="progress-label" :class="progressIndex >= 1 ? 'is-active' : ''">待取货</text>
          </view>
          <view class="progress-line" :class="progressIndex >= 2 ? 'is-active' : ''" />
          <view class="progress-node">
            <view class="progress-dot" :class="progressIndex >= 2 ? 'is-active' : ''" />
            <text class="progress-label" :class="progressIndex >= 2 ? 'is-active' : ''">配送中</text>
          </view>
          <view class="progress-line" :class="progressIndex >= 3 ? 'is-active' : ''" />
          <view class="progress-node">
            <view class="progress-dot" :class="stage === 'done' ? 'is-done' : progressIndex >= 3 ? 'is-active' : ''" />
            <text class="progress-label" :class="progressIndex >= 3 ? 'is-active' : ''">已完成</text>
          </view>
        </view>

        <!-- 商品块 + 合计 -->
        <view class="goods">
          <view v-for="(item, index) in (order.items || [])" :key="index" class="goods-row">
            <image class="goods-img" :src="item.productImage || ''" mode="aspectFill" />
            <view class="goods-info">
              <text class="goods-name">{{ item.productName || '—' }}</text>
              <text v-if="item.skuSpec" class="goods-spec">{{ item.skuSpec }}</text>
            </view>
            <text class="goods-qty">× {{ item.quantity ?? 1 }}</text>
            <view class="goods-price"><text class="price-yen">¥</text><text class="price-num">{{ money(item.price) }}</text></view>
          </view>
          <view class="total-row">
            <text class="total-label">合计</text>
            <view class="total-amount"><text class="total-yen">¥</text><text class="total-num">{{ money(goodsAmount) }}</text></view>
          </view>
        </view>
      </view>

      <!-- 订单信息卡 -->
      <view class="card info-card">
        <text class="info-title">订单信息</text>
        <view class="info-row">
          <text class="info-label">订单编号</text>
          <view class="info-value">
            <text class="short-no">#{{ order.shortNo || '' }}</text>
            <text class="order-no-text">{{ order.orderNo }}</text>
            <text class="copy-icon" @click="copyOrderNo">⧉</text>
          </view>
        </view>
        <view class="info-row">
          <text class="info-label">下单时间</text>
          <text class="info-value-text">{{ formatDateTime(order.createTime) }}</text>
        </view>
        <view v-if="order.pickedUpAt" class="info-row">
          <text class="info-label">取货时间</text>
          <text class="info-value-text">{{ formatDateTime(order.pickedUpAt) }}</text>
        </view>
        <view v-if="order.deliveryPersonName" class="info-row">
          <text class="info-label">骑手</text>
          <text class="info-value-text">{{ order.deliveryPersonName }}</text>
        </view>
        <view v-if="order.deliveryDurationMinutes != null" class="info-row">
          <text class="info-label">配送时长</text>
          <text class="info-value-text">{{ order.deliveryDurationMinutes }} 分钟</text>
        </view>
        <view v-if="order.distanceKm != null" class="info-row">
          <text class="info-label">配送距离</text>
          <text class="info-value-text">{{ Number(order.distanceKm).toFixed(1) }}km</text>
        </view>
        <view v-if="order.deliveredAt" class="info-row">
          <text class="info-label">送达时间</text>
          <text class="info-value-text">{{ formatDateTime(order.deliveredAt) }}</text>
        </view>
        <view v-if="proofUrls.length" class="info-row info-row-photo">
          <text class="info-label">送达照片</text>
          <view class="photo-list">
            <image
              v-for="(url, index) in proofUrls"
              :key="index"
              class="photo"
              :src="url"
              mode="aspectFill"
              @click="previewProof(url)"
            />
          </view>
        </view>
        <view v-if="order.shopName" class="info-row">
          <text class="info-label">提货门店</text>
          <text class="info-value-text">{{ order.shopName }}</text>
        </view>
        <view v-if="order.pickupCode" class="info-row">
          <text class="info-label">自提码</text>
          <text class="info-value-text pickup-code">{{ order.pickupCode }}</text>
        </view>
        <view v-if="order.remark" class="info-row">
          <text class="info-label">备注</text>
          <text class="info-value-text">{{ order.remark }}</text>
        </view>
      </view>
      <!-- 底部动作栏是 fixed，这里留占位，避免它盖住最后一行 -->
      <view v-if="showActions" class="action-space" />
    </scroll-view>

    <!-- 加载 / 错误态 -->
    <view v-else class="state-wrap">
      <view v-if="loading" class="state">加载中…</view>
      <view v-else class="state">{{ errorMsg || '订单不存在' }}</view>
    </view>

    <!-- 履约动作栏（仅同城配送、且处于可操作阶段时出现） -->
    <view v-if="showActions" class="action-bar">
      <view v-if="canFinishPrepare" class="action-btn" :class="{ disabled: acting }" @click="finishPreparing">{{ acting ? '处理中…' : '备货完成' }}</view>
      <view v-else-if="canAssign" class="action-btn" @click="openAssign">安排配送</view>
    </view>

    <!-- 安排配送弹层：三种方式 -->
    <view v-if="assignVisible" class="mask" @click="assignVisible = false">
      <view class="sheet" @click.stop>
        <view class="sheet-head"><text class="sheet-title">安排配送</text><text class="sheet-close" @click="assignVisible = false">×</text></view>
        <view
          v-for="option in ASSIGN_OPTIONS"
          :key="option.type"
          class="assign-option"
          :class="{ active: assignMode === option.type }"
          @click="chooseAssignMode(option.type)"
        >
          <view class="radio" :class="{ active: assignMode === option.type }"><view class="radio-dot" /></view>
          <view class="assign-text">
            <text class="assign-name">{{ option.label }}</text>
            <text class="assign-desc">{{ option.desc }}</text>
          </view>
        </view>
        <!-- 指派骑手：选本店配送员 -->
        <view v-if="assignMode === 'ASSIGN_TO_PERSON'" class="staff-list">
          <view v-if="staffLoading" class="staff-empty">骑手加载中…</view>
          <view v-else-if="!staffList.length" class="staff-empty">本店暂无配送员，可改用「发布领取」</view>
          <view
            v-for="staff in staffList"
            :key="staff.id"
            class="staff-item"
            :class="{ active: selectedStaffId === staff.id }"
            @click="selectedStaffId = staff.id"
          >
            <text class="staff-name">{{ staff.name }}</text>
            <text class="staff-online">{{ staff.online ? '在线' : '离线' }}</text>
          </view>
        </view>
        <view class="assign-submit" :class="{ disabled: assigning }" @click="confirmAssign">{{ assigning ? '提交中…' : '确认安排' }}</view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  background: #f2f3f7;
}
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 85rpx; /* 44px */
}
.nav-back {
  position: absolute;
  left: 23rpx;
  top: 50%;
  transform: translateY(-50%);
  color: #1d2129;
  font-size: 46rpx;
  line-height: 1;
}
.nav-title {
  color: #1d2129;
  font-size: 33rpx;
  font-weight: 600;
}
.content {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 15rpx 15rpx 40rpx;
}
.card {
  margin-bottom: 15rpx;
  padding: 0 23rpx 23rpx;
  border-radius: 24rpx;
  background: #ffffff;
}

/* 状态头 */
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 96rpx;
  padding-top: 12rpx;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.head-icon {
  font-size: 38rpx;
}
.head-icon.is-picking {
  color: #ff7d00;
}
.head-icon.is-done {
  color: #00b42a;
}
.head-icon.is-exception {
  color: #f53f3f;
}
.head-text {
  font-size: 31rpx;
  font-weight: 600;
}
.head.picking .head-text {
  color: #ff7d00;
}
.head.delivering .head-text {
  color: #ff7d00;
}
.head.done .head-text {
  color: #00b42a;
}
.head.exception .head-text {
  color: #f53f3f;
}
.head.plain .head-text {
  color: #1d2129;
}
.head-sub {
  display: block;
  padding-bottom: 12rpx;
  color: #86909c;
  font-size: 27rpx;
}
.rider-pill {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 4rpx 23rpx 4rpx 4rpx;
  border-radius: 9999rpx;
  background: #fff4e8;
}
.rider-avatar {
  width: 54rpx;
  height: 54rpx;
  border-radius: 50%;
  background: #ffffff;
}
.rider-name {
  color: #ff5500;
  font-size: 27rpx;
}

/* 异常原因条 */
.exception-bar {
  display: flex;
  margin: 12rpx 0;
  padding: 15rpx;
  border-radius: 15rpx;
  background: #ffeded;
}
.exception-label {
  flex: none;
  color: #f53f3f;
  font-size: 27rpx;
}
.exception-text {
  flex: 1;
  color: #1d2129;
  font-size: 27rpx;
}

/* 收货人 */
.receiver {
  display: flex;
  align-items: center;
  margin-bottom: 12rpx;
}
.receiver-name {
  color: #1d2129;
  font-size: 35rpx;
  font-weight: 600;
}
.receiver-phone {
  margin-left: 23rpx;
  color: #1d2129;
  font-size: 35rpx;
}
.address-row {
  display: flex;
  align-items: center;
  margin-bottom: 12rpx;
}
.addr-icon {
  flex: none;
  margin-right: 8rpx;
  font-size: 27rpx;
}
.address {
  flex: 1;
  min-width: 0;
  color: #86909c;
  font-size: 27rpx;
  line-height: 38rpx;
}

/* 进度条 */
.progress {
  display: flex;
  align-items: center;
  margin: 23rpx 0;
  padding: 0 30rpx;
}
.progress-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  flex: none;
  width: 80rpx;
}
.progress-dot {
  width: 20rpx;
  height: 20rpx;
  border-radius: 50%;
  background: #d7dbe0;
}
.progress-dot.is-active {
  background: #ff5500;
}
.progress-dot.is-done {
  background: #00b42a;
}
.progress-label {
  color: #86909c;
  font-size: 23rpx;
}
.progress-label.is-active {
  color: #ff5500;
}
.progress-line {
  flex: 1;
  height: 3rpx;
  background: #e6e7eb;
}
.progress-line.is-active {
  background: #ff5500;
}

/* 商品块 */
.goods {
  margin-top: 12rpx;
  padding: 0 0 12rpx;
}
.goods-row {
  display: flex;
  align-items: center;
  gap: 23rpx;
  padding: 12rpx 0;
}
.goods-img {
  flex: none;
  width: 127rpx;
  height: 127rpx;
  border-radius: 12rpx;
  background: #f2f3f7;
}
.goods-info {
  flex: 1;
  min-width: 0;
}
.goods-name {
  display: block;
  color: #1d2129;
  font-size: 25rpx;
  line-height: 42rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.goods-spec {
  display: block;
  color: #86909c;
  font-size: 23rpx;
  line-height: 38rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.goods-qty {
  flex: none;
  color: #86909c;
  font-size: 23rpx;
}
.goods-price {
  flex: none;
  display: flex;
  align-items: baseline;
  color: #1d2129;
}
.price-yen {
  font-size: 23rpx;
  font-weight: 500;
  line-height: 1;
}
.price-num {
  font-size: 27rpx;
  font-weight: 500;
  line-height: 1;
}
.total-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 15rpx;
}
.total-label {
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 500;
}
.total-amount {
  display: flex;
  align-items: baseline;
  color: #ff5500;
}
.total-yen {
  font-size: 23rpx;
  font-weight: 500;
  line-height: 1;
}
.total-num {
  font-size: 35rpx;
  font-weight: 500;
  line-height: 1;
}

/* 订单信息卡 */
.info-card {
  padding-top: 23rpx;
}
.info-title {
  display: block;
  padding-bottom: 12rpx;
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 500;
}
.info-row {
  display: flex;
  align-items: center;
  min-height: 108rpx; /* 56px */
  padding: 15rpx 0;
  border-top: 2rpx solid #e6e7eb;
}
.info-label {
  flex: none;
  width: 116rpx;
  color: #86909c;
  font-size: 29rpx;
}
.info-value {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
  min-width: 0;
}
.info-value-text {
  flex: 1;
  color: #1d2129;
  font-size: 29rpx;
  text-align: right;
  word-break: break-all;
}
.short-no {
  color: #ff7d00;
  font-size: 29rpx;
}
.order-no-text {
  color: #1d2129;
  font-size: 29rpx;
}
.copy-icon {
  flex: none;
  color: #1d2129;
  font-size: 31rpx;
  padding: 0 4rpx;
}
.pickup-code {
  color: #ff5500;
  font-weight: 600;
}
.info-row-photo {
  align-items: flex-start;
}
.photo-list {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  justify-content: flex-end;
}
.photo {
  width: 108rpx;
  height: 108rpx;
  border-radius: 12rpx;
  background: #f2f3f7;
}

/* 加载 / 错误 */
.state-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.state {
  text-align: center;
  color: #86909c;
  font-size: 28rpx;
}
/* ===== 履约动作栏 + 安排配送弹层（2026-09-19：商家终于能在小程序里推单） ===== */
.action-space { height: 160rpx; }
.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  padding: 16rpx 23rpx calc(16rpx + env(safe-area-inset-bottom));
  background: #ffffff;
  box-shadow: 0 -2rpx 12rpx rgba(29, 33, 41, 0.06);
}
.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  border-radius: 16rpx;
  color: #ffffff;
  background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%);
  font-size: 31rpx;
  font-weight: 600;
}
.action-btn.disabled { opacity: 0.6; }

.mask { position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; justify-content: flex-end; background: rgba(0, 0, 0, 0.45); }
.sheet { padding: 31rpx 31rpx calc(31rpx + env(safe-area-inset-bottom)); border-radius: 23rpx 23rpx 0 0; background: #ffffff; }
.sheet-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 12rpx; }
.sheet-title { color: #1d2129; font-size: 35rpx; font-weight: 600; }
.sheet-close { color: #86909c; font-size: 44rpx; line-height: 1; }
.assign-option { display: flex; align-items: center; padding: 24rpx 0; border-bottom: 1rpx solid #f2f3f7; }
.assign-text { flex: 1; min-width: 0; }
.assign-name { display: block; color: #1d2129; font-size: 28rpx; font-weight: 500; }
.assign-desc { display: block; margin-top: 4rpx; color: #86909c; font-size: 23rpx; }
.radio { flex: none; display: flex; align-items: center; justify-content: center; width: 38rpx; height: 38rpx; margin-right: 18rpx; border: 2rpx solid #d7dbe0; border-radius: 50%; box-sizing: border-box; }
.radio.active { border-color: #ff5500; background: #ff5500; }
.radio-dot { width: 16rpx; height: 16rpx; border-radius: 50%; }
.radio.active .radio-dot { background: #ffffff; }
.staff-list { margin-top: 16rpx; max-height: 400rpx; }
.staff-item { display: flex; align-items: center; justify-content: space-between; padding: 22rpx 20rpx; margin-bottom: 12rpx; border-radius: 12rpx; background: #f6f7f9; }
.staff-item.active { background: #fff4e8; }
.staff-name { color: #1d2129; font-size: 27rpx; }
.staff-online { color: #86909c; font-size: 23rpx; }
.staff-empty { padding: 24rpx 0; color: #86909c; font-size: 25rpx; text-align: center; }
.assign-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  margin-top: 24rpx;
  border-radius: 16rpx;
  color: #ffffff;
  background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%);
  font-size: 31rpx;
  font-weight: 600;
}
.assign-submit.disabled { opacity: 0.6; }
</style>
