<script setup lang="ts">
/**
 * 骑手端「订单详情」（对应设计：待取货 / 配送中 / 已完成 / 异常 / 已取消 五形态共用一页）
 * 契约：2026-09-14 v1.4
 * - 手机号明文（UI 打星）；`pickupCodeRequired` 决定送达前是否需校验收货码；
 * - 商品清单走 `GET /tasks/{id}/items`；
 * - 送达：先 `/verify-code`（服务端落事件）→ 再 `/delivered`（**不再传 pickupCodeVerified**）；
 * - 异常上报：类型用附录 C 枚举 + 图片（上传拿 URL → `toObjectKey` 反推 OSS Key）。
 */
import { computed, ref } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import {
  EXCEPTION_TYPES,
  deliverTask,
  getTaskContact,
  getTaskDetail,
  getTaskItems,
  pickupTask,
  reportTaskException,
  toObjectKey,
  verifyTaskCode,
  type RiderTask,
  type RiderTaskItem,
  type TaskNodeBody,
} from '@/api/delivery'
import { uploadFile } from '@/utils/request'

const taskId = ref('')
const task = ref<RiderTask | null>(null)
const items = ref<RiderTaskItem[]>([])
const loading = ref(true)
const acting = ref(false)
/** 剩余秒数（服务端基准，本地递减）。 */
const remainSeconds = ref<number | null>(null)
let tickTimer: ReturnType<typeof setInterval> | null = null

/** 上报异常弹层。 */
const exceptionVisible = ref(false)
const exceptionType = ref<string>('CONTACT_FAILED')
const exceptionRemark = ref('')
const exceptionImages = ref<string[]>([])
const uploading = ref(false)

const statusBarHeight = ref(0)
const contentTop = computed(() => statusBarHeight.value + 44)

/** API 基址（凭证图片要拼完整 URL：`{base}/api/image/{objectKey}`）。 */
const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

/** 凭证 OSS Key → 可访问图片 URL（后端图片代理）。 */
function imageUrl(key: string): string {
  return `${API_BASE}/api/image/${key}`
}

/** 异常类型选择（picker change）。 */
function onExceptionTypeChange(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value) || 0
  exceptionType.value = EXCEPTION_TYPES[index]?.value || 'OTHER'
}

/** 当前阶段（`CANCELLED` 单独成一态：不显示异常说明、不给任何动作按钮）。 */
const stage = computed<'picking' | 'delivering' | 'done' | 'exception' | 'cancelled'>(() => {
  const status = String(task.value?.status || '')
  if (status === 'CANCELLED') return 'cancelled'
  if (status === 'EXCEPTION') return 'exception'
  if (status === 'DELIVERED') return 'done'
  if (status === 'PICKED_UP' || status === 'DELIVERING' || status === 'NEARBY') return 'delivering'
  return 'picking'
})
const stageText = computed(() => ({ picking: '待取货', delivering: '配送中', done: '已完成', exception: '配送异常', cancelled: '已取消' })[stage.value])
/**
 * 状态区插画（设计切图，与详情页节点 05/07/10 一一对应）：
 * 待取货 → `to-pickup`、配送中 → `delivering`、已完成 → `completed`；
 * **异常**用宽幅横幅（见模板里的 `issue-banner`）、**已取消**不显示插画（设计：灰调、不给动作）。
 * 切图为 96×96（按 2 倍图使用），显示尺寸取 96rpx。
 */
const stageIllustration = computed(() => {
  if (stage.value === 'picking') return '/static/rider/to-pickup.png'
  if (stage.value === 'delivering') return '/static/rider/delivering.png'
  if (stage.value === 'done') return '/static/rider/completed.png'
  return ''
})
/** 阶段进度：已取消停在第一步（进度条全灰）。 */
const stageIndex = computed(() => (stage.value === 'picking' || stage.value === 'cancelled' ? 1 : stage.value === 'delivering' ? 2 : 3))
const canPickup = computed(() => String(task.value?.status || '') === 'ACCEPTED')
const canDeliver = computed(() => ['PICKED_UP', 'DELIVERING', 'NEARBY'].includes(String(task.value?.status || '')))
/** 是否需要收货码核销。 */
const needPickupCode = computed(() => Boolean(task.value?.pickupCodeRequired))
/** 异常类型中文（附录 C 枚举；非异常单为空）。 */
const exceptionTypeText = computed(() => EXCEPTION_TYPES.find((item) => item.value === String(task.value?.exceptionType || ''))?.label || '—')

