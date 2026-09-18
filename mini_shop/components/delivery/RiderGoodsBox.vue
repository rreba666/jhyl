<script setup lang="ts">
/**
 * 商品清单块（骑手端「新任务」「待取货」卡片共用）
 *
 * ⚠️ 同一个块在两页的**位置和宽度不同**（2026-09-17 核对设计稿）：
 * - `01_新任务` / `02_新任务_商品清单展开`：在**右侧信息列内**（左侧距离气泡的右边），
 *   与店名/地址同宽（`Frame 57` x=64 宽 302），紧跟地址下方（间距 4px）；
 * - `03_待取货`：**全宽**（`Frame 88` x=1000 宽 350），在「位置图标 + 地址」下方（间距 12px）。
 *
 * 所以组件只负责「块本身」（100% 宽 + 灰底容器），**摆在哪里由父级容器决定**。
 *
 * 件数用列表的 `totalQuantity`（**总件数**），不是 `itemCount`（明细行数）—— 2026-09-17 api_doc 口径。
 */
import type { RiderTaskItem } from '@/api/delivery'

const props = defineProps<{
  /** 总件数（totalQuantity） */
  quantity: number
  /** 是否展开 */
  expanded: boolean
  /** 展开后的商品明细（父组件按需拉取后传入） */
  items: RiderTaskItem[]
}>()

const emit = defineEmits<{ (event: 'toggle'): void }>()
</script>

<template>
  <view class="goods-box">
    <!-- `.stop` 必须有：卡片本体可点进详情，不阻止冒泡的话点"商品清单"也会跳详情 -->
    <view class="goods-row" @click.stop="emit('toggle')">
      <text class="goods-text">商品清单（{{ props.quantity }} 件）</text>
      <!-- 展开时箭头朝上（iconfont `jiantou_shang` / 收起 `jiantou_xia`） -->
      <text
        class="rider-icon goods-arrow"
        :class="props.expanded ? 'rider-icon-jiantou_shang' : 'rider-icon-jiantou_xia'"
      />
    </view>
    <view v-if="props.expanded" class="goods-list">
      <view v-for="(item, index) in props.items" :key="index" class="goods-item">
        <image v-if="item.productImage" class="goods-image" :src="item.productImage" mode="aspectFill" />
        <view class="goods-info">
          <text class="goods-name">{{ item.productName }}</text>
          <text v-if="item.skuSpec" class="goods-spec">{{ item.skuSpec }}</text>
        </view>
        <text class="goods-qty">× {{ item.quantity }}</text>
      </view>
      <view v-if="!props.items.length" class="goods-empty">暂无商品明细</view>
    </view>
  </view>
</template>

<style scoped>
/* 灰底容器（设计稿 01/02 的 Frame 57：302 宽、上下左右内边距 12px、圆角）；展开时容器自然变高 */
.goods-box { box-sizing: border-box; width: 100%; padding: 0 23rpx; border-radius: 24rpx; background: #f6f7f9; }
/* 标题行：12px(padding) + 22px(内容) + 12px = 46px → 88rpx */
.goods-row { display: flex; align-items: center; justify-content: space-between; height: 88rpx; }
.goods-text { color: #1d2129; font-size: 27rpx; font-weight: 500; }
.goods-arrow { color: #1d2129; font-size: 31rpx; }
/* 展开后的明细区：上间距 8px（= 设计稿标题行到首个商品行的 gap），下间距 8rpx + 商品行自带的 15rpx ≈ 容器底 12px */
.goods-list { padding: 15rpx 0 8rpx; }
/* 商品行（设计稿 02 的 Frame 58：278×56，内边距 8/12/8/8，圆角 8px） */
.goods-item { display: flex; align-items: center; height: 108rpx; margin-bottom: 15rpx; padding: 0 23rpx 0 15rpx; border-radius: 15rpx; background: #fff; }
/* 商品图 40×40px → 77rpx */
.goods-image { width: 77rpx; height: 77rpx; flex-shrink: 0; border-radius: 12rpx; background: #f2f3f7; }
.goods-info { flex: 1; min-width: 0; margin-left: 15rpx; }
.goods-name { display: block; overflow: hidden; color: #1d2129; font-size: 23rpx; font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.goods-spec { display: block; margin-top: 4rpx; color: #86909c; font-size: 23rpx; }
.goods-qty { flex-shrink: 0; margin-left: 16rpx; color: #4e5969; font-size: 23rpx; }
.goods-empty { padding: 8rpx 0 24rpx; color: #86909c; font-size: 24rpx; text-align: center; }
</style>
