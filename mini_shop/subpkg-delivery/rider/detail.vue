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
  getTaskProofs,
  getTaskContact,
  getTaskDetail,
  getTaskItems,
  pickupTask,
  reportTaskException,
  startTask,
  toObjectKey,
  verifyTaskCode,
  type DeliveryProof,
  type RiderTask,
  type RiderTaskItem,
  type TaskNodeBody,
} from '@/api/delivery'
import { collectNodeLocation, confirmDeliverDistance } from '@/utils/location'
import { durationMinutesText, formatClock, formatDateTime } from '@/utils/datetime'
import { canStillUploadProof, captureProofImages, submitProofImages } from '@/utils/delivery-proof'
import { uploadFile } from '@/utils/request'

const taskId = ref('')
const task = ref<RiderTask | null>(null)
const items = ref<RiderTaskItem[]>([])
/** 送达凭证（仅已完成态拉取；用于订单信息里的「送达照片」）。 */
const proofs = ref<DeliveryProof[]>([])
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
  // PAUSED（商家暂停）在「配送中」Tab 仍可见，详情也按配送中处理（2026-09-17 后端口径）
  if (status === 'PICKED_UP' || status === 'DELIVERING' || status === 'NEARBY' || status === 'PAUSED') return 'delivering'
  return 'picking'
})
const stageText = computed(() => ({ picking: '待取货', delivering: '配送中', done: '已完成', exception: '配送异常', cancelled: '已取消' })[stage.value])
/**
 * 阶段指示的三个节点（设计稿 05/07/08/10 的 `Frame 104`）：
 * 用交付的三张插画做节点图标（设计 32×32 → **61rpx**），文字 12px → 23rpx。
 * 颜色：当前阶段 = 主色 `#FF5500`、已经过的阶段 = 深灰 `#1D2129`、未到 = 浅灰 `#86909C`。
 */
const stageNodes = [
  { key: 'picking', label: '待取货', image: '/static/rider/to-pickup.png' },
  { key: 'delivering', label: '配送中', image: '/static/rider/delivering.png' },
  { key: 'done', label: '已完成', image: '/static/rider/completed.png' },
]
/** 阶段进度：已取消停在第一步（异常态在模板里不渲染阶段指示）。 */
const stageIndex = computed(() => (stage.value === 'picking' || stage.value === 'cancelled' ? 1 : stage.value === 'delivering' ? 2 : 3))
/** 阶段节点文字颜色类。 */
function stageNodeClass(index: number): string {
  const current = stageIndex.value
  if (index + 1 === current) return 'is-current'
  return index + 1 < current ? 'is-passed' : ''
}
/** 卡片头部状态图标（iconfont）：待取货=时间、配送中=车、已完成=勾、异常=警报。 */
const headIcon = computed(() => {
  if (stage.value === 'exception') return 'rider-icon-jingbao'
  if (stage.value === 'done') return 'rider-icon-gouxuan_tianchong'
  if (stage.value === 'delivering') return 'rider-icon-peisongzhong'
  return 'rider-icon-shijian'
})
/**
 * 卡片头部右侧文案：
 * 待取货/配送中 = 「55 分钟内- 4.1km」；已完成 = 「送达时间：10:52:00」；异常/取消 = 空。
 */
const headRightText = computed(() => {
  const item = task.value
  if (!item) return ''
  if (stage.value === 'exception' || stage.value === 'cancelled') return ''
  if (stage.value === 'done') return item.deliveredAt ? `送达时间：${formatClock(item.deliveredAt)}` : ''
  const km = item.distanceKm != null ? `${Number(item.distanceKm).toFixed(1)}km` : ''
  const clock = String(item.expectedDeliverAt || '').match(/\d{2}:\d{2}/)?.[0] || ''
  let left = ''
  if (remainSeconds.value != null) left = remainSeconds.value <= 0 ? '已超时' : `${Math.ceil(remainSeconds.value / 60)} 分钟内`
  else if (clock) left = `${clock} 前送达`
  if (left && km) return `${left}- ${km}`
  return left || km
})
/** 配送时长（已完成态）：后端未直接给，由取货时间与送达时间推算（iOS 解析见 utils/datetime.ts 注释）。 */
const deliveryDurationText = computed(() => durationMinutesText(task.value?.pickedUpAt, task.value?.deliveredAt))
/** 配送距离文案（订单信息用）。 */
const distanceText = computed(() => {
  const km = task.value?.distanceKm
  return km != null ? `${Number(km).toFixed(1)}km` : '—'
})
/**
 * 订单信息里的短号：**订单号后 4 位**，与骑手列表、商家端、后台统一。
 * ⚠️ 此前详情用「任务号末 3 位」、骑手列表用「列表序号 `#001`」、商家端用「订单号后 4 位」——
 * 同一单在三处显示三个样（2026-09-19 用户反馈）。
 */
