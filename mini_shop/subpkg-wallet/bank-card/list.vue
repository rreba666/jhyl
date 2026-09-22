<script setup lang="ts">
/**
 * 提现银行卡管理（**独立页面**，C 端真实接口）
 *
 * 背景：`pages/settings/settings.vue` 里「提现银行卡」原先写的是「绑定银行卡管理（待开通）」。
 * 2026-09-22 核对 `api_doc.json`：tag「提现银行卡」下 C 端接口**齐全**
 * （`/api/user/bank-card/list` · `POST /api/user/bank-card` · `PUT|DELETE /api/user/bank-card/{id}` ·
 * `PUT /api/user/bank-card/{id}/default`），所以接上真实绑卡/解绑，不再显示"待开通"。
 *
 * ⚠️ 与实名认证的关系：实名弹层里的「银行卡号 / 银行预留手机号」是**实名接口的附属字段**
 * （后端只记录、不核验），提现不带 `bankCardId` 时后端就用那份实名资料；
 * 本页管理的是**独立银行卡表**（可绑多张、可切默认），提现带 `bankCardId` 时优先用它。
 *
 * 两种模式（`mode` 查询参数）：
 * - `mode=manage`（默认）：设置页进入，绑卡 / 解绑 / 设为默认；
 * - `mode=select`：提现页进入，点一张卡即回传（广播 `BANK_CARD_SELECTED_EVENT`）。
 */
import { computed, reactive, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  BANK_CARDS_CHANGED_EVENT,
  BANK_CARD_SELECTED_EVENT,
  bindBankCard,
  getBankCardList,
  isDefaultBankCard,
  removeBankCard,
  setDefaultBankCard,
  COMMON_BANK_NAMES,
  type BankCardVO,
} from '@/api/bank-card'
import { getRealnameStatus } from '@/api/realname'
import { isLoggedIn } from '@/utils/auth'
import { createThrottle } from '@/utils/interaction'
import { validateBankCard, validateMobile, validateText } from '@/utils/input-validation'

const statusBarHeight = ref(0)
/** 页面模式：manage=纯管理，select=选卡后回传提现页。 */
const mode = ref<'manage' | 'select'>('manage')
const cards = ref<BankCardVO[]>([])
const loading = ref(false)
/** 加载失败文案（非空时展示重试，而不是误显示"还没有银行卡"）。 */
const loadError = ref('')
/** 是否有操作（绑定 / 解绑 / 设默认）正在提交。 */
const submitting = ref(false)
/** 绑卡表单是否可见。 */
const formVisible = ref(false)
/** 实名认证状态：绑卡要求持卡人与实名一致，未实名时先提示去实名。 */
const realnameVerified = ref(false)
/** 实名姓名（后端只回脱敏值，如「张*三」）：用于在表单里提示该填哪个名字。 */
const realnameMaskedName = ref('')
const navigationThrottle = createThrottle(500)

/** 绑卡表单（卡号只用于本次提交，不落任何缓存）。 */
const form = reactive({ bankName: '', cardNo: '', holderName: '', phone: '' })

/** 银行名候选下标（-1 = 未选择，使用自定义输入）。 */
const bankIndex = ref(-1)
/** 是否使用自定义银行名输入。 */
const customBank = ref(false)

const selecting = () => mode.value === 'select'
const bankNames = COMMON_BANK_NAMES

/** 持卡人输入框的占位文案：拿到脱敏实名姓名时提示"该填谁"，避免用户填错被后端拒绝。 */
const holderNamePlaceholder = computed(() => (
  realnameMaskedName.value
    ? `须与实名一致（当前实名：${realnameMaskedName.value}）`
    : '须与实名认证姓名一致'
))

onLoad((options) => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  mode.value = String((options as Record<string, unknown> | undefined)?.mode || '') === 'select' ? 'select' : 'manage'
})

// 从绑卡表单 / 实名弹层返回后需要拿到最新数据，统一在 onShow 拉取
onShow(() => {
  void loadCards()
  void loadRealname()
})

/** 加载银行卡列表；失败给出可重试的提示。 */
async function loadCards(): Promise<void> {
  if (!isLoggedIn()) {
    cards.value = []
    loadError.value = '登录后即可管理提现银行卡'
    return
  }
  loading.value = true
  try {
    cards.value = await getBankCardList() || []
    loadError.value = ''
  } catch (error) {
    cards.value = []
    loadError.value = error instanceof Error ? error.message : '银行卡加载失败，请重试'
  } finally {
    loading.value = false
  }
}

