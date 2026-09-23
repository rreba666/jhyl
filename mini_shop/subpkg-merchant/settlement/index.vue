<script setup lang="ts">
/**
 * 商家端 · 结算与提现（主页）
 * ------------------------------------------------------------
 * 契约：`docs/商户提现-前端开发文档-2026-09-22.md`（§2.1 账户 / §2.3 规则 / §2.5 提交 / §4 状态机）
 * - `GET  /api/merchant/settlement/account`        → 账户卡片（可提现 / 冻结中 / 欠款 + 累计四项 + 让利比例）
 * - `GET  /api/merchant/settlement/withdraw/rules` → 规则与当前状态（无最低无上限 / 是否在审 / 是否绑微信 / blockReason）
 * - `POST /api/merchant/settlement/withdraw`       → 提交申请（发票图 1~6 张 + **单一金额** + 收款信息）**申请即冻结**
 * - `POST /api/common/upload`                      → 发票图 / 收款码上传（复用 `utils/request` 的 `uploadFile`）
 * 入口：本页可进「账户流水」（flows.vue）与「提现记录」（withdraw-list.vue）。
 *
 * 必须守住的口径（文档 §6「踩过的坑」，改动前先读）：
 * 1. **只留一个金额输入框**：后端强校验「发票金额 == 申请金额」（13014），
 *    提交体由 api 层 `buildWithdrawApplyPayload()` 用同一个金额填 `amount` + `invoiceAmount`；
 * 2. **同一张发票图不能复用**（13019，含被驳回的单）→ 后端报 13019 时清空已选发票并提示**重新上传发票**；
 * 3. **申请即冻结**：提交成功后必须重新拉 `account` 与 `rules`，**绝不把可提现金额缓存在本地**；
 * 4. `withdrawable=false` / `blockReason` 非空 / `hasActiveWithdraw=true` → 提现按钮**置灰**，
 *    且**直接展示后端下发的原因**（前端不自己拼文案）；
 * 5. 未绑定微信（8110）→ 弹窗引导去个人中心绑定；
 * 6. 时间只做字符串规范化（api 层 `formatSettlementTime`），**不用 `new Date`**（会时区漂移）。
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  SETTLEMENT_CODE_ACTIVE_WITHDRAW,
  SETTLEMENT_CODE_INVOICE_REUSED,
  SETTLEMENT_CODE_NOT_MERCHANT_OWNER,
  SETTLEMENT_CODE_WECHAT_UNBOUND,
  SETTLEMENT_ERROR_TEXT,
  applySettlementWithdraw,
  buildWithdrawApplyPayload,
  formatCommissionRate,
  formatSettlementAmount,
  getSettlementAccount,
  getSettlementWithdrawRules,
  resolveSettlementErrorMessage,
  validateWithdrawForm,
  type MerchantWithdrawPayeeType,
  type SettlementAccountVO,
  type SettlementWithdrawRulesVO,
} from '@/api/settlement'
import { isApiRequestError, resolveImageUrl, uploadFile } from '@/utils/request'
import { getIdentity } from '@/api/identity'

const statusBarHeight = ref(0)
/** 内容区顶部留白 = 状态栏 + 自定义导航栏高度（与 bill/index.vue 同口径）。 */
const contentTop = computed(() => statusBarHeight.value + 44)

/** 结算账户（**不缓存到本地存储**，每次进页面/提交后都重新拉）。 */
const account = ref<SettlementAccountVO>({})
/** 提现规则与当前状态。 */
const rules = ref<SettlementWithdrawRulesVO>({})
const loading = ref(false)
const submitting = ref(false)
/** 非品牌主体（13016）：整页只显示提示，不渲染账户与表单（店长/店员误入）。 */
const notMerchantOwner = ref(false)

// ===== 提现申请表单（**金额只有一个输入框**） =====
const amountText = ref('')
const invoiceImages = ref<string[]>([])
const invoiceNo = ref('')
const payeeType = ref<MerchantWithdrawPayeeType>('WECHAT')
const payeeName = ref('')
const payeeAccount = ref('')
const payeeQrUrl = ref('')
const uploading = ref(false)
const qrUploading = ref(false)

