<script setup lang="ts">
/**
 * 设置页
 * 个人信息（昵称/头像/实名）真实可用；收货地址 / 银行卡等依赖后端接口，先做入口占位提示。
 */
import { onMounted, ref } from 'vue'
import { getUserProfile, updateUserProfile, type UserProfile } from '@/api/user'
import { getRealnameStatus, type RealnameStatus } from '@/api/realname'
import { uploadFile } from '@/utils/request'
import { validateText } from '@/utils/input-validation'
import RealnameVerifySheet from '@/components/RealnameVerifySheet.vue'
import { createThrottle } from '@/utils/interaction'

const menuTop = ref(0)
const menuHeight = ref(32)

const user = ref<UserProfile | null>(null)
const realname = ref<RealnameStatus | null>(null)
const nicknameInput = ref('')
const avatarUploading = ref(false)
const profileSaving = ref(false)
const realnameVisible = ref(false)
const navigationThrottle = createThrottle(500)

onMounted(async () => {
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect) { menuTop.value = rect.top; menuHeight.value = rect.height }
  } catch { /* 非微信环境忽略 */ }
  await Promise.all([loadProfile(), loadRealname()])
})

/** 加载个人信息。 */
async function loadProfile(): Promise<void> {
  try {
    user.value = await getUserProfile()
    nicknameInput.value = user.value?.nickname || ''
  } catch { user.value = null }
}

/** 加载实名认证状态。 */
async function loadRealname(): Promise<void> {
  try { realname.value = await getRealnameStatus() } catch { realname.value = null }
}

/** 选择头像后上传并保存。 */
async function onChooseAvatar(event: { detail: { avatarUrl?: string } }): Promise<void> {
  const tempPath = event.detail?.avatarUrl
  if (!tempPath) return
  avatarUploading.value = true
  try {
    const avatarUrl = await uploadFile(tempPath)
    user.value = await updateUserProfile({ avatarUrl })
    uni.showToast({ title: '头像已更新', icon: 'success' })
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '头像更新失败', icon: 'none' })
  } finally { avatarUploading.value = false }
}

/** 保存昵称。 */
async function saveNickname(): Promise<void> {
  const nickname = validateText(nicknameInput.value, { label: '昵称', maxLength: 32 })
  if (!nickname.ok) { uni.showToast({ title: nickname.message, icon: 'none' }); return }
  if (profileSaving.value) return
  profileSaving.value = true
  try {
    user.value = await updateUserProfile({ nickname: nickname.value })
    nicknameInput.value = user.value?.nickname || ''
    uni.showToast({ title: '昵称已保存', icon: 'success' })
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '昵称保存失败', icon: 'none' })
  } finally { profileSaving.value = false }
}

/** 实名认证成功回调。 */
function onRealnameVerified(status: RealnameStatus): void {
  realname.value = status
  uni.showToast({ title: '实名认证成功', icon: 'success' })
}

/** 收货地址 / 银行卡 = 待后端接口，先占位提示。 */
function todoFeature(feature: string): void {
  if (!navigationThrottle()) return
  uni.showToast({ title: `${feature}功能待后端接口开通后使用`, icon: 'none' })
}
</script>

