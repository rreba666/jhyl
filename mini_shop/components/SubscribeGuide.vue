<script setup lang="ts">
/**
 * 「开启配送通知」引导弹层（C 端，2026-09-29 新建）。
 *
 * ⚠️ 为什么用**页面内的真实 `<button @click>`** 而不是 `uni.showModal`：
 *   微信要求 `wx.requestSubscribeMessage` 必须在**用户点击手势的同步链路**里调用，
 *   而 `uni.showModal` 的 success 回调**通常不被算作点击手势**（会 fail）。
 *   真实按钮的 tap 回调才是可靠的手势来源。
 *
 * ⚠️ 所以「进入小程序就自动弹授权框」在技术上做不到；本组件做的是
 *   「进入首页就弹引导，用户点一下按钮即同步发起授权」，体验上等价。
 */
import { ref } from 'vue'
import { markUserSubscribeGuided, requestUserSubscribe } from '@/utils/user-subscribe'

withDefaults(defineProps<{
  modelValue?: boolean
}>(), {
  modelValue: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

/** 防止重复点击（授权弹窗期间按钮应不可再点）。 */
const requesting = ref(false)

/** 关闭弹层并记录"已引导过"，之后首页不再弹。 */
function close(): void {
  markUserSubscribeGuided()
  emit('update:modelValue', false)
}

/**
 * 用户点「开启通知」：**在本函数的同步流程里**直接调微信授权接口。
 * ⚠️ 不要 `await` 任何东西再调 —— 那样就脱离点击手势的同步链路了。
 */
function enable(): void {
  if (requesting.value) return
  requesting.value = true
  // 先关弹层：微信授权框会盖在最上层，留着本弹层会显得叠了两层
  emit('update:modelValue', false)
  requestUserSubscribe({
    onFinish: () => {
      requesting.value = false
      markUserSubscribeGuided()
    },
  })
}
</script>

<template>
  <view v-if="modelValue" class="subscribe-guide-mask" @click="close">
    <view class="subscribe-guide-dialog" @click.stop>
      <view class="subscribe-guide-close" @click="close"><text class="subscribe-guide-close-icon">×</text></view>
      <view class="subscribe-guide-icon"><text class="subscribe-guide-bell">🔔</text></view>
      <text class="subscribe-guide-title">开启配送通知</text>
      <text class="subscribe-guide-desc">开启后，订单支付、商家接单、商品出库、配送完成的进度都会第一时间通知你。</text>
      <view class="subscribe-guide-actions">
        <button class="subscribe-guide-cancel" @click="close">暂不开启</button>
        <button class="subscribe-guide-action" :disabled="requesting" @click="enable">{{ requesting ? '正在开启...' : '开启通知' }}</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.subscribe-guide-mask { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 48rpx; box-sizing: border-box; background: rgba(18, 22, 28, .58); }
.subscribe-guide-dialog { position: relative; display: flex; align-items: center; width: 100%; max-width: 620rpx; padding: 68rpx 44rpx 44rpx; box-sizing: border-box; flex-direction: column; border-radius: 28rpx; background: #fff; box-shadow: 0 24rpx 70rpx rgba(18, 22, 28, .2); }
.subscribe-guide-close { position: absolute; top: 18rpx; right: 22rpx; display: flex; align-items: center; justify-content: center; width: 64rpx; height: 64rpx; }
.subscribe-guide-close-icon { color: #9aa1aa; font-size: 42rpx; font-weight: 300; line-height: 1; }
.subscribe-guide-icon { display: flex; align-items: center; justify-content: center; width: 112rpx; height: 112rpx; border-radius: 50%; background: #fff4e5; }
.subscribe-guide-bell { font-size: 56rpx; line-height: 1; }
.subscribe-guide-title { margin-top: 28rpx; color: #17191c; font-size: 34rpx; font-weight: 700; line-height: 1.45; text-align: center; }
.subscribe-guide-desc { margin-top: 16rpx; color: #7a828d; font-size: 26rpx; line-height: 1.65; text-align: center; }
.subscribe-guide-actions { display: flex; width: 100%; gap: 18rpx; margin-top: 36rpx; }
.subscribe-guide-actions button { flex: 1; height: 82rpx; margin: 0; padding: 0; border: 0; border-radius: 41rpx; font-size: 29rpx; line-height: 82rpx; }
.subscribe-guide-cancel { color: #626b77; background: #f1f3f5; }
.subscribe-guide-action { color: #fff; background: #ff5500; }
.subscribe-guide-actions button::after { border: 0; }
.subscribe-guide-action[disabled] { opacity: .72; }
</style>
