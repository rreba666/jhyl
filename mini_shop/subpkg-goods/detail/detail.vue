<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad, onShareAppMessage, onShow } from '@dcloudio/uni-app'
import { addSkuToCartWithStock } from '@/api/cart'
import { favoriteProduct, unfavoriteProduct } from '@/api/favorite'
import { getUserProfile, type UserProfile } from '@/api/user'
import { getProductDetail, type ProductDetail } from '@/api/product'
import { getAuth, isLoggedIn, isRegisteredUser } from '@/utils/auth'
import { bindStoredPromotionIfLoggedIn, buildPromotionSharePath, capturePromotionContext } from '@/utils/promotion'
import { getPromotionCode } from '@/api/promotion'
import { isApiRequestError } from '@/utils/request'
import { PURCHASE_LIMIT_ERROR_CODE, PURCHASE_LIMIT_MESSAGE } from '@/utils/dividend-limit'
import PromotionCodePoster from '@/components/PromotionCodePoster.vue'
import LoginGuide from '@/components/LoginGuide.vue'

const menuTop = ref(0)
const menuHeight = ref(32)
const user = ref<UserProfile | null>(null)
const product = ref<ProductDetail | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const actionLoading = ref(false)
const paymentNavigationLoading = ref(false)
/** 当前商品是否已收藏（进页从详情 favorite 字段初始化）。 */
const favorite = ref(false)
/** 收藏操作进行中，防止连点重复请求。 */
const favoriteLoading = ref(false)
/** 分享抽屉（转发按钮弹出：推广码 / 分享好友）。 */
const shareSheetVisible = ref(false)
/** 推广码弹窗状态。 */
const promotionCodeVisible = ref(false)
const promotionCodeLoading = ref(false)
const promotionCodeUrl = ref('')
const loginGuideVisible = ref(false)

const navStyle = computed(() => ({ top: `${menuTop.value}px`, height: `${menuHeight.value}px` }))
const bodyTop = computed(() => menuTop.value + menuHeight.value + 10)

/** 合并主图和轮播图，去重后作为详情页顶部轮播数据。 */
const galleryImages = computed(() => {
  if (!product.value) return []
  return Array.from(new Set((product.value.images || []).filter(Boolean)))
})

/** 没有轮播图时使用商品主图作为静态封面，不把主图混入轮播序列。 */
const coverImage = computed(() => product.value?.mainImage || galleryImages.value[0] || '')

/**
 * 详情图列表（后端 `ProductDetailV2VO.detailImages` 下发的是 **OSS 直链数组**）。
 * ⚠️ 为空时**整块（标题 + 灰底容器）都不渲染**：`.detail-media` 有 `min-height: 520rpx` + 灰底，
 * 没有图时会留一块灰板，看起来就像"详情图没显示出来"（2026-09-22 用户反馈的观感问题之一）。
 */
const detailImageList = computed(() => (product.value?.detailImages || []).filter(Boolean))

/**
 * 加载失败的详情图 URL 集合。
 * 长图/超大图在部分机型与基础库上会加载失败（`@error` 不会冒泡，容易被误认为"后端没下发"），
 * 因此这里单独记下来给一句提示，并且**失败也允许点开**用微信原生预览看原图。
 * 不需要在商品切换时清空：详情页每次都是新的页面实例。
 */
const failedDetailImages = ref<Set<string>>(new Set())

function onDetailImageError(image: string): void {
  failedDetailImages.value = new Set(failedDetailImages.value).add(image)
}

/**
 * 点详情图 → 微信原生预览。
 * 长图在本页里是按宽度自适应的（`mode="widthFix"`），细节会被压得很小；
 * 原生预览支持双指缩放，是查看长图内容最可靠的方式（也是渲染失败时的兜底出口）。
 */
function previewDetailImage(index: number): void {
  const urls = detailImageList.value
  if (!urls.length) return
  uni.previewImage({ urls, current: urls[index] })
}

