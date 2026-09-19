<script setup lang="ts">
/**
 * 商家端 · 新增 / 编辑商品（对应设计稿「新增商品」未录入/已录入两态）
 * 契约：POST /api/merchant/products（新增）、PUT /api/merchant/products/{id}（编辑）
 * 请求体 MerchantProductSaveDTO：title* / mainImages*（≤5）/ description / skus*[{specName,price,stock}] / detailImages / status
 * 范围结论：规格页是独立整页；商品核心是上下架；编辑因无单商品详情接口，仅能回填列表项已有字段（title/mainImage/skus）。
 * 图片上传走 POST /api/common/upload（utils/request 的 uploadFile）。
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  saveMerchantProduct,
  updateMerchantProduct,
  type MerchantProductVO,
  type MerchantSkuItem,
} from '@/api/merchant'
import { uploadFile } from '@/utils/request'

/** 编辑数据暂存 key（商品列表页写入，本页读取回填）。 */
const EDIT_STORAGE_KEY = 'merchant_product_edit'
/** 规格页传回 key（规格页保存后写入，本页 onShow 读取）。 */
const SKUS_STORAGE_KEY = 'merchant_product_skus'

const statusBarHeight = ref(0)
const contentTop = computed(() => statusBarHeight.value + 44)

/** 编辑模式：productId 非空。 */
const productId = ref<number | null>(null)
const pageTitle = computed(() => (productId.value ? '编辑商品' : '新增商品'))

const title = ref('')
const mainImages = ref<string[]>([])
const description = ref('')
const skus = ref<MerchantSkuItem[]>([])
const detailImages = ref<string[]>([])

const saving = ref(false)
const uploading = ref(false)

onLoad((options) => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '新增商品' })
  const id = Number(options?.productId)
  if (Number.isInteger(id) && id > 0) {
    productId.value = id
    uni.setNavigationBarTitle({ title: '编辑商品' })
    fillFromEditCache()
  }
})

onShow(() => {
  // 规格页保存后把 skus 写回 storage，这里读取
  const cached = uni.getStorageSync(SKUS_STORAGE_KEY) as MerchantSkuItem[] | ''
  if (Array.isArray(cached)) {
    skus.value = cached
  }
})

/** 编辑模式：从列表项缓存回填能拿到的字段（描述/详情图无接口，留空）。 */
function fillFromEditCache(): void {
  const cached = uni.getStorageSync(EDIT_STORAGE_KEY) as MerchantProductVO | ''
  if (!cached || typeof cached !== 'object') return
  title.value = cached.name || ''
  if (cached.mainImage) mainImages.value = [cached.mainImage]
  skus.value = (cached.skus || []).map((s) => ({
    // 列表返回的规格名字段是 `specName`（不是 skuName）：读错会让编辑时规格名回填为空，一提交就报「请填写规格名称」
    specName: s.specName || '',
    price: Number(s.price) || 0,
    stock: Number(s.stock) || 0,
  }))
}

/** 规格 chip 展示：前 2 个 + 共 N 个。 */
const specChips = computed(() => skus.value.slice(0, 2).map((s) => s.specName).filter(Boolean))

// ===== 图片上传 =====
async function chooseMainImages(): Promise<void> {
  const remaining = 5 - mainImages.value.length
  if (remaining <= 0) {
    uni.showToast({ title: '最多上传 5 张主图', icon: 'none' })
    return
  }
  const res = await uni.chooseImage({ count: remaining, sizeType: ['compressed'] })
  await uploadImages(res.tempFilePaths, mainImages.value)
}

async function chooseDetailImages(): Promise<void> {
  const remaining = 5 - detailImages.value.length
  if (remaining <= 0) {
    uni.showToast({ title: '最多上传 5 张详情图', icon: 'none' })
    return
  }
  const res = await uni.chooseImage({ count: remaining, sizeType: ['compressed'] })
  await uploadImages(res.tempFilePaths, detailImages.value)
}

async function uploadImages(paths: string[], target: string[]): Promise<void> {
  if (!paths.length) return
  uploading.value = true
  try {
    for (const p of paths) {
      const url = await uploadFile(p)
      target.push(url)
    }
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '上传失败', icon: 'none' })
  } finally {
    uploading.value = false
  }
}

function removeImage(target: string[], index: number): void {
  target.splice(index, 1)
}