/**
 * 账号里是否**存在**「商家（MERCHANT_OWNER）」身份。
 *
 * ⚠️ 2026-09-25 新增（诊断用）：结算/提现是按**当前身份**判定的，而一个自然人常常
 * **同时**有「商家」与「店长」两个身份（入驻审核通过时一并授予）
 * ⇒ 在店长身份下就会拿到 `13016`。
 *
 * 此时必须能区分两种情况，否则用户只能反复试、排查的人也只能猜：
 * ① 账号**有** owner 身份 ⇒ 是"身份没切过去"，去「我的」页切一下即可；
 * ② 账号**没有** owner 身份 ⇒ 是真的没权限，得找平台处理。
 */
const hasOwnerIdentity = ref(false)

/** 读一次身份，标记账号是否含商家身份（失败不影响页面，只是不显示这半句提示）。 */
async function loadOwnerIdentityFlag(): Promise<void> {
  try {
    const data = await getIdentity()
    const list = data?.identities || []
    hasOwnerIdentity.value = list.some((item) => String(item.role || '').toUpperCase() === 'MERCHANT_OWNER')
  } catch {
    hasOwnerIdentity.value = false
  }
}

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '结算与提现' })
})

// 每次显示都重新拉数据：提交后余额/规则会变（申请即冻结），返回本页也必须是最新值
// ⚠️ 同时重新判定「账号是否有商家身份」：用户可能刚去「我的」页切了身份再回来
onShow(() => { void refreshData(); void loadOwnerIdentityFlag() })

// ===== 金额与状态展示 =====

const availableBalance = computed(() => Number(account.value?.availableBalance || 0))
const debtAmount = computed(() => Number(account.value?.debtAmount || 0))
/** 发票图张数上下限：以后端规则为准，缺失时兜底 1~6（文档 §2.4）。 */
const imageMin = computed(() => (Number(rules.value?.invoiceImageMin) > 0 ? Number(rules.value?.invoiceImageMin) : 1))
const imageMax = computed(() => (Number(rules.value?.invoiceImageMax) > 0 ? Number(rules.value?.invoiceImageMax) : 6))
/** 当前让利比例文案（「平台抽成 X%」）。 */
const commissionRateText = computed(() => formatCommissionRate(account.value?.commissionRate))

/**
 * 阻断原因：**后端原文优先**（`account.withdrawBlockReason` → `rules.blockReason`）。
 * 两者都空但 `hasActiveWithdraw=true` 时，用文档 §5 的 13013 文案（"有一笔在审核中"）。
 */
const submitBlockReason = computed(() => {
  const reason = String(account.value?.withdrawBlockReason || rules.value?.blockReason || '').trim()
  if (reason) return reason
  if (rules.value?.hasActiveWithdraw) return SETTLEMENT_ERROR_TEXT[SETTLEMENT_CODE_ACTIVE_WITHDRAW]
  return ''
})

/** 提现按钮是否置灰：后端明确 `withdrawable=false`，或存在任何阻断原因（含在途提现）。 */
const submitBlocked = computed(() => account.value?.withdrawable === false || Boolean(submitBlockReason.value))

/**
 * 后端只给 `withdrawable=false` 却没给原因时的兜底文案。
 * ⚠️ 这里**不能**猜成"有一笔提现正在审核中"（那是 13013 的语义，只在 `hasActiveWithdraw=true` 时成立）。
 */
const BLOCK_FALLBACK_TEXT = '当前不可提现，请稍后重试或联系平台'

// ===== 数据加载 =====

/** 判断是否为「非品牌主体」（13016，店长/店员误入结算接口）。 */
function isNotMerchantOwnerError(error: unknown): boolean {
  return isApiRequestError(error) && Number(error.code) === SETTLEMENT_CODE_NOT_MERCHANT_OWNER
}

