<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ocrRealname, verifyRealname, type RealnameStatus, type RealnameVerifyDTO } from '@/api/realname'
import { isApiRequestError, uploadFile } from '@/utils/request'
import { cleanIdCard, validateBankCard, validateIdCard, validateMobile, validateText } from '@/utils/input-validation'

interface Props {
  modelValue: boolean
  /** 银行卡提现时要求同时填写银行卡号和银行预留手机号；零钱提现/转账仍可选填。 */
  requiredBankInfo?: boolean
}

const props = withDefaults(defineProps<Props>(), { requiredBankInfo: false })
const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  verified: [status: RealnameStatus]
}>()

type ImageSide = 'front' | 'back'
type ImageState = { preview: string; url: string }

const visible = computed(() => props.modelValue)
const bankInfoRequired = computed(() => props.requiredBankInfo)
const submitting = ref(false)
const uploadingSide = ref<ImageSide | null>(null)
const ocrLoading = ref(false)
const errorMessage = ref('')
const form = reactive({
  certName: '',
  certNo: '',
  bankCardNo: '',
  bankPhone: '',
})
const images = reactive<Record<ImageSide, ImageState>>({
  front: { preview: '', url: '' },
  back: { preview: '', url: '' },
})
const busy = computed(() => submitting.value || uploadingSide.value !== null || ocrLoading.value)

function clearSensitiveInput(): void {
  form.certName = ''
  form.certNo = ''
  form.bankCardNo = ''
  form.bankPhone = ''
  images.front.preview = ''
  images.front.url = ''
  images.back.preview = ''
  images.back.url = ''
}

function close(): void {
  if (busy.value) return
  clearSensitiveInput()
  errorMessage.value = ''
  emit('update:modelValue', false)
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (isApiRequestError(error) && error.message) return error.message
  return error instanceof Error && error.message ? error.message : fallback
}

function compressImage(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    uni.compressImage({
      src: filePath,
      quality: 70,
      success: (result) => resolve(result.tempFilePath || filePath),
      fail: () => resolve(filePath),
    })
  })
}

function chooseIdCardImage(side: ImageSide): void {
  if (busy.value) return
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (result) => {
      const filePath = result.tempFilePaths?.[0]
      if (!filePath) return
      images[side].preview = filePath
      void uploadIdCardImage(side, filePath)
    },
  })
}

type TextRecord = Record<string, unknown>

function asTextRecord(value: unknown): TextRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as TextRecord : null
}

function collectOcrRecords(value: unknown, depth = 0, records: TextRecord[] = []): TextRecord[] {
  if (depth > 3) return records
  const record = asTextRecord(value)
  if (!record) return records
  records.push(record)
  for (const key of ['data', 'info', 'result']) collectOcrRecords(record[key], depth + 1, records)
  return records
}

function findOcrText(records: TextRecord[], keys: string[]): string {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return ''
}

/** 兼容第三方 OCR 的顶层字段和 data.info 嵌套字段。 */
async function recognizeFront(url: string): Promise<void> {
  ocrLoading.value = true
  try {
    const result = await ocrRealname({ url })
    if (!result.success) throw new Error(result.message || '身份证识别失败，请手动输入')
    const records = collectOcrRecords(result)
    const name = findOcrText(records, ['name', 'certName', 'realName', '姓名'])
    const certNo = findOcrText(records, ['number', 'certNo', 'idNumber', '身份证号', '公民身份号码'])
    if (!form.certName.trim() && name) form.certName = name
    if (!form.certNo.trim() && certNo) form.certNo = cleanIdCard(certNo)
    const missing = [!name ? '姓名' : '', !certNo ? '身份证号' : ''].filter(Boolean)
    errorMessage.value = missing.length ? `图片已上传，请手动填写${missing.join('和')}` : ''
  } catch (error) {
    errorMessage.value = getErrorMessage(error, '图片识别失败，请手动填写姓名和身份证号')
  } finally {
    ocrLoading.value = false
  }
}

