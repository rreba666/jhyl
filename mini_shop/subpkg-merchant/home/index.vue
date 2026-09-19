<script setup lang="ts">
/**
 * 商家端 · 工作台首页（对应设计稿「商家端」画板 2690:31292）
 * 契约：
 * - GET /api/merchant/overview        今日订单 / 今日成交额 / 净额 + 待接单 / 待取货计数
 * - GET /api/merchant/orders?tab=     配送中 / 已完成 页签 total（只取计数）
 * - GET /api/merchant/products?status= 已上架 / 待上架 total（在售列表顺带算库存预警）
 * 四宫格统计按设计稿：订单管理 = 待配送/配送中/已完成，新增商品 = 已上架/待上架，
 * 商品管理 = 在售商品/库存预警，第四张卡 = 净额（订单口径）。
 * 范围结论：商家结算账户尚未实现，balance 是「订单口径净额」（balanceScope=ORDER_NET），
 * 展示时标注口径，不写成「可提现余额」。
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  getMerchantOverview,
  getMerchantOrders,
  getMerchantProducts,
  type MerchantOverviewVO,
  type MerchantProductVO,
} from '@/api/merchant'
import { getIdentity, switchIdentity, type IdentitySwitchVO, type IdentityVO } from '@/api/identity'
import { getUserProfile, updateUserProfile, type UserProfile } from '@/api/user'
import { uploadFile } from '@/utils/request'

const statusBarHeight = ref(0)
const shopName = ref('')
/** 当前用户资料：顶部头像来源（用户可上传微信头像）。 */
const user = ref<UserProfile | null>(null)
const avatarUploading = ref(false)
/** 身份列表：顶部箭头的身份切换弹层用（一个账号多角色）。 */
const identity = ref<IdentityVO | null>(null)
const roleSheetVisible = ref(false)
const roleSwitching = ref(false)
/** 弹层当前选中的角色：'CUSTOMER' / 'MANAGER' / 'RIDER'。 */
const selectedRoleKey = ref('CUSTOMER')

const overview = ref<MerchantOverviewVO>({})
/** 四宫格计数：商品（已上架 / 待上架 / 库存预警）。 */
const onSaleCount = ref(0)
const offSaleCount = ref(0)
const warningCount = ref(0)
/** 四宫格计数：订单（配送中 / 已完成；「待配送」由 overview 的待接单+待取货算出）。 */
const deliveringCount = ref(0)
const doneCount = ref(0)

/** 库存预警阈值（与商品列表页同一口径：设计稿示例 100，阈值待产品确认）。 */
const LOW_STOCK_THRESHOLD = 100
/**
 * 库存预警一次最多统计的在售商品条数。
 * 后端**没有**「库存预警计数」字段、商品列表也不支持按库存筛选，只能在拉回的在售列表里本地过滤，
 * 所以在售商品超过这个条数时计数会偏小 —— 已在后端需求稿登记 `lowStockCount`。
 */
const LOW_STOCK_SCAN_LIMIT = 100

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '商家工作台' })
})

onShow(() => {
  // 店铺名与可选身份从后端拉取（身份卡列表同源）；用户头像单独取资料
  void loadIdentity()
  void loadUser()
  void loadOverview()
  void loadProductCounts()
  void loadOrderCounts()
})

/** 问候语按时间段。 */
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了，注意休息'
  if (h < 12) return '早上好，生意兴隆！'
  if (h < 18) return '下午好，生意兴隆！'
  return '晚上好，生意兴隆！'
})

async function loadOverview(): Promise<void> {
  try {
    overview.value = (await getMerchantOverview()) || {}
  } catch {
    overview.value = {}
  }
}

/**
 * 商品计数（四宫格「新增商品」「商品管理」两张卡，设计稿：已上架/待上架、在售商品/库存预警）。
 * 在售列表顺带算库存预警：一次请求同时拿到「已上架」总数与低库存商品，避免多打一次接口。
 */
async function loadProductCounts(): Promise<void> {
  try {
    const [onSale, offSale] = await Promise.all([
      getMerchantProducts({ status: 1, page: 1, pageSize: LOW_STOCK_SCAN_LIMIT }),
      getMerchantProducts({ status: 0, page: 1, pageSize: 1 }),
    ])
    onSaleCount.value = Number(onSale?.total || 0)
    offSaleCount.value = Number(offSale?.total || 0)
    warningCount.value = (onSale?.list || []).filter((item) => effectiveStock(item) <= LOW_STOCK_THRESHOLD).length
  } catch {
    // 忽略
  }
}