/** 拉结算账户；13016 → 整页置为「仅品牌主体可见」。 */
async function loadAccount(): Promise<void> {
  try {
    account.value = (await getSettlementAccount()) || {}
    notMerchantOwner.value = false
  } catch (error) {
    account.value = {}
    if (isNotMerchantOwnerError(error)) {
      notMerchantOwner.value = true
      return
    }
    uni.showToast({ title: resolveSettlementErrorMessage(error, '结算账户加载失败'), icon: 'none' })
  }
}

/** 拉提现规则（失败静默：阻断原因与张数限制退化为兜底值，不打断主流程）。 */
async function loadRules(): Promise<void> {
  try {
    rules.value = (await getSettlementWithdrawRules()) || {}
  } catch (error) {
    rules.value = {}
    if (isNotMerchantOwnerError(error)) notMerchantOwner.value = true
  }
}

/** 刷新账户 + 规则（提交成功后必须调用，见口径 3）。 */
async function refreshData(): Promise<void> {
  loading.value = true
  try {
    await Promise.all([loadAccount(), loadRules()])
  } finally {
    loading.value = false
  }
}

// ===== 发票图 / 收款码上传 =====

/**
 * 选图（拍照或相册）：小程序端 `uni.chooseMedia` 返回 `tempFiles[].tempFilePath`。
 * 返回临时文件路径数组；用户取消时 reject，由调用方按"已取消"静默处理。
 */
function chooseMedia(count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    uni.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res: { tempFiles?: { tempFilePath?: string }[] }) => {
        resolve((res?.tempFiles || []).map((item) => String(item?.tempFilePath || '')).filter(Boolean))
      },
      fail: (error: { errMsg?: string }) => reject(new Error(error?.errMsg || '已取消选择')),
    })
  })
}

/** 用户主动取消选图不算失败，不弹错误提示。 */
function isCancelError(error: unknown): boolean {
  return /cancel/i.test(String((error as Error)?.message || ''))
}

/**
 * 追加发票图：先选本地图 → 逐张 `uploadFile()` 换成后端 OSS 直链 → 存 URL 数组。
 * 一次最多补足到上限（1~6 张）；**已上传的图不能复用到下一笔提现**（后端 13019）。
 */
async function chooseInvoiceImages(): Promise<void> {
  if (uploading.value || submitting.value) return
  const remain = imageMax.value - invoiceImages.value.length
  if (remain <= 0) {
    uni.showToast({ title: `最多上传 ${imageMax.value} 张发票`, icon: 'none' })
    return
  }
  uploading.value = true
  try {
    const files = await chooseMedia(remain)
    for (const filePath of files) {
      const url = await uploadFile(filePath)
      if (url) invoiceImages.value = [...invoiceImages.value, url]
    }
  } catch (error) {
    if (!isCancelError(error)) {
      uni.showToast({ title: resolveSettlementErrorMessage(error, '发票图上传失败'), icon: 'none' })
    }
  } finally {
    uploading.value = false
  }
}

/** 删除某张发票图（索引越界直接忽略）。 */
function removeInvoiceImage(index: number): void {
  if (index < 0 || index >= invoiceImages.value.length) return
  invoiceImages.value = invoiceImages.value.filter((_, current) => current !== index)
}

/** 预览发票图（财务要能看清票面金额，故必须可放大）。 */
function previewInvoiceImages(current: string): void {
  if (!invoiceImages.value.length) return
  uni.previewImage({ urls: invoiceImages.value.map((item) => resolveImageUrl(item)), current: resolveImageUrl(current) })
}

/** 上传收款码（选填，1 张）。 */
async function choosePayeeQr(): Promise<void> {
  if (qrUploading.value || submitting.value) return
  qrUploading.value = true
  try {
    const files = await chooseMedia(1)
    if (!files.length) return
    payeeQrUrl.value = await uploadFile(files[0])
  } catch (error) {
    if (!isCancelError(error)) {
      uni.showToast({ title: resolveSettlementErrorMessage(error, '收款码上传失败'), icon: 'none' })
    }
  } finally {
    qrUploading.value = false
  }
}