/** 默认选择第一个可用 SKU，详情页暂按该 SKU 进行加购和立即支付。 */
const selectedSku = computed(() => product.value?.skuList.find((sku) => sku.enabled !== 0) || product.value?.skuList[0])

/** 展示价格：从「SKU 划线价 → SKU 售价 → 商品最低价」中取第一个大于 0 的值（0 视为未设置，不能当价格用）。 */
const displayPrice = computed(() => {
  const candidates = [selectedSku.value?.originalPrice, selectedSku.value?.price, product.value?.minPrice]
  const hit = candidates.find((value) => Number(value) > 0)
  return Number(hit ?? 0)
})

/** 展示推广资金，整数金额不显示多余的小数位。 */
const promotionFundText = computed(() => formatAmount(product.value?.promotionFund || 0))

/** 仅在后端明确启用推广资金且金额有效时展示推广区域。 */
const promotionVisible = computed(() => {
  const enabled = product.value?.promotionEnabled
  return isRegisteredUser(user.value?.identity)
    && (enabled === 1 || enabled === '1' || enabled === true)
    && Number(product.value?.promotionFund || 0) > 0
})

/** 将金额格式化为设计稿使用的紧凑形式。 */
function formatAmount(value: number): string {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '')
}

/** 读取页面参数并加载商品详情。 */
onLoad(async (options) => {
  capturePromotionContext(options as Record<string, unknown>)
  void bindStoredPromotionIfLoggedIn()
  if (!options?.id) {
    errorMessage.value = '商品参数缺失'
    loading.value = false
    return
  }
  // 商品详情是公开接口，先启动商品请求，避免用户资料接口阻塞游客首屏。
  const productRequest = getProductDetail(String(options.id))
  const profileRequest = isLoggedIn()
    ? getUserProfile().catch(() => null)
    : Promise.resolve(null)
  try {
    product.value = await productRequest
    favorite.value = Boolean(product.value.favorite)
    user.value = await profileRequest
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '商品详情加载失败'
  } finally {
    loading.value = false
  }
})


/** 商品详情原生转发保留商品 ID，并附带当前推广者身份。 */
onShareAppMessage(() => {
  const productId = product.value?.id
  const path = productId ? `/subpkg-goods/detail/detail?id=${encodeURIComponent(String(productId))}` : '/pages/index/index'
  return { title: product.value?.name || '商品详情', path: buildPromotionSharePath(path) }
})

/** 返回上一级页面，没有历史页面时回到首页。 */
function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1 })
    return
  }
  uni.switchTab({ url: '/pages/index/index' })
}

/** 返回购物车 TabBar 页面。 */
function goCart(): void {
  uni.switchTab({ url: '/pages/cart/cart' })
}

/** 切换收藏状态：已收藏→取消，未收藏→收藏。 */
async function toggleFavorite(): Promise<void> {
  if (!product.value || favoriteLoading.value) return
  if (!isLoggedIn()) {
    loginGuideVisible.value = true
    return
  }
  favoriteLoading.value = true
  try {
    if (favorite.value) {
      await unfavoriteProduct(product.value.id)
      favorite.value = false
    } else {
      await favoriteProduct(product.value.id)
      favorite.value = true
    }
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
  } finally {
    favoriteLoading.value = false
  }
}

/** 将当前商品默认 SKU 加入购物车。 */
async function addProductToCart(): Promise<void> {
  if (!product.value || actionLoading.value) return
  if (!isLoggedIn()) {
    loginGuideVisible.value = true
    return
  }
  const sku = selectedSku.value
  if (!sku) {
    uni.showToast({ title: '商品库存不足', icon: 'none' })
    return
  }
  actionLoading.value = true
  try {
    await addSkuToCartWithStock({
      productId: Number(product.value.id),
      skuId: Number(sku.id),
      stock: Number(sku.stock),
      quantity: 1,
      dividendEnabled: product.value.dividendEnabled,
      price: Number(sku.price),
    })
    uni.showToast({ title: '已加入购物车', icon: 'success' })
  } catch (error) {
    uni.showToast({
      title: isApiRequestError(error) && error.code === 3001
        ? '库存不足'
        : isApiRequestError(error) && error.code === PURCHASE_LIMIT_ERROR_CODE
          ? PURCHASE_LIMIT_MESSAGE
          : (error instanceof Error ? error.message : '加入购物车失败'),
      icon: 'none',
    })
  } finally {
    actionLoading.value = false
  }
}

