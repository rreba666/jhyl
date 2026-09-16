<script setup lang="ts">
import { onLoad, onReachBottom } from '@dcloudio/uni-app'
import { computed, onMounted, ref } from 'vue'
import { getProductList, type ProductCard } from '@/api/product'
import RequestState from '@/components/RequestState.vue'
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

    <scroll-view class="content" scroll-y @scrolltolower="load(false)">
      <view v-show="loading && !products.length" class="state">加载中...</view>
      <RequestState v-if="!loading && !products.length && loadError" :error="loadError" @retry="retrySearch" />
      <view v-show="!loading && loaded && !loadError && !products.length" class="state">暂无相关商品</view>
      <view v-show="products.length" class="grid">
        <view v-for="item in products" :key="String(item.id)" class="card" @click="goDetail(item.id)">
          <image v-show="item.mainImage" class="image" :src="item.mainImage" mode="aspectFill" />
          <view v-show="!item.mainImage" class="image-placeholder" />
          <view class="card-body">
            <text class="name">{{ item.name }}</text>
            <text v-show="item.descriptionTitle" class="description">{{ item.descriptionTitle }}</text>
            <view class="card-bottom">
              <view class="price"><text class="currency">¥</text><text class="amount">{{ Number(item.originalPrice ?? item.minOriginalPrice ?? item.price ?? 0).toFixed(2) }}</text></view>
              <text v-show="item.tag" class="tag">{{ item.tag }}</text>
            </view>
          </view>
        </view>
      </view>
      <view v-show="loadingMore" class="more">加载更多...</view>
      <view v-show="loaded && !loading && !loadingMore && products.length > 0 && products.length >= total" class="more">没有更多了</view>
    </scroll-view>
  </view>
</template>

<style>
.page { display: flex; flex-direction: column; height: 100vh; background: #fff; color: #222; }
.nav { display: flex; align-items: center; flex-shrink: 0; height: auto; padding: 0 24rpx; box-sizing: border-box; border-bottom: 1px solid #f0f0f0; }
.back { width: 52rpx; color: #222; font-size: 56rpx; line-height: 1; text-align: left; }
.search-box { display: flex; flex: 1; align-items: center; height: 68rpx; margin-left: 12rpx; padding: 0 22rpx; background: #f5f5f5; border-radius: 34rpx; box-sizing: border-box; }
.search-input { flex: 1; min-width: 0; color: #222; font-size: 26rpx; }
.search-action { margin-left: 16rpx; color: #222; font-size: 25rpx; font-weight: 600; }
.sort-row { display: flex; align-items: center; gap: 34rpx; height: 78rpx; padding: 0 28rpx; border-bottom: 1px solid #f2f2f2; box-sizing: border-box; white-space: nowrap; }
.sort-item { color: #999; font-size: 24rpx; }
.sort-item.active { color: #222; font-weight: 700; }
.content { flex: 1; min-height: 0; padding: 24rpx 24rpx 40rpx; box-sizing: border-box; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28rpx 18rpx; }
.card { min-width: 0; overflow: hidden; background: #fff; }
.image, .image-placeholder { display: block; width: 100%; height: 328rpx; background: #f1f1f1; }
.card-body { padding: 16rpx 4rpx 0; }
.name, .description { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name { color: #222; font-size: 27rpx; font-weight: 600; }
.description { margin-top: 8rpx; color: #999; font-size: 22rpx; }
.card-bottom { display: flex; align-items: center; justify-content: space-between; gap: 10rpx; margin-top: 14rpx; }
.price { display: flex; align-items: baseline; min-width: 0; }
.currency { color: #222; font-size: 22rpx; }
.amount { margin-left: 2rpx; color: #222; font-size: 30rpx; font-weight: 700; }
.tag { flex-shrink: 0; color: #999; font-size: 21rpx; }
.state, .more { padding: 160rpx 0; color: #999; font-size: 26rpx; text-align: center; }
.more { padding: 28rpx 0; }
</style>
