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

/**
 * 首页分享卡片图（2026-09-22 换新切图 `分享海报/share 1.png`，1400×1120 正好 5:4）。
 * 微信聊天里展示的就是这张图；海报弹窗「发送群或好友」按钮走的是同一条 `onShareAppMessage`。
 * ⚠️ 官方文档明确 `imageUrl` **只支持 PNG / JPG**，所以这里用 JPG，不能用 WebP。
 */
const SHARE_CARD_IMAGE = '/static/design-cuts/figma-share/share-card.jpg'

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

/**
 * ===== 虚拟滚动（2026-09-21）=====
 * 首屏**只渲染 6 条**（双列 = 3 行），滚动时按需把渲染窗口放大 ——
 * 而不是一次性把整页数据全挂到 DOM 上。
 *
 * **为什么现在能做**：商品卡在 2026-09-21 已改成**等高**（图片 366rpx + 标题固定 2 行 + 描述固定 2 行 + 价格行），
 * 所以"每行多高"可估算，滚动位置才能换算成"该渲染到第几条"。
 *
 * ⚠️ 两个刻意的取舍（都不是疏漏）：
 * 1. **只扩不缩**：不回收已经渲染过的卡片。真正回收 DOM 需要绝对定位 + 滚动锚定，
 *    而小程序是 **HBuilderX-only、无法本地编译验证**，算错就是整屏空白 —— 风险不对称。
 *    ✅ **已与需求方确认（2026-09-21）：不做 DOM 回收**，保持"只扩不缩"，不要再自行加回收逻辑。
 *    本方案解决的是"首屏/前几屏一次渲染过多"这个主要问题。
 * 2. **估算宁多不少**：行高取偏小值 + 额外缓冲行，保证换算出来的条数只会偏多；
 *    少渲染会让用户看到空白，多渲染只是多几个节点。
 */
const RENDER_BATCH = 6
/** 估算的单行高度（rpx）。**刻意取偏小值**（实际约 620~650rpx），保证换算只会偏多。 */
const ROW_HEIGHT_RPX_ESTIMATE = 560
/** 滚动换算时额外多渲染的行数（缓冲，抵消估算误差）。 */
const RENDER_BUFFER_ROWS = 2
/** 当前渲染窗口的条数（只增不减，见上面的取舍 1）。 */
const visibleCount = shallowRef(RENDER_BATCH)

/** 实际渲染的商品 = `products`（全部已加载）按渲染窗口切片。 */
const visibleProducts = computed(() => products.value.slice(0, visibleCount.value))
const leftProducts = computed(() => visibleProducts.value.filter((_item, index) => index % 2 === 0))
const rightProducts = computed(() => visibleProducts.value.filter((_item, index) => index % 2 === 1))
const navStyle = computed(() => ({ paddingTop: `${statusBarHeight.value}px` }))
const shareLink = computed(() => buildPromotionSharePath('/pages/index/index'))

async function loadHomepage(): Promise<void> {
  const data = await getHomepageData()
  // 大图轮播（V2 heroImages，含点击跳转）；为空回退默认图
  const hero = (data.heroImages || []).filter((item) => Boolean(item.url))
  heroImages.value = hero.length ? hero : [{ url: '/static/figma-home/hero-banner.jpg', linkType: 'page', linkValue: '' }]
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
      if (reset) {
        loadError.value = ''
        // 重新加载（下拉刷新/首次进入）后把渲染窗口收回首屏大小 —— 虚拟滚动的起点
        visibleCount.value = RENDER_BATCH
      }
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
  imageUrl: SHARE_CARD_IMAGE,
}))

/** 屏幕可视高度（px），用于把 scrollTop 换算成"滚过了几行"；取不到时按 0（靠触底兜底）。 */
let windowHeightPx = 0
function viewportHeightPx(): number {
  if (!windowHeightPx) {
    try { windowHeightPx = uni.getSystemInfoSync().windowHeight || 0 } catch { windowHeightPx = 0 }
  }
  return windowHeightPx
}

/**
 * 按"已滚过的行数"放大渲染窗口（**同步、无等待** —— 数据早在内存里，只是之前没渲染）。
 * 估算只多不少：行高取偏小值 + `RENDER_BUFFER_ROWS` 行缓冲。
 */
function growRenderWindow(scrollTop: number): void {
  const total = products.value.length
  if (visibleCount.value >= total) return
  const rowHeight = Math.max(80, uni.upx2px(ROW_HEIGHT_RPX_ESTIMATE))
  const rows = Math.ceil((scrollTop + viewportHeightPx()) / rowHeight) + RENDER_BUFFER_ROWS
  const next = Math.min(total, Math.max(visibleCount.value, rows * 2))
  if (next > visibleCount.value) visibleCount.value = next
}

onPageScroll(({ scrollTop }: { scrollTop: number }) => {
  navScrolled.value = scrollTop > 4
  growRenderWindow(scrollTop)
})

/**
 * 触底：**先把渲染窗口放大**（同步完成），窗口覆盖全部已加载数据之后才去拉下一页。
 * ⚠️ 这样即使 onPageScroll 的估算有偏差，触底也一定会继续出内容，不会"滚到底没东西"。
 */
