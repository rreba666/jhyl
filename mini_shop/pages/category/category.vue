<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getCategoryList, getCategoryProducts, type CategoryNode, type CategoryProduct } from '@/api/category'
import { addSkuToCartWithStock } from '@/api/cart'
import { getProductDetail } from '@/api/product'
import { ApiRequestError, isApiRequestError } from '@/utils/request'
import { PURCHASE_LIMIT_ERROR_CODE, PURCHASE_LIMIT_MESSAGE } from '@/utils/dividend-limit'
import { createThrottle } from '@/utils/interaction'
import { isLoggedIn } from '@/utils/auth'
import RequestState from '@/components/RequestState.vue'
import LoginGuide from '@/components/LoginGuide.vue'

const menuTop = ref(0)
const menuLeft = ref(0)
const menuH = ref(32)
const winW = ref(375)

const navStyle = computed(() => ({ top: menuTop.value + 'px', height: menuH.value + 'px' }))
const schStyle = computed(() => {
  if (!menuLeft.value) return {}
  return { marginRight: (winW.value || 375) - menuLeft.value + 12 + 'px' }
})

/** 设计稿固定三个一级分类（接口不可用时兜底） */
const FALLBACK_CATS: CategoryNode[] = [
  { id: '1', name: '每周新品', icon: '' },
  { id: '2', name: '美妆个护', icon: '' },
  { id: '3', name: '养生保健', icon: '' },
]

const cats = ref<CategoryNode[]>([...FALLBACK_CATS])
const active = ref(0)
const goods = ref<CategoryProduct[]>([])
const categoryGoodsCache = new Map<string, CategoryProduct[]>()
let goodsRequestToken = 0
const loading = ref(true)
const loadError = ref('')
let categoryLoadPromise: Promise<void> | null = null
const busy = ref(false)
const cartAdding = ref(false)
const loginGuideVisible = ref(false)
const navigationThrottle = createThrottle(500)
const categorySwitchThrottle = createThrottle(250)
const bodyTop = computed(() => menuTop.value + menuH.value + 12)
/** 为左右内容区计算固定可视高度，避免页面整体滚动造成顶部导航穿透。 */
const scrollHeightStyle = computed(() => ({
  height: `calc(100vh - ${bodyTop.value + 64}px)`,
}))

/** 请求 GET /api/category/list 获取2级分类树，展示所有一级分类 */
async function loadCats(): Promise<void> {
  loadError.value = ''
  try {
    const list = await getCategoryList()
    if (list?.length) cats.value = list
  } catch (e) {
    console.error('分类列表加载失败:', e)
    loadError.value = e instanceof Error ? e.message : '分类加载失败，请重试'
  }
  await loadGoods(cats.value[active.value].id)
  loading.value = false
}

/** 复用分类首屏请求，避免 onMounted 与 onShow 重叠时重复加载。 */
function refreshCategories(): Promise<void> {
  if (categoryLoadPromise) return categoryLoadPromise
  const pending = loadCats()
  categoryLoadPromise = pending
  pending.then(
    () => { if (categoryLoadPromise === pending) categoryLoadPromise = null },
    () => { if (categoryLoadPromise === pending) categoryLoadPromise = null },
  )
  return pending
}


/** 请求 GET /api/product/list?categoryId= 获取商品 */
async function loadGoods(catId: string): Promise<void> {
  const requestToken = ++goodsRequestToken
  if (categoryGoodsCache.has(catId)) {
    goods.value = categoryGoodsCache.get(catId) || []
    busy.value = false
    return
  }

  busy.value = true
  try {
    const r = await getCategoryProducts(catId, 1, 20)
    const list = r?.list || []
    categoryGoodsCache.set(catId, list)
    if (requestToken === goodsRequestToken) goods.value = list
    if (r?.list?.length) console.log('分类商品加载成功:', r.list.length, '条, 首个:', JSON.stringify(r.list[0]))
  } catch (e) {
    console.error('分类商品加载失败:', e)
    if (requestToken === goodsRequestToken) {
      loadError.value = e instanceof Error ? e.message : '商品加载失败，请重试'
    }
  } finally {
    if (requestToken === goodsRequestToken) busy.value = false
  }
}

