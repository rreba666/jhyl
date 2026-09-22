<script setup lang="ts">
/**
 * 配送地址编辑（**独立页面**）
 *
 * 为什么从「弹层」改成独立页面（2026-09-19 用户要求，弹层方案确实别扭）：
 * 1. 弹层里塞省市区选择器 + 定位 + 地图选点，空间不够，说明文字还会被挤到表单下方；
 * 2. 独立页面可以正常调用定位能力：`getLocation` 自动填省市区、`chooseLocation` 地图选点拿**精确坐标**；
 * 3. 同城配送下单**必须带收货坐标**（否则距离算成 0），所以这里把「拿到经纬度」当一等目标。
 *
 * 2026-09-22 起本页承接**两种模式**（`onLoad` 查询参数区分）：
 * - `mode=book`（默认，地址簿管理）：新增 / 修改都直接写后端 `收货地址簿` 接口，
 *   保存成功后返回地址列表页（列表页 `onShow` 会自行重拉）；
 * - `mode=payment`（确认订单页）：沿用原有「写 storage 草稿 → 返回后由确认订单页读回」的方式，
 *   额外提供「从地址簿选择」入口，用户不必每次手打。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import {
  ADDRESS_DRAFT_KEY,
  ADDRESS_SELECTED_EVENT,
  addAddress,
  getAddressList,
  removeAddress,
  updateAddress,
  type AddressEntity,
} from '@/api/address'
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

/** 编辑/新增的地址 ID：0 = 新增（地址簿模式）。 */
const addressId = ref(0)
/** 当前模式：book=地址簿增改（直连后端），payment=确认订单页草稿。 */
const pageMode = ref<'book' | 'payment'>('book')
const statusBarHeight = ref(0)
const form = reactive<AddressDraft>({ name: '', phone: '', detail: '', province: '', city: '', district: '' })
/** 是否正在定位（只驱动按钮文案）。 */
const locating = ref(false)
/** 是否正在提交（新增/修改/删除共用，避免重复提交）。 */
const saving = ref(false)
/** 新增模式下，地址簿里是否还没有任何地址（第一个地址后端会自动设为默认，用于文案提示）。 */
const bookEmpty = ref(false)
/** 是否已经拿到坐标（用于给「地图选点」按钮加一个已选中的态，不再写说明文字）。 */
const hasCoordinate = computed(() => form.latitude != null && form.longitude != null)

const regionValue = computed(() => [form.province, form.city, form.district].filter(Boolean))
const regionText = computed(() => (regionValue.value.length === 3 ? regionValue.value.join(' ') : '请选择所在地区'))
/** 标题：新增还是修改。 */
const navTitle = computed(() => (addressId.value ? '编辑收货地址' : '新增收货地址'))

onLoad((options) => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  const query = (options || {}) as Record<string, unknown>
  pageMode.value = String(query.mode || '') === 'payment' ? 'payment' : 'book'
  const id = Number(query.id || 0)
  if (Number.isSafeInteger(id) && id > 0) addressId.value = id
  void initForm()
})

/** 进入页面时初始化表单：地址簿模式按 id 回填，支付模式读草稿。 */
async function initForm(): Promise<void> {
  if (pageMode.value === 'payment') {
    // 带入确认订单页当前地址（编辑而不是新建）
    try {
      const draft = uni.getStorageSync(ADDRESS_DRAFT_KEY) as AddressDraft | ''
      if (draft && typeof draft === 'object') Object.assign(form, draft)
    } catch { /* 忽略 */ }
    void locate()
    return
  }
  // 地址簿模式：首次进入就开始定位，先用定位结果填省市区，用户可改
  if (addressId.value) await loadBookAddress(addressId.value)
  else await refreshBookEmpty()
  void locate()
}

/** 地址簿模式：拉列表找到这条地址并回填表单（列表接口没有单条查询，按 id 匹配即可）。 */
async function loadBookAddress(id: number): Promise<void> {
  try {
    const list = await getAddressList()
    const target = (list || []).find((item) => Number(item.id) === id)
    if (target) fillFromEntity(target)
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '地址加载失败', icon: 'none' })
  }
}