const shortNoFromTask = computed(() => {
  const no = String(task.value?.orderNo || '')
  return no ? `#${no.slice(-4)}` : '#—'
})
/** 复制订单号（订单信息行）。 */
function copyOrderNo(): void {
  const no = String(task.value?.orderNo || '')
  if (!no) return
  uni.setClipboardData({ data: no, success: () => uni.showToast({ title: '订单号已复制', icon: 'none' }) })
}
const canPickup = computed(() => String(task.value?.status || '') === 'ACCEPTED')
const canDeliver = computed(() => ['PICKED_UP', 'DELIVERING', 'NEARBY', 'PAUSED'].includes(String(task.value?.status || '')))
/** 是否需要收货码核销。 */
const needPickupCode = computed(() => Boolean(task.value?.pickupCodeRequired))
/** 异常类型中文（附录 C 枚举；非异常单为空）。 */
const exceptionTypeText = computed(() => EXCEPTION_TYPES.find((item) => item.value === String(task.value?.exceptionType || ''))?.label || '—')

/** 送达照片（只取 PHOTO 类型且有 objectKey 的凭证；签名/说明类凭证不进照片行）。 */
const photoProofs = computed(() => proofs.value.filter((proof) => String(proof.proofType || 'PHOTO') === 'PHOTO' && proof.objectKey))

/** 是否还能补传送达照片：后端 `/proof` 允许「送达后 24h 内」上传，超窗口就不再给入口。 */
const canUploadProof = computed(() => {
  const item = task.value
  if (!item) return false
  if (String(item.status) !== 'DELIVERED') return false
  return canStillUploadProof(item.deliveredAt)
})

/**
 * 查看送达照片：用小程序原生图片预览（**交互由前端定**：缩略图点击 → 全屏预览，可左右滑动看多张）。
 * 设计稿只给了 56×56 缩略图，没有大图弹层，这里取"系统预览"这个最省事且体验标准的方式。
 */
function previewProofs(index: number): void {
  const urls = photoProofs.value.map((proof) => imageUrl(proof.objectKey))
  if (!urls.length) return
  uni.previewImage({ urls, current: index })
}

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
    // 送达照片只在已完成态需要：走**骑手端专用**的 `tasks/{id}/proofs`
    // （C 端的 `orders/{orderNo}/proofs` 按下单人校验，骑手调用会 403 —— 2026-09-17 后端要求改调）
    proofs.value = String(detail.status) === 'DELIVERED'
      ? await getTaskProofs(taskId.value).catch(() => [])
      : []
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '任务详情加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

/**
 * 「开始配送」节点（`PICKED_UP → DELIVERING`）。
 *
 * ⚠️ 设计稿没有单独的「开始配送」按钮，但后端 `/delivered` 只接受 `DELIVERING`/`NEARBY`，
 * 而任务列表的「配送中」Tab 会把 `PICKED_UP` 一起列出来 —— 不补这一步，任务会永远停在
 * `PICKED_UP`，一点送达就报「任务状态已变化，无法确认送达」。故取货后自动补一次、送达前再兜底。
 * 定位尽力而为（`NodeBody` 坐标非必填）。
 */
async function startDelivery(id: number | string): Promise<boolean> {
  try {
    const body = await collectNodeLocation(false, true)
    await startTask(id, body)
    return true
  } catch {
    return false
  }
}

