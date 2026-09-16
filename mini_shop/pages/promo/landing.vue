<template>
  <view class="landing">
    <view class="landing-tip">正在进入...</view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { bindStoredPromotionIfLoggedIn, capturePromotionContext } from '@/utils/promotion'

/**
 * 推广码落地中转页。
 * tabBar 页面不能直接作为 getwxacodeunlimit 的 page 参数，故用本非 tabBar 页中转：
 * 解析扫码携带的推广者身份并补绑定后，跳转到首页。
 */
onLoad((options) => {
  capturePromotionContext(options as Record<string, unknown>)
  void bindStoredPromotionIfLoggedIn().finally(() => {
    uni.switchTab({ url: '/pages/index/index' })
  })
})
</script>

<style>
.landing { display: flex; align-items: center; justify-content: center; height: 100vh; background: #f6f8fc; }
.landing-tip { color: #98a2b3; font-size: 26rpx; }
</style>