/** 订单计数（四宫格「订单管理」卡）：只取页签 total，pageSize=1 不拉数据。 */
async function loadOrderCounts(): Promise<void> {
  try {
    const [delivering, done] = await Promise.all([
      getMerchantOrders({ tab: 'DELIVERING', page: 1, pageSize: 1 }),
      getMerchantOrders({ tab: 'DONE', page: 1, pageSize: 1 }),
    ])
    deliveringCount.value = Number(delivering?.total || 0)
    doneCount.value = Number(done?.total || 0)
  } catch {
    // 忽略
  }
}

/** 有效库存（门店库存优先，否则品牌总库存）——与商品列表页同口径。 */
function effectiveStock(product: MerchantProductVO): number {
  const value = product.shopStock ?? product.totalStock
  return value == null ? 0 : Number(value)
}

/**
 * 「待配送」= 待接单 + 待取货（设计稿口径：尚未被骑手取货的订单都算待配送）。
 * 两个数都在 overview 里，不用额外请求。
 */
const pendingDeliverCount = computed(
  () => Number(overview.value.pendingAcceptCount || 0) + Number(overview.value.pendingPickupCount || 0),
)

/** 金额格式化：千分位 + 两位小数。 */
function money(value?: number): string {
  return (Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 今日成交额整数/小数拆分（整数 17px / 小数 13px）。 */
const amountParts = computed(() => {
  const fixed = money(overview.value.todayAmount)
  const [int, dec] = fixed.split('.')
  return { int: int || '0', dec: dec || '00' }
})

function goOrders(): void {
  uni.navigateTo({ url: '/subpkg-merchant/orders/list' })
}
function goAddProduct(): void {
  uni.navigateTo({ url: '/subpkg-merchant/products/edit' })
}
function goProducts(): void {
  uni.navigateTo({ url: '/subpkg-merchant/products/list' })
}
function goBill(): void {
  uni.navigateTo({ url: '/subpkg-merchant/bill/index' })
}
/** 顶部头像：优先用户微信头像，没有则用店铺默认头像（设计切图，放分包不占主包）。 */
const shopAvatar = computed(() => user.value?.avatarUrl || '/subpkg-merchant/static/shop-avatar-default.png')

/** 角色展示元信息（名称/说明/图标），文案与图标取自设计稿「选择你要进入的角色」弹层。 */
function roleMeta(entry: 'CUSTOMER' | 'MANAGER' | 'RIDER'): { name: string; desc: string; icon: string } {
  if (entry === 'MANAGER') return { name: '商户管理员', desc: '上传商品，管理店铺，经营数据', icon: '/subpkg-merchant/static/role-merchant.png' }
  if (entry === 'RIDER') return { name: '骑手', desc: '接单配送，及时送达', icon: '/subpkg-merchant/static/role-rider.png' }
  return { name: '商城用户', desc: '浏览选购好物，享受品质生活', icon: '/subpkg-merchant/static/role-customer.png' }
}

/** 身份切换弹层的角色项：商城用户恒有，其余按已开通身份生成，待开通置灰。 */
const roleOptions = computed(() => {
  const list: { key: string; bindingId: number | null; disabled: boolean; name: string; desc: string; icon: string }[] = [
    { key: 'CUSTOMER', bindingId: null, disabled: false, ...roleMeta('CUSTOMER') },
  ]
  const seen = new Set(['CUSTOMER'])
  ;(identity.value?.identities || []).forEach((item) => {
    const entry = (item.targetPage || 'CUSTOMER') as 'CUSTOMER' | 'MANAGER' | 'RIDER'
    if (seen.has(entry)) return
    seen.add(entry)
    list.push({ key: entry, bindingId: item.bindingId, disabled: Boolean(item.pending), ...roleMeta(entry) })
  })
  // 店长身份「内含骑手能力」（IdentityVO.deliveryCapability）：后端常常只返回一张店长卡，
  // 此时必须补一个「骑手」入口，否则门店管理员根本进不去配送页。
  // 进骑手页**不需要切换身份**（同一 token、身份仍是店长，任务接口用 C 端 token 直调），
  // 所以这一项 bindingId 保持 null，走直接跳转（见 confirmSwitch）。
  if (identity.value?.deliveryCapability && !seen.has('RIDER')) {
    list.push({ key: 'RIDER', bindingId: null, disabled: false, ...roleMeta('RIDER') })
  }
  return list
})

/** 拉取用户资料（顶部头像展示）。 */
async function loadUser(): Promise<void> {
  try { user.value = await getUserProfile() } catch { user.value = null }
}

/** 拉取身份列表：用于弹层可选角色，同时同步店名。 */
async function loadIdentity(): Promise<void> {
  try {
    identity.value = await getIdentity()
    const first = identity.value?.identities?.[0]
    shopName.value = first?.shopName || first?.merchantName || ''
  } catch { identity.value = null }
}

/** 选择头像（微信头像或相册）：上传后写回用户资料，顶部立即刷新。 */
async function onChooseAvatar(event: { detail: { avatarUrl?: string } }): Promise<void> {
  const tempPath = event.detail?.avatarUrl
  if (!tempPath || avatarUploading.value) return
  avatarUploading.value = true
  try {
    const avatarUrl = await uploadFile(tempPath)
    user.value = await updateUserProfile({ avatarUrl })
    uni.showToast({ title: '头像已更新', icon: 'none' })
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '头像上传失败', icon: 'none' })
  } finally {
    avatarUploading.value = false
  }
}

