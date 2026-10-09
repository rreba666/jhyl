<script setup lang="ts">
/**
 * C 端 · 规格选择弹层（SKU Sheet）
 *
 * 背景（2026-10-08 用户反馈「下单没有出现 SKU 弹层」）：
 * 此前商品详情页**默认取第一个可用 SKU** 就直接加购/立即购买（见 `detail.vue` 的历史注释
 * 「默认选择第一个可用 SKU，详情页暂按该 SKU 进行加购和立即支付」）——
 * 多规格商品（950ml / 550ml / 330ml）用户**根本没法选**，下单的永远是列表里第一个，
 * 与他在页面上看到的价格也可能不是同一个规格。分类页的快捷加购同样如此。
 * ⇒ 本组件把「选规格 + 选数量」补齐，详情页与列表页共用。
 *
 * 设计（无设计稿，按主流电商的**京东/淘宝风格**）：
 * 底部弹层：商品图 + 价格/库存 → 「规格」chip 列表 → 「数量」步进器 → 底部动作按钮。
 *
 * 职责边界：**只负责"让用户选出 (sku, quantity)"**，不碰购物车/下单——
 * 由父组件在 `confirm` 里执行业务（`props down / events up`）。
 */
import { computed, ref, watch } from 'vue'
import type { ProductDetail } from '@/api/product'

/** 规格项（= 契约 `ProductDetail.skuList` 的元素）。 */
export interface SkuOption {
  id: string
  skuName: string
  specs: string
  /**
   * 该规格自己的图片 URL（后端 `SkuVO.skuImage`）。
   * ⚠️ **空串/null = 未配置** ⇒ 展示时必须回退商品主图（见 `headImage`），不得开天窗。
   */
  skuImage?: string
  price: number
  originalPrice?: number
  stock: number
  enabled: number
}

const props = withDefaults(defineProps<{
  visible: boolean
  /** 商品详情（取图 / 名 / 规格 / 价格区间 / 库存）。 */
  product: ProductDetail | null
  /** 是否显示「加入购物车」。 */
  showCart?: boolean
  /** 是否显示「立即购买」。 */
  showBuy?: boolean
}>(), {
  showCart: true,
  showBuy: true,
})

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  /** 用户确认：交出选中的规格与数量，业务由父组件执行。 */
  (e: 'confirm', payload: { action: 'cart' | 'buy'; sku: SkuOption; quantity: number }): void
}>()

const selectedSkuId = ref('')
const quantity = ref(1)

/**
 * 可展示的规格：`enabled !== 0`（禁用的不展示，避免用户选中后被后端拒绝）。
 *
 * ⚠️ 这里**逐个字段显式映射**（不再用 `as SkuOption[]` 断言）：`skuImage` 必须被带出来，
 * 否则头部图永远只能显示商品主图 —— 那正是用户反馈的「不同规格应有不同图片、弹层却不变」。
 */
const skus = computed<SkuOption[]>(() => {
  const list = props.product?.skuList
  if (!Array.isArray(list)) return []
  return list
    .filter((item) => Number(item.enabled) !== 0)
    .map((item) => ({
      id: item.id,
      skuName: item.skuName,
      specs: item.specs,
      skuImage: item.skuImage,
      price: item.price,
      originalPrice: item.originalPrice,
      stock: item.stock,
      enabled: item.enabled,
    }))
})

/** 当前选中规格（未选中时为 `undefined`）。 */
const selectedSku = computed<SkuOption | undefined>(() => skus.value.find((item) => String(item.id) === selectedSkuId.value))

/**
 * 弹层头部图：**优先选中规格自己的 `skuImage`**，该规格未配图时**回退商品主图**（`product.mainImage`）。
 *
 * ⚠️ 依赖 `selectedSku` ⇒ 用户切换规格时**自动跟着换图**（computed 响应式，无需额外 watch）。
 * ⚠️ 空串/空白一律视为"未配置"（后端未配规格图时会下发空串），否则弹层会开天窗。
 */
const headImage = computed(() => {
  const skuImage = String(selectedSku.value?.skuImage || '').trim()
  if (skuImage) return skuImage
  return String(props.product?.mainImage || '').trim()
})