async function uploadIdCardImage(side: ImageSide, filePath: string): Promise<void> {
  uploadingSide.value = side
  errorMessage.value = ''
  try {
    const compressedPath = await compressImage(filePath)
    images[side].url = await uploadFile(compressedPath)
    if (side === 'front') await recognizeFront(images[side].url)
  } catch (error) {
    images[side].url = ''
    errorMessage.value = getErrorMessage(error, '图片上传失败，请重试')
  } finally {
    uploadingSide.value = null
  }
}

function validateForm(): RealnameVerifyDTO | null {
  const certName = validateText(form.certName, { label: '真实姓名', maxLength: 32 })
  if (!certName.ok) {
    errorMessage.value = certName.message
    return null
  }
  const certNo = validateIdCard(form.certNo)
  if (!certNo.ok) {
    errorMessage.value = certNo.message
    return null
  }

  const bankCardInput = form.bankCardNo.trim()
  const bankPhoneInput = form.bankPhone.trim()
  if (bankInfoRequired.value && !bankCardInput) {
    errorMessage.value = '银行卡号为必填项'
    return null
  }
  if (bankInfoRequired.value && !bankPhoneInput) {
    errorMessage.value = '银行预留手机号为必填项'
    return null
  }
  const bankCardNo = bankCardInput ? validateBankCard(bankCardInput) : null
  if (bankCardNo && !bankCardNo.ok) {
    errorMessage.value = bankCardNo.message
    return null
  }
  const bankPhone = bankPhoneInput ? validateMobile(bankPhoneInput, '银行预留手机号') : null
  if (bankPhone && !bankPhone.ok) {
    errorMessage.value = bankPhone.message
    return null
  }

  return {
    certName: certName.value,
    certNo: certNo.value,
    ...(images.front.url ? { idCardFrontUrl: images.front.url } : {}),
    ...(images.back.url ? { idCardBackUrl: images.back.url } : {}),
    ...(bankCardNo ? { bankCardNo: bankCardNo.value } : {}),
    ...(bankPhone ? { bankPhone: bankPhone.value } : {}),
  }
}

async function submitForm(): Promise<void> {
  if (busy.value) return
  const payload = validateForm()
  if (!payload) return
  submitting.value = true
  errorMessage.value = ''
  try {
    const status = await verifyRealname(payload)
    if (!status.verified) {
      errorMessage.value = '实名认证未完成，请核对信息后重试'
      return
    }
    clearSensitiveInput()
    emit('verified', status)
    emit('update:modelValue', false)
  } catch (error) {
    if (isApiRequestError(error) && [1000, 8602, 8603, 1001].includes(error.code ?? -1)) {
      errorMessage.value = error.message
    } else {
      errorMessage.value = getErrorMessage(error, '实名认证失败，请稍后重试')
    }
  } finally {
    submitting.value = false
  }
}

function photoActionText(side: ImageSide): string {
  if (uploadingSide.value === side) return '上传中...'
  return images[side].preview ? '重新上传' : '拍照或从相册选择'
}

watch(() => props.modelValue, (nextVisible) => {
  if (nextVisible) errorMessage.value = ''
  else {
    clearSensitiveInput()
    errorMessage.value = ''
  }
})
</script>

