<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getCartList, toggleChecked, updateQuantity, checkAll, removeCartItem, removeCartBatch, type CartItem } from '@/api/cart'
import { DIVIDEND_PURCHASE_LIMIT, PURCHASE_LIMIT_MESSAGE, getDividendQuantity } from '@/utils/dividend-limit'
import { createThrottle } from '@/utils/interaction'
import RequestState from '@/components/RequestState.vue'
import LoginGuide from '@/components/LoginGuide.vue'
import { isLoggedIn } from '@/utils/auth'

const menuTop = ref(0)
const menuHeight = ref(32)
const navStyle = computed(() => ({ top: menuTop.value + 'px', height: menuHeight.value + 'px' }))
/**
 * 右上角「管理 / 完成」按钮的位置：**相对 `.nav` 顶部**的偏移。
 *
 * ⚠️ 2026-09-29 两轮调整（用户反馈「距原生胶囊太近」→「还可以再往下一点」）：
 *    `upx2px(8)`（4px，几乎贴着）→ `upx2px(28)`（14px）→ **`upx2px(52)`（26px）**。
 * ⚠️ 该按钮是**绝对定位**、且 `.nav` 高度只够装胶囊 ⇒ 按钮实际浮在 `.nav` **下方**、
 *    压在内容之上 ⇒ 所以下面的 `bodyTop` **必须跟着算**，否则内容会钻到按钮底下。
 * ⚠️ 按钮自身高度在 CSS 里定死了（`.nav-act { height: 52rpx }` = 26px）——
 *    以后改按钮高度时，这里与 `bodyTop` 都要一起算。
 */
const navActionStyle = computed(() => ({ top: `${menuHeight.value + uni.upx2px(52)}px` }))
/**
 * 内容区顶部留白（距页面顶部的绝对距离）。
 *
 * ⚠️ 与 `navActionStyle` **严格联动**，按下式算（统一换算成 px）：
 *      内容顶 = 胶囊底 + 按钮下移量(26px) + 按钮高度(26px) + 安全余量
 *    ⇒ 取 `upx2px(120)` = 60px（余量 8px），刚好把按钮完整让在内容之上。
 *    ⚠️ 动上面那个下移量、或 `.nav-act` 的高度，**必须同步改这里**。
 */
const bodyTop = computed(() => menuTop.value + menuHeight.value + uni.upx2px(120))

const items = ref<CartItem[]>([])

/**
 * 商品主图是否「加载结束」（成功或失败都算），按 `cartId` 分别记录。
 *
 * ⚠️ 2026-09-29 图片加载优化（与首页卡片、分类页同款）：原来 `.rimg` 只有一块纯色底，
 *    图片加载完**硬切**出现。现在改为「骨架 + 扫光」占位、实图淡入。
 * ⚠️ 按 `cartId` 记录（购物车是**多行**，且增删改会重排）—— 用全局布尔量会导致
 *    「第一张加载完就以为全都加载完了」。
 * ⚠️ `@error` 也算「结束」—— 否则扫光一直转，看起来像卡死。
 * ⚠️ 用**替换 Set** 触发响应式（小程序端对 Set 原地 add 不保证触发更新）。
 */
const imageSettled = ref<Set<string | number>>(new Set())
/** 标记某张主图「已加载结束」（成功、失败都调用）。 */
function onImageSettled(id: string | number): void {
  if (imageSettled.value.has(id)) return
  imageSettled.value = new Set(imageSettled.value).add(id)
}
const loading = ref(true)
const loadError = ref('')
const editMode = ref(false)
const busy = ref(false)
const loginGuideVisible = ref(false)
const navigationThrottle = createThrottle(500)
let listLoadPromise: Promise<void> | null = null
const checkedCount = computed(() => items.value.filter((i) => i.checked).length)
const dividendQuantity = computed(() => getDividendQuantity(items.value))
const checkedTotal = computed(() => {
  const t = items.value.reduce((s, i) => (i.checked ? s + i.price * i.quantity : s), 0)
  return t.toFixed(2)
})
const isAllChecked = computed(() => items.value.length > 0 && items.value.every((i) => i.checked))

