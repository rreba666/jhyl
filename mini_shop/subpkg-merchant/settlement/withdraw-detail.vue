<script setup lang="ts">
/**
 * 商家端 · 提现详情页
 * ------------------------------------------------------------
 * 契约（文档 §2.7）：`GET /api/merchant/settlement/withdraw/{withdrawNo}`
 * - 单条提现单：含财务意见 `reviewRemark`、打款凭证 `payNo` / `payVoucherUrl` / `paidAt`
 * - **非本商户的单返回 `1002`**（按「不存在」处理）
 *
 * 口径：
 * 1. 响应里 `invoiceImages` 是 **JSON 字符串**（不是数组）→ api 层已归一化成数组，本页直接 `v-for`；
 * 2. 时间只做字符串规范化（`formatSettlementTime`），**不用 `new Date`**；
 * 3. 发票图必须可放大（财务人工看图核对票面金额，前端只需保证清晰可放大，文档 §7 待优化项 3）。
 * 4. 提现**无手续费**概念：`amount` 即打款金额，页面上不要自己算"实际到账"。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  MERCHANT_WITHDRAW_STATUS_TEXT,
  SETTLEMENT_CODE_NOT_MERCHANT_OWNER,
  formatSettlementAmount,
  formatSettlementTime,
  getSettlementWithdrawDetail,
  resolveSettlementErrorMessage,
  withdrawStatusText,
  type MerchantWithdrawOrderVO,
} from '@/api/settlement'
import { isApiRequestError, resolveImageUrl } from '@/utils/request'

const statusBarHeight = ref(0)
const contentTop = computed(() => statusBarHeight.value + 44)

const withdrawNo = ref('')
const detail = ref<MerchantWithdrawOrderVO | null>(null)
const loading = ref(false)
/** 单子不存在（1002：非本商户或已被删除）。 */
const notFound = ref(false)
/** 非品牌主体（13016）。 */
const notMerchantOwner = ref(false)

onLoad((options) => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '提现详情' })
  // withdrawNo 由列表页 encodeURIComponent 后带过来，这里解码还原
  withdrawNo.value = decodeURIComponent(String((options as Record<string, string>)?.withdrawNo || ''))
  void loadDetail()
})

/** 拉提现单详情。 */
async function loadDetail(): Promise<void> {
  if (!withdrawNo.value) {
    notFound.value = true
    return
  }
  loading.value = true
  try {
    const result = await getSettlementWithdrawDetail(withdrawNo.value)
    if (!result) {
      notFound.value = true
      return
    }
    detail.value = result
    notFound.value = false
  } catch (error) {
    const code = isApiRequestError(error) ? Number(error.code) : NaN
    // 1002：非本商户 / 不存在 —— 一律按"单子不存在"展示
    if (code === 1002) {
      notFound.value = true
      return
    }
    // 13016：店长/店员误入
    if (code === SETTLEMENT_CODE_NOT_MERCHANT_OWNER) {
      notMerchantOwner.value = true
      return
    }
    uni.showToast({ title: resolveSettlementErrorMessage(error, '提现详情加载失败'), icon: 'none' })
  } finally {
    loading.value = false
  }
}

/** 状态样式类。 */
const statusClass = computed(() => {
  switch (String(detail.value?.status || '')) {
    case 'PENDING_REVIEW': return 'is-pending'
    case 'APPROVED': return 'is-approved'
    case 'SUCCESS': return 'is-success'
    case 'REJECTED': return 'is-rejected'
    case 'FAILED': return 'is-failed'
    default: return ''
  }
})

/** 收款方式文案。 */
const payeeTypeText = computed(() => (String(detail.value?.payeeType || '') === 'BANK_CARD' ? '银行卡' : '微信'))

/** 状态说明（把后端状态翻译成商家能理解的下一步）。 */
const statusHint = computed(() => {
  switch (String(detail.value?.status || '')) {
    case 'PENDING_REVIEW': return '已提交，等待平台财务核对发票与金额；此时申请金额已从可提现余额冻结。'
    case 'APPROVED': return '财务已核对通过，等待线下打款；到账后状态会更新为「已到账」。'
    case 'SUCCESS': return '平台已完成打款，请核对下方打款流水号与到账时间。'
    case 'REJECTED': return '该笔提现被驳回，冻结金额已解冻回可提现余额；如需重新申请请重新上传发票。'
    case 'FAILED': return '打款失败，冻结金额已解冻回可提现余额；请核对收款账号后重新申请。'
    default: return ''
  }
})

/** 复制文本（收款账号 / 打款流水号）。 */
function copyText(value?: string | null, label = '内容'): void {
  const text = String(value || '').trim()
  if (!text) return
  uni.setClipboardData({ data: text, success: () => uni.showToast({ title: `${label}已复制`, icon: 'none' }) })
}