/** 预览收款码。 */
function previewPayeeQr(): void {
  if (!payeeQrUrl.value) return
  uni.previewImage({ urls: [resolveImageUrl(payeeQrUrl.value)] })
}

// ===== 提交提现申请 =====

/** 重置表单（成功后调用；发票图必须清空 —— 同一张图不能复用于下一笔）。 */
function resetForm(): void {
  amountText.value = ''
  invoiceImages.value = []
  invoiceNo.value = ''
  payeeQrUrl.value = ''
}

/** 提交失败按错误码给差异化引导（文案一律取文档 §5 口径）。 */
function handleSubmitError(error: unknown): void {
  const code = isApiRequestError(error) ? Number(error.code) : NaN

  // 8110：提现前置是已绑定微信 → 引导去个人中心
  if (code === SETTLEMENT_CODE_WECHAT_UNBOUND) {
    uni.showModal({
      title: '需要先绑定微信',
      content: SETTLEMENT_ERROR_TEXT[SETTLEMENT_CODE_WECHAT_UNBOUND],
      confirmText: '去绑定',
      success: (result: { confirm?: boolean }) => { if (result.confirm) uni.switchTab({ url: '/pages/mine/mine' }) },
    })
    return
  }

  // 13019：同一张发票图被任何历史提现单用过都会被拒 → 清空发票并要求重新上传
  if (code === SETTLEMENT_CODE_INVOICE_REUSED) {
    invoiceImages.value = []
    uni.showToast({ title: '该发票图已用过，请重新上传发票', icon: 'none' })
    void refreshData()
    return
  }

  // 13013：已有一笔在途提现 → 刷新规则，让按钮进入置灰态并展示原因
  if (code === SETTLEMENT_CODE_ACTIVE_WITHDRAW) {
    uni.showToast({ title: SETTLEMENT_ERROR_TEXT[SETTLEMENT_CODE_ACTIVE_WITHDRAW], icon: 'none' })
    void refreshData()
    return
  }

  uni.showToast({ title: resolveSettlementErrorMessage(error, '提现申请失败'), icon: 'none' })
  // 13012（欠款）/13022（商户状态）等会改变可提现状态，失败后同样刷新账户与规则
  if (code === 13012 || code === 13022 || code === 13011) void refreshData()
}

/** 提交提现申请：本地硬校验 → POST → **重新拉账户与规则**（申请即冻结）。 */
async function handleSubmit(): Promise<void> {
  if (submitting.value) return
  // 按钮已置灰时点击：把后端下发的阻断原因原样提示（不改写、不自己拼）
  if (submitBlocked.value) {
    uni.showToast({ title: submitBlockReason.value || BLOCK_FALLBACK_TEXT, icon: 'none' })
    return
  }
  // 提交前的本地硬校验（13020 金额格式 / 13017 发票张数 / 13021 收款信息 / 13011 超余额）
  const invalidMessage = validateWithdrawForm({
    amount: amountText.value,
    invoiceImages: invoiceImages.value,
    payeeName: payeeName.value,
    payeeAccount: payeeAccount.value,
    availableBalance: availableBalance.value,
    invoiceImageMin: imageMin.value,
    invoiceImageMax: imageMax.value,
  })
  if (invalidMessage) {
    uni.showToast({ title: invalidMessage, icon: 'none' })
    return
  }

  submitting.value = true
  try {
    // ⚠️ 只用**一个金额**：buildWithdrawApplyPayload 把同一金额写进 amount 与 invoiceAmount
    //    （后端强校验两者相等，不一致报 13014，页面无从写歪）
    await applySettlementWithdraw(buildWithdrawApplyPayload({
      amount: Number(String(amountText.value).trim()),
      invoiceImages: [...invoiceImages.value],
      invoiceNo: invoiceNo.value.trim() || undefined,
      payeeType: payeeType.value,
      payeeName: payeeName.value.trim(),
      payeeAccount: payeeAccount.value.trim(),
      payeeQrUrl: payeeQrUrl.value || undefined,
    }))
    resetForm()
    // 申请即冻结：不缓存余额，重新拉账户与规则（可提现↓、冻结↑、hasActiveWithdraw=true）
    await refreshData()
    uni.showToast({ title: '提现申请已提交，待财务审核', icon: 'success' })
    // 文档 §4：提交成功后进记录列表看这笔「审核中」
    setTimeout(() => uni.navigateTo({ url: '/subpkg-merchant/settlement/withdraw-list' }), 900)
  } catch (error) {
    handleSubmitError(error)
  } finally {
    submitting.value = false
  }
}