async function loadList(): Promise<void> {
  loadError.value = ''
  if (!isLoggedIn()) {
    items.value = []
    loading.value = false
    loginGuideVisible.value = true
    return
  }
  try {
    items.value = await getCartList({ resolveDividendEligibility: true })
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '购物车加载失败，请重试'
    console.error('购物车列表加载失败:', e)
  } finally { loading.value = false }
}
function refreshList(): Promise<void> {
  if (listLoadPromise) return listLoadPromise
  const pending = loadList()
  listLoadPromise = pending
  pending.then(
    () => { if (listLoadPromise === pending) listLoadPromise = null },
    () => { if (listLoadPromise === pending) listLoadPromise = null },
  )
  return pending
}
async function onToggle(item: CartItem): Promise<void> {
  if (busy.value) return; busy.value = true
  try { await toggleChecked(item.cartId); item.checked = !item.checked } catch (e) { uni.showToast({ title: '操作失败', icon: 'none' }) } finally { busy.value = false }
}
async function onCheckAll(): Promise<void> {
  if (busy.value) return; busy.value = true
  try { const t = !isAllChecked.value; await checkAll(t); items.value.forEach((i) => { i.checked = t }) } catch (e) { /* */ } finally { busy.value = false }
}
async function onChangeQty(item: CartItem, delta: number): Promise<void> {
  const currentQuantity = Number(item.quantity)
  const stock = Math.max(0, Number(item.stock))
  if (delta < 0 && stock <= 0) { uni.showToast({ title: '商品已售罄，请删除后重新选择', icon: 'none' }); return }
  let n = currentQuantity + delta
  // 库存变动后购物车数量可能暂时超限，减法直接回落到当前可用库存。
  if (delta < 0 && n > stock) n = stock
  if (n < 1) { uni.showToast({ title: '最少1件', icon: 'none' }); return }
  if (delta > 0 && n > stock) { uni.showToast({ title: '库存不足', icon: 'none' }); return }
  if (delta > 0 && item.dividendEligible && dividendQuantity.value + delta > DIVIDEND_PURCHASE_LIMIT) {
    uni.showToast({ title: PURCHASE_LIMIT_MESSAGE, icon: 'none' })
    return
  }
  if (busy.value) return; busy.value = true
  try { await updateQuantity(item.cartId, n); item.quantity = n } catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '数量更新失败', icon: 'none' }); await refreshList() } finally { busy.value = false }
}
async function onRemove(cartId: number): Promise<void> {
  if (busy.value) return; busy.value = true
  try { await removeCartItem(cartId); items.value = items.value.filter((i) => i.cartId !== cartId); uni.showToast({ title: '已删除', icon: 'success' }) } catch (e) { /* */ } finally { busy.value = false }
}
async function onRemoveSelected(): Promise<void> {
  if (busy.value) return
  const sel = items.value.filter((i) => i.checked)
  if (!sel.length) return; busy.value = true
  try { await removeCartBatch(sel.map((i) => i.cartId)); items.value = items.value.filter((i) => !i.checked); editMode.value = false } catch (e) { /* */ } finally { busy.value = false }
}
function toggleEditMode(): void {
  if (!navigationThrottle()) return
  editMode.value = !editMode.value
}