/** 地址簿模式：判断当前是否还没有任何地址（第一个地址会自动成为默认地址）。 */
async function refreshBookEmpty(): Promise<void> {
  try {
    bookEmpty.value = (await getAddressList() || []).length === 0
  } catch {
    bookEmpty.value = false
  }
}

/** 把后端地址实体写进表单字段（后端字段名与表单字段名不同，必须显式映射）。 */
function fillFromEntity(address: AddressEntity): void {
  form.name = address.receiverName || ''
  form.phone = address.receiverPhone || ''
  form.detail = address.detail || ''
  form.province = address.province || ''
  form.city = address.city || ''
  form.district = address.district || ''
}

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
 * 从地图选点返回的地址串里拆出「省 / 市 / 区」。
 *
 * 为什么需要：`chooseLocation` 返回的 `address` 是「江西省九江市柴桑区水葵路」这样一整串，
 * 原来直接把它塞进「详细地址」→ 和「所在地区」完全重复（2026-09-22 真机截图反馈），
 * 而「所在地区」又一直空着。这里把省市区拆出来填联动选择器，剩下的街道部分才留给详细地址。
 */
function parseRegion(text: string): { province: string; city: string; district: string; rest: string } | null {
  const raw = String(text || '').trim()
  if (!raw) return null
  // 普通省份：江西省 / 广西壮族自治区 / 内蒙古自治区…
  const normal = raw.match(/^(.{2,10}?(?:省|自治区|特别行政区))(.{2,12}?(?:市|自治州|地区|盟))(.{2,12}?(?:区|县|旗|市))(.*)$/)
  if (normal) return { province: normal[1], city: normal[2], district: normal[3], rest: normal[4] || '' }
  // 直辖市：北京市朝阳区…（省市同名，选择器里两级都填「北京市」）
  const municipality = raw.match(/^(北京市|上海市|天津市|重庆市)(.{2,12}?(?:区|县))?(.*)$/)
  if (municipality) return { province: municipality[1], city: municipality[1], district: municipality[2] || '', rest: municipality[3] || '' }
  return null
}

/**
 * 地图选点：拿到**精确坐标**与地址文本。
 * 同城配送的距离就是靠这个坐标算的 —— 自动定位只到「省市区」精度，选点才够准。
 *
 * ⚠️ 2026-09-22 修：选点后要把省市区回填到「所在地区」，
 * 详细地址只用**选点名称**（如「XX小区」）或剥掉省市区后的街道部分 —— 见 parseRegion。
 */
