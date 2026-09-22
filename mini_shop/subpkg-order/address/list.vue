<script setup lang="ts">
/**
 * 收货地址簿管理（**独立页面**，C 端真实接口）
 *
 * 背景：`pages/settings/settings.vue` 里「收货地址」原先写的是「地址簿管理（待开通）」。
 * 2026-09-22 核对 `api_doc.json`：tag「收货地址簿」下 C 端接口**齐全**
 * （`/api/user/address/list` · `POST /api/user/address` · `PUT|DELETE /api/user/address/{id}` ·
 * `PUT /api/user/address/{id}/default`），所以这里把它接上，不再显示"待开通"。
 *
 * 两个入口复用同一个页面（用 `mode` 查询参数区分）：
 * - `mode=manage`：设置页进入，纯管理（新增 / 编辑 / 删除 / 设为默认）；
 * - `mode=select`：确认订单页的地址编辑页进入，点一条地址即回传并返回上一页；
 * - 不带参数 = manage。
 *
 * 回传协议（`select` 模式）：
 * 1. `uni.$emit(ADDRESS_SELECTED_EVENT, { address, text })` —— 页面栈里的**下层页面**监听这个事件落库；
 * 2. `uni.$emit(ADDRESS_SELECTED_DONE_EVENT)` —— `navigateBack` 完成后广播，供监听方弹提示。
 * 两步分开是为了避免「提示 toast 在返回动画前就被页面切换吞掉」。
 */
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  ADDRESS_DRAFT_KEY,
  ADDRESS_SELECTED_DONE_EVENT,
  ADDRESS_SELECTED_EVENT,
  formatAddressText,
  getAddressList,
  removeAddress,
  setDefaultAddress,
  type AddressEntity,
} from '@/api/address'
import { isLoggedIn } from '@/utils/auth'
import { createThrottle } from '@/utils/interaction'
import { isApiRequestError } from '@/utils/request'

const statusBarHeight = ref(0)
/** 页面模式：manage=纯管理，select=选择地址后回传。 */
const mode = ref<'manage' | 'select'>('manage')
const addresses = ref<AddressEntity[]>([])
const loading = ref(false)
/** 首次加载失败的错误文案（非空时展示重试入口，不展示"暂无地址"）。 */
const loadError = ref('')
/** 是否有操作正在提交（删除 / 设为默认），提交期间禁用整列操作，避免重复点击。 */
const submitting = ref(false)
const navigationThrottle = createThrottle(500)

/** 是否处于"选择地址"模式（决定点击一行是回传还是进编辑）。 */
const selecting = () => mode.value === 'select'

onLoad((options) => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  // 只有显式传 select 才进入选择模式，避免后端/分享链接带入未知值时误判
  mode.value = String((options as Record<string, unknown> | undefined)?.mode || '') === 'select' ? 'select' : 'manage'
})

// 从编辑页返回后要看到最新数据，因此用 onShow 拉取（onLoad 只执行一次）
onShow(() => { void loadAddresses() })

/** 加载地址簿；失败时保留错误文案并给出重试按钮。 */
async function loadAddresses(): Promise<void> {
  if (!isLoggedIn()) {
    addresses.value = []
    loadError.value = '登录后即可管理收货地址'
    return
  }
  loading.value = true
  try {
    const list = await getAddressList()
    // 后端按「默认地址在前」返回，这里再兜底排一次，避免后端顺序变动后默认地址跑到中间
    addresses.value = [...(list || [])].sort((a, b) => Number(b.isDefault || 0) - Number(a.isDefault || 0))
    loadError.value = ''
  } catch (error) {
    addresses.value = []
    loadError.value = error instanceof Error ? error.message : '地址加载失败，请重试'
  } finally {
    loading.value = false
  }
}

/** 该地址是否是默认地址（后端用 1/0 表示）。 */
function isDefaultAddress(address: AddressEntity): boolean {
  return Number(address.isDefault || 0) === 1
}

