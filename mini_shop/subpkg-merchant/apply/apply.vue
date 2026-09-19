<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import { getMyMerchantApply, submitMerchantApply, type MerchantApplyVO } from '@/api/merchant'
import { ApiRequestError, uploadFile } from '@/utils/request'

/** 我的申请单（null = 未提交过，展示表单）。 */
const apply = ref<MerchantApplyVO | null>(null)
/** 页面加载 / 提交 / 上传 状态。 */
const loading = ref(true)
const submitting = ref(false)
const uploading = ref(false)
/** 是否展示表单：未申请过 or 已驳回（可重提）。 */
const showForm = ref(true)
/** 品牌名内联错误（7311 品牌已存在）。 */
const brandError = ref('')

/** 表单字段（坐标必填，由微信选点回填）。 */
const form = ref({
  brandName: '',
  contactName: '',
  contactPhone: '',
  shopName: '',
  address: '',
  mainBusiness: '',
  latitude: null as number | null,
  longitude: null as number | null,
  licenseImage: '',
  remark: '',
})

/** 状态文案。 */
const statusText = computed(() => {
  const item = apply.value
  if (!item) return ''
  if (item.statusText) return item.statusText
  return item.status === 0 ? '待审核' : item.status === 1 ? '已通过' : '已驳回'
})

/** 状态说明（按文档 §5.2 状态机）。 */
const statusHint = computed(() => {
  const item = apply.value
  if (!item) return ''
  if (item.status === 0) return '资料已提交，平台正在审核（1–3 个工作日）。'
  if (item.status === 2) return '申请未通过，请按驳回原因修改后重新提交（同名品牌可直接重提）。'
  // 入驻审核通过会**同时**授予「商家 MERCHANT_OWNER」与「首店店长 MANAGER」两个身份，
  // 而**店长身份不需要工号**（只有商家主账号卡工号）→ 通过后立刻就能进小程序「门店管理」。
  // `backendAccountIssued` 只决定能否登 PC 控制台 / H5 核销页，**不阻塞小程序入口**，
  // 所以两种状态都不该让用户以为"还要等发号"。
  if (!item.backendAccountIssued) return '审核已通过，已开通「门店管理」，可到「我的 → 我的身份」进入；商家工号（登录 PC 控制台用）由客服另行发放，不影响小程序使用。'
  return '审核已通过，商家工号已发放；可到「我的 → 我的身份」进入门店管理，工号用于登录 PC 控制台。'
})

/** 状态栏高度：本页是 navigationStyle: custom，必须自己避开状态栏与右上角胶囊按钮，否则内容会顶头。 */
const statusBarHeight = ref(0)
/** 正文起始位置 = 状态栏 + 导航栏(44px) + 间距。 */
const contentTop = computed(() => statusBarHeight.value + 44 + 8)

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  void loadApply()
})

/** 下拉刷新：重新查询申请状态（不做高频轮询）。 */
onPullDownRefresh(async () => {
  await loadApply()
  uni.stopPullDownRefresh()
})

/** 加载我的申请单，决定展示表单还是状态卡。 */
async function loadApply(): Promise<void> {
  loading.value = true
  try {
    const result = await getMyMerchantApply()
    apply.value = result
    // 无申请 → 表单；已驳回 → 表单（可重提）；待审核/已通过 → 状态卡
    showForm.value = !result || result.status === 2
    if (result && result.status === 2) {
      form.value.brandName = result.brandName || ''
      form.value.shopName = result.shopName || ''
    }
  } catch {
    apply.value = null
    showForm.value = true
  } finally {
    loading.value = false
  }
}

/** 微信选点：回填门店名/地址/经纬度（GCJ-02，与后端配送坐标系一致，无需转换）。 */
function chooseShopLocation(): void {
  uni.chooseLocation({
    success: (res) => {
      if (!form.value.shopName) form.value.shopName = res.name || ''
      form.value.address = res.address || ''
      form.value.latitude = res.latitude
      form.value.longitude = res.longitude
    },
    fail: (error) => {
      const message = String(error?.errMsg || '')
      if (!/cancel/i.test(message)) uni.showToast({ title: '选择位置失败，请检查定位授权', icon: 'none' })
    },
  })
}

/** 营业执照：选图 → 上传（/api/common/upload）→ 回填 licenseImage。 */
function chooseLicense(): void {
  uni.chooseImage({
    count: 1,
    success: async (res) => {
      const filePath = res.tempFilePaths?.[0]
      if (!filePath) return
      uploading.value = true
      try {
        form.value.licenseImage = await uploadFile(filePath)
        uni.showToast({ title: '营业执照已上传', icon: 'success' })
      } catch (error) {
        uni.showToast({ title: error instanceof Error ? error.message : '上传失败', icon: 'none' })
      } finally {
        uploading.value = false
      }
    },
  })
}

