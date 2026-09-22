<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, onMounted, ref } from 'vue'
import { getInvoiceDetail, getInvoiceList, type InvoiceRequest } from '@/api/invoice'
import { isLoggedIn } from '@/utils/auth'
import LoginGuide from '@/components/LoginGuide.vue'
import { useModuleGuard } from '@/utils/config'

/** invoice 模块守卫：停用则拦截发票（深链防护）。 */
const { moduleEnabled: invoiceEnabled, loadModuleConfig: loadInvoiceModule } = useModuleGuard('invoice')

const menuTop = ref(0)
const menuHeight = ref(32)
const navStyle = computed(() => ({ top: `${menuTop.value}px`, height: `${menuHeight.value}px` }))
const listStyle = computed(() => ({ paddingTop: `${menuTop.value + menuHeight.value + uni.upx2px(20)}px` }))

const list = ref<InvoiceRequest[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const loaded = ref(false)
const detailVisible = ref(false)
const detail = ref<InvoiceRequest | null>(null)
const loginGuideVisible = ref(false)

function invoiceTitle(item: InvoiceRequest): string { return item.type === 2 ? item.companyName || '公司抬头' : item.personalName || '个人抬头' }
function statusClass(status: number): string { return status === 1 ? 'success' : status === 4 ? 'muted' : 'pending' }

/** 加载发票申请记录，支持触底分页。 */
async function load(reset = true): Promise<void> {
  if (loading.value || loadingMore.value) return
  const nextPage = reset ? 1 : page.value + 1
  if (!reset && list.value.length >= total.value) return
  if (reset) loading.value = true
  else loadingMore.value = true
  try {
    const result = await getInvoiceList(nextPage, 10)
    list.value = reset ? result.list : [...list.value, ...result.list]
    page.value = result.page || nextPage
    total.value = result.total || list.value.length
    loaded.value = true
  } catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '发票记录加载失败', icon: 'none' }) }
  finally { loading.value = false; loadingMore.value = false }
}

/** 打开发票详情抽屉。 */
async function showDetail(item: InvoiceRequest): Promise<void> {
  try { detail.value = await getInvoiceDetail(item.id); detailVisible.value = true }
  catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '发票详情加载失败', icon: 'none' }) }
}

onLoad(() => {
  if (!isLoggedIn()) {
    loginGuideVisible.value = true
    return
  }
  void load(true)
})
onShow(() => { if (loaded.value) void load(true) })

onMounted(() => {
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect) {
      menuTop.value = rect.top
      menuHeight.value = rect.height
    }
  } catch { /* 非微信环境没有胶囊按钮 */ }
  void loadInvoiceModule()
})
</script>

<template>
  <view class="page">
    <view class="nav" :style="navStyle"><image class="back" src="/static/left_arrow.png" mode="aspectFit" @click="uni.navigateBack()" /><text class="title">发票记录</text></view>
    <!-- invoice 模块停用：拦截发票（深链防护） -->
    <view v-if="!invoiceEnabled" class="module-blocked">
      <text class="module-blocked-title">发票功能未开通</text>
      <text class="module-blocked-desc">当前商户未开通发票模块，发票申请暂不可用。</text>
    </view>
    <scroll-view v-if="invoiceEnabled" class="list" :style="listStyle" scroll-y @scrolltolower="load(false)">
      <view v-show="loading && !list.length" class="state">加载中...</view>
      <view v-for="item in list" :key="String(item.id)" class="invoice-card" @click="showDetail(item)">
        <view class="card-head"><text>{{ invoiceTitle(item) }}</text><text :class="['status', statusClass(item.status)]">{{ item.statusDesc }}</text></view>
        <view class="card-row"><text>发票类型：{{ item.type === 2 ? '公司' : '个人' }}</text><text>¥{{ Number(item.amount || 0).toFixed(2) }}</text></view>
        <view class="card-row muted-text"><text>{{ item.email }}</text><text>{{ item.createTime }}</text></view>
      </view>
      <view v-show="loaded && !loading && !list.length" class="state">暂无发票记录</view>
      <view v-show="loadingMore" class="more">加载中...</view>
    </scroll-view>

    <view v-show="detailVisible" class="mask" @click="detailVisible = false">
      <view class="sheet" @click.stop>
        <view class="sheet-head"><text>发票详情</text><text class="close" @click="detailVisible = false">×</text></view>
        <template v-if="detail">
          <view class="detail-row"><text>状态</text><text :class="['status', statusClass(detail.status)]">{{ detail.statusDesc }}</text></view>
          <view class="detail-row"><text>发票抬头</text><text>{{ invoiceTitle(detail) }}</text></view>
          <view v-if="detail.taxNo" class="detail-row"><text>税号</text><text>{{ detail.taxNo }}</text></view>
          <view class="detail-row"><text>收票邮箱</text><text>{{ detail.email }}</text></view>
          <view class="detail-row"><text>关联订单</text><text class="wrap">{{ detail.orderIds }}</text></view>
          <view v-if="detail.invoiceNo" class="detail-row"><text>发票号码</text><text>{{ detail.invoiceNo }}</text></view>
        </template>
      </view>
    </view>

    <LoginGuide v-model="loginGuideVisible" />
  </view>
</template>

<style>
.page { position: relative; height: 100vh; overflow: hidden; background: #f6f6f6; color: #222; }
.nav { position: fixed; right: 0; left: 0; z-index: 20; display: flex; align-items: center; justify-content: center; background: #fff; }
.back { position: absolute; left: 32rpx; width: 40rpx; height: 40rpx; }
.title { font-size: 32rpx; font-weight: 700; }
.list { position: absolute; inset: 0; width: 100%; height: 100%; padding: 20rpx 24rpx; box-sizing: border-box; }
.invoice-card { margin-bottom: 18rpx; padding: 24rpx; background: #fff; border-radius: 8rpx; }
.card-head, .card-row, .detail-row { display: flex; justify-content: space-between; gap: 24rpx; }
.card-head { font-size: 28rpx; font-weight: 600; }
.card-row { margin-top: 20rpx; color: #555; font-size: 24rpx; }
.muted-text { color: #999; font-size: 22rpx; }
.status.pending { color: #aa7a35; }.status.success { color: #3e8a55; }.status.muted { color: #999; }
.state, .more { padding: 140rpx 0; color: #999; text-align: center; font-size: 26rpx; }.more { padding: 28rpx 0; }
.mask { position: fixed; inset: 0; z-index: 20; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .62); }
.sheet { width: 100%; padding: 30rpx 28rpx calc(30rpx + env(safe-area-inset-bottom)); background: #fff; }
.sheet-head { display: flex; justify-content: center; position: relative; font-size: 30rpx; font-weight: 700; }.close { position: absolute; right: 0; font-size: 42rpx; font-weight: 300; }
.detail-row { align-items: flex-start; margin-top: 26rpx; color: #555; font-size: 25rpx; }.detail-row > text:first-child { flex-shrink: 0; color: #999; }.wrap { flex: 1; text-align: right; word-break: break-all; }

/* 模块停用拦截提示 */
.module-blocked { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; padding: 40rpx; text-align: center; }
.module-blocked-title { color: #1f2937; font-size: 32rpx; font-weight: 600; }
.module-blocked-desc { margin-top: 16rpx; color: #98a2b3; font-size: 26rpx; line-height: 1.6; }
</style>
