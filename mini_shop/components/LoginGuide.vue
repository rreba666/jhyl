<script setup lang="ts">
import { ref } from 'vue'

withDefaults(defineProps<{
  modelValue?: boolean
}>(), {
  modelValue: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const navigating = ref(false)

function close(): void {
  if (navigating.value) return
  emit('update:modelValue', false)
}

function goLogin(): void {
  if (navigating.value) return
  navigating.value = true
  emit('update:modelValue', false)
  uni.navigateTo({
    url: '/pages/login/login',
    complete: () => { navigating.value = false },
  })
}
</script>

<template>
  <view v-if="modelValue" class="login-guide-mask" @click="close">
    <view class="login-guide-dialog" @click.stop>
      <view class="login-guide-close" @click="close"><text class="login-guide-close-icon">×</text></view>
      <image class="login-guide-logo" src="/static/logo.png" mode="aspectFit" />
      <text class="login-guide-title">登录后即可体验完整功能</text>
      <text class="login-guide-description">登录后即可使用推广、提现、订单管理等完整功能</text>
      <view class="login-guide-actions">
        <button class="login-guide-cancel" @click="close">取消</button>
        <button class="login-guide-action" :disabled="navigating" @click="goLogin">{{ navigating ? '正在进入...' : '去登录' }}</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.login-guide-mask { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 48rpx; box-sizing: border-box; background: rgba(18, 22, 28, .58); }
.login-guide-dialog { position: relative; display: flex; align-items: center; width: 100%; max-width: 620rpx; padding: 68rpx 44rpx 44rpx; box-sizing: border-box; flex-direction: column; border-radius: 28rpx; background: #fff; box-shadow: 0 24rpx 70rpx rgba(18, 22, 28, .2); }
.login-guide-close { position: absolute; top: 18rpx; right: 22rpx; display: flex; align-items: center; justify-content: center; width: 64rpx; height: 64rpx; }
.login-guide-close-icon { color: #9aa1aa; font-size: 42rpx; font-weight: 300; line-height: 1; }
.login-guide-logo { width: 112rpx; height: 112rpx; border-radius: 24rpx; }
.login-guide-title { margin-top: 28rpx; color: #17191c; font-size: 34rpx; font-weight: 700; line-height: 1.45; text-align: center; }
.login-guide-description { margin-top: 16rpx; color: #7a828d; font-size: 26rpx; line-height: 1.65; text-align: center; }
.login-guide-actions { display: flex; width: 100%; gap: 18rpx; margin-top: 36rpx; }
.login-guide-actions button { flex: 1; height: 82rpx; margin: 0; padding: 0; border: 0; border-radius: 41rpx; font-size: 29rpx; line-height: 82rpx; }
.login-guide-cancel { color: #626b77; background: #f1f3f5; }
.login-guide-action { color: #fff; background: #22272e; }
.login-guide-actions button::after { border: 0; }
.login-guide-action::after { border: 0; }
.login-guide-action[disabled] { opacity: .72; }
</style>
