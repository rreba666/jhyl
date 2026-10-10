<script setup lang="ts">
/**
 * 商家端「自助调整品牌（商户）级让利比例」输入弹层（2026-10-10 新增）。
 *
 * ## 为什么不用原生 `uni.showModal({ editable: true })`
 * 原来的实现在结算页里用原生弹窗采集比例，真机反馈「输入 3% 不生效、只有纯数字才行」
 * （解析层根因见 `utils/product-commission.ts` 的 `normalizeCommissionRateInput`）。
 * 原生弹窗那一侧还有三个绕不过去的限制 —— 它们正是"看起来改不了"的另一半原因：
 * 1. **输入框没有我们可控的占位/提示**（`placeholderText` 的显示不可控，且用户明确要求提示只写区间「3~20」）；
 * 2. **不能控制聚焦**（打开弹窗不会自动唤起键盘，用户得先点一下输入框）；
 * 3. **不能指定小数键盘**（`type="digit"` 只能在自建 `<input>` 上用，见 `subpkg-merchant/apply/apply.vue`
 *    与 `subpkg-merchant/settlement/index.vue` 的提现金额框，本项目统一用 `type="digit"`）。
 * ⇒ 换成自建底部弹层：结构/交互与同页的 `WithdrawRulesSheet.vue`、
 *   `RefundReasonSheet.vue` 保持一致（遮罩点击关闭、底部圆角、`env(safe-area-inset-bottom)` 安全区）。
 *
 * ## 交互约定（改前先读）
 * - **校验不在这里做**：`confirm` 只把**原文**抛给页面（`subpkg-merchant/settlement/index.vue`
 *   的 `editCommissionRate` 仍用共享的 3~20 校验 + 同一个 `13018` 文案）——
 *   口径只有一处，弹层不许再写一份"3~20"。
 * - **提交失败/越界时弹层不关**（由页面决定何时关）：用户改一下数字就能重试，输入不丢。
 * - `submitting` 期间：输入禁用、遮罩与取消都不响应 —— 防"请求还在飞、弹层先没了"，
 *   也让页面的 `commissionSubmitting` 不会被卡在 `true`（页面在 `finally` 里复位）。
 * - 每次打开都**清空输入并自动聚焦**（上一次输入绝不能带进下一次）。
 */
import { ref, watch } from 'vue'
import {
  MERCHANT_COMMISSION_RATE_EDIT_ENTRY_TEXT,
  MERCHANT_COMMISSION_RATE_EDIT_PLACEHOLDER,
  MERCHANT_COMMISSION_RATE_EDIT_SHEET_NOTE,
} from '@/utils/product-commission'

interface Props {
  /** 弹层显隐（v-model）。 */
  modelValue: boolean
  /**
   * 当前品牌级比例文案（如 `5%`，取不到时 `—`）—— **只读展示现状**。
   * ⚠️ 绝不能拿它当输入框默认值：那样"没改"与"改成同一个值"就分不出来了。
   */
  currentRateText?: string
  /** 页面提交中：禁用输入与关闭（见文件头「交互约定」）。 */
  submitting?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  currentRateText: '—',
  submitting: false,
})

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  /** 点「确认」/ 键盘完成：抛出**原文**（校验与提交都在页面里，见文件头）。 */
  confirm: [text: string]
}>()

/** 输入原文（每次打开清空）。 */
const rateText = ref('')
/** 聚焦标志：置 `true` 时小程序会聚焦输入框并唤起键盘。 */
const focused = ref(false)

// 每次打开：清空 + 自动聚焦
watch(() => props.modelValue, (visible) => {
  if (!visible) {
    focused.value = false
    return
  }
  rateText.value = ''
  focused.value = false
  // ⚠️ 首帧就置 `focus=true` 在小程序里常被忽略（输入框还没挂上去）⇒ 等弹层渲染完再置。
  //    回调里再判一次 `modelValue`：弹层若已被关掉，不去动已卸载组件的状态。
  setTimeout(() => {
    if (props.modelValue) focused.value = true
  }, 150)
})

/** 关闭（提交中不响应：否则请求还在飞、弹层先没了，用户会以为没提交成功）。 */
function close(): void {
  if (props.submitting) return
  emit('update:modelValue', false)
}