/** 立即购买：直接跳转确认订单页，由支付页按 skuId 直接下单（items），不污染购物车。 */
async function buyNow(): Promise<void> {
  if (!product.value || actionLoading.value || paymentNavigationLoading.value) return
  if (!isLoggedIn()) {
    loginGuideVisible.value = true
    return
  }
  const skuId = selectedSku.value?.id
  const stock = Number(selectedSku.value?.stock ?? 0)
  if (!skuId || !Number.isFinite(stock) || stock <= 0) {
    uni.showToast({ title: '暂无可购买规格', icon: 'none' })
    return
  }
  paymentNavigationLoading.value = true
  uni.navigateTo({
    url: `/subpkg-order/payment/payment?productId=${product.value.id}&skuId=${skuId}&quantity=1`,
    fail: (error) => {
      paymentNavigationLoading.value = false
      uni.showToast({ title: error?.errMsg || '打开确认订单失败', icon: 'none' })
    },
  })
}

/** 打开分享抽屉。 */
function openShareSheet(): void {
  shareSheetVisible.value = true
}

/** 关闭分享抽屉。 */
function closeShareSheet(): void {
  shareSheetVisible.value = false
}

/** 生成并展示带当前推广者身份的小程序码（扫码进入首页后自动绑定关系）。 */
async function openPromotionCode(): Promise<void> {
  shareSheetVisible.value = false
  if (promotionCodeLoading.value) return
  if (!isLoggedIn() || !getAuth()?.userId) {
    loginGuideVisible.value = true
    return
  }
  promotionCodeLoading.value = true
  promotionCodeVisible.value = true
  try {
    promotionCodeUrl.value = await getPromotionCode()
    if (!promotionCodeUrl.value) throw new Error('推广码地址为空')
  } catch (error) {
    promotionCodeVisible.value = false
    uni.showToast({ title: error instanceof Error ? error.message : '推广码生成失败', icon: 'none' })
  } finally {
    promotionCodeLoading.value = false
  }
}

/** 获取胶囊按钮位置，让自定义返回按钮与系统导航区域对齐。 */
onMounted(() => {
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect) {
      menuTop.value = rect.top
      menuHeight.value = rect.height
    }
  } catch {
    // 非微信环境没有胶囊按钮，使用默认导航尺寸。
  }
})

onShow(() => {
  // 从确认订单页返回时允许再次购买。
  paymentNavigationLoading.value = false
})
</script>