/** 确认取货（定位可选）。 */
async function doPickup(): Promise<void> {
  if (acting.value || !taskId.value) return
  acting.value = true
  try {
    const body = await collectNodeLocation(false)
    await pickupTask(taskId.value, body)
    // 取货成功后立刻进入「配送中」（设计稿没有单独的「开始配送」按钮）
    await startDelivery(taskId.value)
    uni.showToast({ title: '已确认取货', icon: 'success' })
    await loadDetail()
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
    // 兜底：任务可能还停在 PICKED_UP（例如取货时自动 start 没成功），送达前补一次
    if (String(task.value?.status || '') === 'PICKED_UP') {
      const started = await startDelivery(taskId.value)
      if (!started) {
        uni.showToast({ title: '任务状态已变化，请刷新后重试', icon: 'none' })
        await loadDetail()
        return
      }
    }
    // 位置软提醒：离收货点太远先二次确认（只提醒不拦截 —— 室内定位飘移很常见）
    if (!(await confirmDeliverDistance({ latitude: task.value?.deliveryLat, longitude: task.value?.deliveryLng }))) return
    // 引导拍送达照片（可跳过；跳过之后可在本页 24h 内补传）
    const proofKeys = await captureProofImages()
    // 先静默取一次定位：拿到就带上；拿不到则二次确认后按「无定位」提交
    let body: TaskNodeBody = {}
    try {
      body = await collectNodeLocation(true, true)
    } catch {
      const goOn = await confirmDeliverWithoutLocation()
      if (!goOn) return
    }
    await deliverTask(taskId.value, body)
    uni.showToast({ title: '已确认送达', icon: 'success' })
    await loadDetail()
    // 凭证必须在**送达之后**提交（后端口径：送达后 24h 内）；失败不打断流程，延后提示以免盖掉成功 toast
    if (proofKeys.length) {
      try {
        await submitProofImages(taskId.value, proofKeys, task.value?.receiverName)
      } catch {
        setTimeout(() => uni.showToast({ title: '送达照片上传失败，可在本页补传', icon: 'none' }), 1600)
      }
    }
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

/**
 * 补传送达照片（已完成态、送达后 24h 内）：拍照/相册 → 上传 OSS → 提交 `/proof` → 重新拉凭证列表。
 * 后端按张存（一次一个 objectKey），所以多张走 submitProofImages 逐张提交。
 */
async function uploadProof(): Promise<void> {
  if (!taskId.value || uploading.value) return
  const keys = await captureProofImages()
  if (!keys.length) return
  uploading.value = true
  try {
    await submitProofImages(taskId.value, keys, task.value?.receiverName)
    uni.showToast({ title: '已上传', icon: 'success' })
    proofs.value = await getTaskProofs(taskId.value).catch(() => proofs.value)
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '照片上传失败', icon: 'none' })
  } finally {
    uploading.value = false
  }
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
        <!-- 状态卡（设计稿 05/07/10 的 Frame 117；异常态见 12：浅红头部 + 异常原因条） -->
        <view class="card">
          <!-- 异常态：特殊头部（设计稿 12 的 Frame 158/154） -->
          <template v-if="stage === 'exception'">
            <view class="exception-head">
              <image class="exception-head-bg" src="/static/rider/delivery-issue.jpg" mode="aspectFill" />
              <view class="exception-head-body">
                <view class="exception-title-row">
                  <text class="rider-icon rider-icon-jingbao exception-icon" />
                  <text class="exception-title">配送异常</text>
                </view>
                <text class="exception-tip">请尽快处理该订单</text>
              </view>
            </view>
            <view v-if="task.exceptionRemark" class="exception-reason-bar">
              <text class="exception-reason-label">异常原因：</text>
              <text class="exception-reason-text">{{ task.exceptionRemark }}</text>
            </view>
          </template>

          <!-- 常规态头部：状态图标 + 状态名 + 右侧时限 / 送达时间 -->
          <view v-else class="status-head">
            <view class="status-left" :class="stage === 'done' ? 'is-done' : stage === 'cancelled' ? 'is-cancelled' : ''">
              <text class="rider-icon status-icon" :class="headIcon" />
              <text class="status-text">{{ stageText }}</text>
            </view>
            <text v-if="headRightText" class="status-extra">{{ headRightText }}</text>
          </view>

          <!-- 收货人 + 地址（地址前带定位图标，设计稿 Frame 90） -->
          <view class="receiver-row">
            <text class="receiver-name">{{ task.receiverName || '收货人' }}</text>
            <text class="receiver-phone">{{ maskPhone(task.receiverPhone) }}</text>
          </view>
          <view class="address-row">
            <text class="rider-icon rider-icon-weizhi1 address-icon" />
            <text class="address">{{ task.deliveryAddress || '—' }}</text>
          </view>
          <text v-if="stage === 'cancelled'" class="cancelled-tip">该订单已取消，无需继续配送</text>

          <!-- 阶段指示（设计稿 Frame 104）：三个节点用交付插画 32×32 → 61rpx；异常/已取消不显示 -->
          <view v-if="stage !== 'cancelled' && stage !== 'exception'" class="stages">
            <template v-for="(node, index) in stageNodes" :key="node.key">
              <view class="stage">
                <image class="stage-image" :src="node.image" mode="aspectFit" />
                <text class="stage-text" :class="stageNodeClass(index)">{{ node.label }}</text>
              </view>
              <view v-if="index < stageNodes.length - 1" class="stage-line" />
            </template>
          </view>

          <!-- 联系客户 / 导航（异常态设计稿里没有这两个按钮） -->
          <view v-if="stage !== 'exception'" class="contact-actions">
            <button class="btn btn-ghost" @click="callCustomer"><text class="rider-icon rider-icon-dianhua btn-icon" />联系客户</button>
            <button v-if="stage !== 'cancelled'" class="btn btn-ghost" @click="navigate"><text class="rider-icon rider-icon-daohang btn-icon" />导航</button>
          </view>
        </view>

        <!-- 商品清单（设计稿 Frame 122：只展示 图 / 品名 / 规格 / ×数量，没有单价） -->
        <view class="card">
          <text class="card-title">商品清单</text>
          <view v-for="(item, index) in items" :key="index" class="goods-item">
            <image v-if="item.productImage" class="goods-image" :src="item.productImage" mode="aspectFill" />
            <view class="goods-info">
              <text class="goods-name">{{ item.productName }}</text>
              <text v-if="item.skuSpec" class="goods-spec">{{ item.skuSpec }}</text>
            </view>
            <text class="goods-qty">× {{ item.quantity }}</text>
          </view>
          <view v-if="!items.length" class="goods-empty"><text class="goods-empty-text">暂无商品明细</text></view>
        </view>

        <!-- 订单信息（设计稿 Frame 121：标签 15px 灰 + 值 15px 深色 + 行底分割线；行随状态变化） -->
        <view class="card">
          <text class="card-title">订单信息</text>
          <view class="info-row">
            <text class="info-label">订单编号</text>
            <view class="info-value-row">
              <text class="info-short-no">{{ shortNoFromTask }}</text>
              <text class="info-value">{{ task.orderNo || '—' }}</text>
              <text class="rider-icon rider-icon-fuzhi info-copy" @click="copyOrderNo" />
            </view>
          </view>
          <view class="info-row"><text class="info-label">下单时间</text><text class="info-value">{{ formatDateTime(task.createTime) }}</text></view>
          <view v-if="task.pickedUpAt" class="info-row"><text class="info-label">取货时间</text><text class="info-value">{{ formatDateTime(task.pickedUpAt) }}</text></view>
          <view v-if="stage === 'done'" class="info-row"><text class="info-label">配送时长</text><text class="info-value">{{ deliveryDurationText }}</text></view>
          <view v-if="stage === 'done'" class="info-row"><text class="info-label">配送距离</text><text class="info-value">{{ distanceText }}</text></view>
          <view v-if="stage === 'done'" class="info-row"><text class="info-label">送达时间</text><text class="info-value">{{ formatDateTime(task.deliveredAt) }}</text></view>
          <!-- 送达照片（设计稿 10 的「送达照片」行：56×56 缩略图，点击用系统图片预览看大图） -->
          <view v-if="stage === 'done'" class="info-row">
            <text class="info-label">送达照片</text>
            <view class="proof-row">
              <image
                v-for="(proof, index) in photoProofs"
                :key="index"
                class="proof-image"
                :src="imageUrl(proof.objectKey)"
                mode="aspectFill"
                @click="previewProofs(index)"
              />
              <!-- 补传入口：设计稿没画，但后端 /proof 允许「送达后 24h 内」补传，所以补一个「＋」方块 -->
              <view v-if="canUploadProof" class="proof-add" @click="uploadProof">
                <text class="proof-add-icon">{{ uploading ? '…' : '＋' }}</text>
              </view>
              <text v-if="!photoProofs.length && !canUploadProof" class="info-value">无</text>
            </view>
          </view>
          <view v-if="stage === 'exception'" class="info-row"><text class="info-label">异常类型</text><text class="info-value">{{ exceptionTypeText }}</text></view>
          <!-- ⚠️ 备注（用户留言）设计稿有、后端 RiderTaskVO 暂无该字段，先按空值显示，等后端补 remark 字段 -->
          <view class="info-row"><text class="info-label">备注</text><text class="info-value">{{ task.remark || '无' }}</text></view>
        </view>
      </template>
    </scroll-view>

    <!-- 底部动作（设计稿：待取货 = 确认取货；配送中 = 上报异常 + 确认送达；已完成/异常/已取消无底部条） -->
    <view v-if="task && (canPickup || canDeliver)" class="footer">
      <template v-if="canPickup">
        <button class="btn btn-primary btn-block" :disabled="acting" @click="doPickup">确认取货</button>
      </template>
      <template v-else-if="canDeliver">
        <button class="btn btn-danger-ghost" style="flex: 136" @click="exceptionVisible = true"><text class="rider-icon rider-icon-jingbao btn-icon" />上报异常</button>
        <button class="btn btn-primary" style="flex: 222" :disabled="acting" @click="doDeliver">确认送达</button>
      </template>
    </view>

    <!-- 上报异常弹层（设计稿 08 的 Frame 141/142：居中卡片 + 异常原因 + 上传图片 + 提交） -->
    <view v-if="exceptionVisible" class="mask" @click="exceptionVisible = false">
      <view class="sheet" @click.stop>
        <view class="sheet-head">
          <text class="rider-icon rider-icon-jingbao sheet-icon" />
          <text class="sheet-title">上报异常</text>
        </view>

        <!-- 异常类型（后端必填；设计稿只画了"异常原因"，这里补一行下拉） -->
        <view class="sheet-field">
          <text class="sheet-label">异常类型 <text class="required">*</text></text>
          <picker :range="EXCEPTION_TYPES.map((item) => item.label)" @change="onExceptionTypeChange">
            <view class="sheet-picker">{{ EXCEPTION_TYPES.find((item) => item.value === exceptionType)?.label || '请选择' }}</view>
          </picker>
        </view>

        <view class="sheet-field">
          <text class="sheet-label">异常原因 <text class="required">*</text></text>
          <textarea v-model="exceptionRemark" class="sheet-input" :maxlength="200" placeholder="请描述异常情况，例如：联系不上用户" />
        </view>

        <view class="sheet-field">
          <text class="sheet-label">上传图片</text>
          <view class="sheet-images">
            <image v-for="(key, index) in exceptionImages" :key="index" class="sheet-image" :src="imageUrl(key)" mode="aspectFill" />
            <view class="sheet-add" @click="chooseExceptionImages">
              <text v-if="uploading" class="sheet-add-text">上传中</text>
              <text v-else class="rider-icon rider-icon-tianjia sheet-add-icon" />
            </view>
          </view>
        </view>

        <button class="sheet-submit" :disabled="acting || uploading" @click="submitException">{{ uploading ? '上传中…' : '提交' }}</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; background: #f2f3f7; }
.nav { position: fixed; top: 0; right: 0; left: 0; z-index: 30; background: #f2f3f7; }
.nav-inner { position: relative; display: flex; align-items: center; justify-content: center; height: 44px; }
.nav-back { position: absolute; left: 24rpx; color: #1d2129; font-size: 46rpx; line-height: 1;
  top: auto;
  bottom: 0;
  display: flex;
  height: 88rpx;
  align-items: center;
}
.nav-title { color: #1d2129; font-size: 33rpx; font-weight: 600; }
.body { flex: 1; min-height: 0; padding: 16rpx 16rpx 160rpx; box-sizing: border-box; }
.state { padding: 160rpx 0; color: #86909c; font-size: 28rpx; text-align: center; }
.card { margin-bottom: 24rpx; padding: 24rpx; border-radius: 24rpx; background: #fff; }
.card-title { display: block; margin-bottom: 16rpx; color: #000; font-size: 31rpx; font-weight: 500; }

/* ===== 状态卡头部（设计稿 05/07/10 的 Frame 82）===== */
.status-head { display: flex; align-items: center; justify-content: space-between; }
.status-left { display: flex; align-items: center; color: #ff7d00; }
.status-left.is-done { color: #00b42a; }
.status-left.is-cancelled { color: #86909c; }
.status-icon { margin-right: 8rpx; font-size: 38rpx; }
.status-text { font-size: 31rpx; font-weight: 600; }
.status-extra { color: #ff7d00; font-size: 31rpx; font-weight: 600; }
/* 按钮内图标（iconfont，16px → 31rpx） */
.btn-icon { margin-right: 8rpx; font-size: 31rpx; }

/* ===== 异常态头部（设计稿 12 的 Frame 158 + 异常原因条 Frame 154）===== */
.exception-head { position: relative; overflow: hidden; border-radius: 16rpx; }
.exception-head-bg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
.exception-head-body { position: relative; padding: 24rpx; }
.exception-title-row { display: flex; align-items: center; }
.exception-icon { margin-right: 8rpx; color: #f53f3f; font-size: 31rpx; }
.exception-title { color: #f53f3f; font-size: 27rpx; font-weight: 600; }
.exception-tip { display: block; margin-top: 6rpx; margin-left: 39rpx; color: #86909c; font-size: 23rpx; }
.exception-reason-bar { display: flex; align-items: flex-start; margin: 20rpx -24rpx -24rpx; padding: 16rpx 24rpx; background: #ffeded; }
.exception-reason-label { flex-shrink: 0; color: #f53f3f; font-size: 27rpx; }
.exception-reason-text { flex: 1; color: #1d2129; font-size: 27rpx; }

/* ===== 收货人 / 地址 ===== */
.receiver-row { display: flex; align-items: center; margin-top: 24rpx; }
.receiver-name { color: #1d2129; font-size: 35rpx; font-weight: 600; }
.receiver-phone { margin-left: 23rpx; color: #1d2129; font-size: 35rpx; }
.address-row { display: flex; align-items: flex-start; margin-top: 10rpx; }
.address-icon { flex-shrink: 0; margin-right: 8rpx; color: #86909c; font-size: 31rpx; }
.address { flex: 1; color: #86909c; font-size: 27rpx; line-height: 38rpx; }
.cancelled-tip { display: block; margin-top: 12rpx; color: #86909c; font-size: 27rpx; }

/* ===== 阶段指示（设计稿 Frame 104：插画 32×32 → 61rpx，连线 105px → 202rpx）===== */
.stages { display: flex; align-items: center; margin-top: 28rpx; }
.stage { display: flex; width: 69rpx; flex-direction: column; align-items: center; }
.stage-image { width: 61rpx; height: 61rpx; }
.stage-text { margin-top: 6rpx; color: #86909c; font-size: 23rpx; }
.stage-text.is-current { color: #ff5500; }
.stage-text.is-passed { color: #1d2129; }
.stage-line { flex: 1; height: 2rpx; background: #e5e6eb; }

.contact-actions { display: flex; gap: 16rpx; margin-top: 28rpx; }

/* ===== 商品清单（设计稿 Frame 122：行高 44px→85rpx、图 44×44、品名 13px、规格/数量 12px、行间距 12px→23rpx）===== */
.goods-item { display: flex; align-items: center; margin-bottom: 23rpx; }
.goods-item:last-child { margin-bottom: 0; }
.goods-image { width: 85rpx; height: 85rpx; flex-shrink: 0; border-radius: 12rpx; background: #f2f3f7; }
.goods-info { flex: 1; min-width: 0; margin-left: 16rpx; }
.goods-name { display: block; overflow: hidden; color: #1d2129; font-size: 25rpx; font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.goods-spec { display: block; margin-top: 4rpx; color: #86909c; font-size: 23rpx; }
.goods-qty { flex-shrink: 0; margin-left: 16rpx; color: #4e5969; font-size: 23rpx; }
.goods-empty { padding: 24rpx 0; text-align: center; }
.goods-empty-text { color: #86909c; font-size: 24rpx; }

/* ===== 订单信息（设计稿 Frame 121：行高 56px→108rpx、标签 15px 灰、值 15px 深色、行底分割线）=====
   用 min-height 而非固定高度：备注/地址这类长值可能要换行，固定高会截断 */
.info-row { display: flex; align-items: center; min-height: 108rpx; padding: 16rpx 0; border-bottom: 1rpx solid #f2f3f7; }
.info-row:last-child { border-bottom: 0; }
.info-label { flex-shrink: 0; width: 140rpx; color: #86909c; font-size: 29rpx; }
.info-value-row { display: flex; flex: 1; align-items: center; }
.info-short-no { margin-right: 12rpx; color: #ff7d00; font-size: 29rpx; }
.info-value { flex: 1; color: #1d2129; font-size: 29rpx; word-break: break-all; }
.info-copy { flex-shrink: 0; margin-left: 12rpx; color: #1d2129; font-size: 31rpx; }
/* 送达照片缩略图（设计 56×56 → 108rpx；点击用系统图片预览看大图） */
.proof-row { display: flex; flex: 1; flex-wrap: wrap; gap: 12rpx; }
.proof-image { width: 108rpx; height: 108rpx; border-radius: 12rpx; background: #f2f3f7; }
/* 补传入口方块（与缩略图同尺寸；灰底 + 加号，设计稿未画、按后端 24h 补传能力补的） */
.proof-add { display: flex; align-items: center; justify-content: center; width: 108rpx; height: 108rpx; border-radius: 12rpx; background: #f6f7f9; }
.proof-add-icon { color: #86909c; font-size: 44rpx; line-height: 1; }

/* ===== 底部动作（按钮高 48px → 92rpx、圆角 12px → 24rpx）===== */
.footer { position: fixed; right: 0; bottom: 0; left: 0; display: flex; gap: 16rpx; padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom)); background: #fff; }
.btn { flex: 1; height: 92rpx; margin: 0; padding: 0 8rpx; border-radius: 24rpx; font-size: 31rpx; line-height: 92rpx; white-space: nowrap; }
.btn::after { border: 0; }
.btn-block { flex: none; width: 100%; }
.btn-primary { color: #fff; background: #ff5500; }
.btn-primary[disabled] { opacity: .6; }
.btn-ghost { color: #1d2129; background: #f6f7f9; }
/* 「上报异常」按钮（设计稿 #FFEDED 底 + 红字） */
.btn-danger-ghost { color: #f53f3f; background: #ffeded; }

/* ===== 上报异常弹层（设计稿 08：居中卡片 326×412、圆角 16px）===== */
.mask { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 40; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .5); }
.sheet { width: 626rpx; padding: 32rpx; box-sizing: border-box; border-radius: 31rpx; background: #fff; }
.sheet-head { display: flex; align-items: center; margin-bottom: 32rpx; }
.sheet-icon { margin-right: 8rpx; color: #f53f3f; font-size: 38rpx; }
.sheet-title { color: #f53f3f; font-size: 31rpx; font-weight: 500; }
.sheet-field { margin-bottom: 28rpx; }
.sheet-label { display: block; margin-bottom: 12rpx; color: #1d2129; font-size: 27rpx; font-weight: 500; }
.required { color: #f53f3f; }
.sheet-picker { padding: 20rpx 24rpx; border-radius: 15rpx; background: #f6f7f9; color: #1d2129; font-size: 27rpx; }
.sheet-input { width: 100%; height: 138rpx; padding: 20rpx; box-sizing: border-box; border-radius: 15rpx; background: #f6f7f9; color: #1d2129; font-size: 27rpx; }
.sheet-images { display: flex; align-items: center; gap: 16rpx; }
.sheet-image { width: 185rpx; height: 185rpx; border-radius: 15rpx; background: #f2f3f7; }
.sheet-add { display: flex; align-items: center; justify-content: center; width: 185rpx; height: 185rpx; border-radius: 15rpx; background: #f6f7f9; }
.sheet-add-icon { color: #86909c; font-size: 46rpx; }
.sheet-add-text { color: #86909c; font-size: 24rpx; }
.sheet-submit { margin-top: 8rpx; border-radius: 24rpx; background: #fff4e8; color: #ff5500; font-size: 31rpx; font-weight: 600; line-height: 92rpx; }
.sheet-submit::after { border: 0; }
.sheet-submit[disabled] { opacity: .6; }
</style>