<template>
  <view class="page">
    <view class="nav" :style="{ top: menuTop + 'px' }">
      <image class="back" src="/static/left_arrow.png" mode="aspectFit" @click="uni.navigateBack()" />
      <text class="nav-title">设置</text>
    </view>

    <scroll-view class="scroll" scroll-y :style="{ paddingTop: (menuTop + menuHeight + 12) + 'px' }">
      <!-- 个人信息卡 -->
      <view class="card">
        <button class="avatar-row" open-type="chooseAvatar" :disabled="avatarUploading" @chooseavatar="onChooseAvatar">
          <image v-if="user?.avatarUrl" class="avatar-img" :src="user.avatarUrl" mode="aspectFill" />
          <view v-else class="avatar-img avatar-empty" />
          <view class="avatar-info">
            <text class="avatar-name">{{ user?.nickname || '未设置昵称' }}</text>
            <text class="avatar-tip">{{ avatarUploading ? '上传中...' : '点击更换头像' }}</text>
          </view>
        </button>
        <view class="nickname-row">
          <text class="row-label">昵称</text>
          <input v-model="nicknameInput" class="nickname-input" type="nickname" placeholder="请输入昵称" />
          <button class="save-btn" :disabled="profileSaving" @click="saveNickname">{{ profileSaving ? '保存中' : '保存' }}</button>
        </view>
      </view>

      <!-- 实名认证 -->
      <view class="card">
        <view class="row" @click="realnameVerified ? uni.showToast({ title: '已实名认证', icon: 'none' }) : realnameVisible = true">
          <text class="row-label">实名认证</text>
          <text :class="['row-value', realname?.verified ? 'verified' : 'unverified']">{{ realname?.verified ? '已认证' : '未认证' }}</text>
          <text class="row-arrow">›</text>
        </view>
        <template v-if="realname?.verified && realname.maskedName">
          <view class="row"><text class="row-label">实名姓名</text><text class="row-value">{{ realname.maskedName }}</text></view>
        </template>
      </view>

      <!-- 收货地址（待后端） -->
      <view class="card">
        <view class="row" @click="todoFeature('收货地址管理')">
          <text class="row-label">收货地址</text>
          <text class="row-value muted">地址簿管理（待开通）</text>
          <text class="row-arrow">›</text>
        </view>
      </view>

      <!-- 提现银行卡（待后端） -->
      <view class="card">
        <view class="row" @click="todoFeature('银行卡管理')">
          <text class="row-label">提现银行卡</text>
          <text class="row-value muted">绑定银行卡管理（待开通）</text>
          <text class="row-arrow">›</text>
        </view>
      </view>
    </scroll-view>

    <RealnameVerifySheet v-model="realnameVisible" @verified="onRealnameVerified" />
  </view>
</template>

<style scoped>
.page { position: relative; height: 100vh; overflow: hidden; background: #f6f6f6; color: #222; }
.nav { position: fixed; right: 0; left: 0; z-index: 20; display: flex; align-items: center; justify-content: center; background: #fff; height: 44px; }
.back { position: absolute; left: 32rpx; width: 40rpx; height: 40rpx; }
.nav-title { font-size: 32rpx; font-weight: 700; }
.scroll { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0 24rpx 40rpx; box-sizing: border-box; }
.card { margin-bottom: 20rpx; padding: 24rpx; background: #fff; border-radius: 8rpx; }
.avatar-row { display: flex; align-items: center; width: 100%; padding: 0; background: transparent; border: 0; text-align: left; }
.avatar-row::after { border: 0; }
.avatar-img { width: 110rpx; height: 110rpx; border-radius: 50%; background: #eee; }
.avatar-empty { background: #eee; }
.avatar-info { display: flex; flex-direction: column; gap: 8rpx; margin-left: 24rpx; }
.avatar-name { font-size: 30rpx; font-weight: 600; }
.avatar-tip { color: #999; font-size: 22rpx; }
.nickname-row { display: flex; align-items: center; gap: 16rpx; margin-top: 24rpx; padding-top: 20rpx; border-top: 1rpx solid #f0f0f0; }
.row-label { flex-shrink: 0; color: #333; font-size: 28rpx; }
.nickname-input { flex: 1; height: 60rpx; padding: 0 16rpx; border: 1rpx solid #eee; border-radius: 8rpx; font-size: 26rpx; }
.save-btn { flex-shrink: 0; padding: 0 24rpx; height: 60rpx; line-height: 60rpx; border: 0; border-radius: 8rpx; background: #222; color: #fff; font-size: 24rpx; }
.save-btn::after { border: 0; }
.row { display: flex; align-items: center; justify-content: space-between; padding: 26rpx 0; }
.row + .row { border-top: 1rpx solid #f0f0f0; }
.row-label { flex-shrink: 0; color: #333; font-size: 28rpx; }
.row-value { font-size: 26rpx; }
.row-value.verified { color: #3e8a55; }
.row-value.unverified { color: #d9534f; }
.row-value.muted { color: #999; font-size: 24rpx; }
.row-arrow { color: #ccc; font-size: 32rpx; }
</style>
