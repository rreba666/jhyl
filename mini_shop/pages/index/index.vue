<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { onLoad, onPageScroll, onPullDownRefresh, onReachBottom, onShareAppMessage, onShow } from '@dcloudio/uni-app'
import { getHomepageData, type KingkongItem, type MediaLinkV2, type WelfareConfigV2 } from '@/api/homepage'
import type { HomepageMediaItem } from '@/api/homepage'
import { getProductList, type ProductCard } from '@/api/product'
import { hasNextPage } from '@/utils/config'
import { bindStoredPromotionIfLoggedIn, buildPromotionSharePath, capturePromotionContext } from '@/utils/promotion'
import { createThrottle } from '@/utils/interaction'
import RequestState from '@/components/RequestState.vue'
import HomeCategoryNav from '@/components/home/HomeCategoryNav.vue'
import HomeLayoutToggle from '@/components/home/HomeLayoutToggle.vue'
import HomeProductCard from '@/components/home/HomeProductCard.vue'
import HomeSharePoster from '@/components/home/HomeSharePoster.vue'
import HomeWelfare from '@/components/home/HomeWelfare.vue'
import { getPromotionCode } from '@/api/promotion'
import { isLoggedIn } from '@/utils/auth'

type LayoutMode = 'grid' | 'list'

/** 兜底金刚区（后端未配置时使用）。 */
const defaultCategories: Array<{ label: string; icon: string; background: string; iconOffset: { left: number; top: number } }> = [
  { label: '营养膳食', icon: '/static/figma-home/category-nutrition.png', background: '/static/figma-home/category-nutrition-bg.svg', iconOffset: { left: -2, top: 4 } },
  { label: '风生水起', icon: '/static/figma-home/category-water.png', background: '/static/figma-home/category-water-bg.svg', iconOffset: { left: -2, top: 6 } },
  { label: '纸定发财', icon: '/static/figma-home/category-paper.png', background: '/static/figma-home/category-paper-bg.svg', iconOffset: { left: -1.5, top: 3 } },
  { label: '非遗老号', icon: '/static/figma-home/category-heritage.png', background: '/static/figma-home/category-heritage-bg.svg', iconOffset: { left: -1, top: 6 } },
  { label: '国家地标', icon: '/static/figma-home/category-landmark.png', background: '/static/figma-home/category-landmark-bg.svg', iconOffset: { left: -1, top: 2 } },
]

/** 后端返回的金刚区（含跳转）；为空时用默认。 */
const kingkongItems = shallowRef<KingkongItem[]>([])
/** 金刚区导航展示项（label/icon/background/iconOffset）。 */
const categories = computed(() => kingkongItems.value.length
  ? kingkongItems.value.map((k) => ({ label: k.label, icon: k.icon, background: k.background, iconOffset: { left: k.iconOffsetLeft ?? 0, top: k.iconOffsetTop ?? 0 } }))
  : defaultCategories)

const layoutMode = shallowRef<LayoutMode>('grid')
const brandName = shallowRef('今华有礼')
const heroImages = shallowRef<MediaLinkV2[]>([])
const footerImages = shallowRef<string[]>([])
const footerLinks = shallowRef<string[]>([])
const welfareConfig = shallowRef<WelfareConfigV2 | null>(null)
const products = shallowRef<ProductCard[]>([])
const currentPage = shallowRef(1)
const hasMore = shallowRef(true)
const loading = shallowRef(true)
const loadingMore = shallowRef(false)
const loadError = shallowRef('')
const statusBarHeight = shallowRef(24)
const navScrolled = shallowRef(false)
const welfareTab = shallowRef(0)
const sharePosterVisible = shallowRef(false)
const sharePosterCodeUrl = shallowRef('')
const navigationThrottle = createThrottle(500)
let productRequest: Promise<void> | null = null
let shareCodeRequest: Promise<void> | null = null

const leftProducts = computed(() => products.value.filter((_item, index) => index % 2 === 0))
const rightProducts = computed(() => products.value.filter((_item, index) => index % 2 === 1))
const navStyle = computed(() => ({ paddingTop: `${statusBarHeight.value}px` }))
const shareLink = computed(() => buildPromotionSharePath('/pages/index/index'))

