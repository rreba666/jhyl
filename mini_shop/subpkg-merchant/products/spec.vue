<script setup lang="ts">
/**
 * 商家端 · 规格页（独立整页，对应设计稿「添加规格」未录入/已录入两态）
 * 每个规格一行：规格名 + 价格 + 库存（扁平结构，与接口 skus[] 对齐）。
 * 保存后把 skus 写回 storage（key 与 edit 页一致），返回表单页由 onShow 读取。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { MerchantSkuItem } from '@/api/merchant'

const SKUS_STORAGE_KEY = 'merchant_product_skus'

const statusBarHeight = ref(0)
const contentTop = computed(() => statusBarHeight.value + 44)

const skus = ref<MerchantSkuItem[]>([])

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '规格' })
  const cached = uni.getStorageSync(SKUS_STORAGE_KEY) as MerchantSkuItem[] | ''
  if (Array.isArray(cached)) {
    skus.value = cached.map((s) => ({ specName: s.specName || '', price: s.price ?? 0, stock: s.stock ?? 0 }))
  }
})

function addSpec(): void {
  skus.value.push({ specName: '', price: 0, stock: 0 })
}

function removeSpec(index: number): void {
  skus.value.splice(index, 1)
}

/** 价格输入（digit 键盘，字符串 → 数字）。 */
function onPriceInput(index: number, e: { detail: { value: string } }): void {
  skus.value[index] = { ...skus.value[index], price: Number(e.detail.value) || 0 }
}
/** 库存输入（number 键盘）。 */
function onStockInput(index: number, e: { detail: { value: string } }): void {
  skus.value[index] = { ...skus.value[index], stock: Number(e.detail.value) || 0 }
}
function onNameInput(index: number, e: { detail: { value: string } }): void {
  skus.value[index] = { ...skus.value[index], specName: e.detail.value }
}

function confirm(): void {
  const valid = skus.value.filter((s) => s.specName.trim())
  if (!valid.length) {
    uni.showToast({ title: '请至少添加一个规格', icon: 'none' })
    return
  }
  for (const s of valid) {
    if (!Number.isFinite(s.price) || s.price <= 0) {
      uni.showToast({ title: `规格「${s.specName}」价格需大于 0`, icon: 'none' })
      return
    }
    if (!Number.isInteger(s.stock) || s.stock < 0) {
      uni.showToast({ title: `规格「${s.specName}」库存需为非负整数`, icon: 'none' })
      return
    }
  }
  uni.setStorageSync(SKUS_STORAGE_KEY, valid)
  uni.navigateBack()
}

function goBack(): void {
  uni.navigateBack()
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <text class="nav-back" @click="goBack">‹</text>
      <text class="nav-title">规格</text>
    </view>

    <scroll-view class="content" scroll-y>
      <view class="card">
        <view class="field-label">
          <text class="label-text">规格名称</text>
          <text class="label-star">*</text>
        </view>

        <!-- 规格列表 -->
        <view v-for="(sku, index) in skus" :key="index" class="spec-item">
          <view class="spec-head">
            <text class="spec-name">{{ sku.specName || '未命名规格' }}</text>
            <text class="spec-del" @click="removeSpec(index)">−</text>
          </view>
          <view class="spec-row">
            <input
              class="name-input"
              :value="sku.specName"
              placeholder="规格名称（如 950ml）"
              placeholder-class="input-ph"
              @input="onNameInput(index, $event)"
            />
          </view>
          <view class="spec-row">
            <view class="num-box">
              <text class="num-label">价格</text>
              <input
                class="num-input"
                :value="sku.price ? String(sku.price) : ''"
                type="digit"
                placeholder="请输入"
                placeholder-class="input-ph"
                @input="onPriceInput(index, $event)"
              />
            </view>
            <view class="num-box">
              <text class="num-label">库存</text>
              <input
                class="num-input"
                :value="sku.stock ? String(sku.stock) : ''"
                type="number"
                placeholder="请输入"
                placeholder-class="input-ph"
                @input="onStockInput(index, $event)"
              />
            </view>
          </view>
        </view>

        <view class="add-btn" @click="addSpec">
          <text class="add-icon">+</text>
          <text class="add-text">添加规格</text>
        </view>
      </view>
      <view class="content-pad" />
    </scroll-view>

    <view class="footer">
      <button class="confirm-btn" @click="confirm">确定</button>
    </view>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  background: #f2f3f7;
}
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 85rpx;
}
.nav-back {
  position: absolute;
  left: 23rpx;
  top: 50%;
  transform: translateY(-50%);
  color: #1d2129;
  font-size: 46rpx;
  line-height: 1;
}
.nav-title {
  color: #1d2129;
  font-size: 33rpx;
  font-weight: 600;
}
.content {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 15rpx 15rpx 40rpx;
}
.content-pad {
  height: 120rpx;
}
.card {
  padding: 31rpx;
  border-radius: 24rpx;
  background: #ffffff;
}
.field-label {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.label-text {
  color: #1d2129;
  font-size: 29rpx;
  font-weight: 500;
}
.label-star {
  color: #f53f3f;
  font-size: 29rpx;
}

.spec-item {
  margin-top: 23rpx;
  padding: 23rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
}
.spec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 15rpx;
}
.spec-name {
  color: #1d2129;
  font-size: 27rpx;
  font-weight: 500;
}
.spec-del {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46rpx;
  height: 46rpx;
  border-radius: 12rpx;
  background: #ffffff;
  color: #f53f3f;
  font-size: 34rpx;
  line-height: 1;
}
.spec-row {
  display: flex;
  gap: 15rpx;
  margin-bottom: 15rpx;
}
.spec-row:last-child {
  margin-bottom: 0;
}
.name-input {
  flex: 1;
  height: 77rpx;
  padding: 0 23rpx;
  border-radius: 12rpx;
  background: #ffffff;
  color: #1d2129;
  font-size: 27rpx;
}
.num-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8rpx;
  height: 77rpx;
  padding: 0 19rpx;
  border-radius: 12rpx;
  background: #ffffff;
}
.num-label {
  flex: none;
  color: #1d2129;
  font-size: 27rpx;
}
.num-input {
  flex: 1;
  min-width: 0;
  color: #1d2129;
  font-size: 27rpx;
}
.input-ph {
  color: #c1c5cc;
}

.add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  height: 85rpx;
  margin-top: 23rpx;
  border-radius: 23rpx;
  background: #f6f7f9;
}
.add-icon {
  color: #1d2129;
  font-size: 32rpx;
  line-height: 1;
}
.add-text {
  color: #1d2129;
  font-size: 29rpx;
  font-weight: 500;
}

.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  padding: 23rpx;
  background: #ffffff;
  padding-bottom: calc(23rpx + env(safe-area-inset-bottom));
}
.confirm-btn {
  margin: 0;
  padding: 0;
  height: 92rpx;
  border-radius: 24rpx;
  background: linear-gradient(90deg, #ff9301 0%, #ff6a01 50%, #ff4202 100%);
  color: #ffffff;
  font-size: 31rpx;
  font-weight: 600;
  line-height: 92rpx;
}
.confirm-btn::after {
  border: 0;
}
</style>