/** 打开身份切换弹层，默认选中当前身份（取切换缓存里的 entry）。 */
function openRoleSheet(): void {
  try {
    const cached = uni.getStorageSync('identity_entry') as IdentitySwitchVO | ''
    if (cached && typeof cached === 'object' && cached.entry) selectedRoleKey.value = cached.entry
  } catch { /* 忽略 */ }
  roleSheetVisible.value = true
}

function closeRoleSheet(): void {
  roleSheetVisible.value = false
}

/**
 * 确定切换身份（token 不变，按后端返回的 entry 决定去哪）。
 * 注意：MANAGER 的目标页就是**本页**（商家端工作台），所以原地刷新即可，不能 redirectTo 自己。
 */
async function confirmSwitch(): Promise<void> {
  const option = roleOptions.value.find((item) => item.key === selectedRoleKey.value)
  if (!option) return
  if (option.disabled) {
    uni.showToast({ title: '该身份尚未开通，请联系客服', icon: 'none' })
    return
  }
  if (roleSwitching.value) return
  // 店长内含骑手能力：骑手项不切身份（bindingId 为 null），直接进骑手工作台
  if (option.key === 'RIDER' && option.bindingId === null) {
    roleSheetVisible.value = false
    uni.navigateTo({ url: '/subpkg-delivery/rider/index' })
    return
  }
  roleSwitching.value = true
  try {
    const result = await switchIdentity(option.bindingId)
    uni.setStorageSync('identity_entry', result)
    roleSheetVisible.value = false
    if (result.entry === 'RIDER') {
      uni.redirectTo({ url: '/subpkg-delivery/rider/index' })
      return
    }
    if (result.entry === 'CUSTOMER') {
      uni.switchTab({ url: '/pages/index/index' })
      return
    }
    // MANAGER：当前就在商家端工作台，原地刷新身份与数据即可
    await loadIdentity()
    void loadOverview()
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '身份切换失败', icon: 'none' })
  } finally {
    roleSwitching.value = false
  }
}

