<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { switchIdentity, type IdentitySwitchVO } from '@/api/identity'
import { getRiderTasks } from '@/api/delivery'

/** 当前门店名（进入本页前由 switch 返回，这里兜底展示）。 */
const shopName = ref('')
const switching = ref(false)
/** 状态栏高度：本页是 navigationStyle: custom，需自己避开状态栏，否则内容顶头。 */
const statusBarHeight = ref(0)
/** 正文起始位置（状态栏 + 间距）。 */
const contentTop = computed(() => statusBarHeight.value + 8)
/** 本店待接（可抢）配送单数：取「新任务」Tab 的 total。 */
const pendingCount = ref(0)

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '门店管理' })
})

/** 进入页面时展示门店信息（由切换接口写入的当前身份）。 */
onShow(() => {
  try {
    const cached = uni.getStorageSync('identity_entry') as IdentitySwitchVO | ''
    if (cached && typeof cached === 'object') shopName.value = cached.identities?.[0]?.shopName || ''
  } catch { /* 忽略读取失败 */ }
  void loadPendingCount()
})

/** 拉取本店可抢单数量（失败静默置 0，不阻断页面）。 */
async function loadPendingCount(): Promise<void> {
  try {
    const result = await getRiderTasks('NEW', 1, 1)
    pendingCount.value = Number(result.total || 0)
  } catch {
    pendingCount.value = 0
  }
}

/** 返回商城：切回 CUSTOMER（token 不变，不重新登录）。 */
async function backToMall(): Promise<void> {
  switching.value = true
  try {
    await switchIdentity(null)
    uni.removeStorageSync('identity_entry')
    uni.switchTab({ url: '/pages/index/index' })
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '切换失败', icon: 'none' })
  } finally {
    switching.value = false
  }
}

/**
 * 进入骑手工作台（本页内置骑手功能）。
 * 店长（MANAGER）不会拿到独立的「骑手工作台」身份卡（targetPage=MANAGER），
 * 但具备配送能力（后端对 MANAGER 放行 `/api/delivery/tasks/**`），因此在本页提供入口。
 * @param tab 可选的落地 Tab：`new` = 直接落到「新任务」（可抢单列表）
 */
function goRiderWorkbench(tab?: 'new' | 'picking' | 'delivering' | 'done' | 'exception'): void {
  uni.navigateTo({ url: `/subpkg-delivery/rider/index${tab ? `?tab=${tab}` : ''}` })
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <view class="head">
      <text class="title">门店管理</text>
      <text class="sub">{{ shopName || '本门店' }}</text>
    </view>
    <view class="card">
      <text class="card-title">配送（本店）</text>
      <text class="card-text">店长与骑手都具备配送能力。点「抢单配送」直接进入可抢单列表，抢到后按「待取货 → 配送中 → 已完成」流程操作即可。</text>
      <button class="entry-btn" @click="goRiderWorkbench('new')">抢单配送{{ pendingCount > 0 ? `（${pendingCount} 单待接）` : '' }}</button>
      <button class="entry-btn entry-btn-ghost" @click="goRiderWorkbench()">进入骑手工作台</button>
    </view>
    <view class="card">
      <text class="card-title">工作台（骨架页）</text>
      <text class="card-text">本页将承载：订单 / 商品 / 人员 / 规则。店长账号不能被设为骑手，但页内含骑手功能——上方入口即可接单配送。</text>
    </view>
    <button class="btn" :disabled="switching" @click="backToMall">{{ switching ? '切换中…' : '返回商城' }}</button>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx; box-sizing: border-box; background: #f6f7f9; }
.head { display: flex; flex-direction: column; gap: 8rpx; margin: 24rpx 8rpx 24rpx; }
.title { color: #1d2129; font-size: 40rpx; font-weight: 700; }
.sub { color: #86909c; font-size: 26rpx; }
.card { margin-bottom: 20rpx; padding: 32rpx; border-radius: 20rpx; background: #fff; }
.card-title { display: block; margin-bottom: 12rpx; color: #1d2129; font-size: 30rpx; font-weight: 600; }
.card-text { color: #4e5969; font-size: 26rpx; line-height: 40rpx; }
/* 骑手工作台入口（店长页内含骑手功能） */
.entry-btn { margin: 28rpx 0 0; border-radius: 44rpx; background: #ff5500; color: #fff; font-size: 28rpx; line-height: 80rpx; }
.entry-btn::after { border: 0; }
.entry-btn-ghost { margin-top: 16rpx; background: #fff6ed; color: #ff5500; }
.btn { margin-top: 40rpx; border-radius: 44rpx; background: linear-gradient(135deg, #ffb341 0%, #ff5500 100%); color: #fff; font-size: 30rpx; line-height: 88rpx; }
.btn[disabled] { opacity: .6; }
</style>
