<script setup lang="ts">
import { computed } from 'vue'
import type { ProductCard } from '@/api/product'

type LayoutMode = 'grid' | 'list'

const props = defineProps<{
  product: ProductCard
  mode: LayoutMode
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const imageUrl = computed(() => props.product.mainImage || '/static/figma-home/product-default.webp')
const description = computed(() => props.product.descriptionTitle || props.product.tag || '精选好物，安心品质')
/**
 * 后台「推荐文本」开关：关闭时不渲染描述行。
 * 兼容后端可能下发的 0/1、'0'/'1'、boolean；**未下发（undefined/null/空串）按开启处理**，
 * 避免老接口或字段缺失时把描述行整片隐藏。
 */
const showDescription = computed(() => {
  const flag = props.product.recommendTextEnabled
  if (flag === undefined || flag === null || flag === '') return true
  return flag === 1 || flag === '1' || flag === true
})
const price = computed(() => {
  const value = props.product.price
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
})

function selectProduct(): void {
  emit('select', String(props.product.id))
}
</script>

<template>
  <view class="product-card" :class="`product-card-${mode}`" @click="selectProduct">
    <image class="product-image" :src="imageUrl" mode="aspectFill" lazy-load />
    <view class="product-copy">
      <text class="product-title">{{ product.name || '精选商品' }}</text>
      <text v-if="showDescription" class="product-description">{{ description }}</text>
      <view class="product-price-row">
        <view class="product-price"><text class="price-symbol">¥</text><text class="price-number">{{ price }}</text></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.product-card { display: flex; overflow: hidden; border-radius: 16rpx; background: #fff; }
.product-card-grid { flex-direction: column; width: 100%; }
.product-card-list { flex-direction: row; width: 100%; min-height: 272rpx; padding: 0; box-sizing: border-box; }
/* 图片占位底色。
   ⚠️ 这里原本是一个纯深红（全项目仅此一处）：商品图带透明边、或图片还没加载完时，
   那层红色会沿着图片四周露出来，看起来就像商品图被加了一圈红框（2026-09-19 用户截图反馈）。
   现改为与分类页 `.category-product-image-wrap` 一致的浅灰占位色。 */
.product-image { flex-shrink: 0; background: #f5f6f7; }
.product-card-grid .product-image { width: 100%; height: 366rpx; }
.product-card-list .product-image { width: 272rpx; height: 272rpx; }
.product-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; align-items: stretch; padding: 16rpx 24rpx 20rpx; box-sizing: border-box; }
.product-card-list .product-copy { justify-content: space-between; padding: 8rpx 24rpx 16rpx; }
.product-title, .product-description { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; }
.product-title { color: #1d2129; font-size: 28rpx; font-weight: 600; line-height: 44rpx; -webkit-line-clamp: 2; }
.product-description { margin-top: 4rpx; color: #ff7b2e; font-size: 26rpx; line-height: 40rpx; -webkit-line-clamp: 2; }
.product-card-list .product-title { font-size: 30rpx; }
.product-price-row { display: flex; align-items: center; justify-content: space-between; margin-top: 12rpx; }
.product-price { display: flex; align-items: baseline; color: #ff5500; }
.price-symbol { font-size: 24rpx; font-weight: 500; }
.price-number { margin-left: 4rpx; font-family: MiSans, -apple-system, sans-serif; font-size: 36rpx; font-weight: 500; line-height: 44rpx; }
</style>