function switchCat(i: number): void {
  if (!categorySwitchThrottle()) return
  if (i === active.value) return
  active.value = i
  loadGoods(cats.value[i].id)
}
function goDetail(id: string): void {
  if (!navigationThrottle()) return
  uni.navigateTo({ url: `/subpkg-goods/detail/detail?id=${id}` })
}
function goHome(): void { uni.switchTab({ url: '/pages/index/index' }) }
function goSearch(): void {
  if (!navigationThrottle()) return
  uni.navigateTo({ url: '/subpkg-goods/search/index' })
}

/** 将商品加入购物车，阻止事件冒泡避免同时跳转详情 */
async function onAddCart(product: CategoryProduct): Promise<void> {
  if (cartAdding.value) return
  if (!isLoggedIn()) {
    loginGuideVisible.value = true
    return
  }
  cartAdding.value = true
  try {
    const detail = await getProductDetail(String(product.id))
    const sku = detail.skuList.find((item) => item.enabled !== 0) || detail.skuList[0]
    const stock = Number(sku?.stock ?? 0)
    if (!sku || !Number.isFinite(stock) || stock <= 0) {
      throw new ApiRequestError('库存不足', 3001)
    }
    await addSkuToCartWithStock({
      productId: Number(product.id),
      skuId: Number(sku.id),
      stock,
      quantity: 1,
      dividendEnabled: detail.dividendEnabled,
      price: Number(sku.price),
    })
    uni.showToast({ title: '已加入购物车', icon: 'success' })
  } catch (error) {
    uni.showToast({
      title: isApiRequestError(error) && error.code === 3001
        ? '库存不足'
        : isApiRequestError(error) && error.code === PURCHASE_LIMIT_ERROR_CODE
          ? PURCHASE_LIMIT_MESSAGE
          : (error instanceof Error ? error.message : '加购失败'),
      icon: 'none',
    })
  } finally {
    cartAdding.value = false
  }
}

onMounted(() => {
  try { const s = uni.getSystemInfoSync(); winW.value = s.windowWidth || 375 } catch { /* */ }
  try { const r = uni.getMenuButtonBoundingClientRect(); if (r) { menuTop.value = r.top; menuLeft.value = r.left; menuH.value = r.height } } catch { /* */ }
  // 始终加载数据，登录态由 API 服务器校验，失败时自动兜底
  void refreshCategories()
})

onShow(() => { void refreshCategories() })
</script>

<template>
  <view class="pg">

    <!-- ====== 导航栏（fixed，对齐胶囊） ====== -->
    <view class="nav" :style="navStyle">
      <text class="nav-tit">全部商品</text>
      <view class="nav-sch" :style="schStyle" @click="goSearch"><text class="nav-sch-txt">搜索商品</text></view>
    </view>

    <!-- ====== 主体 ====== -->
    <view class="bd" :style="{ paddingTop: bodyTop + 'px' }">
      <view class="bd-row">
        <!-- 左侧分类 113px=226rpx, bg #f9f9f9 -->
        <scroll-view class="side" scroll-y :style="scrollHeightStyle">
          <view v-for="(c, i) in cats" :key="c.id" class="side-it" :class="{ sel: i === active }" @click="switchCat(i)">
            <text>{{ c.name }}</text>
          </view>
          <view class="side-fill" />
        </scroll-view>

        <!-- 右侧商品 -->
        <scroll-view class="prod" scroll-y :style="scrollHeightStyle">
          <view v-show="!busy" class="prod-grid">
            <view v-for="it in goods" :key="it.id" class="card" @click="goDetail(it.id)">
              <view class="card-img">
                <image v-show="it.mainImage" class="c-img" :src="it.mainImage" mode="aspectFill" />
                <view v-show="!it.mainImage" class="c-img-ph" />
              </view>
              <text class="c-name">{{ it.name }}</text>
              <!-- 价格 + 加购：放在商品名下方，价格在左、加购在右，两端对齐 -->
              <view class="c-bot">
                <view class="c-pri" v-show="it.minPrice"><text class="p-y">¥</text><text class="p-n">{{ it.originalPrice ?? it.minOriginalPrice ?? it.minPrice }}</text></view>
                <view class="add-cart-btn" @click.stop="onAddCart(it)"><text class="add-cart-h"></text><text class="add-cart-v"></text></view>
              </view>
            </view>
          </view>
          <RequestState v-if="!busy && loadError" :error="loadError" @retry="loadCats" />
          <view v-show="!busy && !loadError && !goods.length && !loading" class="empty-msg"><text>暂无商品</text></view>
          <view v-show="loading" class="ld"><text class="ld-t">加载中...</text></view>
        </scroll-view>
      </view>
    </view>
    <LoginGuide v-model="loginGuideVisible" />
  </view>