// ===== 跳转 =====

/** 账户流水页（按 type 筛选 + 分页）。 */
function goFlows(): void {
  uni.navigateTo({ url: '/subpkg-merchant/settlement/flows' })
}

/** 提现记录页。 */
function goWithdrawList(): void {
  uni.navigateTo({ url: '/subpkg-merchant/settlement/withdraw-list' })
}

/** 店长/店员误入时的退路：本门店订单口径营业额仍在「账单」页。 */
function goBill(): void {
  uni.navigateTo({ url: '/subpkg-merchant/bill/index' })
}

/**
 * 去「我的」页切换身份。
 *
 * ⚠️ 结算与提现按**当前身份**判定：入驻会同时授予「商家（MERCHANT_OWNER）」与「店长（MANAGER）」
 * 两个身份，若当前是店长，后端就返回 13016。商户主体需要回「我的」切到商家身份。
 * `pages/mine/mine` 是 tabBar 页 ⇒ 必须用 `switchTab`（navigateTo 会失败）。
 */
function goSwitchIdentity(): void {
  uni.switchTab({ url: '/pages/mine/mine' })
}

function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <text class="nav-back" @click="goBack">‹</text>
      <text class="nav-title">结算与提现</text>
    </view>

    <scroll-view class="content" scroll-y>
      <!-- 13016：仅品牌主体可看结算账户与提现（店长/店员误入） -->
      <view v-if="notMerchantOwner" class="blocked-card">
        <text class="blocked-title">仅商户品牌主体可查看结算账户与提现</text>
        <text class="blocked-desc">当前身份为店长/店员，只能查看本门店订单口径营业额。</text>
        <!-- 区分「身份没切过去」与「账号真没权限」：这两句话的可操作动作完全不同 -->
        <text v-if="hasOwnerIdentity" class="blocked-hint">
          检测到你的账号确实拥有「商家」身份：结算与提现按当前身份判定，现在用的是「店长」身份。
          请到「我的」页切换到商家身份后再回来。
        </text>
        <text v-else class="blocked-hint">
          当前账号没有「商家（品牌主体）」身份，所以看不到结算账户与提现。如需开通请联系平台。
        </text>
        <view class="blocked-button" @click="goBill">去「账单」看本店营业额</view>
        <view class="blocked-button blocked-button--ghost" @click="goSwitchIdentity">去「我的」切换身份</view>
      </view>

      <template v-else>
        <!-- 账户卡片：可提现 / 冻结中 / 欠款 -->
        <view class="account-card">
          <text class="account-subject">{{ account.subjectName || '我的商户' }}</text>
          <text class="account-label">可提现余额（元）</text>
          <text class="account-value">{{ formatSettlementAmount(account.availableBalance) }}</text>
          <view class="account-sub">
            <view class="sub-item">
              <text class="sub-value">{{ formatSettlementAmount(account.frozenBalance) }}</text>
              <text class="sub-label">冻结中（已申请未打款）</text>
            </view>
            <view class="sub-divider" />
            <view class="sub-item">
              <text class="sub-value" :class="{ 'is-debt': debtAmount > 0 }">{{ formatSettlementAmount(account.debtAmount) }}</text>
              <text class="sub-label">欠款（&gt;0 不可提现）</text>
            </view>
          </view>
        </view>

        <!-- 累计口径（净额口径） -->
        <view class="card">
          <text class="card-title">累计账目（净额口径）</text>
          <view class="total-grid">
            <view class="total-item">
              <text class="total-value">{{ formatSettlementAmount(account.totalGoodsIncome) }}</text>
              <text class="total-label">商品净额</text>
            </view>
            <view class="total-item">
              <text class="total-value">{{ formatSettlementAmount(account.totalCommission) }}</text>
              <text class="total-label">平台抽成</text>
            </view>
            <view class="total-item">
              <text class="total-value">{{ formatSettlementAmount(account.totalDeliveryFee) }}</text>
              <text class="total-label">配送费</text>
            </view>
            <view class="total-item">
              <text class="total-value">{{ formatSettlementAmount(account.totalWithdrawn) }}</text>
              <text class="total-label">已提现</text>
            </view>
          </view>
          <text class="commission-hint">当前让利比例（平台抽成）{{ commissionRateText }}，仅对之后新下的订单生效；配送费全额归商家。</text>
        </view>

        <!-- 提现规则 + 阻断原因（原因直接展示后端原文） -->
        <view class="card">
          <text class="card-title">提现规则</text>
          <text class="rule-line">· 无最低金额、无上限；金额最多两位小数</text>
          <text class="rule-line">· 发票图 {{ imageMin }}~{{ imageMax }} 张；发票金额须等于申请金额（本页只填一个金额）</text>
          <text class="rule-line">· 同一张发票图不能重复使用，每次提现都要重新上传发票</text>
          <text class="rule-line">· 同一时间只允许一笔在途提现；申请即冻结，驳回/打款失败会解冻回余额</text>
          <text class="rule-line">· 提现前需在个人中心绑定微信；账户有欠款时不可提现</text>
          <view v-if="submitBlockReason" class="block-banner">
            <text class="block-text">{{ submitBlockReason }}</text>
          </view>
        </view>

        <!-- 提现申请表单 -->
        <view class="card">
          <text class="card-title">提现申请</text>

          <text class="field-label">发票图片（{{ invoiceImages.length }}/{{ imageMax }}）</text>
          <view class="image-grid">
            <view v-for="(image, index) in invoiceImages" :key="image + index" class="image-item">
              <image class="image-thumb" :src="resolveImageUrl(image)" mode="aspectFill" @click="previewInvoiceImages(image)" />
              <view class="image-remove" @click.stop="removeInvoiceImage(index)">×</view>
            </view>
            <view v-if="invoiceImages.length < imageMax" class="image-add" @click="chooseInvoiceImages">
              <text class="image-add-text">{{ uploading ? '上传中…' : '+ 上传发票' }}</text>
            </view>
          </view>
          <text class="field-hint">支持 jpg/jpeg/png/webp/gif，单张 ≤ 10MB；点击图片可放大核对票面金额。</text>

          <text class="field-label">提现金额（元）</text>
          <input
            v-model="amountText"
            class="field-input"
            type="digit"
            maxlength="11"
            :disabled="submitting"
            placeholder="请输入提现金额，最多两位小数"
          />
          <text class="field-hint">可提现余额 ¥{{ formatSettlementAmount(account.availableBalance) }}；发票金额与申请金额一致，无需重复填写。</text>

          <text class="field-label">收款方式</text>
          <view class="chip-row">
            <view class="chip" :class="{ 'is-active': payeeType === 'WECHAT' }" @click="payeeType = 'WECHAT'">微信</view>
            <view class="chip" :class="{ 'is-active': payeeType === 'BANK_CARD' }" @click="payeeType = 'BANK_CARD'">银行卡</view>
          </view>

          <text class="field-label">收款人姓名</text>
          <input v-model="payeeName" class="field-input" maxlength="30" :disabled="submitting" placeholder="财务转账核对用，必填" />

          <text class="field-label">收款账号</text>
          <input v-model="payeeAccount" class="field-input" maxlength="64" :disabled="submitting" placeholder="微信号 / 手机号 / 银行卡号" />

          <text class="field-label">发票号（选填）</text>
          <input v-model="invoiceNo" class="field-input" maxlength="64" :disabled="submitting" placeholder="便于财务核验，可不填" />

          <text class="field-label">收款码（选填）</text>
          <view class="image-grid">
            <view v-if="payeeQrUrl" class="image-item">
              <image class="image-thumb" :src="resolveImageUrl(payeeQrUrl)" mode="aspectFill" @click="previewPayeeQr" />
              <view class="image-remove" @click.stop="payeeQrUrl = ''">×</view>
            </view>
            <view v-else class="image-add" @click="choosePayeeQr">
              <text class="image-add-text">{{ qrUploading ? '上传中…' : '+ 上传收款码' }}</text>
            </view>
          </view>

          <!-- 阻断时置灰：点击只提示后端原因，不发起请求 -->
          <view class="submit-button" :class="{ 'is-disabled': submitBlocked || submitting }" @click="handleSubmit">
            {{ submitting ? '提交中…' : '提交提现申请' }}
          </view>
          <text v-if="submitBlockReason" class="submit-reason">{{ submitBlockReason }}</text>
        </view>

        <!-- 二级入口 -->
        <view class="entry-list">
          <view class="entry-item" @click="goFlows">
            <text class="entry-label">账户流水</text>
            <text class="entry-arrow">›</text>
          </view>
          <view class="entry-item" @click="goWithdrawList">
            <text class="entry-label">提现记录</text>
            <text class="entry-arrow">›</text>
          </view>
        </view>

        <view v-if="loading" class="loading-tip">加载中…</view>
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

