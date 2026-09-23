<script setup lang="ts">
type LayoutMode = 'grid' | 'list'

const props = defineProps<{
  modelValue: LayoutMode
}>()

const emit = defineEmits<{
  'update:modelValue': [value: LayoutMode]
}>()

function selectMode(mode: LayoutMode): void {
  if (mode !== props.modelValue) emit('update:modelValue', mode)
}
</script>

<template>
  <view class="layout-toggle" aria-label="商品布局切换">
    <!-- 图标改用 iconfont（2026-09-25 用户要求用在线 iconfont 里的图标）：
         字体在 styles/rider-iconfont.wxss（iconfont 项目 5230143 完整字体），App.vue 已全局 import。
         双列 = buju_shangxia(\e89c 布局_上下)，单列 = buju_zuoyou(\e899 布局_左右)。 -->
    <view class="layout-option" :class="{ active: modelValue === 'grid' }" @click="selectMode('grid')">
      <text class="rider-icon rider-icon-buju_shangxia layout-icon" aria-hidden="true" />
    </view>
    <view class="layout-option" :class="{ active: modelValue === 'list' }" @click="selectMode('list')">
      <text class="rider-icon rider-icon-buju_zuoyou layout-icon" aria-hidden="true" />
    </view>
  </view>
</template>

<style scoped>
.layout-toggle { display: flex; gap: 4rpx; padding: 4rpx; border-radius: 999rpx; background: #f2f3f7; }
.layout-option { display: flex; width: 80rpx; height: 64rpx; align-items: center; justify-content: center; border-radius: 999rpx; }
.layout-option.active { background: #fff; }
/* 图标：iconfont 字体（原来是用 CSS 画的 2x2 网格与三根横线，已按用户要求换成在线图标） */
.layout-icon { font-size: 36rpx; line-height: 1; color: #86909c; }
.layout-option.active .layout-icon { color: #1d2129; }
</style>
