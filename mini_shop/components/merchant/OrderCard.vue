<script setup lang="ts">
/**
 * 商家端 · 订单卡片（对应设计稿「订单管理」卡片，两种头部）
 * - A 型：订单号（灰）+ 复制 + 状态文案（如绿色「已完成」）
 * - B 型：短号 chip（#001 橙）+ 骑手胶囊（头像 + 「张三-待取货」）
 * 主体一致：收货人（姓名 + 打码电话 / 地址）+ 商品行 + 合计。
 * 异常单：收货人下方多一条「异常原因」浅红条（后端下发 exceptionRemark 时才显示）。
 */
import { computed } from 'vue'
import {
  DELIVERY_STATUS_TEXT,
  isActiveDelivery,
  maskPhone,
  type MerchantOrderCardVO,
} from '@/api/merchant'

const props = defineProps<{ order: MerchantOrderCardVO }>()
const emit = defineEmits<{
  (e: 'click', order: MerchantOrderCardVO): void
  (e: 'copy', orderNo: string): void
}>()

/** 是否为 B 型卡片（进行中配送，有骑手）。 */
const isTypeB = computed(() => isActiveDelivery(props.order.deliveryStatus))

/** 骑手胶囊文案：「张三-待取货」。 */
const riderText = computed(() => {
  const name = props.order.deliveryPersonName || '骑手'
  const status = DELIVERY_STATUS_TEXT[String(props.order.deliveryStatus || '')] || props.order.deliveryStatus || ''
  return status ? `${name}-${status}` : name
})

/** 商品行：列表最多展示 3 行，超出提示。 */
const displayItems = computed(() => (props.order.items || []).slice(0, 3))
const hiddenCount = computed(() => {
  const total = (props.order.items || []).length
  return total > 3 ? total - 3 : 0
})

/** 状态文案颜色（A 型）：已完成绿 / 异常红 / 其余橙或灰。 */
const statusClass = computed(() => {
  const status = props.order.status
  const desc = String(props.order.statusDesc || '')
  if (status === 4 || desc.includes('完成')) return 'is-done'
  if (props.order.deliveryStatus === 'EXCEPTION' || desc.includes('异常')) return 'is-exception'
  if (status === 5 || status === 7 || desc.includes('关闭') || desc.includes('退款')) return 'is-muted'
  return 'is-normal'
})

/** 金额格式化：保留最多 2 位小数，去尾零。 */
function money(value?: number | null): string {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  return num.toFixed(2).replace(/\.?0+$/, '')
}

function onCopy(): void {
  const no = props.order.orderNo
  if (!no) return
  emit('copy', no)
  uni.setClipboardData({ data: no })
}
</script>

<template>
  <view class="card" hover-class="card-pressed" @click="emit('click', order)">
    <!-- 头部 -->
    <view class="head">
      <!-- B 型：短号 + 骑手胶囊 -->
      <template v-if="isTypeB">
        <view class="short-chip">#{{ order.shortNo || '001' }}</view>
        <view class="rider-pill">
          <view class="rider-avatar" />
          <text class="rider-name">{{ riderText }}</text>
        </view>
      </template>
      <!-- A 型：订单号 + 复制 + 状态 -->
      <template v-else>
        <view class="order-no-wrap">
          <text class="order-no">{{ order.orderNo || '—' }}</text>
          <text class="copy-icon" @click.stop="onCopy">⧉</text>
        </view>
        <view class="status" :class="statusClass">{{ order.statusDesc || '' }}</view>
      </template>
    </view>

    <!-- 主体 -->
    <view class="body">
      <!-- 收货人 -->
      <view class="receiver">
        <text class="receiver-name">{{ order.receiverName || '收货人' }}</text>
        <text class="receiver-phone">{{ maskPhone(order.receiverPhone) }}</text>
      </view>
      <view v-if="order.receiverAddress" class="address-row">
        <text class="addr-icon">📍</text>
        <text class="address">{{ order.receiverAddress }}</text>
      </view>

      <!-- 异常原因条 -->
      <view v-if="order.exceptionRemark" class="exception-bar">
        <text class="exception-label">异常原因：</text>
        <text class="exception-text">{{ order.exceptionRemark }}</text>
      </view>

      <!-- 商品行 -->
      <view class="goods">
        <view v-for="(item, index) in displayItems" :key="index" class="goods-row">
          <image class="goods-img" :src="item.productImage || ''" mode="aspectFill" />
          <view class="goods-info">
            <text class="goods-name">{{ item.productName || '—' }}</text>
            <text v-if="item.skuSpec" class="goods-spec">{{ item.skuSpec }}</text>
          </view>
          <text class="goods-qty">× {{ item.quantity ?? 1 }}</text>
          <view class="goods-price"><text class="price-yen">¥</text><text class="price-num">{{ money(item.price) }}</text></view>
        </view>
        <text v-if="hiddenCount > 0" class="goods-more">等 {{ order.items?.length }} 件商品</text>
      </view>

      <!-- 合计 -->
      <view class="total-row">
        <text class="total-label">合计</text>
        <view class="total-amount"><text class="total-yen">¥</text><text class="total-num">{{ money(order.totalAmount) }}</text></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.card {
  box-sizing: border-box;
  padding: 0 23rpx;
  border-radius: 24rpx;
  background: #ffffff;
}
.card-pressed {
  background: #f7f8fa;
}