<template>
  <view v-show="visible" class="realname-mask" @click="close">
    <view class="realname-sheet" @click.stop>
      <view class="sheet-header">
        <text class="sheet-title">实名认证</text>
        <text class="sheet-close" @click="close">×</text>
      </view>
      <scroll-view class="realname-form" scroll-y>
        <view class="photo-grid">
          <view class="photo-group">
            <text class="field-label">身份证正面 <text class="field-optional">（选填）</text></text>
            <view class="photo-box" @tap="chooseIdCardImage('front')">
              <image v-if="images.front.preview" class="photo-preview" :src="images.front.preview" mode="aspectFit" />
              <view v-else class="photo-placeholder"><text class="photo-plus">＋</text><text>身份证正面</text></view>
              <text class="photo-action">{{ photoActionText('front') }}</text>
            </view>
          </view>
          <view class="photo-group">
            <text class="field-label">身份证反面 <text class="field-optional">（选填）</text></text>
            <view class="photo-box" @tap="chooseIdCardImage('back')">
              <image v-if="images.back.preview" class="photo-preview" :src="images.back.preview" mode="aspectFit" />
              <view v-else class="photo-placeholder"><text class="photo-plus">＋</text><text>身份证反面</text></view>
              <text class="photo-action">{{ photoActionText('back') }}</text>
            </view>
          </view>
        </view>

        <view class="field-group">
          <text class="field-label">姓名 <text class="field-required">*</text></text>
          <input v-model="form.certName" class="field-input" maxlength="32" type="text" placeholder="请输入真实姓名" />
        </view>
        <view class="field-group">
          <text class="field-label">身份证号 <text class="field-required">*</text></text>
          <input v-model="form.certNo" class="field-input" maxlength="18" type="text" placeholder="请输入18位身份证号" />
        </view>
        <view class="field-group">
          <text class="field-label">银行预留手机号 <text v-if="bankInfoRequired" class="field-required">*</text><text v-else class="field-optional">（选填）</text></text>
          <input v-model="form.bankPhone" class="field-input" maxlength="11" type="number" placeholder="请输入银行预留手机号" />
        </view>
        <view class="field-group">
          <text class="field-label">银行卡号 <text v-if="bankInfoRequired" class="field-required">*</text><text v-else class="field-optional">（选填）</text></text>
          <input v-model="form.bankCardNo" class="field-input" maxlength="19" type="number" placeholder="请输入银行卡号" />
        </view>
        <text v-show="ocrLoading" class="sheet-hint">正在识别身份证正面，请稍候...</text>
        <text v-show="errorMessage" class="sheet-error">{{ errorMessage }}</text>
      </scroll-view>
      <button class="sheet-submit" :disabled="busy" @click="submitForm">
        {{ submitting ? '认证中...' : '提交认证' }}
      </button>
    </view>
  </view>
</template>

<style>
.realname-mask { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .62); }
.realname-sheet { width: 100%; max-height: 90vh; padding: 30rpx 28rpx calc(30rpx + env(safe-area-inset-bottom)); box-sizing: border-box; background: #fff; }
.sheet-header { position: relative; display: flex; align-items: center; justify-content: center; min-height: 54rpx; }
.sheet-title { color: #222; font-size: 30rpx; font-weight: 600; }
.sheet-close { position: absolute; right: 0; color: #888; font-size: 42rpx; line-height: 42rpx; }
.realname-form { max-height: 66vh; margin-top: 20rpx; }
.photo-grid { display: flex; gap: 18rpx; margin-bottom: 24rpx; }
.photo-group { flex: 1; min-width: 0; }
.photo-box { position: relative; display: flex; align-items: center; justify-content: center; height: 190rpx; overflow: hidden; border: 1rpx dashed #cfd4dc; border-radius: 12rpx; background: #f8fafc; color: #8a94a6; }
.photo-preview { width: 100%; height: 100%; }
.photo-placeholder { display: flex; align-items: center; flex-direction: column; justify-content: center; font-size: 22rpx; }
.photo-plus { color: #667085; font-size: 46rpx; font-weight: 300; line-height: 48rpx; }
.photo-action { position: absolute; right: 0; bottom: 0; left: 0; padding: 8rpx 4rpx; background: rgba(0, 0, 0, .48); color: #fff; font-size: 20rpx; text-align: center; }
.field-group { margin-bottom: 20rpx; }
.field-label { display: block; margin-bottom: 10rpx; color: #333; font-size: 25rpx; font-weight: 600; }
.field-required { color: #d92d20; }
.field-optional { color: #98a2b3; font-size: 21rpx; font-weight: 400; }
.field-input { width: 100%; height: 82rpx; padding: 0 22rpx; box-sizing: border-box; border: 1rpx solid #e5e7eb; border-radius: 12rpx; background: #fafafa; color: #222; font-size: 26rpx; }
.sheet-hint, .sheet-error { display: block; margin: 4rpx 0 10rpx; font-size: 23rpx; line-height: 32rpx; }
.sheet-hint { color: #667085; }
.sheet-error { color: #c44; }
.sheet-submit { height: 78rpx; margin-top: 22rpx; color: #fff; background: #222; border-radius: 4rpx; font-size: 27rpx; }
.sheet-submit::after { border: 0; }
.sheet-submit[disabled] { opacity: .56; }
</style>
