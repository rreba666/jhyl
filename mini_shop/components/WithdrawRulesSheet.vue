<script setup lang="ts">
/**
 * 商家结算页「说明」弹层 —— **三个话题共用一个组件**（2026-10-03 新增，2026-10-10 扩展）。
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
 * ## ⚠️ 2026-10-10 扩展：结算页的**三块说明文案全部搬进本组件**（用户要求）
 * 用户原话：「这个**商家提现页的说明太冗余了**，放在**几个按钮后点击弹框**出现吧，目前太难看了」。
 * ⇒ 结算页 `subpkg-merchant/settlement/index.vue` 只保留**入口行**，正文按话题分成三个 `mode`：
 *   | `mode` | 弹层标题 | 正文来源（**原样搬来，一字未改**） |
 *   |---|---|---|
 *   | `'withdraw'`（默认） | 提现说明 | 本组件原有的六节规则 + 规则速览（微信审核要求） |
 *   | `'release'` | 钱什么时候能提现？ | 结算页「钱什么时候能提现？」卡片（物流/同城/自提三种起算点） |
 *   | `'rate'` | 让利比例说明 | 结算页「让利比例（平台抽成）」卡片的四段说明中的三段 |
 * ⚠️ **为什么是"一个组件三种 mode"而不是三个弹层组件**：弹层语言（遮罩/底部圆角/安全区/
 *    `scroll-view` 限高滚动）只有一份，多建一个组件就是多一份会漂的实现。同理，
 *    这里**不许**再建第二个说明弹层 —— 新话题请加 `mode`。
 * ⚠️ 搬进来的文案**未作任何改写**（含 `⚠️` 前缀与标点）：发现页面与这里**重复/矛盾**时必须
 *    先报告、不要私自挑一份留着（本轮已把页面那一份**逐条删掉**：页面原有的「提现规则」七条
 *    与本组件「一~六」节逐条重复，其中两条**逐字相同**、其余为同义改写或拆到不同小节 ——
 *    正文只留本组件这一份）。
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
 *
 * ## 滚动（长内容必须能滚）
 * 正文一律走 `<scroll-view class="wrs-body" scroll-y>`，并给它**显式** `max-height: 62vh`
 * （小程序里父容器 `max-height` 不会自动变成可滚动区，必须由 `scroll-view` 自己限高）；
 * 弹层本体 `max-height: 90vh` + 底部安全区。⚠️ 改样式时别把 `.wrs-body` 的 `max-height` 删掉，
 * 三个话题里 `'withdraw'` 最长（六节 + 速览），删了会直接溢出屏幕。
 * ⚠️ 弹层用 `v-if`（不是 `v-show`）：三个话题长短不一，靠"关闭即销毁"保证每次打开都从顶部开始，
 *    不依赖平台在内容变短时自动把 `scrollTop` 夹回 0（那条行为不可依赖）。
 */
import { computed } from 'vue'
import { formatSettlementAmount } from '@/api/settlement'
// ⚠️ 同城资金释放口径的**单一来源**（与 C 端「售后窗口」同一份，2026-10-08 Step2）。
//    2026-10-10 随「钱什么时候能提现？」文案一起从结算页搬到这里 —— 页面不再持有该常量。
import { SETTLEMENT_RELEASE_TEXT_SAME_CITY } from '@/utils/timing-category'

/** 弹层话题（三个入口共用一个组件，各开到自己的话题）。 */
type SheetMode = 'withdraw' | 'release' | 'rate'

interface Props {
  /** 弹层显隐（v-model）。 */
  modelValue: boolean
  /** 当前话题：`withdraw` 提现说明 / `release` 钱什么时候能提现 / `rate` 让利比例说明。 */
  mode?: SheetMode
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
  mode: 'withdraw',
  availableBalance: 0,
  invoiceImageMin: 1,
  invoiceImageMax: 6,
  hasActiveWithdraw: false,
  blockReason: null,
})

const emit = defineEmits<{ 'update:modelValue': [visible: boolean] }>()

/** 弹层显隐（跟随 props）。 */
const visible = computed(() => props.modelValue)

