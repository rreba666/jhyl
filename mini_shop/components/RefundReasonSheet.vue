<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  CANCEL_REASON_MAX_LENGTH,
  QUICK_CANCEL_REASONS,
  QUICK_REFUND_REASONS,
  REFUND_REASON_MAX_LENGTH,
  refundReasonCharCount,
  validateAfterSaleReason,
  validateCancelReason,
  validateRefundReason,
} from '@/utils/refund-reason'

/**
 * 退款/售后/取消 理由输入弹层（底部 sheet，C 端订单列表/详情共用）。
 *
 * 为什么要有它：秒退（`POST /api/order/refund/fast/{orderId}`）的请求体是后端 `OrderRefundDTO`，
 * 里面**只有 `reason` 一个字段**，而前端此前一直传空对象（无理由）→ 退款记录里看不出用户为什么退。
 * 现在秒退**必须先填理由**（必填）才能提交，理由随 `{ reason }` 一起上送。
 *
 * ⚠️ 2026-10-03：本组件已服务**三个**入口，校验口径按 `mode` 分档（`refund` / `afterSale` / `cancel`）——
 *    三张 DTO 的「长度 / 字符白名单 / 是否必填」各不相同，混用必然产生"前端比后端更严"的假报错。
 *    **取默认值前先读 `Props.mode` 的表**。
 *
 * 交互约定：
 * - 提供**常用理由快捷标签**（点一下填入，再点取消），减少打字；标签组按 `mode` 取默认；
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
  /**
   * 理由是否必填；**不传时按 `mode` 取默认**（见 {@link mode} 的表：
   * `refund` / `afterSale` 必填，`cancel` **选填** —— 对齐后端 `CancelRequestBody.reason`）。
   */
  required?: boolean
  /** 快捷理由标签；不传时按 `mode` 取默认组（`cancel` 用 {@link QUICK_CANCEL_REASONS}，其余用退款那组）。 */
  quickReasons?: string[]
  /** 确认按钮文案。 */
  submitText?: string
  /** 外部提交中：禁用输入与按钮、不允许关闭。 */
  submitting?: boolean
  /** 外部提交失败的错误文案（显示在弹层内，保留用户已填内容）。 */
  errorMessage?: string
  /** 输入框占位文案。 */
  placeholder?: string
  /**
   * 校验模式（决定用哪个后端 DTO 的约束）。
   *
   * ⚠️⚠️ 2026-10-02 新增（代码审查发现）：两个后端 DTO 约束**不同**，不能共用一套校验；
   * ⚠️⚠️ 2026-10-03 扩到第三档（**取消申请**，同样是被审查发现的）：
   * | mode | 对应接口 | 长度 | 字符白名单 | 必填 |
   * |---|---|---|---|---|
   * | `refund`（默认） | 秒退 `refund/fast` / 自助退款 `refund` | 200 | ✅ **有 `@Pattern`** | ✅ |
   * | `afterSale` | 售后申请 `after-sale/submit` | 200 | ❌ **无 pattern** | ✅ |
   * | `cancel` | 取消申请 `delivery/orders/{orderNo}/cancel-request` | **255** | ❌ **无 pattern** | ❌ **选填** |
   *
   * ⇒ 售后用 `afterSale`：**只校验必填与长度**，否则用户写表情会被**前端**无理由拦住
   *   （后端本来接受），表现为"假报错"。
   * ⇒ 取消用 `cancel`：**255 / 无白名单 / 不必填**（后端 DTO 原样，见 `utils/refund-reason.ts`
   *   的 `validateCancelReason`）。⚠️ 传 `refund` 的后果不只是"更严"，报错文案还会写成
   *   「请填写**退款**理由」——落在一个占位文案写着"取消原因"的弹层里（2026-10-03 的实际缺陷）。
   */
  mode?: 'refund' | 'afterSale' | 'cancel'
}

const props = withDefaults(defineProps<Props>(), {
  title: '填写退款理由',
  subtitle: '',
  submitText: '确认退款',
  submitting: false,
  errorMessage: '',
  placeholder: '请填写退款理由（必填）',
  // ⚠️ 默认走退款口径（含后端 @Pattern 白名单）；售后入口需显式传 mode="afterSale"、
  //    取消入口需显式传 mode="cancel"
  // ⚠️ `required` **刻意不给默认值**：它的默认取决于 `mode`（见下面的 `isRequired`），
  //    固定成 `true` 会让"取消原因选填"这个 DTO 口径依赖调用方记得传 `:required="false"`。
  mode: 'refund',
})

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  /** 校验通过后抛出**清洗过**的理由（父组件直接用这个值提交）。 */
  confirm: [reason: string]
}>()

/** 各 mode 的校验口径（`cancel` 与另两档的差别见 {@link Props.mode} 的表）。 */
const VALIDATORS = {
  refund: validateRefundReason,
  afterSale: validateAfterSaleReason,
  cancel: validateCancelReason,
} as const

/**
 * 理由是否必填。
 * ⚠️ 不传 `required` 时**由 mode 决定**：`refund` / `afterSale` 必填（前端产品规则），
 *    `cancel` **选填**（后端 `CancelRequestBody.reason` 的 `minLength: 0`，不填时记为"用户取消"）。
 */
const isRequired = computed(() => props.required ?? props.mode !== 'cancel')

/** 当前 mode 的长度上限：`cancel` 是 255（`CANCEL_REASON_MAX_LENGTH`），其余 200。 */
const maxLength = computed(() => (props.mode === 'cancel' ? CANCEL_REASON_MAX_LENGTH : REFUND_REASON_MAX_LENGTH))

const reason = ref('')
/** 本地校验错误（与父组件传进来的 `errorMessage` 区分：本地错误在用户一改动就撤掉）。 */
const localError = ref('')

const quickList = computed(() => {
  if (props.quickReasons && props.quickReasons.length) return props.quickReasons
  // ⚠️ 默认标签也要按 mode 分档：取消申请摆「商品降价了」会让人误以为能因降价退差价
  //    （取消申请是"这单不要了、等商家审核"，不是退款理由）。
  return props.mode === 'cancel' ? QUICK_CANCEL_REASONS : QUICK_REFUND_REASONS
})
const charCount = computed(() => refundReasonCharCount(reason.value))
const errorText = computed(() => localError.value || props.errorMessage)
/** 计数行左侧的提示语（`cancel` 的理由进的是取消申请记录，不是退款记录）。 */
const hintText = computed(() => (props.mode === 'cancel' ? '仅用于取消申请记录，不会公开' : '仅用于退款记录，不会公开'))
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
  // ⚠️ 按 mode 选择校验口径：售后（afterSale）后端无 @Pattern ⇒ 只校验必填与长度；
  //    取消（cancel）后端 255 / 无 @Pattern / 选填 ⇒ 只校验长度且默认不必填。
  const validate = VALIDATORS[props.mode] ?? validateRefundReason
  const result = validate(reason.value, { required: isRequired.value })
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
        :maxlength="maxLength"
        :disabled="submitting"
        :placeholder="placeholder"
        placeholder-class="refund-reason-placeholder"
      />
      <view class="refund-reason-meta">
        <text v-if="errorText" class="refund-reason-error">{{ errorText }}</text>
        <text v-else class="refund-reason-hint">{{ hintText }}</text>
        <text class="refund-reason-count">{{ charCount }}/{{ maxLength }}</text>
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