<template>
  <view class="detail-page">
    <view class="nav" :style="navStyle">
      <image class="back-button" src="/static/left_arrow.png" mode="aspectFit" @click="goBack" />
    </view>

    <scroll-view class="detail-scroll" scroll-y :style="{ paddingTop: `${bodyTop}px` }">
      <view v-show="loading" class="state">加载中...</view>
      <view v-show="!loading && errorMessage" class="state error">{{ errorMessage }}</view>

      <view v-show="!loading && !errorMessage && product" class="product-body">
        <swiper v-if="galleryImages.length" class="gallery" circular indicator-dots>
          <swiper-item v-for="image in galleryImages" :key="image"><image class="gallery-image" :src="image" mode="aspectFill" /></swiper-item>
        </swiper>
        <image v-else class="gallery gallery-image single" :src="coverImage" mode="aspectFill" />

        <view class="summary">
          <text class="price">¥{{ formatAmount(displayPrice) }}</text>
          <view class="title-row">
            <text class="name">{{ product?.name }}</text>
            <view class="title-icons">
              <image class="title-icon" :src="favorite ? '/static/ProductDetails/已收藏_slices/已收藏.png' : '/static/ProductDetails/收藏_slices/收藏.png'" mode="aspectFit" @click="toggleFavorite" />
              <image class="title-icon" src="/static/ProductDetails/分享_slices/分享.png" mode="aspectFit" @click="openShareSheet" />
            </view>
          </view>
          <text class="description">{{ product?.description || product?.descriptionTitle || '' }}</text>

          <view v-show="promotionVisible" class="promotion-row">
            <text class="promotion-label">分享本商品成功可得</text>
            <text class="promotion-value">{{ promotionFundText }}</text>
            <text class="promotion-label">推广金</text>
          </view>

          <view class="tag-row">
            <view class="tag"><image class="tag-icon" src="/static/ProductDetails/包邮_slices/包邮.png" mode="aspectFit" /><text>包邮</text></view>
            <view class="tag"><image class="tag-icon" src="/static/ProductDetails/七天无理由_slices/七天无理由.png" mode="aspectFit" /><text>七天无理由</text></view>
          </view>
        </view>

        <!-- 详情图（2026-09-22 加固）：没有详情图时**不渲染这一整块**（避免留灰板）；
             单张加载失败只标记该张并提示，用户可点图用原生预览看原图 -->
        <template v-if="detailImageList.length">
          <view class="detail-heading"><text>产品详情</text></view>
          <view class="detail-media">
            <image
              v-for="(image, index) in detailImageList"
              :key="image"
              class="product-detail-image"
              :class="{ 'is-failed': failedDetailImages.has(image) }"
              :src="image"
              mode="widthFix"
              @click="previewDetailImage(index)"
              @error="onDetailImageError(image)"
            />
            <view v-if="failedDetailImages.size" class="detail-image-tip">有详情图加载失败，点图可查看原图</view>
          </view>
        </template>
      </view>
    </scroll-view>

    <view v-show="!loading && !errorMessage && product" class="product-detail-actions">
      <view class="cart-action" @click="goCart"><image class="cart-icon" src="/static/ProductDetails/购物车_slices/购物车.png" mode="aspectFit" /><text>购物车</text></view>
      <view class="action-button add-button" @click="addProductToCart">加入购物车</view>
      <view class="action-button buy-button" :class="{ disabled: paymentNavigationLoading }" @click="buyNow">{{ paymentNavigationLoading ? '打开中...' : '立即支付' }}</view>
    </view>

    <!-- 分享抽屉（推广码 / 分享好友） -->
    <view v-show="shareSheetVisible" class="mask share-mask" @click="closeShareSheet">
      <view class="share-sheet" @click.stop>
        <view class="share-sheet-head"><text>分享商品</text></view>
        <view class="share-option" @click="openPromotionCode">
          <view class="share-option-main"><text class="share-option-title">推广码</text></view>
        </view>
        <button class="share-option share-option-button" open-type="share" @click="closeShareSheet">
          <view class="share-option-main"><text class="share-option-title">分享好友</text></view>
        </button>
      </view>
    </view>

    <PromotionCodePoster v-model="promotionCodeVisible" :loading="promotionCodeLoading" :code-url="promotionCodeUrl" />
    <LoginGuide v-model="loginGuideVisible" />
  </view>
</template>

