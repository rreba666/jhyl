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
    <view class="layout-option" :class="{ active: modelValue === 'grid' }" @click="selectMode('grid')">
      <view class="grid-icon" aria-hidden="true">
        <view v-for="cell in 4" :key="cell" class="grid-cell" />
      </view>
    </view>
    <view class="layout-option" :class="{ active: modelValue === 'list' }" @click="selectMode('list')">
      <view class="list-icon" aria-hidden="true">
        <view v-for="line in 3" :key="line" class="list-line" />
      </view>
    </view>
  </view>
</template>

<style scoped>
.layout-toggle { display: flex; gap: 4rpx; padding: 4rpx; border-radius: 999rpx; background: #f2f3f7; }
.layout-option { display: flex; width: 80rpx; height: 64rpx; align-items: center; justify-content: center; border-radius: 999rpx; }
.layout-option.active { background: #fff; }
.grid-icon { display: grid; width: 36rpx; height: 36rpx; grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(2, 1fr); gap: 4rpx; }
.grid-cell, .list-line { display: block; background: #1d2129; }
.grid-cell { border-radius: 3rpx; }
.list-icon { display: flex; width: 38rpx; flex-direction: column; gap: 6rpx; }
.list-line { height: 5rpx; border-radius: 3rpx; }
</style>
