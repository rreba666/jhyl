<script setup lang="ts">
/**
 * 我的资金明细页
 * 数据源：GET /api/v2/finance/flows（隆平后端）
 * 支持按方向（全部/收入/支出）与业务类型过滤；滚动加载分页。
 * 资金明细归 basic 模块：登录即可查看，不随 wallet 开关拦截。
 */
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getFinanceFlows, type FinanceFlow } from '@/api/finance'
import { isLoggedIn } from '@/utils/auth'
import { createThrottle } from '@/utils/interaction'
import LoginGuide from '@/components/LoginGuide.vue'

/** 方向筛选类型 */
type DirectionFilter = 'all' | 'income' | 'expense'

const menuTop = ref(0)
const menuHeight = ref(32)
const loggedIn = ref(false)
const loginGuideVisible = ref(false)

const list = ref<FinanceFlow[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const currentDirection = ref<DirectionFilter>('all')
const currentType = ref('')
const navigationThrottle = createThrottle(500)
let pageLoadPromise: Promise<void> | null = null

/** 自定义导航栏样式，与微信胶囊按钮保持同一高度。 */
const navStyle = computed(() => ({ top: `${menuTop.value}px`, height: `${menuHeight.value}px` }))

/** 内容区从胶囊按钮下方开始，避免标题被系统导航遮挡。 */
const bodyStyle = computed(() => ({ paddingTop: `${menuTop.value + menuHeight.value + uni.upx2px(20)}px` }))

/** 方向筛选 tab。 */
const dirTabs: { value: DirectionFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'income', label: '收入' },
  { value: 'expense', label: '支出' },
]

/** 业务类型筛选 chips（前端硬编码常用类型与后端 bizType 枚举对齐）。 */
const typeTabs: { value: string; label: string }[] = [
  { value: '', label: '全部类型' },
  { value: 'ORDER_PAY', label: '订单支付' },
  { value: 'ORDER_REFUND', label: '订单退款' },
  { value: 'WITHDRAW', label: '提现' },
  { value: 'WITHDRAW_FAIL_RETURN', label: '提现退回' },
  { value: 'TRANSFER_OUT', label: '转出' },
  { value: 'TRANSFER_IN', label: '转入' },
  { value: 'CONVERT', label: '兑换' },
  { value: 'PROMOTION_INCOME', label: '推广收益' },
  { value: 'BONUS_INCOME', label: '红包收益' },
]

/** 是否还有下一页。 */
const hasMore = computed(() => list.value.length < total.value)

/** 当前方向筛选对应的接口参数（1收入/2支出，全部不传）。 */
function directionParam(): number | undefined {
  if (currentDirection.value === 'income') return 1
  if (currentDirection.value === 'expense') return 2
  return undefined
}

/** 拉取资金明细；reset=true 用于切换筛选后重查首页。 */
async function loadFlows(reset: boolean): Promise<void> {
  if (loading.value || loadingMore.value) return
  if (!reset && !hasMore.value) return
  if (reset) {
    loading.value = true
  } else {
    loadingMore.value = true
  }
  const targetPage = reset ? 1 : page.value + 1
  try {
    const result = await getFinanceFlows({
      direction: directionParam(),
      bizType: currentType.value || undefined,
      page: targetPage,
      pageSize: 10,
    })
    list.value = reset ? (result.list || []) : list.value.concat(result.list || [])
    page.value = result.page || targetPage
    total.value = result.total || 0
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '资金明细加载失败', icon: 'none' })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

/** 滚动到底部继续分页加载。 */
function loadMore(): void {
  void loadFlows(false)
}

/** 切换方向筛选并重查。 */
function changeDirection(value: DirectionFilter): void {
  if (currentDirection.value === value) return
  currentDirection.value = value
  void loadFlows(true)
}

/** 切换业务类型筛选并重查。 */
function changeType(value: string): void {
  if (currentType.value === value) return
  currentType.value = value
  void loadFlows(true)
}