async function loadHomepage(): Promise<void> {
  const data = await getHomepageData()
  // 大图轮播（V2 heroImages，含点击跳转）；为空回退默认图
  const hero = (data.heroImages || []).filter((item) => Boolean(item.url))
  heroImages.value = hero.length ? hero : [{ url: '/static/figma-home/hero-banner.png', linkType: 'page', linkValue: '' }]
  // 金刚区（V2 kingkong）；为空时用默认（categories 兜底）
  kingkongItems.value = data.kingkong || []
  // 福利区（V2 welfare）
  welfareConfig.value = data.welfare || null
  // 兼容旧字段：底部图/链接
  const enabled = (data.mediaList || []).find((item: HomepageMediaItem) => item.isEnabled === 1)
  if (enabled) {
    const footer = enabled.bottomImageUrl || []
    if (footer.some(Boolean)) footerImages.value = footer
    footerLinks.value = enabled.bottomLinkTarget || []
  }
}

async function loadProducts(reset = false): Promise<void> {
  if (productRequest) return productRequest
  if (!reset && (!hasMore.value || loadingMore.value)) return

  const nextPage = reset ? 1 : currentPage.value + 1
  loadingMore.value = !reset
  const pending = getProductList({ page: nextPage, pageSize: 10 })
    .then((result) => {
      products.value = reset ? result.list : [...products.value, ...result.list]
      currentPage.value = result.page
      hasMore.value = hasNextPage(result)
      if (reset) loadError.value = ''
    })
    .catch((error: unknown) => {
      if (!products.value.length) loadError.value = error instanceof Error ? error.message : '商品加载失败，请重试'
    })
    .finally(() => {
      loadingMore.value = false
      productRequest = null
    })

  productRequest = pending
  return pending
}

async function refreshPage(): Promise<void> {
  loading.value = true
  loadError.value = ''
  await Promise.allSettled([loadHomepage(), loadProducts(true)])
  loading.value = false
}

function goProduct(id: string): void {
  if (!navigationThrottle()) return
  uni.navigateTo({ url: `/subpkg-goods/detail/detail?id=${encodeURIComponent(id)}` })
}

function goSearch(): void {
  if (!navigationThrottle()) return
  uni.navigateTo({ url: '/subpkg-goods/search/index' })
}

function openSharePoster(): void {
  sharePosterVisible.value = true
  if (!isLoggedIn() || sharePosterCodeUrl.value || shareCodeRequest) return

  const pending = getPromotionCode()
    .then((codeUrl) => {
      if (codeUrl) sharePosterCodeUrl.value = codeUrl
    })
    .catch(() => {
      // 未生成用户推广码时，海报组件会使用设计稿内的公共二维码兜底。
    })
    .finally(() => {
      if (shareCodeRequest === pending) shareCodeRequest = null
    })
  shareCodeRequest = pending
}

/** 按 linkType/linkValue 统一跳转。 */
function navigate(linkType: string, linkValue: string): void {
  if (linkType === 'landing') uni.navigateTo({ url: `/subpkg-goods/category/index?theme=${encodeURIComponent(linkValue)}` })
  else if (linkType === 'detail') uni.navigateTo({ url: `/subpkg-goods/detail/detail?id=${encodeURIComponent(linkValue)}` })
  else if (linkType === 'page') uni.navigateTo({ url: linkValue })
  else if (linkType === 'url') uni.navigateTo({ url: `/subpkg-goods/search/index` })
  else if (linkType === 'miniprogram') uni.navigateToMiniProgram({ appId: linkValue })
}

function goCategory(index?: number): void {
  if (!navigationThrottle()) return
  const categoryIndex = typeof index === 'number' ? index : 0
  const item = kingkongItems.value[categoryIndex]
  if (item && item.linkType) { navigate(item.linkType, item.linkValue); return }
  const theme = categoryIndex === 3 ? 'heritage' : categoryIndex === 4 ? 'landmark' : 'nutrition'
  uni.navigateTo({ url: `/subpkg-goods/category/index?theme=${theme}` })
}

function goHero(index: number): void {
  if (!navigationThrottle()) return
  const item = heroImages.value[index]
  if (item?.linkType && item.linkValue) navigate(item.linkType, item.linkValue)
}