/** 是否缺货（选中规格库存 ≤ 0）。 */
const soldOut = computed(() => {
  const sku = selectedSku.value
  return !sku || !Number.isFinite(Number(sku.stock)) || Number(sku.stock) <= 0
})

/** 数量上限 = 选中规格的可售库存（至少 1，避免步进器 max < 1 时无法操作）。 */
const maxQuantity = computed(() => Math.max(1, Number(selectedSku.value?.stock ?? 1)))

/** 展示价：优先选中规格的价；未选中时退到商品价格区间。 */
const priceText = computed(() => {
  const sku = selectedSku.value
  if (sku) return formatMoney(sku.price)
  const min = props.product?.minPrice
  const max = props.product?.maxPrice
  if (min != null && max != null && Number(min) !== Number(max)) return `${formatMoney(min)} ~ ${formatMoney(max)}`
  if (min != null) return formatMoney(min)
  return formatMoney(max)
})

/** 划线价（有值且大于现价才展示，避免"划线价低于售价"的荒谬观感）。 */
const originalPriceText = computed(() => {
  const sku = selectedSku.value
  const original = sku?.originalPrice ?? props.product?.minOriginalPrice
  const price = sku?.price ?? props.product?.minPrice
  const o = Number(original)
  const p = Number(price)
  if (!Number.isFinite(o) || o <= 0) return ''
  if (Number.isFinite(p) && o <= p) return ''
  return formatMoney(o)
})

/** 库存/已售文案（选中规格显示该规格库存，未选中显示商品总库存）。 */
const stockText = computed(() => {
  const sku = selectedSku.value
  const stock = sku ? Number(sku.stock) : Number(props.product?.totalStock)
  if (!Number.isFinite(stock)) return ''
  return `库存 ${Math.max(0, stock)}`
})
const soldText = computed(() => {
  const sold = Number(props.product?.soldCount)
  return Number.isFinite(sold) && sold > 0 ? `已售 ${sold}` : ''
})

/** 金额格式化：去掉多余的 0（与商品卡口径一致）。 */
function formatMoney(value?: number | null): string {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  return num.toFixed(2).replace(/\.?0+$/, '')
}

/** 选中某规格（缺货规格不可选）。 */
function pickSku(sku: SkuOption): void {
  if (Number(sku.stock) <= 0) {
    uni.showToast({ title: '该规格暂时缺货', icon: 'none' })
    return
  }
  selectedSkuId.value = String(sku.id)
  // 切换规格后数量可能超过新规格库存 ⇒ 收敛
  if (quantity.value > maxQuantity.value) quantity.value = maxQuantity.value
}

/** 数量步进（下限 1、上限 = 该规格库存）。 */
function stepQuantity(delta: number): void {
  const next = quantity.value + delta
  if (next < 1) return
  if (next > maxQuantity.value) {
    uni.showToast({ title: `该规格最多可购 ${maxQuantity.value} 件`, icon: 'none' })
    return
  }
  quantity.value = next
}

function close(): void {
  emit('update:visible', false)
}

/** 确认：校验选中与库存后把 (sku, quantity) 交给父组件。 */
function confirm(action: 'cart' | 'buy'): void {
  const sku = selectedSku.value
  if (!sku) {
    uni.showToast({ title: '请选择规格', icon: 'none' })
    return
  }
  if (Number(sku.stock) <= 0) {
    uni.showToast({ title: '该规格暂时缺货', icon: 'none' })
    return
  }
  emit('confirm', { action, sku, quantity: quantity.value })
}

/**
 * 每次打开都重置为「第一个有货的规格 + 数量 1」。
 * ⚠️ 默认选中只作为**起点**（少点一下），但用户随时能改 —— 这正是此前缺失的能力；
 * 若全部缺货则保持未选中，由 `confirm` 提示「请选择规格」。
 */
watch(() => props.visible, (visible) => {
  if (!visible) return
  const firstAvailable = skus.value.find((item) => Number(item.stock) > 0)
  selectedSkuId.value = firstAvailable ? String(firstAvailable.id) : ''
  quantity.value = 1
}, { immediate: true })
</script>

