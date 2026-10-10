<script setup lang="ts">
/**
 * C 端 · 商品详情页「进店卡片」（Figma 节点 `4029:5751`，`详情页进店卡片`）。
 *
 * ## 设计口径（值与实现说明逐条对齐，色值/字号不是眼估的）
 * 设计尺寸 390×126 的**白卡**（画板里上下各留 51px 灰底只是衬白用）：
 * - 卡片：`#FFFFFF`，内边距 **12**（→ 23rpx），卡片内纵向间距 **12**（→ 23rpx）；
 * - 顶部行：logo **44×44 圆角 6**（→ 85rpx / 12rpx）+ 店名（16px/600/行高 24，`#1D2129`）
 *   + 评分行（星级 10×10 `#FFB200`、分数 12px `#FFB200`、分隔竖线 1×8 `#E6E7EB`、粉丝 12px `#86909C`）
 *   + 「进店」按钮（**60×28 圆角 4**，纯色 `#FFF4E8`，文案 12px `#FF5500`，右箭头 `#FF5500`）；
 * - 服务表现行：三格等分、**文案居中**，指标名 12px `#86909C` / 指标值 13px `#1D2129`，格间距 24。
 *
 * ## 与「店铺页」那张卡的差异（很容易抄错，实现说明 §2.3 有对照表）
 * 那张卡是**渐变上的透明卡**（白字 + `#FFFFFF@10%` 半透明指标块 + 渐变「收藏」按钮）；
 * 这张是**白卡**（深色字 + 无底色指标格 + 浅橙纯色「进店」按钮）。两张卡**不共用样式**。
 *
 * ## 数据现实（⚠️ 本组件刻意"有数据才画"）
 * - ✗ **评分**：契约里**没有**店铺评分字段（`MerchantOverviewVO.serviceScore` 是
 *   **恒 null 的占位**，契约注释明写"绝不能兜底成 0/占位值"）⇒ 无数据时**整行不渲染**。
 * - ✗ **粉丝数**：契约里**没有** `fansCount` 字段；`ShopVO.boundUserCount` 是
 *   「已绑定微信人数」，**语义不同、不得代替**。
 * - ✗ **服务表现**（`商品品质 / 平均满意度` 等三格）：契约里**没有**服务指标字段。
 * - 以上三项的缺口清单见 `docs/26/10.09/店铺页-Figma实现说明-2026-10-09.md` §4.3 第 4/5/7 条。
 *   ⚠️ 设计稿里那几项指标的具体填充数值全部是**写死的填充文案**，
 *   **不是数据** ⇒ 一律不得硬编码（仓库硬原则：绝不伪造数据）。
 *   ⇒ 所以本组件**只公开可选 prop**：数据到了由父页面传入即渲染，没到就整块不出现（不留 `0`／`—`）。
 *
 * ## 可导航的前提（门店由**商品详情**直给，组件自己不猜）
 * 组件**自己不会猜门店 id**：`shop` 为空时**整张卡不渲染**（`v-if="canRender"`），
 * 点击时 `emit('enter', shop.id)` —— 把「跳哪里」的决定权留给父页面。
 * ⚠️ **2026-10-10 S1 更新**：此前组件注释把"必须由父页面另行解析出唯一门店"当作前提
 * （当时 `ProductDetailV2VO` 没有 `shopId`，只能靠 `/api/shop/deliverable` 旁路猜，
 * 多门店商品一律无卡片）；现在商品详情直接下发 `shopId` / `shopName` / `shopImage`
 * ⇒ 父页面**直读商品详情**即可，旁路已删除（见 `api/shop.ts` 末尾的删除说明）。
 * 组件本身**不受影响**：它要的始终只是"一个有 id 的门店"。
 */
import { computed } from 'vue'
import type { ShopEntry } from '@/api/product'

/** 一条服务指标（名 + 值，值本身已含单位，如「平均满意度97.2%」）。 */
export interface ShopServiceMetric {
  name: string
  value: string
}

/**
 * 进店卡片的门店：**只有跳转真正需要的三个字段**（`id` + 店名 + 门头图）。
 *
 * ⚠️ 这里刻意**不**复用 `api/shop.ts` 的 `EnabledShop` —— 那个类型是**门店档案**，`name` /
 * `address` 是必填的；而本卡片的门店来源是**商品详情自带的** `ShopEntry`
 * （`ProductDetailV2VO.shopId/shopName/shopImage`，2026-10-10 S1），店家档案字段并不保证存在。
 * 用"档案类型"接一个"轻量条目"会逼父页面去补 `address` 之类的假字段 —— 那是伪造数据。
 */
