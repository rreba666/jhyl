<script setup lang="ts">
import { computed } from 'vue'
import type { CategoryProduct } from '@/api/category'

const props = withDefaults(defineProps<{
  product: CategoryProduct
  mode: 'horizontal' | 'grid'
  subtitle: string
  fallbackImage: string
}>(), {})

const emit = defineEmits<{
  select: [id: string]
  add: [product: CategoryProduct]
}>()

const imageUrl = computed(() => props.product.mainImage || props.fallbackImage)
/** 产地直接取商品自身信息（每个商品产地不同，不再由落地页/后台统一配置）。 */
const location = computed(() => props.product.originPlace || '')
const displayPrice = computed(() => {
  const price = Number(props.product.minPrice)
  return Number.isFinite(price) && price > 0 ? price.toFixed(2) : '299.00'
})

function selectProduct(): void {
  emit('select', String(props.product.id))
}

function addProduct(): void {
  emit('add', props.product)
}
</script>

<template>
  <view class="category-product-card" :class="`is-${mode}`" @click="selectProduct">
    <view class="category-product-image-wrap">
      <image class="category-product-image" :src="imageUrl" mode="aspectFill" />
    </view>
    <view class="category-product-copy">
      <view class="category-product-text">
        <text class="category-product-title">{{ product.descriptionTitle || product.name }}</text>
        <text class="category-product-subtitle">{{ product.description || subtitle }}</text>
        <view v-if="location" class="category-product-location">
          <image class="category-product-location-icon" src="/static/figma-category/location.svg" mode="aspectFit" />
          <text>{{ location }}</text>
        </view>
      </view>
      <view class="category-product-footer">
        <text class="category-product-price"><text class="category-product-currency">¥</text>{{ displayPrice }}</text>
        <view class="category-product-buy" @click.stop="addProduct">立即购买</view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.category-product-card { display: flex; box-sizing: border-box; overflow: hidden; border-radius: 16rpx; background: #fff; }
.category-product-card.is-horizontal { width: 100%; min-height: 272rpx; align-items: stretch; gap: 16rpx; padding: 16rpx; }
.category-product-card.is-grid { width: 100%; flex-direction: column; gap: 16rpx; }
.category-product-image-wrap { display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 12rpx; background: #f5f6f7; }
.is-horizontal .category-product-image-wrap { width: 240rpx; height: 240rpx; flex: 0 0 240rpx; }
.is-grid .category-product-image-wrap { width: 100%; height: 344rpx; }
.category-product-image { display: block; width: 100%; height: 100%; }
.category-product-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; justify-content: space-between; align-items: stretch; padding-bottom: 8rpx; box-sizing: border-box; }
.category-product-text { display: flex; flex-direction: column; gap: 8rpx; min-width: 0; }
.category-product-title { display: -webkit-box; overflow: hidden; color: #1d2129; font-size: 30rpx; font-weight: 600; line-height: 44rpx; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.category-product-subtitle { display: -webkit-box; overflow: hidden; color: #ff7b2e; font-size: 26rpx; line-height: 40rpx; -webkit-box-orient: vertical; -webkit-line-clamp: 1; }
.category-product-location { display: flex; width: fit-content; max-width: 100%; height: 40rpx; align-items: center; gap: 8rpx; padding: 4rpx 16rpx; box-sizing: border-box; border-radius: 999rpx; background: #f6f7f9; color: #86909c; font-size: 24rpx; line-height: 32rpx; }
.category-product-location-icon { width: 32rpx; height: 32rpx; flex-shrink: 0; }
.category-product-footer { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 12rpx; }
.category-product-price { color: #ff661a; font-family: MiSans, sans-serif; font-size: 36rpx; font-weight: 500; line-height: 44rpx; white-space: nowrap; }
.category-product-currency { font-size: 24rpx; }
.category-product-buy { flex-shrink: 0; padding: 6rpx 20rpx; box-sizing: border-box; border-radius: 999rpx; background: linear-gradient(135deg, #ffb341 0%, #ff5500 100%); color: #fff; font-size: 24rpx; line-height: 40rpx; white-space: nowrap; }
.is-grid .category-product-copy { min-height: 172rpx; padding: 0 16rpx 16rpx; }
/* 双列（非遗老号等）：标题 27rpx / 描述 25rpx / 价格 27rpx #FF5500（对齐设计稿 14/13/14px） */
.is-grid .category-product-title { font-size: 27rpx; line-height: 42rpx; }
.is-grid .category-product-subtitle { font-size: 25rpx; line-height: 38rpx; }
.is-grid .category-product-price { color: #ff5500; font-size: 27rpx; line-height: 42rpx; }
</style>