/** 预览发票图（可放大核对票面金额）。 */
function previewInvoiceImages(current: string): void {
  const urls = (detail.value?.invoiceImages || []).map((item) => resolveImageUrl(item))
  if (!urls.length) return
  uni.previewImage({ urls, current: resolveImageUrl(current) })
}

/** 预览收款码。 */
function previewPayeeQr(): void {
  const url = String(detail.value?.payeeQrUrl || '').trim()
  if (!url) return
  uni.previewImage({ urls: [resolveImageUrl(url)] })
}

/** 预览打款凭证。 */
function previewPayVoucher(): void {
  const url = String(detail.value?.payVoucherUrl || '').trim()
  if (!url) return
  uni.previewImage({ urls: [resolveImageUrl(url)] })
}

function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.navigateTo({ url: '/subpkg-merchant/settlement/withdraw-list' })
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <text class="nav-back" @click="goBack">‹</text>
      <text class="nav-title">提现详情</text>
    </view>

    <scroll-view class="content" scroll-y>
      <view v-if="loading" class="state">加载中…</view>

      <!-- 非本商户 / 不存在（1002） -->
      <view v-else-if="notFound" class="state">
        <text class="state-title">提现单不存在</text>
        <text class="state-text">该单号不存在或不属于当前商户，请返回列表重新选择。</text>
      </view>

      <!-- 13016：仅品牌主体 -->
      <view v-else-if="notMerchantOwner" class="state">
        <text class="state-title">仅商户品牌主体可查看结算账户与提现</text>
        <text class="state-text">当前身份为店长/店员，请在「账单」查看本门店订单口径营业额。</text>
      </view>

      <template v-else-if="detail">
        <!-- 金额与状态 -->
        <view class="hero">
          <text class="hero-label">申请提现金额（元）</text>
          <text class="hero-value">{{ formatSettlementAmount(detail.amount) }}</text>
          <text class="hero-status" :class="statusClass">{{ withdrawStatusText(detail.status) }}</text>
          <text v-if="statusHint" class="hero-hint">{{ statusHint }}</text>
        </view>

        <!-- 单号与时间 -->
        <view class="card">
          <text class="card-title">申请信息</text>
          <view class="line">
            <text class="line-label">提现单号</text>
            <text class="line-value" @click="copyText(detail.withdrawNo, '单号')">{{ detail.withdrawNo || '—' }}<text class="line-copy">复制</text></text>
          </view>
          <view class="line">
            <text class="line-label">申请时间</text>
            <text class="line-value">{{ formatSettlementTime(detail.createTime) }}</text>
          </view>
          <view class="line">
            <text class="line-label">申请人</text>
            <text class="line-value">{{ detail.applyName || '—' }}</text>
          </view>
          <view class="line">
            <text class="line-label">发票金额</text>
            <text class="line-value">{{ formatSettlementAmount(detail.invoiceAmount) }}</text>
          </view>
          <view class="line">
            <text class="line-label">发票号</text>
            <text class="line-value">{{ detail.invoiceNo || '未填写' }}</text>
          </view>
          <view class="line">
            <text class="line-label">提交时可用余额</text>
            <text class="line-value">{{ formatSettlementAmount(detail.balanceSnapshot) }}</text>
          </view>
        </view>

        <!-- 发票图（可放大核对票面金额） -->
        <view class="card">
          <text class="card-title">发票图片（{{ (detail.invoiceImages || []).length }} 张）</text>
          <view v-if="(detail.invoiceImages || []).length" class="image-grid">
            <image
              v-for="(image, index) in detail.invoiceImages"
              :key="image + index"
              class="image-thumb"
              :src="resolveImageUrl(image)"
              mode="aspectFill"
              @click="previewInvoiceImages(image)"
            />
          </view>
          <text v-else class="empty-text">暂无发票图片</text>
        </view>

        <!-- 收款信息 -->
        <view class="card">
          <text class="card-title">收款信息</text>
          <view class="line">
            <text class="line-label">收款方式</text>
            <text class="line-value">{{ payeeTypeText }}</text>
          </view>
          <view class="line">
            <text class="line-label">收款人</text>
            <text class="line-value">{{ detail.payeeName || '—' }}</text>
          </view>
          <view class="line">
            <text class="line-label">收款账号</text>
            <text class="line-value" @click="copyText(detail.payeeAccount, '收款账号')">{{ detail.payeeAccount || '—' }}<text class="line-copy">复制</text></text>
          </view>
          <view v-if="detail.payeeQrUrl" class="qr-line">
            <text class="line-label">收款码</text>
            <image class="qr-thumb" :src="resolveImageUrl(detail.payeeQrUrl)" mode="aspectFit" @click="previewPayeeQr" />
          </view>
        </view>

        <!-- 审核与打款结果 -->
        <view class="card">
          <text class="card-title">审核与打款</text>
          <view v-if="detail.reviewRemark" class="remark-box">
            <text class="remark-text">财务意见：{{ detail.reviewRemark }}</text>
          </view>
          <view class="line">
            <text class="line-label">审核时间</text>
            <text class="line-value">{{ formatSettlementTime(detail.reviewTime) }}</text>
          </view>
          <view class="line">
            <text class="line-label">打款流水号</text>
            <text class="line-value" @click="copyText(detail.payNo, '打款流水号')">
              {{ detail.payNo || '—' }}<text v-if="detail.payNo" class="line-copy">复制</text>
            </text>
          </view>
          <view class="line">
            <text class="line-label">打款时间</text>
            <text class="line-value">{{ formatSettlementTime(detail.paidAt) }}</text>
          </view>
          <view v-if="detail.payVoucherUrl" class="qr-line">
            <text class="line-label">打款凭证</text>
            <image class="qr-thumb" :src="resolveImageUrl(detail.payVoucherUrl)" mode="aspectFit" @click="previewPayVoucher" />
          </view>
          <!-- 平台不自动打款：SUCCESS 由财务线下转账后点「确认打款」触发 -->
          <text class="card-foot-hint">平台为人工线下打款，{{ MERCHANT_WITHDRAW_STATUS_TEXT.SUCCESS }} 表示财务已确认转账。</text>
        </view>
      </template>
    </scroll-view>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  box-sizing: border-box;
  background: #f2f3f7;
}
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 85rpx;
  background: #f2f3f7;
}
.nav-back {
  position: absolute;
  left: 23rpx;
  color: #1d2129;
  font-size: 46rpx;
  line-height: 1;
  top: auto;
  bottom: 0;
  display: flex;
  height: 88rpx;
  align-items: center;
}
.nav-title {
  color: #1d2129;
  font-size: 33rpx;
  font-weight: 600;
}
.content {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 0 31rpx 60rpx;
}