/**
 * 各话题的弹层标题。
 * ⚠️ 标题与正文**必须同源**：标题写「让利比例说明」而正文是提现规则，就是给用户的错误承诺。
 */
const SHEET_TITLES: Record<SheetMode, string> = {
  withdraw: '提现说明',
  release: '钱什么时候能提现？',
  rate: '让利比例说明',
}

/** 当前标题（未知 mode 兜底回「提现说明」，不让标题空着）。 */
const titleText = computed(() => SHEET_TITLES[props.mode] || SHEET_TITLES.withdraw)

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

/**
 * 同城资金释放规则文案（**单一来源**，见 `utils/timing-category`）。
 * ⚠️ 2026-10-10 从结算页搬来：原来页面持有 `RELEASE_RULE_SAME_CITY`，现在由本组件持有，
 *    页面只留入口 —— 天数**不得**在别处再写一遍（`timing-category-window.contract.ps1` 钉着）。
 */
const RELEASE_RULE_SAME_CITY = SETTLEMENT_RELEASE_TEXT_SAME_CITY

/** 关闭弹层。 */
function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <!-- 底部弹出的说明弹层：遮罩点击关闭，内容区阻止冒泡。
       ⚠️ 用 `v-if`（不是 `v-show`）：三个话题的正文长短不同，而 `scroll-view` 的原生滚动位置
          不会因为"内容变短"就可靠地回到顶部 ⇒ 关掉即销毁、每次打开都从顶部开始（与同页的
          `CommissionRateSheet.vue` 一致）。`mode` 只在打开时切换，所以不会在阅读中途跳位。 -->
  <view v-if="visible" class="wrs-mask" @click="close">
    <view class="wrs-sheet" @click.stop>
      <view class="wrs-header">
        <text class="wrs-title">{{ titleText }}</text>
        <text class="wrs-close" @click="close">×</text>
      </view>

      <!-- ⚠️ 三个话题共用一个滚动容器：显式 `max-height` + `scroll-y`（见文件头「滚动」）。 -->
      <scroll-view class="wrs-body" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false">
        <!-- ===================== 话题 A：钱什么时候能提现（资金释放时间） ===================== -->
        <!-- ⚠️ 2026-10-10 从结算页「钱什么时候能提现？」卡片原样搬来（用户要求：页面只留按钮）。
             文案一字未改；口径来源是 `utils/timing-category`（同城那一行取常量，不写死天数）。 -->
        <view v-if="mode === 'release'">
          <text class="wrs-release-lead">钱不会立刻可提现，而是先进「待结算」，过了释放期才转成「可提现」—— 三种配送方式的起算点不同，分别如下：</text>
          <view class="wrs-release-list">
            <view class="wrs-release-item">
              <text class="wrs-release-form">物流单</text>
              <text class="wrs-release-rule">订单完成后 7 天</text>
            </view>
            <text class="wrs-release-hint">若签收晚于订单完成，则按「签收后 7 天」计算（只会更晚）；查不到签收轨迹时按发货后 15 天估算</text>
            <view class="wrs-release-item">
              <text class="wrs-release-form">同城配送</text>
              <text class="wrs-release-rule">{{ RELEASE_RULE_SAME_CITY }}</text>
            </view>
            <text class="wrs-release-hint">同城的起算点是「送达的次日 0 点」（不是订单完成），按档位分叉的天数见上方规则；且不早于售后窗口关闭</text>
            <view class="wrs-release-item">
              <text class="wrs-release-form">门店自提</text>
              <text class="wrs-release-rule">核销后 1 天</text>
            </view>
            <text class="wrs-release-hint">自提未核销不会释放</text>
          </view>
          <text class="wrs-release-note">释放期到点后由系统自动入账，最长约 5 分钟到账。</text>
          <text class="wrs-release-note">⚠️ 规则本质是「不能退款之后，钱才能提现」—— 释放期与订单的退款窗口对齐，避免出现「钱提走了又发生退款」。</text>
          <text class="wrs-release-note">⚠️ 只有「可提现余额」能提现；「待结算」的钱还没到期，暂时提不出来 —— 它不会丢，到期后会自动转入可提现。</text>
        </view>

        <!-- ===================== 话题 B：让利比例说明 ===================== -->
        <!-- ⚠️ 2026-10-10 从结算页「让利比例（平台抽成）」卡片原样搬来（三段说明）。
             ⚠️ 卡片上保留的那一句（「这里展示的是品牌（商户）级比例…留空 = 本次不修改」）是
                「自助调整」按钮的就地注解，指向的是按钮本体，不搬（搬走就会出现
                "点右侧入口"却看不到入口的死指引）。 -->
        <view v-else-if="mode === 'rate'">
          <text class="wrs-line">平台从每笔订单中抽取的比例，按商品金额计算；⚠️ 配送费全额归商家，不参与抽成。</text>
          <text class="wrs-line">⚠️ 比例调整只对之后新下的订单生效；已完成订单按「下单当时」的比例结算，不会被追溯修改。</text>
          <text class="wrs-line">⚠️ 想只给某个商品单独设比例？在「商品管理 → 编辑商品 → 商品让利比例」里设置即可（3%~20%，留空 = 不修改）。</text>
        </view>

        <!-- ===================== 话题 C（默认）：提现说明 / 提现规则 ===================== -->
        <view v-else>
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
              <text class="wrs-summary-val">人工审核 + 人工打款，无系统固定时限（非自动到账）</text>
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
            <text class="wrs-line">· 申请时间不影响时效：无论何时提交，都排队进入人工审核与人工打款，没有系统固定时限</text>
          </view>

          <!-- 四、到账时间 -->
          <view class="wrs-section">
            <text class="wrs-section-title">四、到账时间</text>
            <text class="wrs-line">· 到账时效：无系统固定时限（人工审核 + 人工打款）—— 一般 1~7 个工作日，遇法定节假日顺延</text>
            <text class="wrs-line">· 打款方式：平台财务审核通过后由平台人工转账打款（不是自动到账）</text>
            <text class="wrs-line">· 申请流程：提交申请 → 待财务审核 → 审核通过（待打款） → 打款完成</text>
            <text class="wrs-line">· 进度查询：在「提现记录」中查看每一笔提现的当前状态</text>
            <text class="wrs-line">· ⚠️ 被驳回或打款失败：冻结金额立即解冻，回到可提现余额，可重新申请</text>
            <text class="wrs-line">· 如长时间未到账，可在「提现记录」查看进度或联系平台核实</text>
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
            <!-- ⚠️ 2026-10-08（spec §3）：商家提现无手续费（用户提现才收 5%，且费率可配、归平台）
                 —— 商家拿用户端规则来问"我是不是也被扣 5%"，所以这里必须显式写明。 -->
            <text class="wrs-line">· 商家提现不收取手续费，提现金额即实际打款金额</text>
            <text class="wrs-line">· ⚠️ 收款信息有误会导致打款失败，此时金额会解冻回可提现余额</text>
          </view>

          <text class="wrs-foot">以上规则以平台实际结算政策为准；如有疑问请联系平台。</text>
        </view>
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
/* ⚠️ 显式限高：小程序里 `scroll-view` 必须先有自己的高度才会滚（见文件头「滚动」） */
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
/* 「钱什么时候能提现？」（话题 release）：样式沿用结算页原来的版式，只换前缀 */
.wrs-release-lead { display: block; color: #4e5969; font-size: 25rpx; line-height: 40rpx; }
.wrs-release-list { margin-top: 18rpx; }
.wrs-release-item { display: flex; align-items: center; margin-top: 14rpx; }
.wrs-release-form { flex-shrink: 0; width: 150rpx; color: #1d2129; font-size: 25rpx; font-weight: 600; }
.wrs-release-rule { flex: 1; color: #4e5969; font-size: 25rpx; line-height: 38rpx; }
.wrs-release-hint { display: block; margin-top: 4rpx; padding-left: 150rpx; color: #86909c; font-size: 22rpx; line-height: 34rpx; }
.wrs-release-note { display: block; margin-top: 14rpx; color: #86909c; font-size: 23rpx; line-height: 36rpx; }
.wrs-confirm { height: 82rpx; margin-top: 24rpx; color: #fff; background: #ff7d00; border-radius: 9999rpx; font-size: 28rpx; }
.wrs-confirm::after { border: 0; }
</style>