function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page">
    <!-- 背景装饰 -->
    <view class="deco">
      <view class="ellipse ellipse-a" />
      <view class="ellipse ellipse-b" />
    </view>

    <!-- 导航栏 -->
    <view class="nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="shop">
        <!-- 头像：点击可选微信头像/相册（open-type=chooseAvatar 必须挂在 button 上） -->
        <button class="shop-avatar-btn" open-type="chooseAvatar" :disabled="avatarUploading" @chooseavatar="onChooseAvatar">
          <image class="shop-avatar" :src="shopAvatar" mode="aspectFill" />
        </button>
        <text class="shop-name">{{ shopName || '我的店铺' }}</text>
        <!-- 箭头：放大的身份切换入口（一个账号多角色，店长也能去配送） -->
        <view class="shop-switch" @click="openRoleSheet"><text class="shop-arrow">▾</text></view>
      </view>
    </view>

    <scroll-view class="content" scroll-y>
      <!-- 经营数据大卡 -->
      <view class="data-card">
        <view class="data-head">
          <image class="data-head-bg" src="/subpkg-merchant/static/home-hero.png" mode="aspectFill" />
          <text class="greeting">{{ greeting }}</text>
          <text class="greeting-sub">用数据看经营，让生意更简单</text>
        </view>
        <view class="data-bar">
          <view class="metric">
            <text class="metric-label">今日订单</text>
            <text class="metric-value">{{ overview.todayOrderCount ?? 0 }}</text>
          </view>
          <view class="metric-divider" />
          <view class="metric">
            <text class="metric-label">今日成交额/元</text>
            <view class="metric-value amount">
              <text class="amount-int">{{ amountParts.int }}</text><text class="amount-dot">.</text><text class="amount-dec">{{ amountParts.dec }}</text>
            </view>
          </view>
          <view class="metric-divider" />
          <view class="metric">
            <text class="metric-label">净额（订单口径）</text>
            <text class="metric-value">{{ money(overview.balance) }}</text>
          </view>
        </view>
      </view>

      <!-- 四宫格入口 -->
      <view class="grid">
        <view class="grid-row">
          <view class="grid-card" @click="goOrders">
            <image class="grid-bg" src="/subpkg-merchant/static/card-orders.png" mode="aspectFill" />
            <view class="grid-head">
              <view class="grid-text">
                <text class="grid-title">订单管理</text>
                <text class="grid-sub">查看订单，处理配送售后问题</text>
              </view>
              <view class="grid-arrow" style="color: #0062ff;">›</view>
            </view>
            <view class="grid-stats">
              <view class="grid-stat">
                <text class="stat-value">{{ pendingDeliverCount }}</text>
                <text class="stat-label">待配送</text>
              </view>
              <view class="stat-divider" />
              <view class="grid-stat">
                <text class="stat-value">{{ deliveringCount }}</text>
                <text class="stat-label">配送中</text>
              </view>
              <view class="stat-divider" />
              <view class="grid-stat">
                <text class="stat-value">{{ doneCount }}</text>
                <text class="stat-label">已完成</text>
              </view>
            </view>
          </view>
          <view class="grid-card" @click="goAddProduct">
            <image class="grid-bg" src="/subpkg-merchant/static/card-add-product.png" mode="aspectFill" />
            <view class="grid-head">
              <view class="grid-text">
                <text class="grid-title">新增商品</text>
                <text class="grid-sub">快速上架，丰富店铺</text>
              </view>
              <view class="grid-arrow" style="color: #ff8000;">›</view>
            </view>
            <view class="grid-stats">
              <view class="grid-stat">
                <text class="stat-value">{{ onSaleCount }}</text>
                <text class="stat-label">已上架</text>
              </view>
              <view class="stat-divider" />
              <view class="grid-stat">
                <text class="stat-value">{{ offSaleCount }}</text>
                <text class="stat-label">待上架</text>
              </view>
            </view>
          </view>
        </view>
        <view class="grid-row">
          <view class="grid-card" @click="goProducts">
            <image class="grid-bg" src="/subpkg-merchant/static/card-products.png" mode="aspectFill" />
            <view class="grid-head">
              <view class="grid-text">
                <text class="grid-title">商品管理</text>
                <text class="grid-sub">管理商品信息，库存价格</text>
              </view>
              <view class="grid-arrow" style="color: #00996e;">›</view>
            </view>
            <view class="grid-stats">
              <view class="grid-stat">
                <text class="stat-value">{{ onSaleCount }}</text>
                <text class="stat-label">在售商品</text>
              </view>
              <view class="stat-divider" />
              <view class="grid-stat">
                <text class="stat-value">{{ warningCount }}</text>
                <text class="stat-label">库存预警</text>
              </view>
            </view>
          </view>
          <view class="grid-card" @click="goBill">
            <image class="grid-bg" src="/subpkg-merchant/static/card-wallet.png" mode="aspectFill" />
            <view class="grid-head">
              <view class="grid-text">
                <text class="grid-title">账单</text>
                <text class="grid-sub">收支流水，资金一目了然</text>
              </view>
              <view class="grid-arrow" style="color: #4000ff;">›</view>
            </view>
            <view class="grid-stats">
              <view class="grid-stat grid-stat-full">
                <text class="stat-value">¥{{ money(overview.balance) }}</text>
                <text class="stat-label">净额（订单口径）</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 身份切换弹层（设计稿：选择你要进入的角色） -->
    <view v-if="roleSheetVisible" class="role-mask" @click="closeRoleSheet">
      <view class="role-sheet" @click.stop>
        <view class="role-sheet-head">
          <view class="role-sheet-titles">
            <text class="role-sheet-title">选择你要进入的角色</text>
            <text class="role-sheet-sub">一个账号可拥有多个角色，轻松切换</text>
          </view>
          <text class="role-sheet-close" @click="closeRoleSheet">×</text>
        </view>
        <view class="role-list">
          <view
            v-for="item in roleOptions"
            :key="item.key"
            class="role-item"
            :class="{ 'is-active': selectedRoleKey === item.key, 'is-disabled': item.disabled }"
            @click="selectedRoleKey = item.key"
          >
            <image class="role-icon" :src="item.icon" mode="aspectFit" />
            <view class="role-text">
              <text class="role-name">{{ item.name }}</text>
              <text class="role-desc">{{ item.desc }}</text>
            </view>
            <view class="role-radio" :class="{ 'is-checked': selectedRoleKey === item.key }">
              <text v-if="selectedRoleKey === item.key" class="role-check">✓</text>
            </view>
          </view>
        </view>
        <view class="role-submit" :class="{ 'is-loading': roleSwitching }" @click="confirmSwitch">确定切换</view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  position: relative;
  min-height: 100vh;
  box-sizing: border-box;
  background: #f2f3f7;
}
.deco {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 585rpx; /* 304px */
  overflow: hidden;
}
.ellipse {
  position: absolute;
  width: 585rpx;
  height: 585rpx;
  border-radius: 50%;
}
.ellipse-a {
  top: -160rpx;
  left: -60rpx;
  background: #f3edff;
}
.ellipse-b {
  top: -200rpx;
  right: -120rpx;
  background: #d6e4ff;
}