/* 13016 提示卡 */
.blocked-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 60rpx;
  padding: 60rpx 38rpx;
  border-radius: 23rpx;
  background: #ffffff;
}
.blocked-title {
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
  text-align: center;
}
.blocked-desc {
  margin-top: 16rpx;
  color: #86909c;
  font-size: 25rpx;
  line-height: 40rpx;
  text-align: center;
}
/* 可操作指引（2026-09-25）：商户主体被卡在「店长」身份时，明确告诉他去哪儿切回来 */
.blocked-hint {
  margin-top: 20rpx;
  color: #4e5969;
  font-size: 24rpx;
  line-height: 38rpx;
  text-align: center;
}
/* 次要按钮：白色描边。
   ⚠️ 用 `.blocked-card` 前缀提高特异性（2 个 class），否则会被后面的 `.blocked-button` 覆盖 */
.blocked-card .blocked-button--ghost {
  margin-top: 20rpx;
  background: #ffffff;
  border: 1rpx solid #ff5500;
  color: #ff5500;
}
.blocked-button {
  margin-top: 38rpx;
  padding: 0 46rpx;
  height: 77rpx;
  display: flex;
  align-items: center;
  border-radius: 39rpx;
  background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%);
  color: #ffffff;
  font-size: 27rpx;
  font-weight: 600;
}

