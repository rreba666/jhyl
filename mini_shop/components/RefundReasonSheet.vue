<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  QUICK_REFUND_REASONS,
  REFUND_REASON_MAX_LENGTH,
  refundReasonCharCount,
  validateRefundReason,
} from '@/utils/refund-reason'

/**
 * 退款理由输入弹层（底部 sheet，C 端订单列表/详情共用）。
 *
 * 为什么要有它：秒退（`POST /api/order/refund/fast/{orderId}`）的请求体是后端 `OrderRefundDTO`，
 * 里面**只有 `reason` 一个字段**，而前端此前一直传空对象（无理由）→ 退款记录里看不出用户为什么退。
 * 现在秒退**必须先填理由**（必填）才能提交，理由随 `{ reason }` 一起上送。
 *
 * 交互约定：
 * - 提供**常用理由快捷标签**（点一下填入，再点取消），减少打字；
 * - 输入即校验（长度按字符算、字符白名单与后端 `@Pattern` 一致，见 `utils/refund-reason.ts`）；
 * - **提交失败时弹层不关**：理由不丢，用户可直接改理由重试（重试复用同一个 `X-Request-Id` 幂等键）；
 * - `submitting` 期间禁止关闭与重复提交。
 */
interface Props {
  modelValue: boolean
  /** 弹层标题。 */
  title?: string
  /** 标题下的说明文案（不同入口的告知不同：秒退要说明"立即原路退款、无需审核"）。 */
  subtitle?: string
  /** 理由是否必填（秒退必填；将来人工退款允许不填时传 false）。 */
  required?: boolean
  /** 快捷理由标签；不传用 `QUICK_REFUND_REASONS` 默认组。 */
  quickReasons?: string[]
  /** 确认按钮文案。 */
  submitText?: string
  /** 外部提交中：禁用输入与按钮、不允许关闭。 */
  submitting?: boolean
  /** 外部提交失败的错误文案（显示在弹层内，保留用户已填内容）。 */
  errorMessage?: string
  /** 输入框占位文案。 */
  placeholder?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '填写退款理由',
  subtitle: '',
  required: true,
  submitText: '确认退款',
  submitting: false,
  errorMessage: '',
  placeholder: '请填写退款理由（必填）',
})

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  /** 校验通过后抛出**清洗过**的理由（父组件直接用这个值提交）。 */
  confirm: [reason: string]
}>()

const reason = ref('')
/** 本地校验错误（与父组件传进来的 `errorMessage` 区分：本地错误在用户一改动就撤掉）。 */
const localError = ref('')

const quickList = computed(() => (props.quickReasons && props.quickReasons.length ? props.quickReasons : QUICK_REFUND_REASONS))
const charCount = computed(() => refundReasonCharCount(reason.value))
const errorText = computed(() => localError.value || props.errorMessage)
/** 当前是否正好等于某个快捷标签（用于高亮；用户手动改过就不再高亮）。 */
const selectedQuick = computed(() => quickList.value.find((item) => item === reason.value.trim()) || '')

// 每次打开都清空：上一笔订单的理由绝不能带到下一笔
watch(() => props.modelValue, (visible) => {
  if (visible) {
    reason.value = ''
    localError.value = ''
  }
})

// 用户一开始修改就撤掉本地报错，避免"改了还红着"
watch(reason, () => {
  if (localError.value) localError.value = ''
})

/** 点快捷标签填入；再点同一个 = 取消（否则误点之后清不掉）。 */
function pickQuick(item: string): void {
  if (props.submitting) return
  reason.value = reason.value.trim() === item ? '' : item
}

function close(): void {
  if (props.submitting) return
  emit('update:modelValue', false)
}

function submit(): void {
  if (props.submitting) return
  const result = validateRefundReason(reason.value, { required: props.required })
  if (!result.ok) {
    localError.value = result.message
    return
  }
  localError.value = ''
  emit('confirm', result.value)
}
</script>