function goWelfareImage(index: number): void {
  if (!navigationThrottle()) return
  const tab = welfareConfig.value?.tabs[index]
  if (tab?.enabled === 1) {
    // 按 welfare tab 配置跳转：优先 appId(小程序)，其次 path(页面)
    if (tab.jumpType === 'miniprogram' || tab.appId) uni.navigateToMiniProgram({ appId: tab.appId })
    else if (tab.path) uni.navigateTo({ url: tab.path })
    return
  }
  // 回退旧字段
  const appId = footerLinks.value[index]?.trim() || ''
  if (appId) uni.navigateToMiniProgram({ appId })
}

onLoad((options) => {
  capturePromotionContext(options as Record<string, unknown>)
  void bindStoredPromotionIfLoggedIn()
})

onShareAppMessage(() => ({
  title: brandName.value,
  path: buildPromotionSharePath('/pages/index/index'),
}))

onPageScroll(({ scrollTop }: { scrollTop: number }) => {
  navScrolled.value = scrollTop > 4
})

onReachBottom(() => {
  void loadProducts()
})

onPullDownRefresh(async () => {
  await refreshPage()
  uni.stopPullDownRefresh()
})

onMounted(() => {
  try {
    statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 24
  } catch { /* 非微信环境使用设计稿默认值 */ }
  void refreshPage()
})

onShow(() => {
  void bindStoredPromotionIfLoggedIn()
})
</script>

<template>
  <view class="home-page">
    <view class="top-shell" :class="{ scrolled: navScrolled }" :style="navStyle">
      <view class="brand-row">
        <image class="brand-logo" src="/static/figma-home/brand-logo.png" mode="aspectFit" />
      </view>
      <view class="search-row">
        <view class="search-pill" @click="goSearch">
          <text class="search-icon" aria-hidden="true" />
          <text class="search-placeholder">老字号精选好物</text>
        </view>
        <button class="share-pill" @click="openSharePoster">
          <text class="share-icon" aria-hidden="true">↗</text>
          <text>分享</text>
        </button>
      </view>
    </view>

    <view class="hero-module">
      <view v-if="loading" class="hero-placeholder" />
      <swiper v-else class="hero-swiper" circular autoplay interval="4500" duration="450">
        <swiper-item v-for="(image, index) in heroImages" :key="image.url" class="hero-slide">
          <image class="hero-image" :src="image.url" mode="aspectFill" @click="goHero(index)" />
          <view v-if="heroImages.length > 1" class="hero-dots">
            <view v-for="(_item, dotIndex) in heroImages" :key="dotIndex" class="hero-dot" :class="{ active: dotIndex === index }" />
          </view>
        </swiper-item>
      </swiper>
      <view class="hero-caption">
        <image class="hero-caption-logo" src="/static/figma-home/hero-caption-logo.png" mode="aspectFit" />
        <text>为美好生活而来，精选好物，让安心品质走进每个家</text>
      </view>
    </view>

    <RequestState v-if="!loading && loadError && !products.length" :error="loadError" @retry="refreshPage" />

    <view class="category-slot">
      <HomeCategoryNav :items="categories" @select="goCategory" />
    </view>

    <view class="product-section">
      <view class="product-toolbar">
        <image class="section-logo" src="/static/figma-home/section-logo.png" mode="aspectFit" />
        <HomeLayoutToggle v-model="layoutMode" />
      </view>

      <view v-if="loading" class="product-loading">
        <view v-for="item in 4" :key="item" class="skeleton-card" />
      </view>

      <view v-else-if="layoutMode === 'grid'" class="product-waterfall">
        <view class="waterfall-column">
          <HomeProductCard v-for="item in leftProducts" :key="item.id" :product="item" mode="grid" @select="goProduct" />
        </view>
        <view class="waterfall-column">
          <HomeProductCard v-for="item in rightProducts" :key="item.id" :product="item" mode="grid" @select="goProduct" />
        </view>
      </view>

      <view v-else class="product-list">
        <HomeProductCard v-for="item in products" :key="item.id" :product="item" mode="list" @select="goProduct" />
      </view>

      <view v-if="!loading && !products.length && !loadError" class="empty-products">暂无精选商品</view>
      <view v-if="loadingMore" class="load-more">正在加载更多</view>
      <view v-else-if="!hasMore && products.length" class="load-more">已经到底了</view>
    </view>

    <HomeWelfare v-model:active-tab="welfareTab" :welfare="welfareConfig" @image-tap="goWelfareImage" />
    <HomeSharePoster v-model="sharePosterVisible" :code-url="sharePosterCodeUrl" :share-link="shareLink" />
  </view>
