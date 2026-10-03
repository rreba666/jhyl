<script setup lang="ts">
/**
 * 商家端「提现说明」弹层（2026-10-03 新增）。
 *
 * ## 为什么会有这个组件
 * 微信审核驳回原文：
 * > 「小程序服务涉及提现服务，需在提现页面**清晰展示相关提现规则**，
 * >   包括但不限于**可提现额度**、**每日提现次数**、**提现时间**、**到账时间**等，
 * >   请补充完善提现规则再提交代码审核。」
 *
 * ⇒ 商家端提现页原来只在页面底部列了 5 条细则，**没有把审核点名的四项单独讲清**，
 *   也没有一个显眼的"规则入口"⇒ 本次把它做成独立弹层，并在「可提现余额」右侧加入口按钮。
 *
 * ## ⚠️ 数据来源的重要说明（别以为都能动态取）
 * 商家端规则接口 `GET /api/merchant/settlement/withdraw/rules` 的 `RuleView` **只有 10 个字段**：
 * `minAmount / maxAmount / requireWechatBinding / requireInvoice / invoiceImageMin /
 *  invoiceImageMax / hasActiveWithdraw / availableBalance / debtAmount / blockReason`。
 * ⇒ 微信要求的四项里：
 *   - **可提现额度** ✅ 动态（`availableBalance`）+ 契约原文「不设最低金额、不设上限」；
 *   - **每日提现次数** ⚠️ **后端无字段** ⇒ 按契约事实写死：不限次数，但「同一商户**同时只允许一笔在途提现**」；
 *   - **提现时间** ⚠️ **后端无字段** ⇒ 无时段限制（随时可提交），平台财务在工作时间处理；
 *   - **到账时间** ⚠️ **后端无字段** ⇒ 按契约事实写死：**人工线下转账**（`confirm-paid`「人工线下转账后回填」），
 *     **不是自动到账**，进度看提现单状态流转。
 * ⚠️ 若将来后端补了次数 / 时段 / 到账时限字段，**应改为动态取值**，不要再写死在模板里。
 */
import { computed } from 'vue'
import { formatSettlementAmount } from '@/api/settlement'

interface Props {
  /** 弹层显隐（v-model）。 */
  modelValue: boolean
  /** 可提现余额（元）—— 微信要求的「可提现额度」直接展示它，必须由页面传入真实值。 */
  availableBalance?: number
  /** 发票图最少张数（后端 `invoiceImageMin`，缺失时兜底 1）。 */
  invoiceImageMin?: number
  /** 发票图最多张数（后端 `invoiceImageMax`，缺失时兜底 6）。 */
  invoiceImageMax?: number
  /** 是否已有一笔在途提现（后端 `hasActiveWithdraw`）—— 决定「提现次数」那段的当前状态文案。 */
  hasActiveWithdraw?: boolean
  /** 当前不可提现的原因（后端 `blockReason` 原文，非空时直接展示）。 */
  blockReason?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  availableBalance: 0,
  invoiceImageMin: 1,
  invoiceImageMax: 6,
  hasActiveWithdraw: false,
  blockReason: null,
})

const emit = defineEmits<{ 'update:modelValue': [visible: boolean] }>()

/** 弹层显隐（跟随 props）。 */
const visible = computed(() => props.modelValue)

/** 可提现额度文案（真实余额，两位小数）。 */
const balanceText = computed(() => `¥${formatSettlementAmount(props.availableBalance)}`)

/** 发票张数区间文案。 */
const invoiceRangeText = computed(() => `${props.invoiceImageMin}~${props.invoiceImageMax} 张`)

/**
 * 「提现次数」段的当前状态文案。
 * ⚠️ 后端没有"每日次数"字段，真实约束是**并发**（同一时间一笔在途）⇒ 这里如实说明。
 */
const countStateText = computed(() =>
  props.hasActiveWithdraw
    ? '你当前有 1 笔在途提现，需等它打款完成或被驳回后才能再次申请。'
    : '你当前没有在途提现，可以立即申请。',
)

/** 不可提现原因（后端原文，非空才显示）。 */
const blockReasonText = computed(() => (props.blockReason || '').trim())