/** 右上文案：已完成显示送达时间，其它显示承诺时间/倒计时。 */
const stageExtra = computed(() => {
  const item = task.value
  if (!item) return ''
  if (stage.value === 'done' && item.deliveredAt) return `送达时间：${String(item.deliveredAt).slice(-8)}`
  const raw = String(item.expectedDeliverAt || '')
  const matched = raw.match(/\d{2}:\d{2}/)
  if (remainSeconds.value != null) {
    // 服务端已判超时（0/负）→ 明确提示，避免"剩余 0 分钟"
    return remainSeconds.value <= 0 ? '已超时' : `剩余 ${Math.ceil(remainSeconds.value / 60)} 分钟`
  }
  return matched ? `${matched[0]} 前送达` : ''
})

/** 手机号打星（明文下发，UI 自己截）。 */
function maskPhone(phone?: string): string {
  const value = String(phone || '').replace(/\s/g, '')
  if (value.length < 7) return value || '—'
  return `${value.slice(0, 3)} **** ${value.slice(-4)}`
}

/** 加载详情 + 商品清单。 */
async function loadDetail(): Promise<void> {
  if (!taskId.value) return
  loading.value = true
  try {
    const detail = await getTaskDetail(taskId.value)
    task.value = detail
    remainSeconds.value = detail.remainingSeconds != null ? Number(detail.remainingSeconds) : null
    items.value = await getTaskItems(taskId.value).catch(() => [])
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '任务详情加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

/** 采集定位（start / delivered 必采；pickup 可选）。 */
function buildNodeBody(): Promise<TaskNodeBody> {
  return new Promise((resolve, reject) => {
    uni.getLocation({
      type: 'gcj02',
      success: (res) => resolve({ latitude: res.latitude, longitude: res.longitude, accuracy: res.accuracy }),
      fail: () => reject(new Error('获取定位失败，请开启定位权限后重试')),
    })
  })
}

/** 确认取货（定位可选）。 */
async function doPickup(): Promise<void> {
  if (acting.value || !taskId.value) return
  acting.value = true
  try {
    const body = await buildNodeBody().catch(() => ({}))
    await pickupTask(taskId.value, body)
    uni.showToast({ title: '已确认取货', icon: 'success' })
    await loadDetail()
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '确认取货失败', icon: 'none' })
  } finally {
    acting.value = false
  }
}

/** 确认送达：需收货码时先弹框校验（服务端落事件），再提交送达（不传前端布尔）。 */
async function doDeliver(): Promise<void> {
  if (acting.value || !taskId.value) return
  if (needPickupCode.value) {
    const code = await promptPickupCode()
    if (!code) return
    acting.value = true
    try {
      await verifyTaskCode(taskId.value, code)
    } catch (error) {
      uni.showToast({ title: error instanceof Error ? error.message : '收货码校验失败', icon: 'none' })
      acting.value = false
      return
    }
  } else {
    acting.value = true
  }
  try {
    const body = await buildNodeBody()
    await deliverTask(taskId.value, body)
    uni.showToast({ title: '已确认送达', icon: 'success' })
    await loadDetail()
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '确认送达失败', icon: 'none' })
  } finally {
    acting.value = false
  }
}

/** 弹框输入收货码。 */
function promptPickupCode(): Promise<string | null> {
  return new Promise((resolve) => {
    uni.showModal({
      title: '校验收货码',
      editable: true,
      placeholderText: '请输入顾客收货码',
      success: (res) => resolve(res.confirm && res.content ? res.content.trim() : null),
      fail: () => resolve(null),
    })
  })
}

/** 选择并上传异常图片（返回 OSS Key 列表）。 */
async function chooseExceptionImages(): Promise<void> {
  uni.chooseImage({
    count: 3,
    success: async (res) => {
      uploading.value = true
      try {
        for (const path of res.tempFilePaths || []) {
          const url = await uploadFile(path)
          exceptionImages.value.push(toObjectKey(url))
        }
      } catch (error) {
        uni.showToast({ title: error instanceof Error ? error.message : '图片上传失败', icon: 'none' })
      } finally {
        uploading.value = false
      }
    },
  })
}

/** 提交异常上报（类型 + 说明必填）。 */
async function submitException(): Promise<void> {
  const remark = exceptionRemark.value.trim()
  if (!remark) {
    uni.showToast({ title: '请填写异常说明', icon: 'none' })
    return
  }
  if (!taskId.value) return
  acting.value = true
  try {
    await reportTaskException(taskId.value, {
      type: exceptionType.value,
      remark,
      imageKeys: exceptionImages.value.length ? exceptionImages.value : undefined,
    })
    exceptionVisible.value = false
    exceptionRemark.value = ''
    exceptionImages.value = []
    uni.showToast({ title: '已上报异常', icon: 'success' })
    await loadDetail()
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '上报失败', icon: 'none' })
  } finally {
    acting.value = false
  }
}

