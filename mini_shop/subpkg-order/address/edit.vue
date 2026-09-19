<script setup lang="ts">
/**
 * 配送地址编辑（**独立页面**）
 *
 * 为什么从「弹层」改成独立页面（2026-09-19 用户要求，弹层方案确实别扭）：
 * 1. 弹层里塞省市区选择器 + 定位 + 地图选点，空间不够，说明文字还会被挤到表单下方；
 * 2. 独立页面可以正常调用定位能力：`getLocation` 自动填省市区、`chooseLocation` 地图选点拿**精确坐标**；
 * 3. 同城配送下单**必须带收货坐标**（否则距离算成 0），所以这里把「拿到经纬度」当一等目标。
 *
 * 与确认订单页的数据传递：写 storage（`ADDRESS_DRAFT_KEY`），返回后由该页读取并清空。
 */
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { ADDRESS_DRAFT_KEY } from '@/api/order'
import { validateMobile, validateText } from '@/utils/input-validation'

interface AddressDraft {
  name: string
  phone: string
  detail: string
  province: string
  city: string
  district: string
  latitude?: number
  longitude?: number
}

const statusBarHeight = ref(0)
const form = reactive<AddressDraft>({ name: '', phone: '', detail: '', province: '', city: '', district: '' })
/** 是否正在定位（只驱动按钮文案）。 */
const locating = ref(false)
/** 是否已经拿到坐标（用于给「地图选点」按钮加一个已选中的态，不再写说明文字）。 */
const hasCoordinate = computed(() => form.latitude != null && form.longitude != null)

const regionValue = computed(() => [form.province, form.city, form.district].filter(Boolean))
const regionText = computed(() => (regionValue.value.length === 3 ? regionValue.value.join(' ') : '请选择所在地区'))

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  // 带入确认订单页当前地址（编辑而不是新建）
  try {
    const draft = uni.getStorageSync(ADDRESS_DRAFT_KEY) as AddressDraft | ''
    if (draft && typeof draft === 'object') Object.assign(form, draft)
  } catch { /* 忽略 */ }
  void locate()
})

/**
 * 自动定位：填省市区（**不覆盖已填**）+ 记录经纬度。
 * 失败静默 —— 用户还可以手选省市区、或点「地图选点」，不因为定位失败卡住。
 */
async function locate(): Promise<void> {
  locating.value = true
  try {
    const res = await new Promise<{ latitude: number; longitude: number; address?: Record<string, string> }>((resolve, reject) => {
      uni.getLocation({
        type: 'gcj02',
        geocode: true,
        success: (r) => resolve(r as unknown as { latitude: number; longitude: number; address?: Record<string, string> }),
        fail: () => reject(new Error('定位失败')),
      })
    })
    form.latitude = Number(res.latitude)
    form.longitude = Number(res.longitude)
    const addr = res.address || {}
    if (!form.province && addr.province) form.province = String(addr.province)
    if (!form.city && addr.city) form.city = String(addr.city)
    if (!form.district && addr.district) form.district = String(addr.district)
  } catch {
    // 静默降级：省市区手选 / 地图选点
  } finally {
    locating.value = false
  }
}

/**
 * 地图选点：拿到**精确坐标**与地址文本。
 * 同城配送的距离就是靠这个坐标算的 —— 自动定位只到「省市区」精度，选点才够准。
 */
function pickOnMap(): void {
  uni.chooseLocation({
    success: (res) => {
      form.latitude = Number(res.latitude)
      form.longitude = Number(res.longitude)
      const detail = String(res.address || res.name || '').trim()
      if (detail) form.detail = detail
    },
    fail: () => { /* 用户取消，不打扰 */ },
  })
}

/** 省市区三级联动。 */
function onRegionChange(event: { detail?: { value?: string[] } }): void {
  const [province = '', city = '', district = ''] = event?.detail?.value || []
  form.province = province
  form.city = city
  form.district = district
}

/** 保存：校验 → 写草稿 → 返回确认订单页。 */
function save(): void {
  const name = validateText(form.name, { label: '收货人姓名', maxLength: 32 })
  if (!name.ok) { uni.showToast({ title: name.message, icon: 'none' }); return }
  const phone = validateMobile(form.phone)
  if (!phone.ok) { uni.showToast({ title: phone.message, icon: 'none' }); return }
  const detail = validateText(form.detail, { label: '详细地址', maxLength: 200 })
  if (!detail.ok) { uni.showToast({ title: detail.message, icon: 'none' }); return }
  if (regionValue.value.length !== 3) { uni.showToast({ title: '请选择所在地区', icon: 'none' }); return }
  const draft: AddressDraft = { ...form, name: name.value, phone: phone.value, detail: detail.value }
  try { uni.setStorageSync(ADDRESS_DRAFT_KEY, draft) } catch { /* 忽略 */ }
  uni.navigateBack()
}

