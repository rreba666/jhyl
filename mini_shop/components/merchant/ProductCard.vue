<script setup lang="ts">
/**
 * 商家端 · 商品卡片（对应设计稿「商品管理」卡片 374×166）
 * 两种形态：
 * - normal：商品图 + 信息（名/规格/库存/价格）+ 操作行（左侧按钮 + 改价/改库存/编辑）
 * - batch ：勾选圈 + 精简卡片（无操作行），供批量上/下架勾选
 *
 * 金额按设计稿字符级样式：货币符号「¥」小一号（12px/23rpx），数字 14px/500。
 */
import { computed, ref } from 'vue'
import type { MerchantProductVO } from '@/api/merchant'

/**
 * 商品主图是否「加载结束」（成功或失败都算）。
 *
 * ⚠️ 2026-09-29 图片加载优化（与首页卡片、分类页同款）：原来 `.thumb` 只有一块纯黑底，
 *    图片加载完**硬切**出现。现在改为「骨架 + 扫光」占位、实图淡入。
 *
 * ⚠️ 这里可以用**单个布尔量**（不像列表页要按 id 记）：本组件一个实例只承载**一个商品**，
 *    两种形态（batch / normal）共用同一张图，天然不会串台。
 * ⚠️ `@error` 也算「结束」—— 否则扫光一直转，看起来像卡死。
 */
const imageLoaded = ref(false)
/** 标记主图「已加载结束」（成功、失败都调用）。 */
function onImageSettled(): void {
  imageLoaded.value = true
}

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
  /** 普通模式操作：type = left | price | stock | sku | edit（sku = 按规格设价/设库存，仅多规格）。 */
  (e: 'action', payload: { type: 'left' | 'price' | 'stock' | 'sku' | 'edit'; product: MerchantProductVO }): void
}>()

/**
 * 是否多规格商品（`skuCount > 1`）。
 *
 * ⚠️ 多规格**必须**用 SKU 级设价/设库存 —— SPU 级「改价 / 改库存」在多规格下只能
 *   "统一作用于全部规格"（例：500g ¥39 / 1kg ¥69 只能填一个值）⇒ 多规格时额外给
 *   「按规格」入口（与后台 `shop-console` 同口径）。
 */
const isMultiSku = computed(() => Number(props.product.skuCount ?? 0) > 1)

/** 展示价：优先门店价，否则品牌最低价（设计稿为单值）。 */
const priceText = computed(() => {
  const value = props.product.shopPrice ?? props.product.minPrice
  if (value == null) return '0'
  return formatMoney(value)
})

/**
 * 本店库存展示。
 *
 * ⚠️ 2026-09-30 修（审计发现）：原先用 `shopStock ?? totalStock` **自造**"有效库存"，
 * 而契约 `MerchantProductVO` **本身就提供 `effectiveStock`**，且注释明确说三者**不是同一个数**：
 *   · `effectiveStock` = 本店有效库存（可售）= 逐 SKU 三级回退后**减锁定**、下限 0，再求和；
 *   · `totalStock`     = 品牌级总库存，**不减锁定**；
 *   · `shopStock`      = 门店级 SPU 覆盖值（NULL 表示用总库存）。
 * ⇒ 用错值会让**商家看到的库存与 C 端可售库存不一致**（显示有货、用户下单无货）。
 * ⚠️ 回退链保留：老后端/字段缺失时仍依次退到 `shopStock` → `totalStock`，避免显示空白。
 */
const stockText = computed(() => {
  const product = props.product
  const value = product.effectiveStock ?? product.shopStock ?? product.totalStock
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

function onAction(type: 'left' | 'price' | 'stock' | 'sku' | 'edit'): void {
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
        <!-- ⚠️ 2026-09-29 图片加载优化：图区改为「定位容器 + 骨架层 + 实图层」 -->
        <view class="thumb-wrap">
          <view v-if="product.mainImage && !imageLoaded" class="thumb-skeleton skeleton-shimmer" />
          <image
            v-if="product.mainImage"
            class="thumb motion-image-in"
            :class="{ 'motion-image-loaded': imageLoaded }"
            :src="product.mainImage"
            mode="aspectFill"
            @load="onImageSettled"
            @error="onImageSettled"
          />
        </view>
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
      <!-- ⚠️ 2026-09-29 图片加载优化：同 batch 形态 -->
      <view class="thumb-wrap">
        <view v-if="product.mainImage && !imageLoaded" class="thumb-skeleton skeleton-shimmer" />
        <image
          v-if="product.mainImage"
          class="thumb motion-image-in"
          :class="{ 'motion-image-loaded': imageLoaded }"
          :src="product.mainImage"
          mode="aspectFill"
          @load="onImageSettled"
          @error="onImageSettled"
        />
      </view>
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
        <!--
          ⚠️ 多规格与单规格**互斥**，不是叠加：
            多规格时 SPU 级「改价 / 改库存」会**统一作用于全部规格**（不准，例：500g ¥39 / 1kg ¥69 只能填一个值）
            ⇒ 多规格**改走「按规格设价」**、不再显示那两个入口（也符合"小程序要精简"的范围结论）；
            单规格继续用原 SPU 级入口（不变）。
        -->
        <view v-if="isMultiSku" class="op-btn op-btn-sku" hover-class="op-btn-pressed" @click.stop="onAction('sku')">按规格设价</view>
        <view v-else class="op-btn" hover-class="op-btn-pressed" @click.stop="onAction('price')">改价</view>
        <view v-if="!isMultiSku" class="op-btn" hover-class="op-btn-pressed" @click.stop="onAction('stock')">改库存</view>
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
/* ⚠️ 2026-09-29：图区改为「定位容器 + 骨架层 + 实图层」，骨架才叠得上去。
   尺寸与底色沿用原来的 `.thumb`（181×181、黑底，#000000），只是从图本身挪到了外层容器上。
   ⚠️ 保留黑底是刻意的：商品无图时仍显示黑块，与改动前行为一致。 */
.thumb-wrap {
  position: relative;
  flex: none;
  width: 181rpx;
  height: 181rpx;
  border-radius: 15rpx;
  background: #000000;
  overflow: hidden;
}
.thumb {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
/* 骨架层铺满图区（底色与扫光由全局 `skeleton-shimmer` 提供，见 styles/motion.wxss） */
.thumb-skeleton {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  border-radius: 15rpx;
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
/* 「按规格设价」也是浅橙强调（与「编辑」同色系，但两者不同时出现在多规格卡片上） */
.op-btn-sku {
  background: #fff4e8;
  color: #ff5500;
}
</style>