/** 进入确认订单页，并只传递当前选中的购物车记录。 */
function goPayment(): void {
  if (!navigationThrottle()) return
  const selectedIds = items.value.filter((item) => item.checked).map((item) => item.cartId)
  if (!selectedIds.length) {
    uni.showToast({ title: '请选择商品', icon: 'none' })
    return
  }
  const selectedDividendQuantity = getDividendQuantity(items.value.filter((item) => item.checked))
  if (selectedDividendQuantity > DIVIDEND_PURCHASE_LIMIT) {
    uni.showToast({ title: PURCHASE_LIMIT_MESSAGE, icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/subpkg-order/payment/payment?cartIds=${selectedIds.join(',')}` })
}

onMounted(() => {
  try { const r = uni.getMenuButtonBoundingClientRect(); if (r) { menuTop.value = r.top; menuHeight.value = r.height } } catch { /* */ }
  void refreshList()
})
onShow(() => { loading.value = true; void refreshList() })
</script>

<template>
  <view class="pg">

    <view class="nav" :style="navStyle">
      <text class="nav-tit">购物车</text>
      <view class="nav-act" :class="{ on: editMode }" :style="navActionStyle" @click="toggleEditMode">{{ editMode ? '完成' : '管理' }}</view>
    </view>

    <view class="bd" :style="{ paddingTop: bodyTop + 'px' }">
      <view v-if="loading" class="st"><text class="st-t">加载中...</text></view>
      <RequestState v-else-if="loadError && !items.length" :error="loadError" @retry="refreshList" />
      <view v-else-if="!items.length" class="st">
        <view class="st-icon">🛒</view>
        <text class="st-t">购物车是空的</text>
      </view>
      <RequestState v-if="!loading && loadError && items.length" :error="loadError" @retry="refreshList" />
      <view v-if="!loading && items.length && dividendQuantity > DIVIDEND_PURCHASE_LIMIT" class="limit-warning">
        <text class="limit-warning-t">补贴商品当前共{{ dividendQuantity }}件，最多同时存在3件，请减少后再结算</text>
      </view>
      <!-- scroll-view 用 padding，和 category.vue 一致 -->
      <scroll-view v-if="!loading && items.length" class="lst" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false">
        <view v-for="it in items" :key="it.cartId" class="row">
          <!-- 勾选框 -->
          <view class="chk" @click="onToggle(it)">
            <view class="chk-c" :class="{ on: it.checked }"><text v-if="it.checked" class="chk-m">✓</text></view>
          </view>
          <!-- 商品图（⚠️ 2026-09-29 加「骨架 + 淡入」，与首页卡片 / 分类页同款） -->
          <view class="rimg-wrap">
            <view v-if="it.productImage && !imageSettled.has(it.cartId)" class="rimg-skeleton skeleton-shimmer" />
            <image
              v-if="it.productImage"
              class="rimg motion-image-in"
              :class="{ 'motion-image-loaded': imageSettled.has(it.cartId) }"
              :src="it.productImage"
              mode="aspectFill"
              @load="onImageSettled(it.cartId)"
              @error="onImageSettled(it.cartId)"
            />
            <view v-else class="rimg ph" />
          </view>
          <!-- 信息区 -->
          <view class="info">
            <view class="iname-row">
              <text class="iname-t">{{ it.productName }}</text>
              <text class="idel" @click="onRemove(it.cartId)">×</text>
            </view>
            <text class="isku" v-if="it.skuName && it.skuName !== '1'">{{ it.skuName }}</text>
            <!-- 底部行: space-between，和 category prod-grid 一样 -->
            <view class="ifoot">
              <view v-if="!editMode" class="stp">
                <text class="qty-label">数量：</text>
                <view class="stp-b" @click="it.quantity <= 1 ? onRemove(it.cartId) : onChangeQty(it, -1)"><image class="stp-i" :src="it.quantity <= 1 ? '/static/cart/del.png' : '/static/cart/del_no.png'" mode="aspectFit" /></view>
                <view class="stp-n"><text class="stp-nt">{{ it.quantity }}</text></view>
                <view class="stp-b" @click="onChangeQty(it, 1)"><image class="stp-i" src="/static/cart/add.png" mode="aspectFit" /></view>
              </view>
              <view v-else />
              <!-- 价格: view包text，和 category c-pri 一致 -->
              <view class="ipri"><text class="ipy">¥</text><text class="ipn">{{ it.originalPrice ?? it.price }}</text></view>
            </view>
          </view>
        </view>
        <view class="lst-pad" />
      </scroll-view>
    </view>

    <view v-if="!loading && items.length" class="ftr">
      <view class="ftr-l" @click="onCheckAll">
        <view class="chk-c" :class="{ on: isAllChecked }"><text v-if="isAllChecked" class="chk-m">✓</text></view>
        <text class="ftr-t">全选</text>
      </view>
      <view class="ftr-r">
        <template v-if="editMode">
          <view class="ftr-b del-b" :class="{ off: !checkedCount }" @click="onRemoveSelected"><text class="ftr-bt">删除({{ checkedCount }})</text></view>
        </template>
        <template v-else>
          <view class="checkout-b" :class="{ off: !checkedCount }" @click="goPayment">
            <text class="checkout-label">结算（{{ checkedCount }}）</text>
            <view class="checkout-right"><text class="checkout-price">¥{{ checkedTotal }}</text><image class="checkout-arrow" src="/static/cart/right.png" mode="aspectFit" /></view>
          </view>
        </template>
      </view>
    </view>

    <LoginGuide v-model="loginGuideVisible" />

  </view>
</template>

<style>
.pg { display: flex; flex-direction: column; height: 100vh; background: #fff; }

.nav { position: fixed; left: 0; right: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: #fff; box-sizing: border-box; }
.nav-tit { color: #232423; font-size: 32rpx; font-weight: 700; }
/**
 * 右上角「管理 / 完成」按钮（2026-09-29 加样式并再下移）。
 *
 * ⚠️ **改用 `<view>`**：原先是 `<text>` —— 内联元素的盒模型在小程序里受限，
 *    背景 / 内边距 / 固定高度都不可靠（加了也未必生效）。
 * ⚠️ 样式刻意贴合本页设计语言（**直角 + 黑灰白**：见 `.checkout-b { background:#222; border-radius:0 }`、
 *    `.stp-b { background:#f4f4f4 }`）⇒ 所以这里**不用圆角彩色胶囊**，而是**直角浅灰块**。
 * ⚠️ 语义区分（这也是"丰富购物页"的点）：
 *      默认「管理」= **次要操作** ⇒ 浅灰底 + 深灰字；
 *      编辑态「完成」= **确认动作** ⇒ 黑底白字（与结算按钮 `#222` 同色系）强调。
 */
.nav-act {
  position: absolute;
  right: 26rpx;
  z-index: 101;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 104rpx;
  height: 52rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  color: #333;
  font-size: 26rpx;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  background: #f4f4f4;
  border: 1rpx solid #e6e6e6;
}
/* 编辑态（「完成」）：与主操作按钮同色系，表示这是确认动作 */
.nav-act.on { color: #fff; background: #222; border-color: #222; }
/* 点击反馈（小程序支持 :active） */
.nav-act:active { opacity: .72; }

.bd { flex: 1; display: flex; flex-direction: column; min-height: 0; box-sizing: border-box; }

.st { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.st-t { color: #999; font-size: 28rpx; }
.st-icon { font-size: 80rpx; margin-bottom: 24rpx; }
.limit-warning { margin: 0 26rpx 12rpx; padding: 14rpx 18rpx; background: #fff6e8; border: 1px solid #f5d7a3; box-sizing: border-box; }
.limit-warning-t { color: #9a671b; font-size: 23rpx; line-height: 1.4; }

/*
 * scroll-view — 参照 category.vue .prod 的验证通过模式：
 * 1. padding 直接加在 scroll-view 上
 * 2. 子元素不设 width:100%，自然撑满
 */
.lst { display: flex; flex: 1 1 auto; flex-direction: column; width: 100%; min-width: 0; min-height: 0; padding: 0 26rpx; box-sizing: border-box; }
.lst-pad { display: none; }

/* 行 — 不设 width，由 scroll-view padding 约束 */
.row { display: flex; flex: 0 0 25%; align-items: center; width: 100%; min-width: 0; min-height: 276rpx; padding: 18rpx 0; border-bottom: 1px solid #eee; box-sizing: border-box; }

/* 勾选框 */
.chk { flex-shrink: 0; margin-right: 10rpx; }
.chk-c { width: 32rpx; height: 32rpx; border-radius: 0; border: 2rpx solid #ccc; display: flex; align-items: center; justify-content: center; }
.chk-c.on { background: #333; border-color: #333; }
.chk-m { color: #fff; font-size: 20rpx; font-weight: 700; }

/* 商品图 */
/* ⚠️ 2026-09-29：图区改为「定位容器 + 骨架层 + 实图层」，骨架才叠得上去。
   尺寸与原来的 `.rimg` 完全一致，只是从图本身挪到了外层容器上。 */
.rimg-wrap { position: relative; width: 204rpx; height: 276rpx; flex-shrink: 0; margin-left: 8rpx; }
.rimg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: 0; background: #E9E7DD; }
/* 骨架层铺满图区（底色与扫光由全局 `skeleton-shimmer` 提供，见 styles/motion.wxss） */
.rimg-skeleton { position: absolute; top: 0; left: 0; z-index: 1; width: 100%; height: 100%; }
.rimg.ph { background: #E9E7DD; }

/* 信息区 */
.info { flex: 1 1 0; width: 0; min-width: 0; margin-left: 16rpx; display: flex; flex-direction: column; justify-content: space-between; height: 276rpx; padding: 10rpx 0; box-sizing: border-box; }

/* 名称行 */
.iname-row { display: flex; align-items: flex-start; width: 100%; min-width: 0; }
.iname-t { flex: 1; min-width: 0; color: #333; font-size: 28rpx; font-weight: 500; line-height: 1.45; overflow: hidden; text-overflow: ellipsis; white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.idel { flex-shrink: 0; color: #999; font-size: 36rpx; margin-left: 10rpx; line-height: 1; }

.isku { color: #999; font-size: 22rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 底部行 — space-between 参照 category .prod-grid */
.ifoot { display: flex; align-items: center; justify-content: space-between; width: 100%; min-width: 0; }

/* 步进器 — view 容器套 text，参照 category .c-pri */
.stp { display: flex; align-items: center; flex-shrink: 0; }
.qty-label { color: #777; font-size: 24rpx; margin-right: 8rpx; white-space: nowrap; }
.stp-b { width: 40rpx; height: 40rpx; background: #f4f4f4; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.stp-i { width: 40rpx; height: 40rpx; display: block; }
/* 数量 — view 容器，text 内无 width */
.stp-n { width: 48rpx; height: 40rpx; background: #f4f4f4; display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; }
.stp-nt { color: #333; font-size: 26rpx; font-weight: 500; }

/* 价格 — view 容器套 text，和 category .c-pri 一模一样 */
.ipri { display: flex; align-items: baseline; flex-shrink: 0; }
.ipy { color: #333; font-size: 20rpx; font-weight: 500; }
.ipn { color: #222; font-size: 32rpx; font-weight: 700; margin-left: 2rpx; white-space: nowrap; }

/* 底部 */
.ftr { display: flex; align-items: center; justify-content: space-between; padding: 12rpx 26rpx; background: #fff; border-top: 1px solid #eee; flex-shrink: 0; }
.ftr-l { display: flex; align-items: center; gap: 10rpx; flex-shrink: 0; }
.ftr-t { color: #333; font-size: 26rpx; }
.ftr-r { flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 14rpx; min-width: 0; }
.checkout-b { min-width: 300rpx; min-height: 72rpx; padding: 0 18rpx 0 24rpx; display: flex; align-items: center; justify-content: space-between; gap: 12rpx; background: #222; border-radius: 0; box-sizing: border-box; flex-shrink: 0; }
.checkout-b.off { background: #ccc; }
.checkout-label { color: #fff; font-size: 26rpx; white-space: nowrap; }
.checkout-right { display: flex; align-items: center; gap: 14rpx; min-width: 0; }
.checkout-price { color: #fff; font-size: 30rpx; font-weight: 700; white-space: nowrap; }
.checkout-arrow { width: 28rpx; height: 28rpx; display: block; filter: brightness(0) invert(1); }
.ftr-b { padding: 14rpx 32rpx; background: #333; border-radius: 0; flex-shrink: 0; }
.ftr-b.off { background: #ccc; }
.ftr-b.del-b { background: #e74c3c; }
.ftr-bt { color: #fff; font-size: 26rpx; font-weight: 500; }
</style>
