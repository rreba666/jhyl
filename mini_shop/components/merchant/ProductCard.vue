<script setup lang="ts">
/**
 * 商家端 · 商品卡片（对应设计稿「商品管理」卡片 374×166）
 * 两种形态：
 * - normal：商品图 + 信息（名/规格/库存/价格）+ 操作行（左侧按钮 + 改价/改库存/编辑）
 * - batch ：勾选圈 + 精简卡片（无操作行），供批量上/下架勾选
 *
 * 金额按设计稿字符级样式：货币符号「¥」小一号（12px/23rpx），数字 14px/500。
 */
import { computed } from 'vue'
import type { MerchantProductVO } from '@/api/merchant'

const props = withDefaults(defineProps<{
  product: MerchantProductVO
  /** 渲染形态。 */
  mode?: 'normal' | 'batch'
  /** 批量模式下是否已勾选。 */
  selected?: boolean
  /** 普通模式左侧按钮文案（在售中=「更多」、仓库中=「上架商品」）。 */
  leftBtn?: string
}>(), {
  mode: 'normal',
  selected: false,
  leftBtn: '更多',
})

const emit = defineEmits<{
  /** 批量模式下点击勾选圈 / 卡片切换选中。 */
  (e: 'select', product: MerchantProductVO): void
  /** 普通模式操作：type = left | price | stock | edit。 */
  (e: 'action', payload: { type: 'left' | 'price' | 'stock' | 'edit'; product: MerchantProductVO }): void
}>()

/** 展示价：优先门店价，否则品牌最低价（设计稿为单值）。 */
const priceText = computed(() => {
  const value = props.product.shopPrice ?? props.product.minPrice
  if (value == null) return '0'
  return formatMoney(value)
})

/** 有效库存：门店库存优先，否则品牌总库存。 */
const stockText = computed(() => {
  const value = props.product.shopStock ?? props.product.totalStock
  if (value == null) return '—'
  return Number(value).toLocaleString('en-US')
})

/** 规格文案：取首个启用规格名；多规格追加「等 N 个规格」。 */
const specText = computed(() => {
  const skus = props.product.skus || []
  // 列表返回的规格字段是 specName（2026-09-19 按 api_doc 与真实响应修正，此前误用 skuName）
  const first = skus[0]?.specName || ''
  const count = props.product.skuCount ?? skus.length
  if (count > 1) return first ? `${first} 等${count}个规格` : `${count}个规格`
  return first
})

/** 金额：保留最多 2 位小数，去掉多余的 0。 */
function formatMoney(value: number): string {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  const fixed = num.toFixed(2)
  return fixed.replace(/\.?0+$/, '')
}

function onClick(): void {
  if (props.mode === 'batch') emit('select', props.product)
}

function onAction(type: 'left' | 'price' | 'stock' | 'edit'): void {
  emit('action', { type, product: props.product })
}
</script>

<template>
  <!-- 批量模式：勾选圈 + 精简卡片 -->
  <view v-if="mode === 'batch'" class="batch-row" @click="onClick">
    <view class="check" :class="{ 'is-checked': selected }">
      <text v-if="selected" class="rider-icon rider-icon-gouxuan_tianchong check-icon" />
    </view>
    <view class="card card-batch">
      <view class="card-top">
        <image class="thumb" :src="product.mainImage || ''" mode="aspectFill" />
        <view class="info">
          <text class="name">{{ product.name || '—' }}</text>
          <text v-if="specText" class="spec">{{ specText }}</text>
          <view class="meta">
            <text class="meta-item">库存 {{ stockText }}</text>
          </view>
          <view class="price"><text class="price-yen">¥</text><text class="price-num">{{ priceText }}</text></view>
        </view>
      </view>
    </view>
  </view>

  <!-- 普通模式 -->
  <view v-else class="card">
    <view class="card-top">
      <image class="thumb" :src="product.mainImage || ''" mode="aspectFill" />
      <view class="info">
        <text class="name">{{ product.name || '—' }}</text>
        <text v-if="specText" class="spec">{{ specText }}</text>
        <view class="meta">
          <text class="meta-item">库存 {{ stockText }}</text>
        </view>
        <view class="price"><text class="price-yen">¥</text><text class="price-num">{{ priceText }}</text></view>
      </view>
    </view>
    <view class="ops">
      <view class="op-btn op-btn-left" hover-class="op-btn-pressed" @click.stop="onAction('left')">{{ leftBtn }}</view>
      <view class="op-group">
        <view class="op-btn" hover-class="op-btn-pressed" @click.stop="onAction('price')">改价</view>
        <view class="op-btn" hover-class="op-btn-pressed" @click.stop="onAction('stock')">改库存</view>
        <view class="op-btn op-btn-edit" hover-class="op-btn-pressed" @click.stop="onAction('edit')">编辑</view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 卡片容器（普通 / 批量共用） */
.card {
  box-sizing: border-box;
  padding: 23rpx;
  border-radius: 24rpx;
  background: #ffffff;
}

/* 批量模式：勾选圈 + 卡片 */
.batch-row {
  display: flex;
  align-items: center;
  gap: 15rpx;
}
.check {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46rpx;
  height: 46rpx;
  border-radius: 50%;
  border: 3rpx solid #d7dbe0;
  background: #ffffff;
}
.check.is-checked {
  border-color: transparent;
  background: #ffffff;
}
.check-icon {
  color: #ff5500;
  font-size: 40rpx;
}
.card-batch {
  flex: 1;
  min-width: 0;
}

/* 上半区：图 + 信息 */
.card-top {
  display: flex;
  gap: 23rpx;
}
.thumb {
  flex: none;
  width: 181rpx;
  height: 181rpx;
  border-radius: 15rpx;
  background: #000000;
}
.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 15rpx;
}
.name {
  color: #1d2129;
  font-size: 27rpx;
  line-height: 42rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spec {
  color: #86909c;
  font-size: 23rpx;
  line-height: 38rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  display: flex;
  gap: 23rpx;
}
.meta-item {
  color: #86909c;
  font-size: 23rpx;
  line-height: 38rpx;
}
.price {
  display: flex;
  align-items: baseline;
  color: #ff5500;
}
.price-yen {
  font-size: 23rpx;
  font-weight: 500;
  line-height: 1;
}
.price-num {
  font-size: 27rpx;
  font-weight: 500;
  line-height: 1;
}

/* 操作行 */
.ops {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 31rpx;
}
.op-group {
  display: flex;
  gap: 15rpx;
}
.op-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 62rpx;
  padding: 0 23rpx;
  border-radius: 12rpx;
  background: #f6f7f9;
  color: #1d2129;
  font-size: 25rpx;
  font-weight: 500;
  line-height: 1;
}
.op-btn-pressed {
  opacity: 0.7;
}
.op-btn-edit {
  background: #fff4e8;
  color: #ff5500;
}
</style>
