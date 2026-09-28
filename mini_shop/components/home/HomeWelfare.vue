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

/**
 * 全屏预览当前福利图（2026-09-28 用户要求：「福利与资讯的图片应该可以点击也可以长按识别」）。
 *
 * ⚠️ 走微信**原生图片预览**：只有进了全屏预览，长按菜单里才有「识别图中二维码」——
 * 这是小程序里识别**普通二维码**（公众号/企微/URL 码）唯一可靠的入口。
 * ⚠️ 图上**不要**再渲染「长按识别二维码」之类的提示条（用户明确要求不显示）。
 */
function previewPoster(): void {
  const url = posterUrl.value
  if (!url) return
  uni.previewImage({ urls: [url], current: url })
}

/**
 * 点击福利图：
 * - tab **配了跳转**（appId / path / jumpType=miniprogram）⇒ 沿用原有跳转逻辑（交给父组件）；
 * - **没配跳转** ⇒ 直接进全屏预览（原来点了没任何反应，用户反馈"图片应该可以点击"）。
 */
function handlePosterTap(): void {
  const tab = currentTab.value
  if (!tab) return
  if (tab.jumpType === 'miniprogram' || tab.appId || tab.path) {
    emit('imageTap', tabs.value.indexOf(tab))
    return
  }
  previewPoster()
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
        <!-- 点击：有配置跳转则跳、否则进全屏预览；长按：始终进全屏预览（长按后才有「识别图中二维码」） -->
        <image v-if="posterUrl" class="welfare-poster" :src="posterUrl" mode="aspectFill" lazy-load @click="handlePosterTap" @longpress="previewPoster" />
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
