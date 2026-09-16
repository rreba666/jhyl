<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getFavoriteList, unfavoriteProduct, type ProductFavorite } from '@/api/favorite'
import { isLoggedIn } from '@/utils/auth'
import LoginGuide from '@/components/LoginGuide.vue'

/** 收藏列表数据。 */
const list = ref<ProductFavorite[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const loaded = ref(false)
const empty = computed(() => loaded.value && !loading.value && !list.value.length)
const loginGuideVisible = ref(false)
/** 请求竞态 token，快速操作时丢弃过期响应。 */
let requestToken = 0

/** 微信胶囊按钮位置，用于自定义导航栏精确定位。 */
const menuTop = ref(0)
const menuHeight = ref(32)
const navStyle = computed(() => ({ top: `${menuTop.value}px`, height: `${menuHeight.value}px` }))
const bodyTop = computed(() => menuTop.value + menuHeight.value)

/** 格式化金额：整数去掉小数位。 */
function formatAmount(value: number): string {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '')
}

/** 加载收藏列表。 */
async function load(reset = true): Promise<void> {
  if (!isLoggedIn()) {
    list.value = []
    loaded.value = true
    loginGuideVisible.value = true
    return
  }
  const token = ++requestToken
  const nextPage = reset ? 1 : page.value + 1
  if (!reset && list.value.length >= total.value) return
  if (reset) loading.value = true
  else loadingMore.value = true
  try {
    const result = await getFavoriteList({ page: nextPage, pageSize: 10 })
    if (token !== requestToken) return
    list.value = reset ? result.list : [...list.value, ...result.list]
    page.value = result.page || nextPage
    total.value = result.total || list.value.length
    loaded.value = true
  } catch (error) {
    if (token !== requestToken) return
    uni.showToast({ title: error instanceof Error ? error.message : '收藏加载失败', icon: 'none' })
  } finally {
    if (token === requestToken) { loading.value = false; loadingMore.value = false }
  }
}

/** 打开商品详情页。 */
function openDetail(item: ProductFavorite): void {
  uni.navigateTo({ url: `/subpkg-goods/detail/detail?id=${encodeURIComponent(String(item.id))}` })
}

/** 取消收藏（从列表移除）。 */
async function removeFavorite(item: ProductFavorite): Promise<void> {
  try {
    await unfavoriteProduct(item.id)
    uni.showToast({ title: '已取消收藏', icon: 'none' })
    list.value = list.value.filter((fav) => fav.id !== item.id)
    total.value = Math.max(0, total.value - 1)
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '取消收藏失败', icon: 'none' })
  }
}

/** 返回上一页。 */
function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/mine/mine' })
}

onMounted(() => {
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect) { menuTop.value = rect.top; menuHeight.value = rect.height }
  } catch { /* 非微信环境忽略 */ }
})

onLoad(() => { void load(true) })
onShow(() => { if (loaded.value) void load(true) })
</script>

<template>
  <view class="page">
    <view class="nav" :style="navStyle"><view class="nav-back" @click="goBack"><text class="back-icon">‹</text></view><text class="title">我的收藏</text></view>

    <scroll-view class="list" scroll-y :style="{ marginTop: bodyTop + 'px' }" @scrolltolower="load(false)">
      <view v-show="loading && !list.length" class="state">加载中...</view>
      <view v-for="item in list" :key="item.id" class="fav-card" @click="openDetail(item)">
        <image v-if="item.mainImage" class="fav-image" :src="item.mainImage" mode="aspectFill" />
        <view v-else class="fav-image placeholder" />
        <view class="fav-info">
          <text class="fav-name">{{ item.name }}</text>
          <view class="fav-bottom">
            <view class="fav-price"><text class="currency">¥</text><text class="amount">{{ formatAmount(item.originalPrice ?? item.minOriginalPrice ?? item.price) }}</text></view>
            <text class="fav-sold">已售 {{ item.soldCount || 0 }}</text>
          </view>
          <text class="fav-time">{{ item.favoriteTime }}</text>
        </view>
        <view class="fav-remove" @click.stop="removeFavorite(item)">取消收藏</view>
      </view>
      <view v-show="empty" class="state">暂无收藏</view>
      <view v-show="loadingMore" class="more">加载中...</view>
    </scroll-view>

    <LoginGuide v-model="loginGuideVisible" />
  </view>
</template>

<style>
.page { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: #f6f6f6; color: #242526; }
.nav { position: fixed; left: 0; right: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: #fff; box-sizing: border-box; }
.nav-back { position: absolute; left: 16rpx; display: flex; align-items: center; justify-content: center; width: 64rpx; height: 64rpx; }
.back-icon { font-size: 48rpx; line-height: 1; color: #222; }
.title { font-size: 32rpx; font-weight: 700; }
.list { flex: 1; min-height: 0; padding: 20rpx 24rpx; box-sizing: border-box; }
.fav-card { display: flex; align-items: center; margin-bottom: 20rpx; padding: 24rpx; background: #fff; border-radius: 16rpx; }
.fav-image { width: 180rpx; height: 180rpx; flex-shrink: 0; background: #d8d8d8; border-radius: 12rpx; }
.fav-image.placeholder { background: #d8d8d8; }
.fav-info { display: flex; flex: 1; min-width: 0; flex-direction: column; align-self: stretch; margin-left: 24rpx; }
.fav-name { color: #0a0a0a; font-size: 28rpx; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.fav-bottom { display: flex; align-items: baseline; justify-content: space-between; margin-top: 16rpx; }
.fav-price { color: #d40000; }
.fav-price .currency { font-size: 24rpx; font-weight: 700; }
.fav-price .amount { font-size: 34rpx; font-weight: 700; }
.fav-sold { color: #999; font-size: 22rpx; }
.fav-time { margin-top: auto; color: #bbb; font-size: 22rpx; }
.fav-remove { flex-shrink: 0; margin-left: 20rpx; padding: 12rpx 22rpx; color: #666; font-size: 24rpx; border: 2rpx solid #ccc; border-radius: 8rpx; }
.state, .more { padding: 160rpx 0; color: #999; text-align: center; font-size: 26rpx; }
.more { padding: 28rpx 0; }
</style>
