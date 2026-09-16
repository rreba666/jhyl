<script setup lang="ts">
import { computed } from 'vue'
import type { WelfareConfigV2 } from '@/api/homepage'

const props = defineProps<{
  welfare: WelfareConfigV2 | null
  activeTab: number
}>()

const emit = defineEmits<{
  'update:activeTab': [value: number]
  imageTap: [index: number]
}>()

const title = computed(() => props.welfare?.title || '福利与资讯')
const tabs = computed(() => (props.welfare?.tabs || []).filter((tab) => Number(tab.enabled) === 1))
const currentTab = computed(() => tabs.value[Math.min(props.activeTab, tabs.value.length - 1)] || tabs.value[0] || null)
const posterUrl = computed(() => currentTab.value?.imageUrl || '')

function selectTab(index: number): void {
  emit('update:activeTab', index)
}

function handlePosterTap(): void {
  if (currentTab.value) emit('imageTap', tabs.value.indexOf(currentTab.value))
}
</script>

<template>
  <view class="welfare">
    <image v-if="welfare?.backgroundUrl" class="welfare-background" :src="welfare.backgroundUrl" mode="scaleToFill" />
    <view class="welfare-content">
      <view class="welfare-heading">
        <text class="welfare-title">{{ title }}</text>
        <view v-if="tabs.length" class="welfare-tabs">
          <view v-for="(tab, index) in tabs" :key="tab.key || index" class="welfare-tab" :class="{ active: activeTab === index }" @click="selectTab(index)">
            <text>{{ tab.label }}</text>
          </view>
        </view>
      </view>
      <view class="welfare-panel">
        <image v-if="posterUrl" class="welfare-poster" :src="posterUrl" mode="aspectFill" lazy-load @click="handlePosterTap" />
        <view v-else class="welfare-empty"><text>暂无福利内容</text></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.welfare { position: relative; width: 100%; height: 864rpx; overflow: hidden; background: #148c48; }
.welfare-background { position: absolute; inset: 0; width: 100%; height: 100%; }
.welfare-content { position: relative; display: flex; height: 100%; flex-direction: column; align-items: center; padding: 64rpx 40rpx 0; box-sizing: border-box; }
.welfare-heading { display: flex; flex-direction: column; align-items: center; gap: 40rpx; }
.welfare-title { color: #295031; font-size: 40rpx; font-weight: 600; line-height: 56rpx; }
.welfare-tabs { display: flex; width: 700rpx; max-width: 100%; height: 72rpx; padding: 4rpx; box-sizing: border-box; gap: 4rpx; border-radius: 999rpx; background: rgba(255, 255, 255, .5); backdrop-filter: blur(12rpx); }
.welfare-tab { display: flex; flex: 1; height: 64rpx; align-items: center; justify-content: center; padding: 16rpx 32rpx; box-sizing: border-box; border-radius: 999rpx; color: #4e5969; font-size: 28rpx; line-height: 44rpx; white-space: nowrap; }
.welfare-tab.active { background: #fff; color: #1d2129; font-weight: 500; }
.welfare-panel { width: 700rpx; max-width: 100%; height: 320rpx; margin-top: 64rpx; overflow: hidden; border-radius: 16rpx; }
.welfare-poster { display: block; width: 100%; height: 100%; border-radius: 16rpx; background: #fff; }
.welfare-empty { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: #4e5969; font-size: 24rpx; }
</style>