/** 一行展示用的完整地址文案。 */
function addressText(address: AddressEntity): string {
  return formatAddressText(address)
}

/** 新增地址：进入共用编辑页，book 模式直接写后端。 */
function goCreate(): void {
  if (!navigationThrottle()) return
  uni.navigateTo({ url: '/subpkg-order/address/edit?mode=book' })
}

/** 编辑地址：带上 id，编辑页按 book 模式加载并保存。 */
function goEdit(address: AddressEntity): void {
  if (!navigationThrottle()) return
  uni.navigateTo({ url: `/subpkg-order/address/edit?mode=book&id=${encodeURIComponent(String(address.id))}` })
}

/** 选择模式下把地址回传给下层页面，并返回上一页。 */
function pickAddress(address: AddressEntity): void {
  if (!navigationThrottle()) return
  const payload = { address, text: addressText(address) }
  // 1. 先把地址广播出去（下层页面在 onLoad/onShow 注册了监听）
  uni.$emit(ADDRESS_SELECTED_EVENT, payload)
  // 2. 顺便写一份草稿缓存：确认订单页即便错过事件，也能在 onShow 时从这里读到
  try {
    uni.setStorageSync(ADDRESS_DRAFT_KEY, {
      name: address.receiverName,
      phone: address.receiverPhone,
      detail: address.detail,
      province: address.province || '',
      city: address.city || '',
      district: address.district || '',
    })
  } catch { /* 缓存失败不影响回传主链路 */ }
  // 3. 返回上一页，返回完成后再广播一次，供监听方弹提示
  uni.navigateBack({
    complete: () => { uni.$emit(ADDRESS_SELECTED_DONE_EVENT, payload) },
  })
}