// ===== 规格入口 =====
function goSpec(): void {
  // 把当前 skus 传给规格页
  uni.setStorageSync(SKUS_STORAGE_KEY, skus.value)
  uni.navigateTo({ url: '/subpkg-merchant/products/spec' })
}

// ===== 保存 =====
function validate(): string | null {
  if (!title.value.trim()) return '请填写商品标题'
  if (mainImages.value.length === 0) return '请上传商品主图'
  if (skus.value.length === 0) return '请添加商品规格'
  for (const s of skus.value) {
    if (!s.specName.trim()) return '请填写规格名称'
    if (!Number.isFinite(s.price) || s.price <= 0) return `规格「${s.specName || ''}」价格需大于 0`
    if (!Number.isInteger(s.stock) || s.stock < 0) return `规格「${s.specName || ''}」库存需为非负整数`
  }
  return null
}

async function doSave(status: 0 | 1): Promise<void> {
  if (saving.value) return
  const err = validate()
  if (err) {
    uni.showToast({ title: err, icon: 'none' })
    return
  }
  saving.value = true
  try {
    const payload = {
      title: title.value.trim(),
      mainImages: mainImages.value,
      description: description.value.trim() || undefined,
      skus: skus.value.map((s) => ({ specName: s.specName.trim(), price: s.price, stock: s.stock })),
      detailImages: detailImages.value.length ? detailImages.value : undefined,
      status,
    }
    if (productId.value) {
      await updateMerchantProduct(productId.value, payload)
    } else {
      await saveMerchantProduct(payload)
    }
    uni.removeStorageSync(SKUS_STORAGE_KEY)
    uni.removeStorageSync(EDIT_STORAGE_KEY)
    uni.showToast({ title: '保存成功', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 600)
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
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
      <text class="nav-title">{{ pageTitle }}</text>
    </view>

    <scroll-view class="content" scroll-y>
      <!-- 卡 1：主图 + 标题 + 描述 -->
      <view class="card">
        <!-- 主图上传 -->
        <view class="main-upload">
          <view
            v-for="(img, index) in mainImages"
            :key="'m' + index"
            class="upload-box has-image"
          >
            <image class="upload-img" :src="img" mode="aspectFill" />
            <view class="upload-remove" @click.stop="removeImage(mainImages, index)">×</view>
          </view>
          <view v-if="mainImages.length < 5" class="upload-box add" @click="chooseMainImages">
            <text class="add-icon">+</text>
            <text class="add-count">{{ mainImages.length + 1 }}/5</text>
          </view>
        </view>
        <view class="main-tip">
          <text class="tip-strong">5 张主图尺寸一致</text>
          <text class="tip-sub">建议尺寸 800x800px（1:1正方形）</text>
        </view>

        <!-- 商品标题 -->
        <view class="field">
          <view class="field-label">
            <text class="label-text">商品标题</text>
            <text class="label-star">*</text>
          </view>
          <textarea
            class="field-input title-input"
            v-model="title"
            :maxlength="60"
            placeholder="最多输入 60 字符（30 个汉字）"
            placeholder-class="field-ph"
          />
        </view>

        <!-- 详情描述 -->
        <view class="field">
          <view class="field-label">
            <text class="label-text">详情描述</text>
            <text class="label-sub">（可描述商品亮点）</text>
          </view>
          <textarea
            class="field-input desc-input"
            v-model="description"
            :maxlength="200"
            placeholder="最多输入 200 字"
            placeholder-class="field-ph"
          />
        </view>
      </view>

      <!-- 卡 2：规格 + 详情页 -->
      <view class="card">
        <view class="spec-row" @click="goSpec">
          <view class="field-label">
            <text class="label-text">规格</text>
            <text class="label-star">*</text>
          </view>
          <view class="spec-right">
            <view v-if="specChips.length" class="spec-chips">
              <text v-for="(chip, index) in specChips" :key="index" class="spec-chip">{{ chip }}</text>
              <text v-if="skus.length > 2" class="spec-more">共{{ skus.length }}个</text>
            </view>
            <text class="arrow">›</text>
          </view>
        </view>

        <view class="field">
          <view class="field-label">
            <text class="label-text">详情页</text>
          </view>
          <view class="detail-upload">
            <view
              v-for="(img, index) in detailImages"
              :key="'d' + index"
              class="upload-box small has-image"
            >
              <image class="upload-img" :src="img" mode="aspectFill" />
              <view class="upload-remove" @click.stop="removeImage(detailImages, index)">×</view>
            </view>
            <view v-if="detailImages.length < 5" class="upload-box small add" @click="chooseDetailImages">
              <text class="add-icon">+</text>
            </view>
          </view>
        </view>
      </view>
      <view class="content-pad" />
    </scroll-view>

    <!-- 底部保存栏 -->
    <view class="footer">
      <button class="save-btn save-btn-ghost" :disabled="saving || uploading" @click="doSave(0)">保存到仓库</button>
      <button class="save-btn save-btn-primary" :disabled="saving || uploading" @click="doSave(1)">保存并上架</button>
    </view>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
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
  height: 85rpx; /* 44px */
}
.nav-back {
  position: absolute;
  left: 23rpx;
  top: 50%;
  transform: translateY(-50%);
  color: #1d2129;
  font-size: 46rpx;
  line-height: 1;
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
  padding: 15rpx 15rpx 40rpx;
}
.content-pad {
  height: 120rpx;
}
.card {
  margin-bottom: 15rpx;
  padding: 31rpx;
  border-radius: 24rpx;
  background: #ffffff;
}

/* 主图上传 */
.main-upload {
  display: flex;
  gap: 15rpx;
}
.upload-box {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  width: 123rpx;
  height: 123rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
  overflow: hidden;
}
.upload-box.small {
  width: 119rpx;
  height: 119rpx;
}
.upload-img {
  width: 100%;
  height: 100%;
}
.upload-remove {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38rpx;
  height: 38rpx;
  background: rgba(0, 0, 0, 0.5);
  color: #ffffff;
  font-size: 30rpx;
  line-height: 1;
  border-radius: 0 0 0 15rpx;
}
.add-icon {
  color: #1d2129;
  font-size: 40rpx;
  line-height: 1;
}
.add-count {
  color: #86909c;
  font-size: 27rpx;
}
.main-tip {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 15rpx;
}
.tip-strong {
  color: #86909c;
  font-size: 25rpx;
  font-weight: 500;
}
.tip-sub {
  color: #86909c;
  font-size: 23rpx;
}

/* 字段 */
.field {
  margin-top: 38rpx;
}
.field-label {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.label-text {
  color: #1d2129;
  font-size: 29rpx;
  font-weight: 500;
}
.label-star {
  color: #f53f3f;
  font-size: 29rpx;
}
.label-sub {
  color: #86909c;
  font-size: 29rpx;
}
.field-input {
  box-sizing: border-box;
  width: 100%;
  margin-top: 15rpx;
  color: #1d2129;
  font-size: 27rpx;
  line-height: 42rpx;
}
.title-input {
  height: 123rpx; /* 64px */
}
.desc-input {
  height: 231rpx; /* 120px */
}
.field-ph {
  color: #c1c5cc;
}

/* 规格行 */
.spec-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.spec-right {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
  margin-left: 31rpx;
}
.spec-chips {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.spec-chip {
  padding: 8rpx 19rpx;
  border-radius: 12rpx;
  background: #f6f7f9;
  color: #000000;
  font-size: 27rpx;
}
.spec-more {
  color: #1d2129;
  font-size: 27rpx;
}
.arrow {
  color: #86909c;
  font-size: 40rpx;
  line-height: 1;
}

/* 详情图上传 */
.detail-upload {
  display: flex;
  gap: 15rpx;
  margin-top: 15rpx;
  flex-wrap: wrap;
}

/* 底部保存栏 */
.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: flex;
  gap: 15rpx;
  padding: 23rpx;
  background: #ffffff;
  padding-bottom: calc(23rpx + env(safe-area-inset-bottom));
}
.save-btn {
  margin: 0;
  padding: 0;
  flex: 1;
  height: 92rpx;
  border-radius: 24rpx;
  font-size: 31rpx;
  font-weight: 600;
  line-height: 92rpx;
}
.save-btn::after {
  border: 0;
}
.save-btn[disabled] {
  opacity: 0.6;
}
.save-btn-ghost {
  background: #f6f7f9;
  color: #1d2129;
}
.save-btn-primary {
  background: linear-gradient(90deg, #ff9301 0%, #ff6a01 50%, #ff4202 100%);
  color: #ffffff;
}
</style>