export interface ShopNavigationTarget {
  /** 门店 ID（字符串形态：契约 `int64`，前端按 string 处理防精度丢失）。 */
  id: string
  name?: string
  shopImage?: string
}

const props = withDefaults(defineProps<{
  /** 已从商品详情读出的门店；**为空则不渲染整张卡**（见头部注释的 fail-closed 约定）。 */
  shop?: ShopNavigationTarget | ShopEntry | null
  /** 店铺评分（0–5，一位小数）。⚠️ 契约暂无此字段 ⇒ 不传即不渲染评分行。 */
  rating?: number | null
  /** 店铺粉丝数。⚠️ 契约暂无此字段（≠ `boundUserCount`）⇒ 不传即不渲染。 */
  fansCount?: number | null
  /** 服务表现（最多 3 条）。⚠️ 契约暂无此字段 ⇒ 不传即不渲染整行。 */
  serviceMetrics?: ShopServiceMetric[]
}>(), {
  shop: null,
  rating: null,
  fansCount: null,
  serviceMetrics: () => [],
})

const emit = defineEmits<{
  /** 用户点「进店」/整卡：交出**已读到的**门店 id（字符串形态，防 int64 精度丢失），由父页面导航。 */
  (e: 'enter', shopId: string): void
}>()

/** 门店可用（有 id）才渲染：没有 id 就没有可靠的跳转目标。 */
const canRender = computed(() => Boolean(props.shop && props.shop.id))

/** 门店 logo；未配置时为**空串**（模板据此不画 `<image>`，不开天窗、也不塞占位假图）。 */
const logo = computed(() => String(props.shop?.shopImage || '').trim())

/** 店名；后端未下发时为空串（设计里店名是必有元素，但"没有就不编"仍是第一原则）。 */
const shopName = computed(() => String(props.shop?.name || '').trim())

/** 有评分才显示评分行（`0` 是合法值，`0.0` 分也要显示 —— 所以判据是 `!= null` 而不是真值判断）。 */
const ratingText = computed(() => {
  const value = props.rating
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return ''
  return Number(value).toFixed(1)
})

/** 有粉丝数才显示（0 也是有效值）。 */
const fansText = computed(() => {
  const value = props.fansCount
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return ''
  return `${Number(value)} 粉丝`
})

/** 过滤掉没有名字/值的指标（后端只给 0–N 条，不保证非空串）。 */
const metrics = computed(() => (props.serviceMetrics || [])
  .filter((item) => item && String(item.name || '').trim() && String(item.value || '').trim())
  .slice(0, 3))

/** 点「进店」：**只在有真实门店 id 时**才向上抛事件（组件内不做任何 id 猜测）。 */
function onEnter(): void {
  if (!canRender.value) return
  emit('enter', String(props.shop?.id || ''))
}
</script>