<template>
  <view v-if="visible" class="mask" @click="close">
    <view class="sheet" @click.stop>
      <!-- 头部：商品图 + 价格 + 库存 -->
      <view class="head">
        <!-- ⚠️ 头部图 = **选中规格的图**（`skuImage`），未配规格图时回退商品主图（见 headImage） -->
        <image class="head-image" :src="headImage" mode="aspectFill" />
        <view class="head-info">
          <view class="price-row">
            <text class="price-yen">¥</text>
            <text class="price-num">{{ priceText }}</text>
            <text v-if="originalPriceText" class="price-original">¥{{ originalPriceText }}</text>
          </view>
          <view class="meta-row">
            <text v-if="stockText" class="meta-text">{{ stockText }}</text>
            <text v-if="soldText" class="meta-text">{{ soldText }}</text>
          </view>
        </view>
        <text class="head-close" @click="close">×</text>
      </view>

      <scroll-view class="body" scroll-y>
        <!-- 规格 -->
        <view class="block">
          <text class="block-label">规格</text>
          <view class="chips">
            <view
              v-for="sku in skus"
              :key="sku.id"
              class="chip"
              :class="{
                'is-active': String(sku.id) === selectedSkuId,
                'is-disabled': Number(sku.stock) <= 0,
              }"
              @click="pickSku(sku)"
            >
              <text class="chip-text">{{ sku.skuName || sku.specs || '默认' }}</text>
            </view>
            <text v-if="!skus.length" class="empty-text">该商品暂无规格</text>
          </view>
        </view>

        <!-- 数量 -->
        <view class="block">
          <view class="qty-row">
            <text class="block-label">数量</text>
            <view class="stepper">
              <view class="step-btn" :class="{ 'is-disabled': quantity <= 1 }" @click="stepQuantity(-1)">−</view>
              <text class="step-value">{{ quantity }}</text>
              <view class="step-btn" :class="{ 'is-disabled': quantity >= maxQuantity }" @click="stepQuantity(1)">＋</view>
            </view>
          </view>
        </view>
      </scroll-view>

      <!-- 底部动作 -->
      <view class="actions">
        <button
          v-if="showCart"
          class="action-btn action-btn-ghost"
          :disabled="soldOut"
          @click="confirm('cart')"
        >加入购物车</button>
        <button
          v-if="showBuy"
          class="action-btn action-btn-primary"
          :disabled="soldOut"
          @click="confirm('buy')"
        >立即购买</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.5);
}
.sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 80vh;
  border-radius: 32rpx 32rpx 0 0;
  background: #ffffff;
  padding-bottom: env(safe-area-inset-bottom);
}

/* 头部 */
.head {
  position: relative;
  display: flex;
  gap: 23rpx;
  padding: 31rpx 77rpx 23rpx 31rpx;
}
.head-image {
  flex: none;
  width: 180rpx;
  height: 180rpx;
  border-radius: 16rpx;
  background: #f2f3f7;
}
.head-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 12rpx;
}
.price-row {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
}
.price-yen {
  color: #ff5500;
  font-size: 27rpx;
  font-weight: 600;
  line-height: 1;
}
.price-num {
  color: #ff5500;
  font-size: 46rpx;
  font-weight: 600;
  line-height: 1;
}
.price-original {
  color: #86909c;
  font-size: 24rpx;
  text-decoration: line-through;
}
.meta-row {
  display: flex;
  gap: 23rpx;
}
.meta-text {
  color: #86909c;
  font-size: 24rpx;
}
.head-close {
  position: absolute;
  top: 23rpx;
  right: 31rpx;
  color: #86909c;
  font-size: 44rpx;
  line-height: 1;
  padding: 0 8rpx;
}