/** 返回上一页。 */
function goBack(): void {
  if (!navigationThrottle()) return
  uni.navigateBack({ delta: 1 })
}

/** 金额显示为两位小数。 */
function formatMoney(value: unknown): string {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00'
}

/** 时间压缩为「yyyy-MM-dd HH:mm」，容错 ISO 或空格分隔格式。 */
function formatTime(value: string | null | undefined): string {
  if (!value) return '--'
  return value.replace('T', ' ').slice(0, 16)
}

/** 校验登录；未登录弹出登录引导。 */
async function ensureLogin(): Promise<boolean> {
  if (isLoggedIn()) {
    loggedIn.value = true
    return true
  }
  loginGuideVisible.value = true
  return false
}

/** 合并首次挂载与重新显示时的并发刷新，避免重复请求。 */
function refreshPage(): Promise<void> {
  if (pageLoadPromise) return pageLoadPromise
  const pending = ensureLogin().then((ok) => (ok ? loadFlows(true) : undefined))
  pageLoadPromise = pending
  pending.then(
    () => { if (pageLoadPromise === pending) pageLoadPromise = null },
    () => { if (pageLoadPromise === pending) pageLoadPromise = null },
  )
  return pending
}

onMounted(async () => {
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect) {
      menuTop.value = rect.top
      menuHeight.value = rect.height
    }
  } catch { /* 非微信环境忽略 */ }
  void refreshPage()
})

onShow(() => {
  void refreshPage()
})
</script>

<template>
  <view class="page">
    <view class="nav" :style="navStyle">
      <image class="back-button" src="/static/left_arrow.png" mode="aspectFit" @click="goBack" />
      <text class="nav-title">资金明细</text>
      <view class="nav-spacer" />
    </view>

    <scroll-view v-if="loggedIn" class="page-scroll" scroll-y :style="bodyStyle" @scrolltolower="loadMore">
      <!-- 筛选区：方向 tab + 类型 chips -->
      <view class="filter-bar">
        <view class="dir-tabs">
          <view
            v-for="dir in dirTabs"
            :key="dir.value"
            :class="['dir-tab', { active: currentDirection === dir.value }]"
            @click="changeDirection(dir.value)"
          >{{ dir.label }}</view>
        </view>
        <scroll-view class="type-scroll" scroll-x :show-scrollbar="false">
          <view class="type-tags">
            <view
              v-for="type in typeTabs"
              :key="type.value"
              :class="['type-tag', { active: currentType === type.value }]"
              @click="changeType(type.value)"
            >{{ type.label }}</view>
          </view>
        </scroll-view>
      </view>

      <!-- 明细列表 -->
      <view class="flow-list">
        <view v-if="loading" class="flow-empty">
          <text>加载中...</text>
        </view>
        <view v-else-if="!list.length" class="flow-empty">
          <text>暂无资金明细</text>
        </view>
        <view v-else class="flow-items">
          <view v-for="item in list" :key="item.flowNo" class="flow-item">
            <view class="flow-item-top">
              <text class="flow-type">{{ item.bizTypeDesc || '--' }}</text>
              <text :class="['flow-amount', item.direction === 1 ? 'income' : 'expense']">
                {{ (item.direction === 2 ? '-' : '+') + formatMoney(item.amount) }}
              </text>
            </view>
            <view class="flow-item-mid">
              <text class="flow-time">{{ formatTime(item.createTime) }}</text>
              <text v-if="item.directionDesc" class="flow-dir">{{ item.directionDesc }}</text>
            </view>
            <view class="flow-item-bottom">
              <text v-if="item.bizNo" class="flow-bizno">单号 {{ item.bizNo }}</text>
              <text v-if="item.balanceAfter != null" class="flow-balance">余额 {{ formatMoney(item.balanceAfter) }}</text>
            </view>
          </view>
          <view class="flow-more">
            <text>{{ loadingMore ? '加载中...' : (hasMore ? '上拉加载更多' : '已加载全部') }}</text>
          </view>
        </view>
      </view>
    </scroll-view>

    <view v-if="!loggedIn" class="access-empty">
      <text class="access-empty-title">登录后查看资金明细</text>
    </view>

    <LoginGuide v-model="loginGuideVisible" />
  </view>