</template>

<style>
.home-page { display: flex; width: 100%; min-height: 100vh; flex-direction: column; align-items: center; background: #fff; color: #1d2129; }
.top-shell { position: relative; z-index: 5; width: 100%; box-sizing: border-box; background: #fff; transition: box-shadow .2s ease; }
.top-shell.scrolled { position: sticky; top: 0; box-shadow: 0 2rpx 16rpx rgba(29, 33, 41, .08); }
.brand-row { display: flex; width: 100%; height: 96rpx; align-items: center; padding: 0 24rpx; box-sizing: border-box; }
.brand-logo { width: 169rpx; height: 64rpx; }
.search-row { display: flex; width: 100%; height: 104rpx; align-items: center; gap: 16rpx; padding: 8rpx 24rpx 0; box-sizing: border-box; }
.search-pill, .share-pill { display: flex; height: 72rpx; align-items: center; box-sizing: border-box; border: 0; border-radius: 999rpx; background: #f1f2f4; color: #86909c; font-size: 30rpx; line-height: 48rpx; }
.search-pill { flex: 1; gap: 12rpx; padding: 0 24rpx; }
.share-pill { width: 128rpx; flex-shrink: 0; justify-content: center; gap: 8rpx; padding: 0; }
.share-pill::after { border: 0; }
.search-icon { position: relative; width: 36rpx; height: 36rpx; flex-shrink: 0; border: 3rpx solid #86909c; border-radius: 50%; box-sizing: border-box; }
.search-icon::after { position: absolute; right: -8rpx; bottom: -5rpx; width: 14rpx; height: 3rpx; transform: rotate(45deg); background: #86909c; content: ''; }
.share-icon { color: #4e5969; font-size: 34rpx; line-height: 1; }
.hero-module { width: calc(100% - 16px); margin-bottom: 12px; padding-bottom: 16rpx; box-sizing: border-box; overflow: hidden; border-radius: 16rpx; background: #148c48; }
.hero-swiper, .hero-placeholder { width: 100%; height: 280rpx; overflow: hidden; border-radius: 16rpx; }
.hero-placeholder { background: #f1f2f4; }
.hero-slide { position: relative; width: 100%; height: 280rpx; overflow: hidden; border-radius: 16rpx; background: #bd2626; }
.hero-image { display: block; width: 100%; height: 100%; }
.hero-caption { display: flex; align-items: center; gap: 8rpx; padding: 16rpx 24rpx 0; color: #fff; font-size: 24rpx; line-height: 40rpx; }
.hero-caption-logo { width: 128rpx; height: 36rpx; flex-shrink: 0; }
.hero-dots { position: absolute; bottom: 72rpx; left: 50%; display: flex; gap: 8rpx; transform: translateX(-50%); }
.hero-dot { width: 12rpx; height: 12rpx; border-radius: 999rpx; background: rgba(255, 255, 255, .45); }
.hero-dot.active { width: 32rpx; background: rgba(255, 255, 255, .8); }
.category-slot { width: 100%; align-self: stretch; }
.product-section { width: 100%; margin-top: 12px; padding: 0 16rpx 32rpx; box-sizing: border-box; }
.product-toolbar { display: flex; width: 100%; height: 96rpx; align-items: center; justify-content: space-between; padding: 0 12rpx; box-sizing: border-box; }
.section-logo { width: 160rpx; height: 36rpx; }
.product-waterfall { display: flex; align-items: flex-start; gap: 16rpx; }
.waterfall-column, .product-list { display: flex; flex-direction: column; gap: 24rpx; }
.waterfall-column { width: calc((100% - 16rpx) / 2); }
.product-list { width: 100%; gap: 16rpx; }
.product-loading { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16rpx; }
.skeleton-card { height: 520rpx; border-radius: 16rpx; background: #f1f2f4; animation: skeleton-pulse 1.4s ease-in-out infinite; }
.empty-products, .load-more { width: 100%; padding: 28rpx 0 8rpx; box-sizing: border-box; color: #86909c; font-size: 24rpx; line-height: 40rpx; text-align: center; }
@keyframes skeleton-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .skeleton-card { animation: none; } }
</style>