/* 账户卡片 */
.account-card {
  margin-top: 23rpx;
  padding: 38rpx 31rpx 31rpx;
  border-radius: 23rpx;
  background: linear-gradient(135deg, #ff9301 0%, #ff6a01 55%, #ff4202 100%);
  color: #ffffff;
}
.account-subject {
  display: block;
  color: rgba(255, 255, 255, 0.9);
  font-size: 25rpx;
}
.account-label {
  display: block;
  margin-top: 19rpx;
  color: rgba(255, 255, 255, 0.88);
  font-size: 25rpx;
}
.account-value {
  display: block;
  margin-top: 8rpx;
  font-size: 62rpx;
  font-weight: 700;
  line-height: 1.1;
}
.account-sub {
  display: flex;
  align-items: center;
  margin-top: 31rpx;
  padding-top: 23rpx;
  border-top: 2rpx solid rgba(255, 255, 255, 0.25);
}
.sub-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}
.sub-value {
  font-size: 31rpx;
  font-weight: 600;
}
.sub-value.is-debt {
  color: #fff3b0;
}
.sub-label {
  color: rgba(255, 255, 255, 0.85);
  font-size: 21rpx;
  text-align: center;
}
.sub-divider {
  flex: none;
  width: 2rpx;
  height: 54rpx;
  background: rgba(255, 255, 255, 0.28);
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
.total-grid {
  display: flex;
  flex-wrap: wrap;
  margin-top: 23rpx;
}
.total-item {
  width: 50%;
  display: flex;
  flex-direction: column;
  margin-bottom: 23rpx;
}
.total-value {
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
}
.total-label {
  margin-top: 6rpx;
  color: #86909c;
  font-size: 23rpx;
}
.commission-hint {
  display: block;
  margin-top: 4rpx;
  color: #86909c;
  font-size: 23rpx;
  line-height: 36rpx;
}
.rule-line {
  display: block;
  margin-top: 12rpx;
  color: #4e5969;
  font-size: 24rpx;
  line-height: 38rpx;
}
/* 阻断原因：直接展示后端原文，样式上必须显眼（商家要一眼看到为什么不能提） */
.block-banner {
  margin-top: 23rpx;
  padding: 19rpx 23rpx;
  border-radius: 15rpx;
  background: #fff7ed;
  border: 2rpx solid rgba(255, 106, 43, 0.28);
}
.block-text {
  color: #9a3412;
  font-size: 24rpx;
  line-height: 36rpx;
}

/* 表单 */
.field-label {
  display: block;
  margin-top: 31rpx;
  color: #1d2129;
  font-size: 26rpx;
  font-weight: 500;
}
.field-input {
  box-sizing: border-box;
  width: 100%;
  height: 84rpx;
  margin-top: 15rpx;
  padding: 0 23rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
  color: #1d2129;
  font-size: 27rpx;
}
.field-hint {
  display: block;
  margin-top: 12rpx;
  color: #86909c;
  font-size: 22rpx;
  line-height: 34rpx;
}
.chip-row {
  display: flex;
  gap: 19rpx;
  margin-top: 15rpx;
}
.chip {
  flex: 1;
  height: 77rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 15rpx;
  background: #f6f7f9;
  color: #4e5969;
  font-size: 26rpx;
}
.chip.is-active {
  background: #fff4e8;
  color: #ff5500;
  border: 2rpx solid rgba(255, 85, 0, 0.35);
}

/* 图片九宫格 */
.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 19rpx;
  margin-top: 15rpx;
}
.image-item {
  position: relative;
  width: 150rpx;
  height: 150rpx;
}
.image-thumb {
  width: 150rpx;
  height: 150rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
}
.image-remove {
  position: absolute;
  top: -14rpx;
  right: -14rpx;
  width: 40rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(29, 33, 41, 0.7);
  color: #ffffff;
  font-size: 27rpx;
  line-height: 1;
}
.image-add {
  width: 150rpx;
  height: 150rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 15rpx;
  border: 2rpx dashed #d7dbe0;
  background: #fafbfc;
}
.image-add-text {
  color: #86909c;
  font-size: 22rpx;
  text-align: center;
}

/* 提交 */
.submit-button {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  margin-top: 46rpx;
  border-radius: 23rpx;
  background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%);
  color: #ffffff;
  font-size: 31rpx;
  font-weight: 600;
}
/* 置灰：仍然可点（点了给原因），但视觉上明确不可提交 */
.submit-button.is-disabled {
  background: #e5e6eb;
  color: #a9aeb8;
}
.submit-reason {
  display: block;
  margin-top: 16rpx;
  color: #c2410c;
  font-size: 23rpx;
  line-height: 36rpx;
  text-align: center;
}

/* 二级入口 */
.entry-list {
  margin-top: 23rpx;
  border-radius: 23rpx;
  background: #ffffff;
  overflow: hidden;
}
.entry-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 108rpx;
  padding: 0 31rpx;
  border-bottom: 2rpx solid #f2f3f7;
}
.entry-item:last-child {
  border-bottom: 0;
}
.entry-label {
  color: #1d2129;
  font-size: 28rpx;
}
.entry-arrow {
  color: #c9cdd4;
  font-size: 34rpx;
  line-height: 1;
}
.loading-tip {
  padding: 31rpx 0;
  text-align: center;
  color: #86909c;
  font-size: 24rpx;
}
</style>