.nav {
  position: relative;
  z-index: 1;
  padding-left: 31rpx;
}
.shop {
  display: flex;
  align-items: center;
  height: 92rpx; /* 48px */
}
/* 头像按钮：清掉 button 默认样式，只保留点击区 */
.shop-avatar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 62rpx;
  height: 62rpx;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  line-height: 1;
}
.shop-avatar-btn::after { border: none; }
.shop-avatar {
  width: 62rpx;
  height: 62rpx;
  border: 1rpx solid rgba(0, 0, 0, 0.06);
  border-radius: 50%;
  background: #ffffff;
  box-sizing: border-box;
}
.shop-name {
  margin-left: 19rpx;
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 500;
}
/* 身份切换入口：白圆托底把箭头放大（设计稿箭头仅 7x4，实际太小不好点） */
.shop-switch {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  margin-left: 10rpx;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2rpx 8rpx rgba(29, 33, 41, 0.08);
}
.shop-arrow {
  color: #ff5500;
  font-size: 32rpx;
  line-height: 1;
}

.content {
  position: relative;
  z-index: 1;
  height: calc(100vh - 92rpx);
  box-sizing: border-box;
  padding: 23rpx;
}

/* 数据大卡 */
.data-card {
  border-radius: 23rpx;
  overflow: hidden;
  background: #ffffff;
}
.data-head {
  position: relative;
  padding: 69rpx 38rpx 0;
  padding-bottom: 46rpx;
  background: linear-gradient(135deg, #eef3ff 0%, #fff6ee 100%);
  overflow: hidden;
}
/* 欢迎卡背景插画（设计切图） */
.data-head-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
.greeting {
  position: relative;
  z-index: 1;
  display: block;
  color: #1d2129;
  font-size: 38rpx;
  font-weight: 600;
}
.greeting-sub {
  position: relative;
  z-index: 1;
  display: block;
  margin-top: 8rpx;
  color: #86909c;
  font-size: 23rpx;
}
.data-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 23rpx 46rpx;
  background: #ffffff;
}
.metric {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}
.metric-value {
  color: #1d2129;
  font-size: 33rpx;
  font-weight: 500;
  line-height: 1;
}
.metric-value.amount {
  display: flex;
  align-items: baseline;
}
.amount-int {
  font-size: 33rpx;
  font-weight: 500;
}
.amount-dot {
  font-size: 31rpx;
  font-weight: 500;
}
.amount-dec {
  font-size: 25rpx;
  font-weight: 500;
}
.metric-label {
  color: #86909c;
  font-size: 23rpx;
}
.metric-divider {
  flex: none;
  width: 2rpx;
  height: 69rpx;
  background: #e6e7eb;
}