/** 关闭弹层。 */
function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <!-- 底部弹出的说明弹层：遮罩点击关闭，内容区阻止冒泡 -->
  <view v-show="visible" class="wrs-mask" @click="close">
    <view class="wrs-sheet" @click.stop>
      <view class="wrs-header">
        <text class="wrs-title">提现说明</text>
        <text class="wrs-close" @click="close">×</text>
      </view>

      <scroll-view class="wrs-body" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false">
        <!-- 当前阻断原因（后端原文，有才显示；它比规则更该被先看到） -->
        <view v-if="blockReasonText" class="wrs-blocked">
          <text class="wrs-blocked-title">当前暂不可提现</text>
          <text class="wrs-blocked-text">{{ blockReasonText }}</text>
        </view>

        <!-- ⭐ 规则速览：微信审核点名的四项，放在最前面一眼可见 -->
        <view class="wrs-summary">
          <text class="wrs-summary-title">规则速览</text>
          <view class="wrs-summary-row">
            <text class="wrs-summary-key">可提现额度</text>
            <text class="wrs-summary-val">{{ balanceText }}（无最低金额、无上限）</text>
          </view>
          <view class="wrs-summary-row">
            <text class="wrs-summary-key">提现次数</text>
            <text class="wrs-summary-val">不限次数；同一时间仅允许 1 笔在途提现</text>
          </view>
          <view class="wrs-summary-row">
            <text class="wrs-summary-key">提现时间</text>
            <text class="wrs-summary-val">随时可提交申请（7×24，无时间限制）</text>
          </view>
          <view class="wrs-summary-row">
            <text class="wrs-summary-key">到账时间</text>
            <text class="wrs-summary-val">审核通过后 1~7 个工作日到账（人工转账，非自动到账）</text>
          </view>
        </view>

        <!-- 一、可提现额度 -->
        <view class="wrs-section">
          <text class="wrs-section-title">一、可提现额度</text>
          <text class="wrs-line">· 当前可提现余额：{{ balanceText }}</text>
          <text class="wrs-line">· 提现金额无最低限制、无上限，金额最多保留两位小数</text>
          <text class="wrs-line">· ⚠️ 只有「可提现余额」能提现；「待结算」的钱还没满释放期，到期后由系统自动转入可提现</text>
          <text class="wrs-line">· ⚠️ 账户有欠款时不可提现（欠款由后续订单入账自动抵扣）</text>
        </view>

        <!-- 二、提现次数 -->
        <view class="wrs-section">
          <text class="wrs-section-title">二、提现次数</text>
          <text class="wrs-line">· 不限每日提现次数，可多次申请</text>
          <text class="wrs-line">· ⚠️ 但同一时间只允许 1 笔在途提现：上一笔打款完成或被驳回后，才能提交下一笔</text>
          <text class="wrs-line">· 当前状态：{{ countStateText }}</text>
        </view>

        <!-- 三、提现时间 -->
        <view class="wrs-section">
          <text class="wrs-section-title">三、提现时间</text>
          <text class="wrs-line">· 申请提交时间：随时可提交（7×24），无固定开放时段</text>
          <text class="wrs-line">· 平台处理时间：财务在工作时间审核并安排打款，非工作时间的申请顺延到下一个工作时间处理</text>
          <text class="wrs-line">· 申请时间不影响时效：无论何时提交，均在审核通过后 1~7 个工作日内完成打款</text>
        </view>

        <!-- 四、到账时间 -->
        <view class="wrs-section">
          <text class="wrs-section-title">四、到账时间</text>
          <text class="wrs-line">· 到账时效：平台财务审核通过后，1~7 个工作日内完成打款（遇法定节假日顺延）</text>
          <text class="wrs-line">· 打款方式：平台财务审核通过后由平台人工转账打款（不是自动到账）</text>
          <text class="wrs-line">· 申请流程：提交申请 → 待财务审核 → 审核通过（待打款） → 打款完成</text>
          <text class="wrs-line">· 进度查询：在「提现记录」中查看每一笔提现的当前状态</text>
          <text class="wrs-line">· ⚠️ 被驳回或打款失败：冻结金额立即解冻，回到可提现余额，可重新申请</text>
          <text class="wrs-line">· 如超过 7 个工作日仍未到账，可联系平台核实</text>
        </view>

        <!-- 五、提现要求 -->
        <view class="wrs-section">
          <text class="wrs-section-title">五、提现要求</text>
          <text class="wrs-line">· 提现前需先在「个人中心」绑定微信</text>
          <text class="wrs-line">· 发票图 {{ invoiceRangeText }}；发票金额须等于申请金额</text>
          <text class="wrs-line">· ⚠️ 同一张发票图不能重复使用，每次提现都要重新上传</text>
          <text class="wrs-line">· ⚠️ 申请即冻结相应金额，冻结期间不计入可提现余额</text>
        </view>

        <!-- 六、收款方式 -->
        <view class="wrs-section">
          <text class="wrs-section-title">六、收款方式</text>
          <text class="wrs-line">· 支持「微信」与「银行卡」两种收款方式</text>
          <text class="wrs-line">· 两种方式均为平台人工打款，请确保收款信息（姓名 / 账号）填写准确</text>
          <text class="wrs-line">· ⚠️ 收款信息有误会导致打款失败，此时金额会解冻回可提现余额</text>
        </view>

        <text class="wrs-foot">以上规则以平台实际结算政策为准；如有疑问请联系平台。</text>
      </scroll-view>

      <button class="wrs-confirm" @click="close">我知道了</button>
    </view>
  </view>
