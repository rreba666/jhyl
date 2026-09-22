<script setup lang="ts">
/**
 * 列表空状态（设计稿 2026-09-22 落地）。
 *
 * 设计规格（Figma 五个空状态画板均为 **390×844**）：
 * - 插画：`176px` 见方（自带透明边，故与文案之间**不需要额外间距**）；
 * - 文案：`14px` / `#86909C`，居中；
 * - 位置：插画顶距内容区顶 `252px`（画板里插画 y=400，内容区顶 = 状态栏 44 + 导航 56 + 筛选行 48 = 148）。
 *
 * 换算口径：小程序 `750rpx = 屏幕宽`，画板宽 390px → **1px(画板) = 750/390 ≈ 1.923rpx**（不是 2 倍！）：
 *   176px → **338rpx**；14px → **27rpx**；252px → **485rpx**。
 * ⚠️ 其余老页面里常见的 `×2` 换算对应的是 375px 宽的画板，本组件按画板实际宽度算，避免插画偏大 4%。
 *
 * 2026-09-22 换图（切图目录里更规范的一套，4 张，源 **528×528 正方形**）。
 * 已逐像素量测「非透明内容 bbox」并与旧图对比，确认视觉尺寸同档，**故不调整 338rpx**：
 *   orders          467×403 / 528（内容宽占比 .884）  ← 旧 312×269 / 352（.886）
 *   orders-search   464×356 / 528（.879）             ← 旧 310×238 / 328（.945）
 *   products        502×370 / 528（.951）             ← 旧 335×248 / 368（.910）
 *   products-search 487×394 / 528（.922）             ← 旧 325×263 / 352（.923）
 * 即宽/高占比偏差 ≤7%，正方形插画在 `aspectFit` 下不会额外留白；528px 也刚好覆盖 3 倍屏（338rpx ≈ 507 物理像素）。
 */
withDefaults(defineProps<{
  /** 插画路径（分包内绝对路径，如 `/subpkg-merchant/static/empty/orders.png`）。 */
  image: string
  /** 文案（如「暂无订单」「暂无搜索订单」）。 */
  text?: string
}>(), {
  text: '',
})
</script>

<template>
  <view class="empty-state">
    <image class="empty-state-image" :src="image" mode="aspectFit" />
    <text v-if="text" class="empty-state-text">{{ text }}</text>
  </view>
</template>

<style>
.empty-state { display: flex; flex-direction: column; align-items: center; padding: 485rpx 48rpx 0; box-sizing: border-box; }
/* 画板 176px → 338rpx（透明边已含在插画内，不要再加 margin） */
.empty-state-image { width: 338rpx; height: 338rpx; }
/* 画板 14px / #86909C → 27rpx */
.empty-state-text { color: #86909c; font-size: 27rpx; line-height: 1.4; text-align: center; }
</style>