<template>
  <!-- ⚠️ 透明根：`shop` 为空时**整块不渲染**（不是"渲染一张空卡"）—— 见头部注释的 fail-closed 约定。 -->
  <view v-if="canRender" class="shop-entry-card" @click="onEnter">
    <view class="entry-head">
      <!-- logo：未配置 `shopImage` 时不画 `<image>`（不塞占位图）。门头图按方形裁切以兼容 2:1 契约尺寸。 -->
      <image v-if="logo" class="entry-logo" :src="logo" mode="aspectFill" />
      <view class="entry-main">
        <text v-if="shopName" class="entry-name">{{ shopName }}</text>
        <!-- 评分行：星级 + 分数 + 分隔线 + 粉丝数；三块各自有数据才出现（设计里的数字是填充文案，不硬编码）。 -->
        <view v-if="ratingText || fansText" class="entry-rating">
          <view v-if="ratingText" class="entry-stars">
            <!-- ⚠️ 设计稿里五颗星复用的是一个**名叫 `收藏_填充`** 的组件（`4002:4148`，内部只有一个
                 `Star 1 (Stroke)` 矢量）—— 名字有误导性，那就是**实心五角星**，不是收藏图标。
                 这里用实心星字形 `★`（#FFB200）绘制，避免为一次小图标新增二进制切图
                 （仓库禁本地 webp，新增图片还要占包体积）。 -->
            <text class="entry-star">★★★★★</text>
            <text class="entry-score">{{ ratingText }}</text>
          </view>
          <view v-if="ratingText && fansText" class="entry-divider" />
          <!-- ⚠️ 粉丝数只渲染**真实值**：`fansText` 在无数据时是空串（契约里根本没有该字段，
                 设计稿那个数字是填充文案）⇒ 整段不出现，不留 `0`、不留 `—`。 -->
          <text v-if="fansText" class="entry-fans">{{ fansText }}</text>
        </view>
      </view>
      <view class="entry-button">
        <text class="entry-button-text">进店</text>
        <!-- 右箭头：设计是 5×8 的折线（`箭头_右`）—— 用两根边框旋转 45° 画，零切图。 -->
        <view class="entry-arrow" />
      </view>
    </view>

    <!-- 服务表现：设计是三格等分、文案居中、无底色。没有数据时整行不渲染。 -->
    <view v-if="metrics.length" class="entry-metrics">
      <view v-for="metric in metrics" :key="metric.name" class="entry-metric">
        <text class="entry-metric-name">{{ metric.name }}</text>
        <text class="entry-metric-value">{{ metric.value }}</text>
      </view>
    </view>
  </view>
</template>

<style>
/* 进店卡片 —— 白底圆角卡（产品已定：详情页里这块是**白卡**，与店铺页的透明卡不同）。
   ⚠️ Figma 节点本身没写 `cornerRadius`（实现说明 §2.3），这里按产品决策取 12px（23rpx）；
   详情页底色同样是 `#fff`，圆角在该页面上视觉中性，不影响其它度量。 */
.shop-entry-card { padding: 23rpx; background: #FFFFFF; border-radius: 23rpx; box-sizing: border-box; }
.entry-head { display: flex; align-items: center; }
/* logo 44×44 圆角 6（设计值） */
.entry-logo { width: 85rpx; height: 85rpx; flex: none; border-radius: 12rpx; background: #F2F3F7; }
/* 文字组：与 logo 间距 8，与按钮间距 24（设计：44 + 8 + 314，其中文字组 230 + 24 + 按钮 60） */
.entry-main { flex: 1; min-width: 0; margin-left: 15rpx; margin-right: 46rpx; display: flex; flex-direction: column; justify-content: center; }
.entry-name { color: #1D2129; font-size: 31rpx; font-weight: 600; line-height: 46rpx; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.entry-rating { display: flex; align-items: center; height: 38rpx; }
.entry-stars { display: flex; align-items: center; }
.entry-star { color: #FFB200; font-size: 19rpx; line-height: 38rpx; }
.entry-score { margin-left: 12rpx; color: #FFB200; font-size: 23rpx; line-height: 38rpx; }
.entry-divider { width: 2rpx; height: 15rpx; margin: 0 15rpx; background: #E6E7EB; }
.entry-fans { color: #86909C; font-size: 23rpx; line-height: 38rpx; }
/* 「进店」按钮：60×28 圆角 4，纯色 #FFF4E8，内边距 上4/右8/下4/左12，元素间距 2 */
.entry-button { display: flex; align-items: center; flex: none; height: 54rpx; padding: 8rpx 15rpx 8rpx 23rpx; border-radius: 8rpx; background: #FFF4E8; box-sizing: border-box; }
.entry-button-text { color: #FF5500; font-size: 23rpx; line-height: 38rpx; }
.entry-arrow { width: 12rpx; height: 12rpx; margin-left: 4rpx; border-top: 3rpx solid #FF5500; border-right: 3rpx solid #FF5500; transform: rotate(45deg); }
/* 服务表现行：三格等分、文案居中、格间距 24（设计：366 = 106×3 + 24×2） */
.entry-metrics { display: flex; align-items: center; margin-top: 23rpx; }
.entry-metric { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; margin-left: 46rpx; }
.entry-metric:first-child { margin-left: 0; }
.entry-metric-name { color: #86909C; font-size: 23rpx; line-height: 38rpx; }
.entry-metric-value { margin-top: 8rpx; color: #1D2129; font-size: 25rpx; line-height: 42rpx; }
</style>