/** 查询实名状态（绑卡后端的「持卡人与实名一致」校验依赖它，提前告知用户）。 */
async function loadRealname(): Promise<void> {
  try {
    const status = await getRealnameStatus()
    realnameVerified.value = status.verified
    realnameMaskedName.value = status.maskedName || ''
  } catch {
    // 查询失败按未实名处理，只影响提示文案，不阻断列表展示
    realnameVerified.value = false
    realnameMaskedName.value = ''
  }
}

/** 一行展示用的卡号文案（后端已脱敏，取不到时给占位而不是空白）。 */
function cardNoText(card: BankCardVO): string {
  return card.cardNoMasked || '**** **** **** ****'
}

/** 选中模式：把卡回传提现页并返回。 */
function pickCard(card: BankCardVO): void {
  if (!navigationThrottle()) return
  uni.$emit(BANK_CARD_SELECTED_EVENT, card)
  uni.navigateBack()
}

/** 设为默认卡。 */
async function makeDefault(card: BankCardVO): Promise<void> {
  if (submitting.value || isDefaultBankCard(card)) return
  submitting.value = true
  try {
    await setDefaultBankCard(card.id)
    uni.showToast({ title: '已设为默认卡', icon: 'success' })
    await loadCards()
    uni.$emit(BANK_CARDS_CHANGED_EVENT)
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '设置默认卡失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

/** 解绑银行卡，需二次确认（提现中的卡后端会自行拦截并返回业务码）。 */
function confirmRemove(card: BankCardVO): void {
  if (submitting.value) return
  uni.showModal({
    title: '解绑银行卡',
    content: `确定解绑「${card.bankName} ${cardNoText(card)}」吗？`,
    confirmText: '解绑',
    confirmColor: '#e34d59',
    success: (result) => { if (result.confirm) void doRemove(card) },
  })
}

/** 执行解绑。 */
async function doRemove(card: BankCardVO): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  try {
    await removeBankCard(card.id)
    uni.showToast({ title: '已解绑', icon: 'success' })
    await loadCards()
    uni.$emit(BANK_CARDS_CHANGED_EVENT)
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '解绑失败，请重试', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

/** 打开绑卡表单，并预填实名姓名（后端要求持卡人与实名一致，省得用户打错）。 */
function openForm(): void {
  form.bankName = ''
  form.cardNo = ''
  // 实名姓名无法从前端读取明文（后端只回脱敏值），所以留空让用户自己填
  form.holderName = ''
  form.phone = ''
  bankIndex.value = -1
  customBank.value = false
  formVisible.value = true
}

/** 银行名选择器变更。 */
function onBankChange(event: { detail?: { value?: number | string } }): void {
  const index = Number(event?.detail?.value ?? -1)
  if (index >= 0 && index < bankNames.length) {
    bankIndex.value = index
    form.bankName = bankNames[index]
    customBank.value = false
  }
}

/** 切换到自定义银行名输入。 */
function useCustomBank(): void {
  customBank.value = true
  bankIndex.value = -1
  form.bankName = ''
}

/** 切换「常见银行选择」与「自定义输入」两种录入口径。 */
function toggleCustomBank(): void {
  if (customBank.value) {
    customBank.value = false
    bankIndex.value = -1
    form.bankName = ''
    return
  }
  useCustomBank()
}

/** 校验并提交绑卡。 */
async function submitForm(): Promise<void> {
  if (submitting.value) return
  if (!realnameVerified.value) {
    uni.showToast({ title: '请先完成实名认证，持卡人须与实名一致', icon: 'none' })
    return
  }
  const bankName = validateText(form.bankName, { label: '银行名称', maxLength: 40 })
  if (!bankName.ok) { uni.showToast({ title: bankName.message, icon: 'none' }); return }
  const cardNo = validateBankCard(form.cardNo)
  if (!cardNo.ok) { uni.showToast({ title: cardNo.message, icon: 'none' }); return }
  const holderName = validateText(form.holderName, { label: '持卡人姓名', maxLength: 32 })
  if (!holderName.ok) { uni.showToast({ title: holderName.message, icon: 'none' }); return }
  const phone = form.phone.trim() ? validateMobile(form.phone, '银行预留手机号') : null
  if (phone && !phone.ok) { uni.showToast({ title: phone.message, icon: 'none' }); return }

  submitting.value = true
  try {
    await bindBankCard({
      bankName: bankName.value,
      cardNo: cardNo.value,
      holderName: holderName.value,
      ...(phone ? { phone: phone.value } : {}),
      // 还没有任何卡时后端会自动设为默认；显式传 1 让"第一张就是默认卡"更明确
      ...(cards.value.length === 0 ? { isDefault: 1 } : {}),
    })
    formVisible.value = false
    form.cardNo = ''
    uni.showToast({ title: '银行卡已绑定', icon: 'success' })
    await loadCards()
    uni.$emit(BANK_CARDS_CHANGED_EVENT)
  } catch (error) {
    // 后端会因「持卡人与实名不一致」「卡号 Luhn 不通过」等返回明确文案，直接展示
    uni.showToast({ title: error instanceof Error ? error.message : '绑卡失败，请重试', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

/** 返回上一页；无上级页面时回「我的」。 */
function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.switchTab({ url: '/pages/mine/mine' })
}

/** 去设置页完成实名认证（绑卡前置条件）。 */
function goRealname(): void {
  uni.navigateTo({ url: '/pages/settings/settings' })
}
</script>

<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">{{ selecting() ? '选择银行卡' : '提现银行卡' }}</text>
      </view>
    </view>

    <scroll-view class="content" scroll-y :style="{ paddingTop: statusBarHeight + 44 + 12 + 'px' }">
      <!-- 未实名提示：绑卡后端校验持卡人与实名一致，提前说明避免提交后才报错 -->
      <view v-if="!realnameVerified" class="notice" @click="goRealname">
        <text class="notice-text">绑卡要求持卡人与实名认证一致，请先完成实名认证</text>
        <text class="notice-arrow">›</text>
      </view>

      <view v-if="loadError" class="state">
        <text class="state-text">{{ loadError }}</text>
        <view class="state-btn" @click="loadCards()">重新加载</view>
      </view>

      <view v-else-if="!loading && !cards.length" class="state">
        <text class="state-text">还没有绑定银行卡</text>
        <text class="state-sub">绑卡后提现可选择到账银行卡</text>
      </view>

      <template v-else>
        <view
          v-for="card in cards"
          :key="card.id"
          class="card"
          :class="{ 'card-disabled': submitting }"
          @click="selecting() && pickCard(card)"
        >
          <view class="card-main">
            <view class="card-row">
              <text class="card-bank">{{ card.bankName }}</text>
              <text v-if="isDefaultBankCard(card)" class="card-tag">默认</text>
            </view>
            <text class="card-no">{{ cardNoText(card) }}</text>
            <text class="card-holder">持卡人：{{ card.holderName }}</text>
          </view>
          <view v-if="!selecting()" class="card-actions">
            <view class="action" :class="{ 'action-active': isDefaultBankCard(card) }" @click.stop="makeDefault(card)">
              {{ isDefaultBankCard(card) ? '默认卡' : '设为默认' }}
            </view>
            <view class="action action-danger" @click.stop="confirmRemove(card)">解绑</view>
          </view>
        </view>
      </template>

      <view class="bottom-space" />
    </scroll-view>

    <view class="footer">
      <view class="save" @click="openForm">绑定银行卡</view>
    </view>

    <!-- 绑卡表单：银行名 + 卡号 + 持卡人 + 预留手机号 -->
    <view v-show="formVisible" class="mask" @click="formVisible = false">
      <view class="sheet" @click.stop>
        <view class="sheet-head">
          <text class="sheet-title">绑定银行卡</text>
          <text class="sheet-close" @click="formVisible = false">×</text>
        </view>

        <view class="field">
          <text class="field-label">开户银行 <text class="req">*</text></text>
          <picker v-if="!customBank" mode="selector" :range="bankNames" :value="bankIndex" @change="onBankChange">
            <view class="field-picker">
              <text :class="form.bankName ? 'picker-value' : 'picker-placeholder'">{{ form.bankName || '请选择开户银行' }}</text>
              <text class="picker-arrow">›</text>
            </view>
          </picker>
          <input v-else v-model="form.bankName" class="field-input" maxlength="40" placeholder="请输入银行名称" />
          <text class="field-link" @click="toggleCustomBank">
            {{ customBank ? '从常见银行中选择' : '找不到？手动输入银行名称' }}
          </text>
        </view>

        <view class="field">
          <text class="field-label">银行卡号 <text class="req">*</text></text>
          <input v-model="form.cardNo" class="field-input" type="number" maxlength="23" placeholder="请输入 12-19 位银行卡号" />
        </view>

        <view class="field">
          <text class="field-label">持卡人姓名 <text class="req">*</text></text>
          <input v-model="form.holderName" class="field-input" maxlength="32" :placeholder="holderNamePlaceholder" />
        </view>

        <view class="field">
          <text class="field-label">银行预留手机号 <text class="optional">（选填）</text></text>
          <input v-model="form.phone" class="field-input" type="number" maxlength="11" placeholder="选填，便于后台核对打款" />
        </view>

        <button class="sheet-submit" :disabled="submitting" @click="submitForm">
          {{ submitting ? '提交中…' : '确认绑定' }}
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; background: #f2f3f7; }
.nav { position: fixed; top: 0; right: 0; left: 0; z-index: 10; background: #ffffff; }
.nav-inner { position: relative; display: flex; align-items: center; justify-content: center; height: 88rpx; }
.nav-back { position: absolute; left: 24rpx; color: #1d2129; font-size: 52rpx; line-height: 1; }
.nav-title { color: #1d2129; font-size: 33rpx; font-weight: 600; }
.content { flex: 1; min-height: 0; padding: 0 23rpx 23rpx; box-sizing: border-box; }

.notice { display: flex; align-items: center; justify-content: space-between; margin-top: 20rpx; padding: 22rpx 24rpx; border-radius: 16rpx; background: #fff4e8; }
.notice-text { flex: 1; min-width: 0; color: #d25f00; font-size: 25rpx; line-height: 1.5; }
.notice-arrow { margin-left: 12rpx; color: #d25f00; font-size: 34rpx; line-height: 1; }

.state { display: flex; align-items: center; flex-direction: column; padding: 160rpx 40rpx; }
.state-text { color: #4e5969; font-size: 29rpx; text-align: center; }
.state-sub { margin-top: 14rpx; color: #86909c; font-size: 24rpx; text-align: center; }
.state-btn { margin-top: 32rpx; padding: 16rpx 48rpx; border-radius: 40rpx; background: #ff5500; color: #fff; font-size: 27rpx; }

.card { margin-top: 20rpx; padding: 26rpx 24rpx; border-radius: 16rpx; background: #ffffff; }
.card-disabled { opacity: .6; }
.card-main { display: flex; flex-direction: column; }
.card-row { display: flex; align-items: center; }
.card-bank { color: #1d2129; font-size: 30rpx; font-weight: 600; }
.card-tag { margin-left: 14rpx; padding: 2rpx 12rpx; border-radius: 6rpx; background: #fff1e8; color: #ff5500; font-size: 20rpx; }
.card-no { margin-top: 12rpx; color: #1d2129; font-size: 32rpx; letter-spacing: 2rpx; }
.card-holder { margin-top: 8rpx; color: #86909c; font-size: 24rpx; }

.card-actions { display: flex; align-items: center; justify-content: flex-end; gap: 32rpx; margin-top: 20rpx; padding-top: 18rpx; border-top: 1rpx solid #f2f3f7; }
.action { color: #86909c; font-size: 25rpx; }
.action-active { color: #ff5500; font-weight: 600; }
.action-danger { color: #e34d59; }

.bottom-space { height: 40rpx; }
.footer { flex-shrink: 0; padding: 16rpx 23rpx calc(16rpx + env(safe-area-inset-bottom)); background: #ffffff; }
.save { display: flex; align-items: center; justify-content: center; height: 88rpx; border-radius: 16rpx; color: #ffffff; background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%); font-size: 31rpx; font-weight: 600; }

/* 绑卡底部弹层 */
.mask { position: fixed; inset: 0; z-index: 30; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .58); }
.sheet { width: 100%; padding: 30rpx 28rpx calc(30rpx + env(safe-area-inset-bottom)); box-sizing: border-box; background: #ffffff; border-radius: 24rpx 24rpx 0 0; }
.sheet-head { position: relative; display: flex; align-items: center; justify-content: center; min-height: 54rpx; }
.sheet-title { color: #1d2129; font-size: 31rpx; font-weight: 600; }
.sheet-close { position: absolute; right: 0; color: #86909c; font-size: 44rpx; line-height: 1; }
.field { margin-top: 22rpx; }
.field-label { display: block; margin-bottom: 10rpx; color: #1d2129; font-size: 26rpx; font-weight: 600; }
.req { color: #f53f3f; }
.optional { color: #86909c; font-size: 22rpx; font-weight: 400; }
.field-input { width: 100%; height: 84rpx; padding: 0 22rpx; box-sizing: border-box; border: 1rpx solid #e5e6eb; border-radius: 12rpx; background: #fafbfc; color: #1d2129; font-size: 27rpx; }
.field-picker { display: flex; align-items: center; justify-content: space-between; height: 84rpx; padding: 0 22rpx; box-sizing: border-box; border: 1rpx solid #e5e6eb; border-radius: 12rpx; background: #fafbfc; }
.picker-value { color: #1d2129; font-size: 27rpx; }
.picker-placeholder { color: #c9cdd4; font-size: 27rpx; }
.picker-arrow { color: #c9cdd4; font-size: 34rpx; line-height: 1; }
.field-link { display: block; margin-top: 10rpx; color: #ff5500; font-size: 23rpx; }
.sheet-submit { height: 86rpx; margin-top: 32rpx; border-radius: 16rpx; color: #ffffff; background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%); font-size: 30rpx; font-weight: 600; }
.sheet-submit::after { border: 0; }
.sheet-submit[disabled] { opacity: .6; }
</style>