/* 规格 / 数量区 */
.body {
  flex: 1;
  min-height: 0;
  max-height: 46vh;
  padding: 0 31rpx;
  /* ⚠️⚠️ 2026-10-08 修复（用户反馈「SKU 弹层里数量行的 `＋` 被右边缘裁掉」）：
     **事实**（可复核）：本项目 **26** 条带正向右内边距的 `scroll-view` 规则里，**25** 条是
     `border-box`，**只有本组件**原来是 `content-box`。
     **算术**：`content-box` 下 border box = 750 + 31 + 31 = **812rpx**（比弹层/视口宽 62rpx），
     内容盒落在 x=31..781 ⇒ 数量行 `justify-content: space-between` 把 `.stepper` 顶到 781rpx
     ⇒ **右侧 31rpx 落在视口外**，而 `＋` 按钮正好宽 62rpx ⇒ **被裁掉一半、图标中心压在屏幕边缘**，
     与用户截图完全吻合。改成 `border-box` 后内容盒 = 750 − 62 = 688rpx，右边缘回到 719rpx。
     ⚠️ **未能本地验证的部分（待真机确认）**：`scroll-view` 为何会按 `content-box` 把内边距
     加在 750rpx 之外（推测基础库给它的是块级宽度、不参与 flex 的 `stretch`）—— 本机没有
     微信基础库的 wxss 可读，此机制属**推断**；但"25/26 都写 border-box + 算术正好裁掉一半"
     已足以定性，且这一行在小程序里**没有副作用**（无右内边距时 `border-box` 与 `content-box` 等价）。
     ⇒ 别再删掉这一行。 */
  box-sizing: border-box;
}
.block {
  padding: 23rpx 0;
  border-top: 2rpx solid #f2f3f7;
}
.block-label {
  display: block;
  margin-bottom: 19rpx;
  color: #1d2129;
  font-size: 29rpx;
  font-weight: 500;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 15rpx;
}
.chip {
  padding: 12rpx 27rpx;
  border-radius: 12rpx;
  border: 2rpx solid transparent;
  background: #f6f7f9;
}
.chip-text {
  color: #1d2129;
  font-size: 27rpx;
}
.chip.is-active {
  border-color: #ff5500;
  background: #fff4e8;
}
.chip.is-active .chip-text {
  color: #ff5500;
  font-weight: 500;
}
.chip.is-disabled {
  opacity: 0.4;
}
.chip.is-disabled .chip-text {
  color: #86909c;
  text-decoration: line-through;
}
.empty-text {
  color: #86909c;
  font-size: 26rpx;
}

/* 数量步进器 */
.qty-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
/* 「数量」是行里**唯一可以变窄**的东西（文字可换行）⇒ 让它在任何挤压下先让位，
   而不是让右边的定尺控件被压/被顶出可视区。`min-width: 0` 是必需的：
   flex 项默认 `min-width: auto`（= 内容的 min-content），不写它这一步形同虚设。 */
.qty-row .block-label {
  margin-bottom: 0;
  flex: 1 1 auto;
  min-width: 0;
}
/* ⚠️ 步进器是**定尺控件**（62 + 4 + 77 + 4 + 62 = 209rpx），`flex: none` 钉住它，
   免得作为 flex 项被默认的 `flex-shrink: 1` 压缩后反而溢出。 */
.stepper {
  display: flex;
  align-items: center;
  gap: 4rpx;
  flex: none;
}
.step-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  /* ⚠️ 同上：`＋` 是全角字符，按钮被压到小于字形时字形会溢出盒子 ⇒ 定尺 62rpx 不许缩 */
  flex: none;
  width: 62rpx;
  height: 62rpx;
  border-radius: 12rpx;
  background: #f6f7f9;
  color: #1d2129;
  font-size: 34rpx;
  line-height: 1;
}
.step-btn.is-disabled {
  opacity: 0.4;
}
.step-value {
  min-width: 77rpx;
  text-align: center;
  color: #1d2129;
  font-size: 29rpx;
}

/* 底部动作 */
.actions {
  display: flex;
  gap: 15rpx;
  padding: 23rpx 31rpx;
  border-top: 2rpx solid #f2f3f7;
}
.action-btn {
  margin: 0;
  padding: 0;
  flex: 1;
  height: 92rpx;
  border-radius: 9999rpx;
  font-size: 31rpx;
  font-weight: 600;
  line-height: 92rpx;
}
.action-btn::after {
  border: 0;
}
.action-btn[disabled] {
  opacity: 0.5;
}
.action-btn-ghost {
  background: #fff4e8;
  color: #ff5500;
}
.action-btn-primary {
  background: linear-gradient(90deg, #ff9301 0%, #ff6a01 50%, #ff4202 100%);
  color: #ffffff;
}
</style>