<template>
  <view v-if="modelValue" class="refund-reason-mask" @click="close">
    <view class="refund-reason-sheet" @click.stop>
      <view class="refund-reason-header">
        <text class="refund-reason-title">{{ title }}</text>
        <text class="refund-reason-close" @click="close">×</text>
      </view>
      <text v-if="subtitle" class="refund-reason-subtitle">{{ subtitle }}</text>
      <view class="refund-reason-quick">
        <text
          v-for="item in quickList"
          :key="item"
          class="refund-reason-tag"
          :class="{ active: item === selectedQuick }"
          @click="pickQuick(item)"
        >{{ item }}</text>
      </view>
      <textarea
        v-model="reason"
        class="refund-reason-input"
        :maxlength="REFUND_REASON_MAX_LENGTH"
        :disabled="submitting"
        :placeholder="placeholder"
        placeholder-class="refund-reason-placeholder"
      />
      <view class="refund-reason-meta">
        <text v-if="errorText" class="refund-reason-error">{{ errorText }}</text>
        <text v-else class="refund-reason-hint">仅用于退款记录，不会公开</text>
        <text class="refund-reason-count">{{ charCount }}/{{ REFUND_REASON_MAX_LENGTH }}</text>
      </view>
      <view class="refund-reason-actions">
        <view class="refund-reason-cancel" :class="{ disabled: submitting }" @click="close">取消</view>
        <view class="refund-reason-submit" :class="{ disabled: submitting }" @click="submit">{{ submitting ? '提交中...' : submitText }}</view>
      </view>
    </view>
  </view>
</template>

<style>
.refund-reason-mask { position: fixed; inset: 0; z-index: 90; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .68); }
.refund-reason-sheet { width: 100%; padding: 28rpx 28rpx calc(28rpx + env(safe-area-inset-bottom)); background: #fff; border-radius: 24rpx 24rpx 0 0; box-sizing: border-box; }
.refund-reason-header { position: relative; display: flex; align-items: center; justify-content: center; min-height: 70rpx; }
.refund-reason-title { color: #222; font-size: 30rpx; font-weight: 700; }
.refund-reason-close { position: absolute; top: 50%; right: 0; color: #888; font-size: 42rpx; font-weight: 300; line-height: 1; transform: translateY(-50%); }
.refund-reason-subtitle { display: block; margin-top: 6rpx; color: #916448; font-size: 23rpx; line-height: 1.5; }
.refund-reason-quick { display: flex; flex-wrap: wrap; gap: 16rpx; margin-top: 22rpx; }
.refund-reason-tag { padding: 10rpx 22rpx; color: #555; font-size: 24rpx; background: #f4f4f4; border: 2rpx solid transparent; border-radius: 999rpx; }
.refund-reason-tag.active { color: #916448; border-color: #c0ac9b; background: rgba(192, 172, 155, .2); }
.refund-reason-input { width: 100%; min-height: 180rpx; margin-top: 22rpx; padding: 20rpx 22rpx; color: #333; font-size: 26rpx; line-height: 1.5; background: #f7f7f7; border-radius: 10rpx; box-sizing: border-box; }
.refund-reason-placeholder { color: #b0b0b0; }
.refund-reason-meta { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-top: 12rpx; }
.refund-reason-hint { color: #9a9a9a; font-size: 22rpx; }
.refund-reason-error { flex: 1; min-width: 0; color: #d40000; font-size: 22rpx; line-height: 1.4; }
.refund-reason-count { flex-shrink: 0; color: #b0b0b0; font-size: 22rpx; }
.refund-reason-actions { display: flex; gap: 20rpx; margin-top: 26rpx; }
.refund-reason-cancel { display: flex; flex: 1; align-items: center; justify-content: center; height: 82rpx; color: #333; font-size: 28rpx; background: #f2f2f2; border-radius: 8rpx; }
.refund-reason-submit { display: flex; flex: 2; align-items: center; justify-content: center; height: 82rpx; color: #fff; font-size: 28rpx; background: #050505; border-radius: 8rpx; }
.refund-reason-cancel.disabled, .refund-reason-submit.disabled { opacity: .55; pointer-events: none; }
</style>