</template>

<style scoped>
.page { position: relative; height: 100vh; overflow: hidden; background: #f5f6f8; color: #172033; font-family: 'PingFang SC', '苹方-简', sans-serif; }
.nav { position: fixed; right: 0; left: 0; z-index: 20; display: flex; align-items: center; padding: 0 32rpx; box-sizing: border-box; background: #f5f6f8; }
.back-button { width: 34rpx; height: 34rpx; flex-shrink: 0; }
.nav-title { position: absolute; left: 50%; color: #111; font-size: 32rpx; font-weight: 600; transform: translateX(-50%); }
.nav-spacer { width: 34rpx; height: 34rpx; }
.page-scroll { position: absolute; inset: 0; width: 100%; height: 100%; box-sizing: border-box; }

/* 筛选区 */
.filter-bar { padding: 20rpx 32rpx 8rpx; }
.dir-tabs { display: flex; gap: 16rpx; }
.dir-tab { flex: 1; height: 72rpx; display: flex; align-items: center; justify-content: center; border-radius: 20rpx; background: #fff; color: #667085; font-size: 26rpx; font-weight: 600; }
.dir-tab.active { background: linear-gradient(135deg, #ff6a2b, #ff5a1f); color: #fff; }
.type-scroll { margin-top: 16rpx; width: 100%; white-space: nowrap; }
.type-tags { display: inline-flex; gap: 12rpx; padding: 4rpx 2rpx; }
.type-tag { flex-shrink: 0; height: 56rpx; padding: 0 24rpx; display: inline-flex; align-items: center; border-radius: 28rpx; background: #fff; color: #475467; font-size: 24rpx; font-weight: 600; }
.type-tag.active { background: rgba(255, 106, 43, .12); color: #ff5a1f; border: 2rpx solid rgba(255, 106, 43, .35); }

/* 明细列表 */
.flow-list { margin-top: 12rpx; padding: 0 32rpx 40rpx; }
.flow-empty { padding: 120rpx 0; color: #98a2b3; font-size: 26rpx; text-align: center; }
.flow-items { display: flex; flex-direction: column; gap: 16rpx; }
.flow-item { padding: 24rpx 26rpx; border-radius: 20rpx; background: #fff; }
.flow-item-top { display: flex; align-items: center; justify-content: space-between; }
.flow-type { color: #172033; font-size: 28rpx; font-weight: 600; }
.flow-amount { font-size: 30rpx; font-weight: 700; }
.flow-amount.income { color: #12b76a; }
.flow-amount.expense { color: #f04438; }
.flow-item-mid { display: flex; align-items: center; justify-content: space-between; margin-top: 12rpx; }
.flow-time { color: #98a2b3; font-size: 22rpx; }
.flow-dir { color: #98a2b3; font-size: 22rpx; }
.flow-item-bottom { display: flex; align-items: center; justify-content: space-between; margin-top: 12rpx; padding-top: 12rpx; border-top: 1rpx solid #f2f4f7; }
.flow-bizno { max-width: 55%; color: #667085; font-size: 22rpx; }
.flow-balance { color: #667085; font-size: 22rpx; }
.flow-more { padding: 20rpx 0; color: #98a2b3; font-size: 24rpx; text-align: center; }

/* 未登录态 */
.access-empty { position: absolute; top: 50%; right: 0; left: 0; display: flex; align-items: center; flex-direction: column; transform: translateY(-50%); }
.access-empty-title { color: #172033; font-size: 30rpx; font-weight: 700; }
</style>