function goBack(): void {
  uni.navigateBack()
}
</script>

<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">配送地址</text>
      </view>
    </view>

    <scroll-view class="content" scroll-y>
      <!-- 定位 / 地图选点：做成一张显眼的操作卡，而不是藏在表单下面的说明文字 -->
      <view class="locate-card" @click="pickOnMap">
        <view class="locate-icon">📍</view>
        <view class="locate-text">
          <text class="locate-title">{{ hasCoordinate ? '已定位，可在地图上微调' : (locating ? '正在定位…' : '点击地图选点') }}</text>
          <text class="locate-sub">选点后配送距离更准确，也可手动填写下方地址</text>
        </view>
        <text class="locate-arrow">›</text>
      </view>

      <view class="card">
        <view class="row">
          <text class="label">所在地区<i class="req">*</i></text>
          <picker mode="region" :value="regionValue" class="picker" @change="onRegionChange">
            <text :class="regionValue.length === 3 ? 'picker-value' : 'picker-placeholder'">{{ regionText }}</text>
          </picker>
        </view>
        <view class="row">
          <text class="label">详细地址<i class="req">*</i></text>
          <input v-model="form.detail" class="input" maxlength="200" placeholder="街道、门牌号等" placeholder-class="ph" />
        </view>
        <view class="row">
          <text class="label">姓名<i class="req">*</i></text>
          <input v-model="form.name" class="input" maxlength="32" placeholder="请输入" placeholder-class="ph" />
        </view>
        <view class="row">
          <text class="label">手机号<i class="req">*</i></text>
          <input v-model="form.phone" class="input" type="number" maxlength="11" placeholder="请输入" placeholder-class="ph" />
        </view>
      </view>

      <view class="tip">同城配送需要精确到门牌，建议用上方「地图选点」自动带出坐标。</view>
      <view class="bottom-space" />
    </scroll-view>

    <view class="footer">
      <view class="save" @click="save">保存地址</view>
    </view>
  </view>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; background: #f2f3f7; }
.nav { background: #ffffff; }
.nav-inner { position: relative; display: flex; align-items: center; justify-content: center; height: 88rpx; }
.nav-back { position: absolute; left: 24rpx; color: #1d2129; font-size: 52rpx; line-height: 1; }
.nav-title { color: #1d2129; font-size: 33rpx; font-weight: 600; }
.content { flex: 1; min-height: 0; padding: 23rpx; box-sizing: border-box; }

.locate-card { display: flex; align-items: center; padding: 28rpx 23rpx; border-radius: 16rpx; background: #fff4e8; }
.locate-icon { margin-right: 18rpx; font-size: 36rpx; }
.locate-text { flex: 1; min-width: 0; }
.locate-title { display: block; color: #ff5500; font-size: 28rpx; font-weight: 600; }
.locate-sub { display: block; margin-top: 6rpx; color: #86909c; font-size: 23rpx; }
.locate-arrow { color: #ff5500; font-size: 36rpx; line-height: 1; }

.card { margin-top: 23rpx; border-radius: 16rpx; background: #ffffff; overflow: hidden; }
.row { display: flex; align-items: center; min-height: 100rpx; padding: 0 23rpx; border-bottom: 1rpx solid #f2f3f7; }
.row:last-child { border-bottom: none; }
.label { flex-shrink: 0; width: 160rpx; color: #1d2129; font-size: 28rpx; }
.req { margin-left: 4rpx; color: #f53f3f; font-style: normal; }
.input { flex: 1; min-width: 0; color: #1d2129; font-size: 28rpx; }
.picker { flex: 1; min-width: 0; }
.picker-value { color: #1d2129; font-size: 28rpx; }
.picker-placeholder { color: #c9cdd4; font-size: 28rpx; }
.ph { color: #c9cdd4; }
.tip { margin: 20rpx 8rpx 0; color: #86909c; font-size: 23rpx; line-height: 34rpx; }
.bottom-space { height: 40rpx; }

.footer { flex-shrink: 0; padding: 16rpx 23rpx calc(16rpx + env(safe-area-inset-bottom)); background: #ffffff; }
.save { display: flex; align-items: center; justify-content: center; height: 88rpx; border-radius: 16rpx; color: #ffffff; background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%); font-size: 31rpx; font-weight: 600; }
</style>