/** 设为默认地址；已经是默认的地址直接忽略，不发请求。 */
async function makeDefault(address: AddressEntity): Promise<void> {
  if (submitting.value || isDefaultAddress(address)) return
  submitting.value = true
  try {
    await setDefaultAddress(address.id)
    // 本地先改再重拉，界面即时反馈；重拉保证与后端一致（id 统一按字符串比较，避免后端把 int64 序列化成字符串）
    addresses.value = addresses.value.map((item) => ({ ...item, isDefault: String(item.id) === String(address.id) ? 1 : 0 }))
    uni.showToast({ title: '已设为默认', icon: 'success' })
    await loadAddresses()
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '设置默认地址失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

/** 删除地址（后端软删），需二次确认。 */
function confirmRemove(address: AddressEntity): void {
  if (submitting.value) return
  uni.showModal({
    title: '删除地址',
    content: `确定删除「${address.receiverName} ${address.receiverPhone}」这条地址吗？`,
    confirmText: '删除',
    confirmColor: '#e34d59',
    success: (result) => { if (result.confirm) void removeAddressItem(address) },
  })
}

/** 真正执行删除。 */
async function removeAddressItem(address: AddressEntity): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  try {
    await removeAddress(address.id)
    uni.showToast({ title: '地址已删除', icon: 'success' })
    await loadAddresses()
  } catch (error) {
    // 后端删不存在/非本人的地址会返回业务码，这里统一按提示文案展示
    uni.showToast({ title: isApiRequestError(error) ? error.message : '删除失败，请重试', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

/** 返回上一页；无上级页面时回「我的」。 */
function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.switchTab({ url: '/pages/mine/mine' })
}
</script>

<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">{{ selecting() ? '选择收货地址' : '收货地址' }}</text>
      </view>
    </view>

    <scroll-view class="content" scroll-y :style="{ paddingTop: statusBarHeight + 44 + 12 + 'px' }">
      <view v-if="loadError" class="state">
        <text class="state-text">{{ loadError }}</text>
        <view class="state-btn" @click="loadAddresses()">重新加载</view>
      </view>

      <view v-else-if="!loading && !addresses.length" class="state">
        <text class="state-text">还没有收货地址</text>
        <text class="state-sub">添加后下单可直接选择，无需重复填写</text>
      </view>

      <template v-else>
        <view
          v-for="item in addresses"
          :key="item.id"
          class="card"
          :class="{ 'card-disabled': submitting }"
          @click="selecting() ? pickAddress(item) : goEdit(item)"
        >
          <view class="card-main">
            <view class="card-row">
              <text class="card-name">{{ item.receiverName }}</text>
              <text class="card-phone">{{ item.receiverPhone }}</text>
              <text v-if="isDefaultAddress(item)" class="card-tag">默认</text>
            </view>
            <text class="card-address">{{ addressText(item) }}</text>
          </view>
          <!-- 选择模式下只提供「选中」语义，不展示管理操作，避免误触 -->
          <view v-if="!selecting()" class="card-actions">
            <view class="action" :class="{ 'action-active': isDefaultAddress(item) }" @click.stop="makeDefault(item)">
              {{ isDefaultAddress(item) ? '默认地址' : '设为默认' }}
            </view>
            <view class="action action-danger" @click.stop="confirmRemove(item)">删除</view>
          </view>
        </view>
      </template>

      <view class="bottom-space" />
    </scroll-view>

    <view class="footer">
      <view class="save" @click="goCreate">新增收货地址</view>
    </view>
  </view>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; background: #f2f3f7; }
.nav { position: fixed; top: 0; right: 0; left: 0; z-index: 10; background: #ffffff; }
.nav-inner { position: relative; display: flex; align-items: center; justify-content: center; height: 88rpx; }
.nav-back { position: absolute; left: 24rpx; color: #1d2129; font-size: 52rpx; line-height: 1; }
.nav-title { color: #1d2129; font-size: 33rpx; font-weight: 600; }
.content { flex: 1; min-height: 0; padding: 0 23rpx 23rpx; box-sizing: border-box; }

.state { display: flex; align-items: center; flex-direction: column; padding: 160rpx 40rpx; }
.state-text { color: #4e5969; font-size: 29rpx; text-align: center; }
.state-sub { margin-top: 14rpx; color: #86909c; font-size: 24rpx; text-align: center; }
.state-btn { margin-top: 32rpx; padding: 16rpx 48rpx; border-radius: 40rpx; background: #ff5500; color: #fff; font-size: 27rpx; }

.card { margin-top: 20rpx; padding: 26rpx 24rpx; border-radius: 16rpx; background: #ffffff; }
.card-disabled { opacity: .6; }
.card-main { display: flex; flex-direction: column; }
.card-row { display: flex; align-items: center; }
.card-name { color: #1d2129; font-size: 30rpx; font-weight: 600; }
.card-phone { margin-left: 18rpx; color: #4e5969; font-size: 27rpx; }
.card-tag { margin-left: 14rpx; padding: 2rpx 12rpx; border-radius: 6rpx; background: #fff1e8; color: #ff5500; font-size: 20rpx; }
.card-address { margin-top: 12rpx; color: #4e5969; font-size: 26rpx; line-height: 1.6; }

.card-actions { display: flex; align-items: center; justify-content: flex-end; gap: 32rpx; margin-top: 20rpx; padding-top: 18rpx; border-top: 1rpx solid #f2f3f7; }
.action { color: #86909c; font-size: 25rpx; }
.action-active { color: #ff5500; font-weight: 600; }
.action-danger { color: #e34d59; }

.bottom-space { height: 40rpx; }
.footer { flex-shrink: 0; padding: 16rpx 23rpx calc(16rpx + env(safe-area-inset-bottom)); background: #ffffff; }
.save { display: flex; align-items: center; justify-content: center; height: 88rpx; border-radius: 16rpx; color: #ffffff; background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%); font-size: 31rpx; font-weight: 600; }
</style>