onReachBottom(() => {
  const total = products.value.length
  if (visibleCount.value < total) {
    visibleCount.value = Math.min(total, visibleCount.value + RENDER_BATCH)
    return
  }
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
        <!-- 品牌块：logo 在上、slogan 在**下方**（2026-09-22 用户澄清位置）；文案不带句号，按用户原文 -->
        <view class="brand-block">
          <image class="brand-logo" src="/static/figma-home/brand-logo.png" mode="aspectFit" />
          <text class="brand-slogan">非遗老字号，礼承中国心</text>
        </view>
      </view>
      <view class="search-row">
        <view class="search-pill" @click="goSearch">
          <text class="rider-icon rider-icon-sousuo search-icon" aria-hidden="true" />
          <text class="search-placeholder">老字号精选好物</text>
        </view>
        <button class="share-pill" @click="openSharePoster">
          <text class="rider-icon rider-icon-fenxiang share-icon" aria-hidden="true" />
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
        <HomeProductCard v-for="item in visibleProducts" :key="item.id" :product="item" mode="list" @select="goProduct" />
      </view>

      <view v-if="!loading && !products.length && !loadError" class="empty-products">暂无精选商品</view>
      <view v-if="loadingMore" class="load-more">正在加载更多</view>
      <!-- ⚠️ 「已经到底了」必须同时满足「没有下一页」**和**「渲染窗口已经放到全部数据」——
           否则虚拟滚动下会出现"提示已经到底了，但用户再滚还能滚出新商品"的矛盾。 -->
      <view v-else-if="!hasMore && products.length && visibleCount >= products.length" class="load-more">已经到底了</view>
    </view>

    <HomeWelfare v-model:active-tab="welfareTab" :welfare="welfareConfig" @image-tap="goWelfareImage" />
    <HomeSharePoster v-model="sharePosterVisible" :code-url="sharePosterCodeUrl" :share-link="shareLink" />
  </view>
</template>

<style>
/* 页面底色改浅灰（2026-09-22 用户要求）：
   商品卡是白色 + 双层阴影，压在纯白底上阴影几乎看不见、卡片"贴"在背景里；
   换成浅灰后白卡自然浮起来，立体感才成立（金刚区/福利区等白色区块也更有层次）。 */
.home-page { display: flex; width: 100%; min-height: 100vh; flex-direction: column; align-items: center; background: #f5f6f8; color: #1d2129; }
.top-shell { position: relative; z-index: 5; width: 100%; box-sizing: border-box; background: #fff; transition: box-shadow .2s ease; }
.top-shell.scrolled { position: sticky; top: 0; box-shadow: 0 2rpx 16rpx rgba(29, 33, 41, .08); }
/* 品牌块：logo + 下方 slogan 两行（2026-09-22 用户要求 slogan 放在 logo 下方）。
   原来固定 height:96rpx 装不下两行，改为内边距撑开 —— 顶部区域总高由内容自然决定，
   navStyle 只负责状态栏 paddingTop，所以这里加高不会影响吸顶（sticky）逻辑。 */
.brand-row { display: flex; width: 100%; align-items: center; padding: 16rpx 24rpx 6rpx; box-sizing: border-box; }
.brand-block { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 6rpx; }
.brand-logo { width: 169rpx; height: 64rpx; }
/* 品牌 slogan：低饱和金棕、字号略小于正文；flex:1 + 居中 —— logo 与胶囊之间刚好留出这段文案 */
/* slogan 跟在 logo 下方、左对齐（不再居中/占满整行）；低饱和金棕、字号略小于正文 */
.brand-slogan { color: #8a6a3b; font-size: 24rpx; font-weight: 500; letter-spacing: 1rpx; line-height: 32rpx; }
.search-row { display: flex; width: 100%; height: 104rpx; align-items: center; gap: 16rpx; padding: 8rpx 24rpx 0; box-sizing: border-box; }
.search-pill, .share-pill { display: flex; height: 72rpx; align-items: center; box-sizing: border-box; border: 0; border-radius: 999rpx; background: #f1f2f4; color: #86909c; font-size: 30rpx; line-height: 48rpx; }
.search-pill { flex: 1; gap: 12rpx; padding: 0 24rpx; }
.share-pill { width: 128rpx; flex-shrink: 0; justify-content: center; gap: 8rpx; padding: 0; }
.share-pill::after { border: 0; }
/* 2026-09-22: was a CSS-drawn circle faking a magnifier (no handle) -> now iconfont rider-icon-sousuo */
.search-icon { flex-shrink: 0; }
.search-icon::after { position: absolute; right: -8rpx; bottom: -5rpx; width: 14rpx; height: 3rpx; transform: rotate(45deg); background: #86909c; content: ''; }
.share-icon { color: #4e5969; font-size: 34rpx; line-height: 1; }
.hero-module { width: calc(100% - 16px); margin-bottom: 12px; padding-bottom: 16rpx; box-sizing: border-box; overflow: hidden; border-radius: 16rpx; background: #148c48; }
.hero-swiper, .hero-placeholder { width: 100%; height: 280rpx; overflow: hidden; border-radius: 16rpx; }
.hero-placeholder { background: #f1f2f4; }
/* 占位底色必须用浅灰（与 .hero-placeholder 一致）。
   原来是一个深红：hero 图带透明边、或还没加载完时会沿图片四周露出，看起来就像给轮播图加了红框
   —— 与商品卡 .product-image 那个老问题同类（2026-09-19 一并修）。 */
.hero-slide { position: relative; width: 100%; height: 280rpx; overflow: hidden; border-radius: 16rpx; background: #f1f2f4; }
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

/* 搜索 / 分享图标（2026-09-22 用户反馈「icon 不正确」）：
   原实现里搜索是个**空** <text>（根本看不见图标），分享用的是文字字符「↗」。
   现改用 iconfont —— 字体在 styles/rider-iconfont.wxss 已全局加载（iconfont 项目 5230143 完整字体，
   19 个图标），其中 search = rider-icon-sousuo(\e89b)、share = rider-icon-fenxiang(\e898)。 */
.search-pill .search-icon { font-size: 30rpx; line-height: 1; color: #86909c; }
.share-pill .share-icon { font-size: 32rpx; line-height: 1; color: #4e5969; }
</style>
