<template>
  <view v-if="!restoringSession" class="login-page">
    <view class="login-card">
      <image class="logo" src="/static/logo.png" mode="aspectFit" />
      <text class="title">欢迎来到商城</text>
      <text class="subtitle">授权手机号后即可开始购物</text>
      <view class="privacy-agreement" @click="privacyAgreed = !privacyAgreed">
        <view class="privacy-checkbox" :class="{ checked: privacyAgreed }">
          <text v-if="privacyAgreed" class="privacy-checkmark">✓</text>
        </view>
        <text class="privacy-agreement-text">我已阅读并同意</text>
        <text class="privacy-link" @click.stop="openUserAgreement">《用户协议》</text>
        <text class="privacy-agreement-text">和</text>
        <text class="privacy-link" @click.stop="openPrivacy">《隐私保护指引》</text>
      </view>
      <button
        class="login-button"
        type="primary"
        open-type="getPhoneNumber"
        :disabled="loading || !privacyAgreed"
        @getphonenumber="handlePhoneNumber"
      >
        {{ loading ? '登录中...' : '手机号快捷登录' }}
      </button>
      <button class="cancel-button" :disabled="loading" @click="cancelLogin">暂不登录，先逛逛</button>
      <text v-if="errorMessage" class="error-message">{{ errorMessage }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { loginByWechat } from '@/api/auth'
import { updateUserProfile } from '@/api/user'
import { isLoggedIn, saveAuth } from '@/utils/auth'
import { getWechatProfile } from '@/utils/wechat-profile'
import { clearPromotionContext, capturePromotionContext, getStoredPromoterId } from '@/utils/promotion'

const loading = ref(false)
const errorMessage = ref('')
const restoringSession = ref(true)
const privacyAgreed = ref(false)

/** 首次打开登录页时恢复本地会话，避免已登录用户重复授权。 */
function restoreExistingSession(): void {
  if (isLoggedIn()) {
    uni.reLaunch({ url: '/pages/index/index' })
    return
  }
  restoringSession.value = false
}

/** 处理微信手机号授权回调，并继续完成业务登录。 */
async function handlePhoneNumber(event: UniApp.GetPhoneNumberResult): Promise<void> {
  if (!privacyAgreed.value) {
    errorMessage.value = '请先阅读并同意用户协议和隐私保护指引'
    return
  }
  if (loading.value) return
  if (!event.detail?.code) {
    errorMessage.value = '已取消登录，你可以继续浏览'
    return
  }

  loading.value = true
  errorMessage.value = ''
  const profilePromise = getWechatProfile().catch((profileError) => {
    console.warn('微信资料同步未完成，登录继续进行', profileError)
    return null
  })
  try {
    const loginResult = await getWechatLoginCode()
    const authData = await loginByWechat(loginResult, event.detail.code, getStoredPromoterId())
    saveAuth(authData)
    const profile = await profilePromise
    if (profile) {
      try {
        await updateUserProfile(profile)
      } catch (profileUpdateError) {
        console.warn('微信资料回写未完成，登录继续进行', profileUpdateError)
      }
    }
    clearPromotionContext()
    uni.reLaunch({ url: '/pages/index/index' })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '登录失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function openUserAgreement(): void {
  uni.navigateTo({ url: '/pages/user-agreement/user-agreement' })
}

function openPrivacy(): void {
  uni.navigateTo({ url: '/pages/privacy/privacy' })
}

/** 用户拒绝授权或暂不登录时返回原页面，无法返回时回到首页。 */
function cancelLogin(): void {
  if (loading.value) return
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({
      delta: 1,
      fail: () => uni.switchTab({ url: '/pages/index/index' }),
    })
    return
  }
  uni.switchTab({ url: '/pages/index/index' })
}

/** 登录页也捕获入口参数，避免分享链接直接打开登录页时丢失推广者身份。 */
onLoad((options) => {
  capturePromotionContext(options as Record<string, unknown>)
  restoreExistingSession()
})

/** 获取微信登录凭证，供后端换取业务 Token。 */
function getWechatLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (result) => {
        if (result.code) resolve(result.code)
        else reject(new Error('登录凭证获取失败'))
      },
      fail: () => reject(new Error('登录失败，请稍后重试')),
    })
  })
}
</script>

<style>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  background: linear-gradient(180deg, #f2f7ff 0%, #ffffff 100%);
}

.login-card {
  width: 100%;
  padding: 72rpx 48rpx 64rpx;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 16rpx 48rpx rgba(31, 65, 114, 0.12);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.logo {
  width: 160rpx;
  height: 160rpx;
  margin-bottom: 32rpx;
}

.title {
  color: #172033;
  font-size: 42rpx;
  font-weight: 700;
}

.subtitle {
  margin-top: 18rpx;
  color: #8a96a8;
  font-size: 27rpx;
}

.privacy-agreement {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  margin-top: 42rpx;
  padding: 10rpx 0;
  color: #8a96a8;
  font-size: 24rpx;
  line-height: 36rpx;
}

.privacy-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30rpx;
  height: 30rpx;
  margin-right: 10rpx;
  box-sizing: border-box;
  border: 2rpx solid #c7cfda;
  border-radius: 50%;
  background: #fff;
}

.privacy-checkbox.checked {
  border-color: #22272e;
  background: #22272e;
}

.privacy-checkmark {
  color: #fff;
  font-size: 20rpx;
  line-height: 1;
}

.privacy-agreement-text { white-space: nowrap; }
.privacy-link { margin: 0 6rpx; color: #22272e; font-weight: 600; white-space: nowrap; }

.login-button {
  width: 100%;
  margin-top: 72rpx;
  border-radius: 48rpx;
  background: #07c160;
  font-size: 31rpx;
}

.login-button[disabled] { opacity: .5; }

.cancel-button {
  width: 100%;
  height: 72rpx;
  margin: 18rpx 0 0;
  padding: 0;
  border: 0;
  border-radius: 36rpx;
  color: #7d8796;
  background: transparent;
  font-size: 26rpx;
  line-height: 72rpx;
}

.cancel-button::after { border: 0; }
.cancel-button[disabled] { opacity: .5; }

.error-message {
  margin-top: 24rpx;
  color: #e45656;
  font-size: 25rpx;
  text-align: center;
}
</style>