/** 提交入驻申请。 */
async function submit(): Promise<void> {
  brandError.value = ''
  if (!form.value.brandName.trim()) { uni.showToast({ title: '请输入品牌名称', icon: 'none' }); return }
  if (!form.value.shopName.trim()) { uni.showToast({ title: '请输入门店名称', icon: 'none' }); return }
  if (form.value.latitude == null || form.value.longitude == null) {
    uni.showToast({ title: '请先选择门店位置（必须选点）', icon: 'none' })
    return
  }
  submitting.value = true
  try {
    apply.value = await submitMerchantApply({
      brandName: form.value.brandName.trim(),
      contactName: form.value.contactName.trim() || undefined,
      contactPhone: form.value.contactPhone.trim() || undefined,
      shop: {
        name: form.value.shopName.trim(),
        address: form.value.address.trim() || undefined,
        latitude: form.value.latitude,
        longitude: form.value.longitude,
        mainBusiness: form.value.mainBusiness.trim() || undefined,
      },
      licenseImage: form.value.licenseImage || undefined,
      remark: form.value.remark.trim() || undefined,
    })
    showForm.value = false
    uni.showToast({ title: '已提交，请等待审核', icon: 'success' })
    await loadApply()
  } catch (error) {
    const code = error instanceof ApiRequestError ? error.code : undefined
    const message = error instanceof Error ? error.message : '提交失败'
    if (code === 7315) {
      // 已有审核中的申请：直接刷新为状态卡，不报错弹窗
      uni.showToast({ title: '已有审核中的申请', icon: 'none' })
      await loadApply()
    } else if (code === 7316) {
      uni.showModal({ title: '无法入驻', content: '该微信已属于其它商家，如需变更请联系客服。', showCancel: false })
    } else if (code === 7311) {
      brandError.value = message || '品牌名已存在，请更换'
    } else {
      uni.showToast({ title: message, icon: 'none' })
    }
  } finally {
    submitting.value = false
  }
}