</template>

<style>
.pg { display: flex; flex-direction: column; min-height: 100vh; background: #fff; }

/* ===== 导航栏 ===== */
.nav { position: fixed; left: 0; right: 0; z-index: 100; display: flex; align-items: center; padding-left: 26rpx; background: #fff; box-sizing: border-box; }
.nav-tit { color: #232423; font-size: 28rpx; font-weight: 600; flex-shrink: 0; }
.nav-sch { flex: 1; height: 68rpx; margin-left: 14rpx; background: rgba(214,214,214,.51); border-radius: 34rpx; display: flex; align-items: center; padding: 0 24rpx; }
.nav-sch-txt { color: #999; font-size: 26rpx; }

/* ===== 主体 ===== */
.bd { flex: 1; padding: 16rpx 14rpx 6rpx 0; }
.bd-row { display: flex; }

/* 侧边栏 */
.side { width: 180rpx; flex-shrink: 0; background: #f9f9f9; }
.side-it { display: flex; align-items: center; justify-content: center; height: 114rpx; background: #f7f7f7; }
.side-it text { color: #959595; font-size: 24rpx; font-weight: 500; }
.side-it.sel { background: #fff; border: 2rpx solid #f2f2f2; }
.side-it.sel text { color: #232423; font-size: 28rpx; font-weight: 600; }
.side-fill { height: 1000rpx; background: #f9f9f9; }

/* 商品区 */
.prod { flex: 1; padding: 16rpx 0 0 14rpx; }
.prod-grid { display: flex; flex-wrap: wrap; align-content: flex-start; justify-content: space-between; }
.card { width: 270rpx; margin-bottom: 24rpx; }
/* 图区 270rpx 正方，图片撑满 */
.card-img { width: 270rpx; height: 270rpx; background: #e9e7dd; position: relative; overflow: hidden; border-radius: 8rpx; }
.c-img { width: 100%; height: 100%; }
.c-img-ph { width: 100%; height: 100%; background: rgba(0,0,0,.05); }
/* 价格 + 加购：商品名下方，价格在左、加购在右，两端对齐 */
.c-bot { display: flex; width: 270rpx; align-items: center; justify-content: space-between; margin-top: 8rpx; }
.c-pri { display: flex; align-items: baseline; }
.p-y { color: #ff5500; font-size: 20rpx; font-weight: 500; }
.p-n { color: #ff5500; font-size: 30rpx; font-weight: 600; margin-left: 2rpx; }
/* 加购按钮：橙色圆形 + 号 */
.add-cart-btn { position: relative; width: 44rpx; height: 44rpx; border-radius: 50%; background: linear-gradient(135deg, #ffb341 0%, #ff5500 100%); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.add-cart-h { position: absolute; width: 18rpx; height: 3rpx; background: #fff; border-radius: 2rpx; }
.add-cart-v { position: absolute; width: 3rpx; height: 18rpx; background: #fff; border-radius: 2rpx; }
/* 商品名 */
.c-name { width: 270rpx; color: #0a0a0a; font-size: 24rpx; font-weight: 500; line-height: 30rpx; margin-top: 12rpx; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }

.ld { text-align: center; padding-top: 200rpx; }
.ld-t { color: #999; font-size: 28rpx; }
.empty-msg { text-align: center; padding-top: 200rpx; }
.empty-msg text { color: #999; font-size: 28rpx; }
</style>
