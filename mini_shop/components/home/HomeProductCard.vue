<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProductCard } from '@/api/product'
// ⚠️ 标题 / 卖点行的**字段口径**统一在这个共用模块里（与店铺页网格卡、分类页卡片同一套，
//    见该模块头部注释：2026-10-10 用户报障「店铺页商品卡展示的字段跟首页不一样」的根因）。
import { productCardSellingPoint, productCardShowSellingPoint, productCardTitle } from '@/utils/product-card'

type LayoutMode = 'grid' | 'list'

const props = defineProps<{
  product: ProductCard
  mode: LayoutMode
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

/**
 * 主图是否已「加载结束」（成功或失败都算）。
 *
 * ⚠️ 图片是**逐张异步加载**的（还带 `lazy-load`），加载完之前该位置需要骨架占位；
 * 图片一旦就位就收起骨架、让实图淡入。
 * ⚠️ **失败（`@error`）也必须收骨架** —— 否则扫光会一直转，看起来像卡死。
 */
const imageLoaded = ref(false)
function onImageSettled(): void {
  imageLoaded.value = true
}

const imageUrl = computed(() => props.product.mainImage || 'https://jinhuayou.com/fengling/2026-09-17-jinhuayouli/mini-static/figma-home/product-default.jpg')
/**
 * 卡片**标题**：`descriptionTitle || name`（契约逐字，见 `utils/product-card.ts`）。
 * ⚠️ 原先这里是 `product.name || '精选商品'` —— 与店铺页网格卡取的不是同一个字段，
 *    同一个商品在两个页面显示两套标题（2026-10-10 用户报障）。
 */
const title = computed(() => productCardTitle(props.product))
/**
 * 卡片**卖点行**：`description || tag`（契约「小程序商品卡下方 = description || subtitle」）。
 * ⚠️ 原先这里是 `descriptionTitle || tag || '精选好物，安心品质'`：
 *    线上 `descriptionTitle` / `tag` **0/78 有值** ⇒ 那句兜底会出现在**每一张**卡片上
 *    （编出来的文案，违反「绝不伪造数据」）；现在改为取真有的 `description`（实测 75/78 有值），
 *    真没有就渲染**空行**（`v-else` 占位节点保住高度），不再塞通用好话。
 */
const description = computed(() => productCardSellingPoint(props.product))
/**
 * 后台「推荐文本」开关：关闭时不渲染描述行（判据同样来自共用模块；未下发按开启）。
 * 兼容后端可能下发的 0/1、'0'/'1'、boolean；**未下发（undefined/null/空串）按开启处理**，
 * 避免老接口或字段缺失时把描述行整片隐藏。
 */
const showDescription = computed(() => productCardShowSellingPoint(props.product))
const price = computed(() => {
  const value = props.product.price
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
})

function selectProduct(): void {
  emit('select', String(props.product.id))
}
</script>

<template>
  <view
    class="product-card motion-card-in"
    :class="`product-card-${mode}`"
    hover-class="product-card-pressed"
    :hover-stay-time="80"
    @click="selectProduct"
  >
    <!-- ⚠️ 图片位骨架 + 扫光（2026-09-29 用户要求）：
         商品图是逐张异步加载的，原来这里只有一块纯浅灰 —— 用户看不出"在加载"，
         会误以为图就是这样。改成骨架 + 一道来回扫过的柔光，加载完再淡入实图。 -->
    <view class="product-image-wrap" :class="`product-image-wrap-${mode}`">
      <view v-if="!imageLoaded" class="product-image-skeleton skeleton-shimmer" />
      <image
        class="product-image motion-image-in"
        :class="{ 'motion-image-loaded': imageLoaded }"
        :src="imageUrl"
        mode="aspectFill"
        lazy-load
        @load="onImageSettled"
        @error="onImageSettled"
      />
    </view>
    <view class="product-copy">
      <!-- ⚠️ 标题与卖点行都走**共用字段口径**（`utils/product-card.ts`）：与店铺页网格卡、
           分类页卡片取同一对字段，几何/字号仍各自按自己的画板写。 -->
      <text class="product-title">{{ title }}</text>
      <!-- 描述行：后台关闭「推荐文本」时不渲染文字，但仍留一个等高占位节点 ——
           若直接把节点摘掉，「有描述」与「无描述」的卡片会相差一行高度，
           双栏瀑布流（左右两列各自 v-for）里同样会错位。
           ⚠️ 文本为空（后端 `description` 与 `tag` 都没值）时也走这条占位分支 ——
              绝不用一句通用文案顶上（那是伪造数据）。 -->
      <text v-if="showDescription && description" class="product-description">{{ description }}</text>
      <text v-else class="product-description"></text>
      <view class="product-price-row">
        <view class="product-price"><text class="price-symbol">¥</text><text class="price-number">{{ price }}</text></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 卡片立体感（2026-09-22 用户反馈「太空、太平、不好看」）：
   原来只有 border-radius + 纯白底、零阴影 → 卡片和浅色页面糊在一起，看着是一块块白板。
   现在：圆角加大 + 两层外阴影（近距紧阴影定轮廓，远距柔阴影做悬浮）+ 极浅描边收边，
   底色用极轻的竖向渐变（纯白大块最容易显平），并按压缩反馈做轻微缩放 —— 让卡片"立"起来。 */
.product-card {
  display: flex;
  overflow: hidden;
  box-sizing: border-box;
  border: 1rpx solid rgba(17, 24, 39, .05);
  border-radius: 24rpx;
  background: linear-gradient(180deg, #ffffff 0%, #fbfbfd 100%);
/* 阴影分两层加深一档：首页是纯白底，太浅的阴影会被背景"吃掉"，看不出悬浮 */
  box-shadow: 0 4rpx 10rpx rgba(17, 24, 39, .06), 0 16rpx 36rpx rgba(17, 24, 39, .1);
}
/* 按下反馈：轻微收缩 + 阴影收紧（有点"按下去"的实体感） */
.product-card-pressed { transform: scale(.98); box-shadow: 0 2rpx 8rpx rgba(17, 24, 39, .06); }
.product-card-grid { flex-direction: column; width: 100%; }
.product-card-list { flex-direction: row; width: 100%; min-height: 272rpx; padding: 0; box-sizing: border-box; }
/* 图片容器：骨架与实图叠放在同一格，圆角内裁切。
   ⚠️ 尺寸规则从原来的 `.product-image` 移到容器上 —— 图片本身改为铺满容器（100%/100%），
      这样骨架层才能与实图严格同位、切换时不跳动。 */
.product-image-wrap { position: relative; flex-shrink: 0; overflow: hidden; background: #f5f6f7; }
.product-card-grid .product-image-wrap { width: 100%; height: 366rpx; }
.product-card-list .product-image-wrap { width: 272rpx; height: 272rpx; }
/* 骨架层铺满容器（`skeleton-shimmer` 提供底色与扫光，见 styles/motion.wxss） */
.product-image-skeleton { position: absolute; top: 0; left: 0; z-index: 1; width: 100%; height: 100%; }
.product-image { display: block; width: 100%; height: 100%; }
.product-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; align-items: stretch; padding: 18rpx 24rpx 20rpx; box-sizing: border-box; }
.product-card-list .product-copy { justify-content: space-between; padding: 8rpx 24rpx 16rpx; }
.product-title, .product-description { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; text-overflow: ellipsis; }
.product-title { color: #1d2129; font-size: 28rpx; font-weight: 600; line-height: 44rpx; -webkit-line-clamp: 2; }
.product-description { margin-top: 4rpx; color: #ff7b2e; font-size: 26rpx; line-height: 40rpx; -webkit-line-clamp: 2; }
.product-card-list .product-title { font-size: 30rpx; }
/* ===== 双栏瀑布流卡片等高对齐（2026-09-21 用户截图反馈：第二列商品名两行，导致两列错位）=====
   首页 grid 模式是**左右两列各自 v-for**，卡片高度完全由内容撑开 ——
   一边标题 1 行、另一边 2 行（描述同理），两张卡就一高一矮，底部自然对不齐。
   修法：标题/描述各按「最大行数 × line-height」固定占位 —— 1 行的标题也占满 2 行高度，
   于是每张卡的文字区高度恒定，价格行自然落在同一水平线上，两列自动对齐。
   （标题/描述本身已带 -webkit-line-clamp: 2 + text-overflow: ellipsis，超出两行即省略号。） */
.product-card-grid .product-title { min-height: 88rpx; }          /* 2 行 × line-height 44rpx */
.product-card-grid .product-description { min-height: 80rpx; }    /* 2 行 × line-height 40rpx */
/* 价格行上方压一道极浅分隔线：把「图片区 / 文字区 / 价格区」分出层次，卡片不再是一整块白 */
.product-price-row { display: flex; align-items: center; justify-content: space-between; margin-top: 12rpx; padding-top: 12rpx; border-top: 1rpx solid rgba(17, 24, 39, .05); }
.product-price { display: flex; align-items: baseline; color: #ff5500; }
.price-symbol { font-size: 24rpx; font-weight: 600; }
.price-number { margin-left: 4rpx; font-family: MiSans, -apple-system, sans-serif; font-size: 38rpx; font-weight: 600; line-height: 44rpx; }
</style>