/** 联系客户（取号留痕；失败退回明文号）。 */
async function callCustomer(): Promise<void> {
  if (!taskId.value) return
  try {
    const phone = (await getTaskContact(taskId.value, '配送联系')) || task.value?.receiverPhone || ''
    if (!phone) {
      uni.showToast({ title: '未获取到号码', icon: 'none' })
      return
    }
    uni.makePhoneCall({ phoneNumber: phone })
  } catch {
    if (task.value?.receiverPhone) uni.makePhoneCall({ phoneNumber: task.value.receiverPhone })
    else uni.showToast({ title: '取号失败', icon: 'none' })
  }
}

/** 导航。 */
function navigate(): void {
  const item = task.value
  if (!item || item.deliveryLat == null || item.deliveryLng == null) {
    uni.showToast({ title: '该订单缺少坐标，无法导航', icon: 'none' })
    return
  }
  uni.openLocation({
    latitude: Number(item.deliveryLat),
    longitude: Number(item.deliveryLng),
    name: item.receiverName || '收货地址',
    address: item.deliveryAddress || '',
    fail: () => uni.showToast({ title: '打开地图失败', icon: 'none' }),
  })
}

function goBack(): void {
  uni.navigateBack()
}

onLoad((options?: Record<string, string | undefined>) => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  taskId.value = options?.taskId || ''
  void loadDetail()
  tickTimer = setInterval(() => {
    if (remainSeconds.value != null && remainSeconds.value > 0) remainSeconds.value -= 1
  }, 1000)
})
onUnload(() => {
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = null
})
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <view class="nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">订单详情</text>
      </view>
    </view>

    <scroll-view class="body" scroll-y>
      <view v-if="loading" class="state">加载中…</view>
      <view v-else-if="!task" class="state">任务不存在或无权查看</view>
      <template v-else>
        <!-- 状态区 -->
        <view class="card">
          <view class="status-head">
            <text class="status-text" :class="{ 'is-exception': stage === 'exception', 'is-cancelled': stage === 'cancelled' }">{{ stageText }}</text>
            <text class="status-extra">{{ stageExtra }}</text>
          </view>
          <!-- 状态插画（设计切图 05 待取货 / 07 配送中 / 10 已完成） -->
          <image v-if="stageIllustration" class="status-illustration" :src="stageIllustration" mode="aspectFit" />
          <template v-if="stage === 'exception'">
            <!-- 异常态宽幅横幅（设计切图 12 异常单） -->
            <image class="issue-banner" src="/static/rider/delivery-issue.png" mode="widthFix" />
            <text class="exception-tip">请尽快处理该订单</text>
            <text v-if="task.exceptionRemark" class="exception-reason">异常原因：{{ task.exceptionRemark }}</text>
          </template>
          <!-- 已取消：进度无意义，给一句说明即可 -->
          <text v-if="stage === 'cancelled'" class="exception-tip is-cancelled">该订单已取消，无需继续配送</text>
          <view class="receiver-row">
            <text class="receiver-name">{{ task.receiverName || '收货人' }}</text>
            <text class="receiver-phone">{{ maskPhone(task.receiverPhone) }}</text>
          </view>
          <text class="address">{{ task.deliveryAddress || '—' }}</text>

          <view v-if="stage !== 'cancelled'" class="stages">
            <view class="stage" :class="{ 'is-done': stageIndex >= 1 }"><text class="stage-text">待取货</text></view>
            <view class="stage" :class="{ 'is-done': stageIndex >= 2 }"><text class="stage-text">配送中</text></view>
            <view class="stage" :class="{ 'is-done': stageIndex >= 3 }"><text class="stage-text">已完成</text></view>
          </view>

          <view class="contact-actions">
            <button class="btn btn-ghost" @click="callCustomer"><text class="rider-icon rider-icon-dianhua btn-icon" />联系客户</button>
            <!-- 已取消的单无需导航 -->
            <button v-if="stage !== 'cancelled'" class="btn btn-ghost" @click="navigate"><text class="rider-icon rider-icon-daohang btn-icon" />导航</button>
          </view>
        </view>

        <!-- 商品清单 -->
        <view class="card">
          <text class="card-title">商品清单（{{ task.itemCount ?? items.length }} 件）</text>
          <view v-for="(item, index) in items" :key="index" class="goods-item">
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
          <view v-if="!items.length" class="goods-empty"><text class="goods-empty-text">暂无商品明细</text></view>
        </view>

        <!-- 订单信息 -->
        <view class="card">
          <text class="card-title">订单信息</text>
          <view class="info-row"><text class="info-label">任务号</text><text class="info-value">{{ task.taskNo || '—' }}</text></view>
          <view class="info-row"><text class="info-label">订单号</text><text class="info-value">{{ task.orderNo || '—' }}</text></view>
          <view class="info-row"><text class="info-label">下单时间</text><text class="info-value">{{ task.createTime || '—' }}</text></view>
          <view class="info-row"><text class="info-label">配送距离</text><text class="info-value">{{ task.distanceKm != null ? `${Number(task.distanceKm).toFixed(1)}km` : '—' }}</text></view>
          <view class="info-row" v-if="stage === 'exception'"><text class="info-label">异常类型</text><text class="info-value">{{ exceptionTypeText }}</text></view>
          <view class="info-row" v-if="stage === 'done'"><text class="info-label">送达时间</text><text class="info-value">{{ task.deliveredAt || '—' }}</text></view>
        </view>
      </template>
    </scroll-view>

    <!-- 底部动作（已取消等无动作状态不渲染，避免空白条） -->
    <view v-if="task && (canPickup || canDeliver)" class="footer">
      <template v-if="canPickup">
        <button class="btn btn-primary btn-block" :disabled="acting" @click="doPickup">确认取货</button>
      </template>
      <template v-else-if="canDeliver">
        <button class="btn btn-ghost" @click="exceptionVisible = true"><text class="rider-icon rider-icon-jingbao btn-icon" />上报异常</button>
        <button class="btn btn-primary" :disabled="acting" @click="doDeliver">确认送达</button>
      </template>
    </view>

    <!-- 上报异常弹层 -->
    <view v-if="exceptionVisible" class="mask" @click="exceptionVisible = false">
      <view class="sheet" @click.stop>
        <text class="sheet-title">上报异常</text>
        <view class="sheet-field">
          <text class="sheet-label">异常原因 <text class="required">*</text></text>
          <picker :range="EXCEPTION_TYPES.map((item) => item.label)" @change="onExceptionTypeChange">
            <view class="sheet-picker">{{ EXCEPTION_TYPES.find((item) => item.value === exceptionType)?.label || '请选择' }}</view>
          </picker>
          <textarea v-model="exceptionRemark" class="sheet-input" :maxlength="200" placeholder="请描述异常情况，例如：联系不上用户" />
          <view class="sheet-images">
            <image v-for="(key, index) in exceptionImages" :key="index" class="sheet-image" :src="imageUrl(key)" mode="aspectFill" />
            <view class="sheet-add" @click="chooseExceptionImages">{{ uploading ? '上传中' : '+ 图片' }}</view>
          </view>
        </view>
        <view class="sheet-actions">
          <button class="btn btn-ghost" @click="exceptionVisible = false">取消</button>
          <button class="btn btn-primary" :disabled="acting || uploading" @click="submitException">提交</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; background: #f6f7f9; }
