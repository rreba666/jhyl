<script setup lang="ts">
import { onLoad, onReachBottom } from '@dcloudio/uni-app'
import { computed, onMounted, ref } from 'vue'
import { getProductList, type ProductCard } from '@/api/product'
import RequestState from '@/components/RequestState.vue'
// ⚠️ 2026-09-29：商品卡片改为**复用首页的同一个组件**（用户要求「与首页商品卡片一致」）
import HomeProductCard from '@/components/home/HomeProductCard.vue'
import { cleanText } from '@/utils/input-validation'

const SEARCH_KEYWORD_MAX_LENGTH = 50
const keyword = ref('')
const sortBy = ref('')
const products = ref<ProductCard[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const loaded = ref(false)
const loadError = ref('')
const systemWidth = ref(0)
const menuTop = ref(0)
const menuLeft = ref(0)
const menuHeight = ref(32)

/** 搜索栏与微信胶囊按钮保持同一水平基线，并避开胶囊区域。 */
const navStyle = computed(() => {
  if (!systemWidth.value || !menuLeft.value) return { height: '104rpx' }
  return {
    height: `${menuTop.value + menuHeight.value}px`,
    paddingTop: `${menuTop.value}px`,
    paddingRight: `${systemWidth.value - menuLeft.value + 12}px`,
  }
})

const sortOptions = [
  { value: '', label: '综合' },
  { value: 'sold_desc', label: '热销' },
  { value: 'price_asc', label: '价格升序' },
  { value: 'price_desc', label: '价格降序' },
  { value: 'new_desc', label: '新品' },
]

/** 查询商品列表，搜索和排序变化时从第一页重新加载。 */
async function load(reset = true): Promise<void> {
  if (loading.value || loadingMore.value) return
  if (!reset && products.value.length >= total.value) return
  const nextPage = reset ? 1 : page.value + 1
  if (reset) loadError.value = ''
  if (reset) loading.value = true
  else loadingMore.value = true
  try {
    const result = await getProductList({
      keyword: keyword.value,
      sortBy: sortBy.value || undefined,
      page: nextPage,
      pageSize: 12,
    })
    products.value = reset ? result.list : [...products.value, ...result.list]
    page.value = result.page || nextPage
    total.value = Number(result.total || products.value.length)
    loaded.value = true
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '商品查询失败，请重试'
    uni.showToast({ title: error instanceof Error ? error.message : '商品查询失败', icon: 'none' })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

/** 提交关键词搜索。 */
function submitSearch(): void {
  const normalized = cleanText(keyword.value)
  if (Array.from(normalized).length > SEARCH_KEYWORD_MAX_LENGTH) {
    uni.showToast({ title: `搜索内容不能超过${SEARCH_KEYWORD_MAX_LENGTH}个字符`, icon: 'none' })
    return
  }
  keyword.value = normalized
  void load(true)
}

function retrySearch(): void { void load(true) }

/** 切换排序方式并刷新商品列表。 */
function changeSort(value: string): void {
  if (sortBy.value === value) return
  sortBy.value = value
  void load(true)
}

/** 打开商品详情页。 */
function goDetail(id: string | number): void { uni.navigateTo({ url: `/subpkg-goods/detail/detail?id=${id}` }) }

onLoad((options?: Record<string, string | undefined>) => {
  keyword.value = Array.from(cleanText(options?.keyword || '')).slice(0, SEARCH_KEYWORD_MAX_LENGTH).join('')
  void load(true)
})
onReachBottom(() => { void load(false) })

onMounted(() => {
  try {
    const system = uni.getSystemInfoSync()
    systemWidth.value = system.windowWidth || 0
  } catch { /* 非微信环境使用 CSS 兜底布局 */ }
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect) {
      menuTop.value = rect.top
      menuLeft.value = rect.left
      menuHeight.value = rect.height
    }
  } catch { /* 非微信环境使用 CSS 兜底布局 */ }
})
</script>

<template>
  <view class="page">
    <view class="nav" :style="navStyle">
      <view class="back" @click="uni.navigateBack()">‹</view>
      <view class="search-box">
        <input v-model="keyword" class="search-input" maxlength="50" confirm-type="search" placeholder="搜索商品" @confirm="submitSearch" />
        <text class="search-action" @click="submitSearch">搜索</text>
      </view>
    </view>

    <view class="sort-row">
      <text
        v-for="option in sortOptions"
        :key="option.value || 'default'"
        class="sort-item"
        :class="{ active: sortBy === option.value }"
        @click="changeSort(option.value)"
      >{{ option.label }}</text>
    </view>

    <scroll-view class="content" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false" @scrolltolower="load(false)">
      <view v-show="loading && !products.length" class="state">加载中...</view>
      <RequestState v-if="!loading && !products.length && loadError" :error="loadError" @retry="retrySearch" />
      <view v-show="!loading && loaded && !loadError && !products.length" class="state">暂无相关商品</view>
      <!-- ⚠️ 2026-09-29：卡片**复用首页的 `HomeProductCard`**（用户要求「与首页商品卡片一致」）。
           好处：外观天然一致（白底渐变 + 24rpx 圆角 + 双层阴影），且自带**骨架扫光 + 加载完弹性渐入**；
           原先这里是另写的一套简易卡片（无圆角无阴影、无加载反馈），两边容易漂移。
           ⚠️ 列宽已通过下面的 `.content` padding 与 `.grid` gap 对齐首页（同为 351rpx）。 -->
      <view v-show="products.length" class="grid">
        <HomeProductCard v-for="item in products" :key="String(item.id)" :product="item" mode="grid" @select="goDetail" />
      </view>
      <view v-show="loadingMore" class="more">加载更多...</view>
      <view v-show="loaded && !loading && !loadingMore && products.length > 0 && products.length >= total" class="more">没有更多了</view>
    </scroll-view>
  </view>
</template>

<style>
.page { display: flex; flex-direction: column; height: 100vh; background: #fff; color: #222; }
/**
 * 顶部搜索栏。
 * ⚠️ 2026-09-29：**去掉 `border-bottom`**（原为 `1px solid #f0f0f0`）。
 *    原因：下方 `.sort-row` 加了 `margin-top: 20rpx` 之后，这条线**悬空在搜索框与选项行之间**，
 *    看起来像"选项行的上边框"（用户反馈"有一条灰色细线贯穿搜索框下方"）✗。
 *    选项行自身已有 `border-bottom` 负责与商品区分隔，所以去掉这条不会失去层次。
 */
.nav { display: flex; align-items: center; flex-shrink: 0; height: auto; padding: 0 24rpx; box-sizing: border-box; }
.back { width: 52rpx; color: #222; font-size: 56rpx; line-height: 1; text-align: left; }
.search-box { display: flex; flex: 1; align-items: center; height: 68rpx; margin-left: 12rpx; padding: 0 22rpx; background: #f5f5f5; border-radius: 34rpx; box-sizing: border-box; }
.search-input { flex: 1; min-width: 0; color: #222; font-size: 26rpx; }
.search-action { margin-left: 16rpx; color: #222; font-size: 25rpx; font-weight: 600; }
/**
 * 排序选项行。
 * ⚠️ 2026-09-29：加 `margin-top` 与上方搜索框**拉开间距**（用户反馈「选项和搜索框挨太紧」）。
 * ⚠️ `align-items: stretch` 是为了让 `.sort-item` 撑满整行高度 —— 选中态的**底部指示条**要贴行底才准。
 */
.sort-row { display: flex; align-items: stretch; gap: 44rpx; height: 88rpx; margin-top: 20rpx; padding: 0 28rpx; border-bottom: 1px solid #f2f2f2; box-sizing: border-box; white-space: nowrap; }
/**
 * 排序选项（**淘宝式两态**）。
 * ⚠️ 2026-09-29 用户要求「选中的时候和选项可以来点样式，可以像淘宝那样」：
 *    原来选中只是 `color:#222 + 加粗`，太弱、一眼看不出选的是哪个。
 *    ⇒ 改为「未选中：灰字；选中：**主色 + 加粗 + 下方圆角短横条指示器**」。
 * ⚠️ 主色取首页同一个 `#ff5500`（首页搜索框描边就是这个色），保持全站一致。
 */
.sort-item { position: relative; display: flex; align-items: center; color: #666; font-size: 26rpx; transition: color .15s ease; }
.sort-item.active { color: #ff5500; font-weight: 700; }
/* 选中指示条：居中的圆角短横条（淘宝筛选栏同款） */
.sort-item.active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 14rpx;
  width: 36rpx;
  height: 6rpx;
  border-radius: 3rpx;
  background: #ff5500;
  transform: translateX(-50%);
}
/**
 * 商品区：左右 padding 与列间距**对齐首页**
 * （首页 `.product-section { padding: 0 16rpx }` + `.product-waterfall { gap: 16rpx }` ⇒ 列宽 351rpx）。
 * 这样两页的卡片宽度一致，看起来才是"同一个卡片"。
 */
.content { flex: 1; min-height: 0; padding: 24rpx 16rpx 40rpx; box-sizing: border-box; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24rpx 16rpx; }
/*
 * ⚠️ 2026-09-29：原先这里有一整套自写的卡片样式（`.card` / `.image` / `.card-body` / `.name` /
 * `.description` / `.card-bottom` / `.price` / `.currency` / `.amount` / `.tag`）——
 * 现已改用首页的 `HomeProductCard` 组件（自带白底渐变 + 24rpx 圆角 + 双层阴影 + 骨架扫光 + 渐入），
 * 这些样式**已全部删除**：留着会与组件自带的外框叠加成"双边框"。
 */
.state, .more { padding: 160rpx 0; color: #999; font-size: 26rpx; text-align: center; }
.more { padding: 28rpx 0; }
</style>