function pickOnMap(): void {
  uni.chooseLocation({
    success: (res) => {
      form.latitude = Number(res.latitude)
      form.longitude = Number(res.longitude)
      const address = String(res.address || '').trim()
      const pointName = String(res.name || '').trim()
      const parsed = parseRegion(address)
      if (parsed) {
        if (!form.province) form.province = parsed.province
        if (!form.city) form.city = parsed.city
        if (!form.district) form.district = parsed.district
      }
      const detail = pointName || (parsed ? parsed.rest : address)
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

/** 统一校验表单，返回清理后的字段；不通过时弹提示并返回 null。 */
function validateForm(): { name: string; phone: string; detail: string } | null {
  const name = validateText(form.name, { label: '收货人姓名', maxLength: 32 })
  if (!name.ok) { uni.showToast({ title: name.message, icon: 'none' }); return null }
  const phone = validateMobile(form.phone)
  if (!phone.ok) { uni.showToast({ title: phone.message, icon: 'none' }); return null }
  const detail = validateText(form.detail, { label: '详细地址', maxLength: 200 })
  if (!detail.ok) { uni.showToast({ title: detail.message, icon: 'none' }); return null }
  if (regionValue.value.length !== 3) { uni.showToast({ title: '请选择所在地区', icon: 'none' }); return null }
  return { name: name.value, phone: phone.value, detail: detail.value }
}

/** 保存：校验 → 按模式落库（地址簿）或写草稿（确认订单页）→ 返回。 */
async function save(): Promise<void> {
  if (saving.value) return
  const fields = validateForm()
  if (!fields) return

  if (pageMode.value === 'payment') {
    const draft: AddressDraft = { ...form, ...fields }
    try { uni.setStorageSync(ADDRESS_DRAFT_KEY, draft) } catch { /* 忽略 */ }
    uni.navigateBack()
    return
  }

  saving.value = true
  try {
    const payload = {
      receiverName: fields.name,
      receiverPhone: fields.phone,
      province: form.province,
      city: form.city,
      district: form.district,
      detail: fields.detail,
      // 地址簿为空时后端本来就会把第一条设为默认；显式传 1 让语义更明确
      ...(bookEmpty.value && !addressId.value ? { isDefault: 1 } : {}),
    }
    if (addressId.value) await updateAddress(addressId.value, payload)
    else await addAddress(payload)
    uni.showToast({ title: addressId.value ? '地址已更新' : '地址已添加', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 400)
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '地址保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

/** 删除当前地址（仅在地址簿模式且是已有地址时可用）。 */
function confirmRemove(): void {
  if (saving.value || !addressId.value) return
  uni.showModal({
    title: '删除地址',
    content: '确定删除这条收货地址吗？',
    confirmText: '删除',
    confirmColor: '#e34d59',
    success: (result) => { if (result.confirm) void doRemove() },
  })
}

/** 执行删除并返回列表页。 */
async function doRemove(): Promise<void> {
  saving.value = true
  try {
    await removeAddress(addressId.value)
    uni.showToast({ title: '地址已删除', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 400)
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '删除失败，请重试', icon: 'none' })
  } finally {
    saving.value = false
  }
}

/** 进入地址簿选择页，选中后由事件回填本表单（仅确认订单页入口展示这个按钮）。 */
function goAddressBook(): void {
  uni.navigateTo({ url: '/subpkg-order/address/list?mode=select' })
}

/** 地址簿选择回填：把选中的地址写进当前表单（用户可继续微调）。 */
function onAddressPicked(payload: unknown): void {
  const picked = payload as { address?: AddressEntity } | undefined
  if (!picked?.address) return
  fillFromEntity(picked.address)
}

onMounted(() => {
  // 只有确认订单页入口需要监听地址簿回传，管理入口不注册，避免无意义回调
  if (pageMode.value === 'payment') uni.$on(ADDRESS_SELECTED_EVENT, onAddressPicked)
})

onUnload(() => {
  uni.$off(ADDRESS_SELECTED_EVENT, onAddressPicked)
})

function goBack(): void {
  uni.navigateBack()
}
</script>

<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">{{ navTitle }}</text>
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

      <!-- 确认订单页入口：提供从地址簿一键带入，省去重复手打 -->
      <view v-if="pageMode === 'payment'" class="book-entry" @click="goAddressBook">
        <text class="book-entry-label">从收货地址簿选择</text>
        <text class="book-entry-arrow">›</text>
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
      <!-- 地址簿模式且是已有地址：提供删除 -->
      <view v-if="pageMode === 'book' && addressId" class="remove" @click="confirmRemove">删除该地址</view>
      <view class="bottom-space" />
    </scroll-view>

    <view class="footer">
      <view class="save" :class="{ 'save-disabled': saving }" @click="save">{{ saving ? '保存中…' : '保存地址' }}</view>
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

/* 从地址簿带入：确认订单页入口专用 */
.book-entry { display: flex; align-items: center; justify-content: space-between; margin-top: 20rpx; padding: 26rpx 23rpx; border-radius: 16rpx; background: #ffffff; }
.book-entry-label { color: #1d2129; font-size: 28rpx; }
.book-entry-arrow { color: #c9cdd4; font-size: 34rpx; line-height: 1; }

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
.remove { margin: 28rpx 0 0; padding: 26rpx 0; border-radius: 16rpx; background: #ffffff; color: #e34d59; font-size: 28rpx; text-align: center; }
.bottom-space { height: 40rpx; }

.footer { flex-shrink: 0; padding: 16rpx 23rpx calc(16rpx + env(safe-area-inset-bottom)); background: #ffffff; }
.save { display: flex; align-items: center; justify-content: center; height: 88rpx; border-radius: 16rpx; color: #ffffff; background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%); font-size: 31rpx; font-weight: 600; }
.save-disabled { opacity: .6; }
</style>
