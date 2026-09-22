<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  statusBarHeight: number
  light?: boolean
  /** 是否固定顶部（不随内容滚动）。 */
  fixed?: boolean
}>()

const emit = defineEmits<{
  back: []
}>()

const topbarStyle = computed(() => ({
  paddingTop: `${props.statusBarHeight}px`,
}))

function goBack(): void {
  emit('back')
}
</script>

<template>
  <view class="category-topbar" :class="{ light, fixed }" :style="topbarStyle">
    <view class="category-topbar-row">
      <view class="category-back" @click="goBack">
        <image class="category-back-icon" src="/static/left_arrow.png" mode="aspectFit" />
      </view>
      <text class="category-topbar-title">{{ title }}</text>
      <view class="category-topbar-spacer" />
    </view>
  </view>
</template>

<style scoped>
.category-topbar { position: relative; z-index: 4; width: 100%; box-sizing: border-box; }
.category-topbar.fixed { position: fixed; top: 0; left: 0; right: 0; z-index: 30; }
.category-topbar-row { display: flex; width: 100%; height: 88rpx; align-items: center; justify-content: space-between; box-sizing: border-box; }
.category-back, .category-topbar-spacer { display: flex; width: 88rpx; height: 88rpx; align-items: center; justify-content: center; flex-shrink: 0; }
.category-back-icon { width: 36rpx; height: 36rpx; }
.category-topbar-title { flex: 1; color: #1d2129; font-size: 34rpx; font-weight: 600; line-height: 48rpx; text-align: center; }
.category-topbar.light .category-topbar-title { color: #fff; }
</style>