/* 头部金额卡 */
.hero {
  margin-top: 23rpx;
  padding: 46rpx 31rpx;
  border-radius: 23rpx;
  background: #ffffff;
  text-align: center;
}
.hero-label {
  display: block;
  color: #86909c;
  font-size: 25rpx;
}
.hero-value {
  display: block;
  margin-top: 12rpx;
  color: #1d2129;
  font-size: 62rpx;
  font-weight: 700;
  line-height: 1.1;
}
.hero-status {
  display: block;
  margin-top: 16rpx;
  font-size: 27rpx;
  font-weight: 600;
}
.hero-status.is-pending { color: #d97706; }
.hero-status.is-approved { color: #2563eb; }
.hero-status.is-success { color: #00b42a; }
.hero-status.is-rejected { color: #86909c; }
.hero-status.is-failed { color: #f53f3f; }
.hero-hint {
  display: block;
  margin-top: 16rpx;
  color: #86909c;
  font-size: 23rpx;
  line-height: 36rpx;
}

/* 通用卡片 */
.card {
  margin-top: 23rpx;
  padding: 31rpx;
  border-radius: 23rpx;
  background: #ffffff;
}
.card-title {
  display: block;
  color: #1d2129;
  font-size: 29rpx;
  font-weight: 600;
}
.line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-top: 19rpx;
}
.line-label {
  flex: none;
  width: 210rpx;
  color: #86909c;
  font-size: 24rpx;
}
.line-value {
  flex: 1;
  min-width: 0;
  color: #1d2129;
  font-size: 24rpx;
  line-height: 36rpx;
  text-align: right;
  word-break: break-all;
}
.line-copy {
  margin-left: 12rpx;
  color: #ff5500;
  font-size: 22rpx;
}
.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 19rpx;
  margin-top: 19rpx;
}
.image-thumb {
  width: 150rpx;
  height: 150rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
}
.qr-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 19rpx;
}
.qr-thumb {
  width: 180rpx;
  height: 180rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
}
.remark-box {
  margin-top: 19rpx;
  padding: 19rpx 23rpx;
  border-radius: 15rpx;
  background: #fff7ed;
}
.remark-text {
  color: #9a3412;
  font-size: 24rpx;
  line-height: 36rpx;
}
.empty-text {
  display: block;
  margin-top: 19rpx;
  color: #86909c;
  font-size: 24rpx;
}
.card-foot-hint {
  display: block;
  margin-top: 23rpx;
  padding-top: 19rpx;
  border-top: 2rpx solid #f2f3f7;
  color: #86909c;
  font-size: 22rpx;
  line-height: 34rpx;
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 200rpx 46rpx;
  text-align: center;
  color: #86909c;
  font-size: 28rpx;
}
.state-title {
  color: #1d2129;
  font-size: 29rpx;
  font-weight: 600;
}
.state-text {
  margin-top: 16rpx;
  color: #86909c;
  font-size: 24rpx;
  line-height: 36rpx;
}
</style>
