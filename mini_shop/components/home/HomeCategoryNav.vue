<script setup lang="ts">
interface CategoryItem {
  label: string
  icon: string
  background: string
  iconOffset: {
    left: number
    top: number
  }
}

defineProps<{
  items: CategoryItem[]
}>()

const emit = defineEmits<{
  select: [index: number]
}>()

function onTap(index: number): void {
  emit('select', index)
}
</script>

<template>
  <view class="category-nav">
    <view
      v-for="(item, index) in items"
      :key="item.label"
      class="category-item"
      @click="onTap(index)"
    >
      <view class="category-icon-frame">
        <image class="category-icon-background" :src="item.background" mode="aspectFit" />
        <image
          class="category-icon"
          :src="item.icon"
          mode="aspectFit"
          :style="{ left: `${item.iconOffset.left}px`, top: `${item.iconOffset.top}px` }"
        />
      </view>
      <text class="category-label">{{ item.label }}</text>
    </view>
  </view>
</template>

<style scoped>
.category-nav { display: flex; align-items: baseline; justify-content: space-between; padding: 10rpx 24rpx; box-sizing: border-box; background: #fff; }
.category-item { display: flex; min-width: 0; flex-direction: column; align-items: center; }
.category-icon-frame { position: relative; width: 50px; height: 50px; flex-shrink: 0; }
.category-icon-background, .category-icon { position: absolute; display: block; width: 50px; height: 50px; }
.category-icon { width: 100%; height: 100%; }
.category-label { width: 100%; margin-top: 6px; overflow: hidden; color: #1d2129; font-size: 12px; font-weight: 500; line-height: 20px; text-align: center; white-space: nowrap; text-overflow: ellipsis; }
</style>