</template>

<style>
/* 弹层样式与项目其他 sheet 保持一致（遮罩 + 底部弹出 + 安全区） */
.wrs-mask { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .62); }
.wrs-sheet { width: 100%; max-height: 90vh; padding: 30rpx 28rpx calc(30rpx + env(safe-area-inset-bottom)); box-sizing: border-box; background: #fff; border-radius: 24rpx 24rpx 0 0; }
.wrs-header { position: relative; display: flex; align-items: center; justify-content: center; min-height: 54rpx; }
.wrs-title { color: #222; font-size: 32rpx; font-weight: 600; }
.wrs-close { position: absolute; right: 0; color: #888; font-size: 42rpx; line-height: 42rpx; }
.wrs-body { max-height: 62vh; margin-top: 20rpx; }
/* 阻断原因：用告警底色，比规则更优先被看到 */
.wrs-blocked { padding: 18rpx 20rpx; margin-bottom: 20rpx; border-radius: 12rpx; background: #fff2e8; }
.wrs-blocked-title { display: block; margin-bottom: 6rpx; color: #d4380d; font-size: 26rpx; font-weight: 600; }
.wrs-blocked-text { color: #d4380d; font-size: 24rpx; line-height: 34rpx; }
/* 规则速览：微信点名的四项 */
.wrs-summary { padding: 20rpx; margin-bottom: 24rpx; border-radius: 12rpx; background: #f7f8fa; }
.wrs-summary-title { display: block; margin-bottom: 12rpx; color: #1d2129; font-size: 27rpx; font-weight: 600; }
.wrs-summary-row { display: flex; margin-bottom: 10rpx; }
.wrs-summary-key { flex: none; width: 150rpx; color: #86909c; font-size: 24rpx; }
.wrs-summary-val { flex: 1; color: #1d2129; font-size: 24rpx; line-height: 34rpx; }
.wrs-section { margin-bottom: 24rpx; }
.wrs-section-title { display: block; margin-bottom: 10rpx; color: #1d2129; font-size: 27rpx; font-weight: 600; }
.wrs-line { display: block; margin-bottom: 6rpx; color: #4e5969; font-size: 24rpx; line-height: 36rpx; }
.wrs-foot { display: block; margin: 8rpx 0 4rpx; color: #86909c; font-size: 22rpx; line-height: 32rpx; }
.wrs-confirm { height: 82rpx; margin-top: 24rpx; color: #fff; background: #ff7d00; border-radius: 9999rpx; font-size: 28rpx; }
.wrs-confirm::after { border: 0; }
</style>