/** 返回上一页：审核通过后用户可在「我的身份」进入门店管理（不依赖是否已发号）。 */
function goBack(): void {
  uni.navigateBack()
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <!-- 自定义导航栏：本页用 navigationStyle: custom，需自行避开状态栏与右上角胶囊 -->
    <view class="nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">商家入驻</text>
      </view>
    </view>

    <view v-if="loading" class="tip">加载中…</view>

    <template v-else>
      <!-- 状态卡：待审核 / 已通过 -->
      <view v-if="apply && !showForm" class="card">
        <view class="card-head">
          <text class="card-title">申请状态</text>
          <text class="status" :class="`status-${apply.status}`">{{ statusText }}</text>
        </view>
        <view class="row"><text class="label">品牌名称</text><text class="value">{{ apply.brandName || '—' }}</text></view>
        <view class="row"><text class="label">首店名称</text><text class="value">{{ apply.shopName || '—' }}</text></view>
        <view class="row" v-if="apply.accountUsername"><text class="label">商家工号</text><text class="value">{{ apply.accountUsername }}</text></view>
        <view class="row" v-if="apply.applyTime"><text class="label">提交时间</text><text class="value">{{ apply.applyTime }}</text></view>
        <view class="row" v-if="apply.auditTime"><text class="label">审核时间</text><text class="value">{{ apply.auditTime }}</text></view>

        <!-- 上次驳回原因（驳回后重新提交、待审核状态仍展示） -->
        <view v-if="apply.status === 0 && apply.previousRejectReason" class="reject-box">
          <text class="reject-title">上次驳回原因</text>
          <text class="reject-text">{{ apply.previousRejectReason }}</text>
        </view>

        <text class="hint">{{ statusHint }}</text>
        <!-- 审核通过即可进门店管理（走店长身份、免工号）；工号只影响 PC 控制台，不作为入口前置条件 -->
        <button v-if="apply.status === 1" class="btn" @click="goBack">去「我的身份」进入门店管理</button>
      </view>

      <!-- 表单：未申请过 / 已驳回重提 -->
      <view v-else class="card">
        <text class="card-title">商家入驻申请</text>
        <text class="hint">提交后由平台客服审核；审核通过即可在「我的 → 我的身份」进入门店管理。商家工号（登录 PC 控制台用）由客服另行发放，不影响小程序使用。</text>

        <!-- 驳回后重提：显示上次驳回原因 -->
        <view v-if="apply && apply.status === 2" class="reject-box">
          <text class="reject-title">驳回原因</text>
          <text class="reject-text">{{ apply.auditRemark || '请按平台要求修改后重新提交' }}</text>
        </view>

        <label class="field">
          <text class="field-label">品牌名称 *</text>
          <input v-model="form.brandName" class="field-input" placeholder="如：金花优（全局唯一）" @input="brandError = ''" />
          <text v-if="brandError" class="field-error">{{ brandError }}</text>
        </label>
        <label class="field"><text class="field-label">首店名称 *</text><input v-model="form.shopName" class="field-input" placeholder="如：金花优张江店" /></label>

        <!-- 门店位置：必须微信选点（后端坐标必填） -->
        <view class="field">
          <text class="field-label">门店位置 *（必须选点，用于配送范围与骑手取货）</text>
          <button class="location-btn" @click="chooseShopLocation">{{ form.latitude == null ? '选择门店位置' : '重新选择位置' }}</button>
          <text v-if="form.latitude != null" class="location-text">已选：{{ form.address || form.shopName }}（{{ form.latitude.toFixed(6) }}, {{ form.longitude?.toFixed(6) }}）</text>
          <text v-else class="field-error">尚未选择位置，提交前必须选点</text>
        </view>

        <label class="field"><text class="field-label">门店地址</text><input v-model="form.address" class="field-input" placeholder="选点后自动回填，可微调" /></label>
        <label class="field"><text class="field-label">主营类目</text><input v-model="form.mainBusiness" class="field-input" placeholder="如：餐饮 / 便利店" /></label>
        <label class="field"><text class="field-label">联系人</text><input v-model="form.contactName" class="field-input" placeholder="请输入联系人姓名" /></label>
        <label class="field"><text class="field-label">联系电话</text><input v-model="form.contactPhone" class="field-input" type="number" maxlength="11" placeholder="请输入手机号" /></label>

        <view class="field">
          <text class="field-label">营业执照</text>
          <view class="license-row">
            <image v-if="form.licenseImage" class="license-img" :src="form.licenseImage" mode="aspectFit" @click="chooseLicense" />
            <button class="license-btn" :disabled="uploading" @click="chooseLicense">{{ uploading ? '上传中…' : (form.licenseImage ? '重新上传' : '上传营业执照') }}</button>
          </view>
        </view>

        <label class="field"><text class="field-label">申请备注</text><input v-model="form.remark" class="field-input" placeholder="可选，如：希望尽快审核" /></label>

        <button class="btn" :disabled="submitting" @click="submit">{{ submitting ? '提交中…' : '提交申请' }}</button>
      </view>
    </template>
  </view>
</template>

<style scoped>
/* 自定义导航栏：固定顶部，标题靠左（右侧留给微信胶囊按钮，避免遮挡） */
.nav { position: fixed; top: 0; right: 0; left: 0; z-index: 20; background: #f6f7f9; }
.nav-inner { display: flex; align-items: center; height: 44px; padding: 0 24rpx; }
.nav-back { width: 56rpx; color: #1d2129; font-size: 46rpx; line-height: 1; }
.nav-title { color: #1d2129; font-size: 34rpx; font-weight: 600; }
.page { min-height: 100vh; padding: 24rpx; box-sizing: border-box; background: #f6f7f9; }
.tip { padding: 80rpx 0; color: #86909c; font-size: 28rpx; text-align: center; }
.card { padding: 32rpx; border-radius: 20rpx; background: #fff; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.card-title { color: #1d2129; font-size: 34rpx; font-weight: 700; }
.status { font-size: 28rpx; font-weight: 600; }
.status-0 { color: #ff9500; }
.status-1 { color: #12a150; }
.status-2 { color: #e0432a; }
.hint { display: block; margin: 20rpx 0 8rpx; color: #86909c; font-size: 25rpx; line-height: 38rpx; }
.row { display: flex; align-items: center; justify-content: space-between; padding: 20rpx 0; border-bottom: 1rpx solid #f2f4f7; }
.row:last-of-type { border-bottom: none; }
.label { color: #86909c; font-size: 26rpx; }
.value { color: #1d2129; font-size: 28rpx; }
.reject-box { margin: 20rpx 0 8rpx; padding: 20rpx 24rpx; border-radius: 16rpx; background: #fff2f0; }
.reject-title { display: block; margin-bottom: 8rpx; color: #e0432a; font-size: 26rpx; font-weight: 600; }
.reject-text { color: #e0432a; font-size: 26rpx; line-height: 38rpx; }
.field { display: block; margin-top: 24rpx; }
.field-label { display: block; margin-bottom: 10rpx; color: #4e5969; font-size: 26rpx; }
.field-input { width: 100%; height: 88rpx; padding: 0 24rpx; box-sizing: border-box; border: 1rpx solid #e5e6eb; border-radius: 16rpx; background: #fafbfc; color: #1d2129; font-size: 28rpx; }
.field-error { display: block; margin-top: 8rpx; color: #e0432a; font-size: 24rpx; }
.location-btn { margin: 0; border-radius: 16rpx; background: #f2f3f5; color: #1d2129; font-size: 28rpx; line-height: 80rpx; }
.location-text { display: block; margin-top: 12rpx; color: #12a150; font-size: 25rpx; line-height: 36rpx; }
.license-row { display: flex; align-items: center; gap: 20rpx; }
.license-img { width: 180rpx; height: 180rpx; border-radius: 16rpx; background: #f2f3f5; }
.license-btn { margin: 0; border-radius: 16rpx; background: #f2f3f5; color: #1d2129; font-size: 28rpx; line-height: 80rpx; }
.btn { margin-top: 40rpx; border-radius: 44rpx; background: linear-gradient(135deg, #ffb341 0%, #ff5500 100%); color: #fff; font-size: 30rpx; line-height: 88rpx; }
.btn[disabled] { opacity: .6; }
</style>