/* 头部 */
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 96rpx; /* 48/50px */
}
.short-chip {
  padding: 2rpx 12rpx;
  border-radius: 12rpx;
  background: #fff6ed;
  color: #ff7d00;
  font-size: 31rpx;
  font-weight: 600;
  line-height: 46rpx;
}
.rider-pill {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 4rpx 23rpx 4rpx 4rpx;
  border-radius: 9999rpx;
  background: #fff4e8;
}
.rider-avatar {
  width: 54rpx;
  height: 54rpx;
  border-radius: 50%;
  background: #ffffff;
}
.rider-name {
  color: #ff5500;
  font-size: 27rpx;
}
.order-no-wrap {
  display: flex;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
}
.order-no {
  color: #86909c;
  font-size: 29rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copy-icon {
  flex: none;
  color: #86909c;
  font-size: 31rpx;
}
.status {
  flex: none;
  margin-left: 15rpx;
  font-size: 27rpx;
  font-weight: 500;
}
.status.is-done {
  color: #00b42a;
}
.status.is-exception {
  color: #f53f3f;
}
.status.is-muted {
  color: #86909c;
}
.status.is-normal {
  color: #ff7d00;
}

/* 主体 */
.body {
  padding: 0 23rpx 23rpx;
}
.receiver {
  display: flex;
  align-items: center;
  margin-bottom: 12rpx;
}
.receiver-name {
  color: #1d2129;
  font-size: 35rpx;
  font-weight: 600;
}
.receiver-phone {
  margin-left: 23rpx;
  color: #1d2129;
  font-size: 35rpx;
}
.address-row {
  display: flex;
  align-items: center;
  margin-bottom: 12rpx;
}
.addr-icon {
  flex: none;
  margin-right: 8rpx;
  font-size: 27rpx;
}
.address {
  flex: 1;
  min-width: 0;
  color: #86909c;
  font-size: 27rpx;
  line-height: 38rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.exception-bar {
  display: flex;
  margin: 12rpx 0;
  padding: 15rpx;
  border-radius: 15rpx;
  background: #ffeded;
}
.exception-label {
  flex: none;
  color: #f53f3f;
  font-size: 27rpx;
}
.exception-text {
  flex: 1;
  color: #1d2129;
  font-size: 27rpx;
}

/* 商品行 */
.goods {
  margin-top: 12rpx;
  padding: 0 0 12rpx;
  border-radius: 12rpx;
  background: #ffffff;
}
.goods-row {
  display: flex;
  align-items: center;
  gap: 23rpx;
  padding: 12rpx 0;
}
.goods-img {
  flex: none;
  width: 127rpx;
  height: 127rpx;
  border-radius: 12rpx;
  background: #f2f3f7;
}
.goods-info {
  flex: 1;
  min-width: 0;
}
.goods-name {
  display: block;
  color: #1d2129;
  font-size: 25rpx;
  line-height: 42rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.goods-spec {
  display: block;
  color: #86909c;
  font-size: 23rpx;
  line-height: 38rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.goods-qty {
  flex: none;
  color: #86909c;
  font-size: 23rpx;
}
.goods-price {
  flex: none;
  display: flex;
  align-items: baseline;
  color: #1d2129;
}
.price-yen {
  font-size: 23rpx;
  font-weight: 500;
  line-height: 1;
}
.price-num {
  font-size: 27rpx;
  font-weight: 500;
  line-height: 1;
}
.goods-more {
  display: block;
  padding: 8rpx 0;
  color: #86909c;
  font-size: 23rpx;
  text-align: center;
}

/* 合计 */
.total-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 15rpx;
}
.total-label {
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 500;
}
.total-amount {
  display: flex;
  align-items: baseline;
  color: #ff5500;
}
.total-yen {
  font-size: 23rpx;
  font-weight: 500;
  line-height: 1;
}
.total-num {
  font-size: 35rpx;
  font-weight: 500;
  line-height: 1;
}
</style>