/** 确认（提交中防连点）。 */
function submit(): void {
  if (props.submitting) return
  emit('confirm', rateText.value)
}
</script>

<template>
  <!-- 底部输入弹层：遮罩点击关闭（提交中不关），内容区阻止冒泡 -->
  <view v-if="modelValue" class="crs-mask" @click="close">
    <view class="crs-sheet" @click.stop>
      <view class="crs-header">
        <text class="crs-title">{{ MERCHANT_COMMISSION_RATE_EDIT_ENTRY_TEXT }}</text>
        <text class="crs-close" @click="close">×</text>
      </view>

      <!-- 现状：只展示当前比例，不作输入框默认值 -->
      <text class="crs-current">当前品牌级比例：{{ currentRateText }}</text>

      <!-- ⚠️ 占位就是用户要的全部提示（「3~20」），不许再加规则长文案 -->
      <!-- ⚠️ `type="digit"`：比例允许小数（`5.5`）；`number` 在 iOS 上打不出小数点 -->
      <!-- ⚠️ `confirm-type="done"` + `@confirm`：把键盘上的「完成」也接成提交，不用再找按钮 -->
      <input
        v-model="rateText"
        class="crs-input"
        type="digit"
        maxlength="6"
        :focus="focused"
        :disabled="submitting"
        confirm-type="done"
        cursor-spacing="24"
        :placeholder="MERCHANT_COMMISSION_RATE_EDIT_PLACEHOLDER"
        placeholder-class="crs-placeholder"
        @confirm="submit"
      />

      <!-- 留空语义：一行短说明（完整版在结算页卡片上，见 MERCHANT_COMMISSION_RATE_EDIT_OMIT_NOTE） -->
      <text class="crs-note">{{ MERCHANT_COMMISSION_RATE_EDIT_SHEET_NOTE }}</text>

      <view class="crs-actions">
        <view class="crs-cancel" :class="{ disabled: submitting }" @click="close">取消</view>
        <view class="crs-confirm" :class="{ disabled: submitting }" @click="submit">{{ submitting ? '提交中...' : '确认' }}</view>
      </view>
    </view>
  </view>
</template>

<style>
/* 与 WithdrawRulesSheet / RefundReasonSheet 同一套弹层语言：遮罩 + 底部圆角 + 安全区 */
.crs-mask { position: fixed; inset: 0; z-index: 90; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .68); }
.crs-sheet { width: 100%; padding: 28rpx 28rpx calc(28rpx + env(safe-area-inset-bottom)); background: #fff; border-radius: 24rpx 24rpx 0 0; box-sizing: border-box; }
.crs-header { position: relative; display: flex; align-items: center; justify-content: center; min-height: 70rpx; }
.crs-title { color: #222; font-size: 30rpx; font-weight: 700; }
.crs-close { position: absolute; top: 50%; right: 0; color: #888; font-size: 42rpx; font-weight: 300; line-height: 1; transform: translateY(-50%); }
.crs-current { display: block; margin-top: 6rpx; color: #86909c; font-size: 24rpx; line-height: 36rpx; }
.crs-input { width: 100%; height: 92rpx; margin-top: 22rpx; padding: 0 22rpx; color: #1d2129; font-size: 30rpx; background: #f7f8fa; border-radius: 10rpx; box-sizing: border-box; }
.crs-placeholder { color: #b0b0b0; }
.crs-note { display: block; margin-top: 14rpx; color: #86909c; font-size: 23rpx; line-height: 34rpx; }
.crs-actions { display: flex; gap: 20rpx; margin-top: 26rpx; }
.crs-cancel { display: flex; flex: 1; align-items: center; justify-content: center; height: 82rpx; color: #333; font-size: 28rpx; background: #f2f2f2; border-radius: 8rpx; }
.crs-confirm { display: flex; flex: 2; align-items: center; justify-content: center; height: 82rpx; color: #fff; font-size: 28rpx; background: #ff7d00; border-radius: 8rpx; }
.crs-cancel.disabled, .crs-confirm.disabled { opacity: .55; pointer-events: none; }
</style>