<style>
.detail-page { height: 100vh; overflow: hidden; background: #fff; color: #222; }
.nav { position: fixed; left: 0; right: 0; z-index: 30; display: flex; align-items: center; padding-left: 20rpx; background: #fff; box-sizing: border-box; }
.back-button { width: 40rpx; height: 40rpx; }
.detail-scroll { width: 100%; height: 100vh; padding-bottom: 140rpx; box-sizing: border-box; }
.product-body { background: #fff; }
.gallery { width: 100%; height: 100vw; background: #d7d7d7; }
.gallery-empty { display: block; }
.gallery-image { width: 100%; height: 100%; }
.summary { padding: 22rpx 20rpx 0; background: #fff; }
.price { display: block; color: #d40000; font-size: 40rpx; font-weight: 700; line-height: 1.2; }
.title-row { display: flex; align-items: flex-start; justify-content: space-between; margin-top: 22rpx; gap: 18rpx; }
.name { flex: 1; min-width: 0; color: #222; font-size: 32rpx; font-weight: 600; line-height: 1.35; }
.title-icons { display: flex; flex-shrink: 0; align-items: center; gap: 36rpx; padding-top: 4rpx; }
.title-icon { width: 40rpx; height: 40rpx; flex-shrink: 0; }
.description { display: block; margin-top: 16rpx; color: #999; font-size: 24rpx; line-height: 1.45; }
.promotion-row { display: flex; align-items: center; min-height: 74rpx; margin-top: 24rpx; padding: 0 18rpx; background: #fff0e6; box-sizing: border-box; }
.promotion-label { color: #444; font-size: 23rpx; white-space: nowrap; }
.promotion-value { margin: 0 10rpx; color: #df1919; font-size: 34rpx; font-weight: 700; line-height: 1; }
.tag-row { display: flex; align-items: center; gap: 32rpx; padding: 24rpx 0 28rpx; border-bottom: 1px solid #eee; }
.tag { display: flex; align-items: center; color: #555; font-size: 23rpx; }
.tag-icon { width: 36rpx; height: 36rpx; margin-right: 12rpx; flex-shrink: 0; }
.detail-heading { display: flex; align-items: center; justify-content: center; height: 116rpx; color: #555; background: #fff; font-size: 25rpx; }
.detail-media { min-height: 520rpx; background: #d6d6d6; }
.product-detail-image { display: block; width: 100%; height: auto; }
/* 加载失败的那张：给一块可点的浅灰底 + 保留高度，避免长图失败后整块塌成一条线 */
.product-detail-image.is-failed { min-height: 240rpx; background: #f2f2f2; }
.detail-image-tip { padding: 16rpx 0; color: #86909c; font-size: 24rpx; text-align: center; }
.product-detail-actions { position: fixed; right: 0; bottom: 0; left: 0; z-index: 40; display: flex; align-items: center; gap: 12rpx; padding: 12rpx 20rpx calc(12rpx + env(safe-area-inset-bottom)); background: #fff; box-sizing: border-box; }
.cart-action { display: flex; width: 124rpx; flex-shrink: 0; flex-direction: column; align-items: center; justify-content: center; color: #333; font-size: 22rpx; }
.cart-icon { width: 64rpx; height: 64rpx; margin-bottom: 2rpx; flex-shrink: 0; }
.action-button { display: flex; align-items: center; justify-content: center; height: 82rpx; font-size: 28rpx; box-sizing: border-box; }
.add-button { flex: 1; border: 2rpx solid #222; color: #222; background: #fff; }
.buy-button { flex: 1; color: #fff; background: #050505; }
.action-button.disabled { opacity: .55; }
.state { padding: 180rpx 32rpx; color: #8a96a8; text-align: center; }
.error { color: #d94d3f; }
/* 分享抽屉 */
.share-mask { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .5); }
.share-sheet { width: 100%; padding: 30rpx 28rpx calc(30rpx + env(safe-area-inset-bottom)); background: #fff; box-sizing: border-box; border-radius: 24rpx 24rpx 0 0; }
.share-sheet-head { display: flex; justify-content: center; padding: 10rpx 0 24rpx; color: #222; font-size: 30rpx; font-weight: 700; }
.share-option { display: flex; align-items: center; min-height: 100rpx; padding: 0 24rpx; border-top: 1px solid #f2f2f2; }
.share-option-button { width: 100%; margin: 0; background: #fff; border: none; line-height: normal; text-align: left; box-sizing: border-box; }
.share-option-button::after { border: 0; }
.share-option-main { display: flex; flex-direction: column; align-items: flex-start; }
.share-option-title { color: #222; font-size: 28rpx; font-weight: 600; }
.sheet-head { position: relative; display: flex; align-items: center; justify-content: center; min-height: 54rpx; }
.sheet-title { color: #222; font-size: 30rpx; font-weight: 700; }
.sheet-close { position: absolute; right: 0; color: #888; font-size: 42rpx; font-weight: 300; line-height: 1; }
</style>
