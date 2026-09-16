<script setup lang="ts">
withDefaults(defineProps<{
  loading?: boolean
  error?: string
  empty?: boolean
  emptyText?: string
}>(), {
  loading: false,
  error: '',
  empty: false,
  emptyText: '暂无内容',
})

defineEmits<{
  retry: []
}>()
</script>

<template>
  <view v-if="loading" class="request-state request-state-loading">
    <text class="request-state-text">加载中...</text>
  </view>
  <view v-else-if="error" class="request-state request-state-error">
    <text class="request-state-text">{{ error }}</text>
    <button class="request-state-retry" @click="$emit('retry')">重新加载</button>
  </view>
  <view v-else-if="empty" class="request-state request-state-empty">
    <text class="request-state-text">{{ emptyText }}</text>
  </view>
</template>

<style scoped>
.request-state { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 180rpx; padding: 32rpx 24rpx; box-sizing: border-box; }
.request-state-text { color: #999; font-size: 26rpx; text-align: center; }
.request-state-retry { min-width: 180rpx; height: 64rpx; margin-top: 24rpx; padding: 0 26rpx; color: #333; background: #f5f5f5; border: 0; border-radius: 32rpx; font-size: 24rpx; line-height: 64rpx; }
</style>