.nav { position: fixed; top: 0; right: 0; left: 0; z-index: 30; background: #fff; }
.nav-inner { position: relative; display: flex; align-items: center; justify-content: center; height: 44px; }
.nav-back { position: absolute; top: 50%; left: 24rpx; color: #1d2129; font-size: 46rpx; line-height: 1; transform: translateY(-50%); }
.nav-title { color: #1d2129; font-size: 32rpx; font-weight: 600; }
.body { flex: 1; min-height: 0; padding: 20rpx 24rpx 140rpx; box-sizing: border-box; }
.state { padding: 160rpx 0; color: #86909c; font-size: 28rpx; text-align: center; }
.card { margin-bottom: 20rpx; padding: 24rpx; border-radius: 16rpx; background: #fff; }
.card-title { display: block; margin-bottom: 16rpx; color: #1d2129; font-size: 30rpx; font-weight: 600; }
.status-head { display: flex; align-items: center; justify-content: space-between; }
.status-text { color: #ff7d00; font-size: 32rpx; font-weight: 600; }
.status-text.is-exception { color: #ff0000; }
.status-text.is-cancelled { color: #86909c; }
.status-extra { color: #ff7d00; font-size: 26rpx; font-weight: 600; }
/* 按钮内图标（iconfont，16px → 31rpx） */
.btn-icon { margin-right: 8rpx; font-size: 31rpx; }
/* 状态插画：切图 96×96，按 2 倍图使用 → 显示 96rpx */
.status-illustration { width: 96rpx; height: 96rpx; margin-top: 16rpx; }
/* 异常态宽幅横幅（1122×324，widthFix 自适应高度） */
.issue-banner { display: block; width: 100%; margin-top: 16rpx; border-radius: 12rpx; }
.exception-tip { display: block; margin-top: 10rpx; color: #ff0000; font-size: 26rpx; }
.exception-tip.is-cancelled { color: #86909c; }
.exception-reason { display: block; margin-top: 6rpx; color: #ff0000; font-size: 26rpx; line-height: 36rpx; }
.receiver-row { display: flex; align-items: center; margin-top: 16rpx; }
.receiver-name { color: #1d2129; font-size: 30rpx; font-weight: 600; }
.receiver-phone { margin-left: 16rpx; color: #1d2129; font-size: 26rpx; }
.address { display: block; margin-top: 8rpx; color: #86909c; font-size: 26rpx; line-height: 38rpx; }
.stages { display: flex; align-items: center; justify-content: space-between; margin-top: 22rpx; }
.stage { flex: 1; text-align: center; }
.stage-text { color: #86909c; font-size: 26rpx; }
.stage.is-done .stage-text { color: #ff5500; font-weight: 600; }
.contact-actions { display: flex; gap: 16rpx; margin-top: 22rpx; }
.goods-item { display: flex; align-items: center; padding: 12rpx 0; }
.goods-image { width: 80rpx; height: 80rpx; flex-shrink: 0; border-radius: 8rpx; background: #f2f3f7; }
.goods-info { flex: 1; min-width: 0; margin-left: 16rpx; }
.goods-name { display: block; overflow: hidden; color: #1d2129; font-size: 26rpx; white-space: nowrap; text-overflow: ellipsis; }
.goods-spec { display: block; margin-top: 4rpx; color: #86909c; font-size: 22rpx; }
.goods-right { flex-shrink: 0; margin-left: 16rpx; text-align: right; }
.goods-qty { display: block; color: #1d2129; font-size: 24rpx; }
.goods-price { display: block; margin-top: 4rpx; color: #86909c; font-size: 22rpx; }
.goods-empty { padding: 24rpx 0; text-align: center; }
.goods-empty-text { color: #86909c; font-size: 24rpx; }
.info-row { display: flex; align-items: flex-start; justify-content: space-between; padding: 12rpx 0; }
.info-label { flex-shrink: 0; margin-right: 24rpx; color: #86909c; font-size: 26rpx; }
.info-value { flex: 1; color: #1d2129; font-size: 26rpx; text-align: right; word-break: break-all; }
.footer { position: fixed; right: 0; bottom: 0; left: 0; display: flex; gap: 16rpx; padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom)); background: #fff; }
.btn { flex: 1; margin: 0; border-radius: 44rpx; font-size: 28rpx; line-height: 76rpx; }
.btn::after { border: 0; }
.btn-block { flex: none; width: 100%; }
.btn-primary { color: #fff; background: #ff5500; }
.btn-primary[disabled] { opacity: .6; }
.btn-ghost { color: #1d2129; background: #f2f3f7; }
.mask { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 40; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .4); }
.sheet { width: 100%; padding: 32rpx 32rpx calc(32rpx + env(safe-area-inset-bottom)); box-sizing: border-box; border-radius: 24rpx 24rpx 0 0; background: #fff; }
.sheet-title { display: block; margin-bottom: 24rpx; color: #1d2129; font-size: 32rpx; font-weight: 600; text-align: center; }
.sheet-label { display: block; margin-bottom: 12rpx; color: #1d2129; font-size: 28rpx; }
.required { color: #ff0000; }
.sheet-picker { padding: 20rpx 24rpx; margin-bottom: 16rpx; border-radius: 12rpx; background: #f6f7f9; color: #1d2129; font-size: 26rpx; }
.sheet-input { width: 100%; height: 160rpx; padding: 20rpx; box-sizing: border-box; border-radius: 12rpx; background: #f6f7f9; color: #1d2129; font-size: 26rpx; }
.sheet-images { display: flex; align-items: center; gap: 16rpx; margin-top: 16rpx; }
.sheet-image { width: 110rpx; height: 110rpx; border-radius: 10rpx; background: #f2f3f7; }
.sheet-add { display: flex; align-items: center; justify-content: center; width: 110rpx; height: 110rpx; border-radius: 10rpx; background: #f2f3f7; color: #86909c; font-size: 24rpx; }
.sheet-actions { display: flex; gap: 16rpx; margin-top: 28rpx; }
</style>