/* 四宫格 */
.grid {
  margin-top: 23rpx;
}
.grid-row {
  display: flex;
  gap: 23rpx;
  margin-bottom: 23rpx;
}
.grid-card {
  position: relative;
  flex: 1;
  border-radius: 23rpx;
  background: #ffffff;
  overflow: hidden;
}
/* 卡片头部插画（设计切图）：只铺上半部，下半部保持白底放统计 */
.grid-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 227rpx;
}
/* 头部区固定 118px（= 插画高度），统计区因此从 118px 开始，与设计稿一致 */
.grid-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  box-sizing: border-box;
  height: 227rpx;
  padding: 31rpx;
}
.grid-text {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
}
.grid-title {
  display: block;
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
}
.grid-sub {
  display: block;
  margin-top: 8rpx;
  color: #86909c;
  font-size: 23rpx;
  line-height: 31rpx;
}
/* 卡片箭头：白圆托底 + 彩色箭头（颜色由模板内联 style 给出，与设计稿一致） */
.grid-arrow {
  position: relative;
  z-index: 1;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46rpx;
  height: 46rpx;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2rpx 8rpx rgba(29, 33, 41, 0.10);
  font-size: 31rpx;
  line-height: 1;
}
/*
 * 统计区：设计稿 60px 高（上下各 10px 内边距），无上边框。
 * ⚠️ 必须 relative + z-index 1：卡片插画是绝对定位（.grid-bg，高 227rpx），
 * 静态定位的统计行会被它整片盖住 —— 表现就是「只有标签隐约可见、数字完全不见」。
 */
.grid-stats {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  height: 115rpx;
  padding: 19rpx 0;
  background: #ffffff;
}
.grid-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}
.grid-stat-full {
  align-items: center;
}
/* 统计项之间的竖直分隔线（设计稿 0×32，颜色未标注，取与其它分隔线一致的 #E6E7EB） */
.stat-divider {
  flex: none;
  width: 2rpx;
  height: 61rpx;
  background: #e6e7eb;
}
.stat-value {
  color: #1d2129;
  font-size: 27rpx;
  font-weight: 500;
  line-height: 42rpx;
}
.stat-label {
  color: #86909c;
  font-size: 21rpx;
  line-height: 36rpx;
}
/* ===== 身份切换弹层（设计稿「选择你要进入的角色」） ===== */
.role-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.45);
}
.role-sheet {
  display: flex;
  flex-direction: column;
  padding: 31rpx 31rpx 42rpx;
  border-radius: 23rpx 23rpx 0 0;
  background: #f6f7f9;
}
.role-sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 23rpx;
}
.role-sheet-titles { flex: 1; min-width: 0; }
.role-sheet-title {
  display: block;
  color: #1d2129;
  font-size: 35rpx;
  font-weight: 600;
  line-height: 50rpx;
}
.role-sheet-sub {
  display: block;
  margin-top: 4rpx;
  color: #86909c;
  font-size: 25rpx;
  line-height: 42rpx;
}
.role-sheet-close {
  flex: none;
  margin-left: 16rpx;
  color: #1d2129;
  font-size: 44rpx;
  line-height: 44rpx;
}
.role-list { display: flex; flex-direction: column; gap: 23rpx; }
.role-item {
  display: flex;
  align-items: center;
  padding: 31rpx;
  border-radius: 23rpx;
  background: #ffffff;
}
.role-item.is-active { background: #fff4e8; }
.role-item.is-disabled { opacity: 0.5; }
.role-icon { flex: none; width: 77rpx; height: 77rpx; }
.role-text { flex: 1; min-width: 0; margin-left: 16rpx; }
.role-name {
  display: block;
  color: #1d2129;
  font-size: 27rpx;
  font-weight: 600;
  line-height: 42rpx;
}
.role-desc {
  display: block;
  margin-top: 2rpx;
  color: #86909c;
  font-size: 25rpx;
  line-height: 42rpx;
}
.role-radio {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46rpx;
  height: 46rpx;
  border: 2rpx solid #d7dbe0;
  border-radius: 50%;
  box-sizing: border-box;
}
.role-radio.is-checked { border-color: #ff5500; background: #ff5500; }
.role-check { color: #ffffff; font-size: 26rpx; line-height: 1; }
.role-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  margin-top: 31rpx;
  border-radius: 23rpx;
  color: #ffffff;
  background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%);
  font-size: 31rpx;
  font-weight: 600;
}
.role-submit.is-loading { opacity: 0.6; }
</style>
