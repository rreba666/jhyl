<script setup lang="ts">
/**
 * 商家端 · 新增 / 编辑商品（对应设计稿「新增商品」未录入/已录入两态）
 * 契约：POST /api/merchant/products（新增）、PUT /api/merchant/products/{id}（编辑）
 * 请求体 MerchantProductSaveDTO：title* / mainImages*（≤5）/ description / skus*[{specName,skuName,price,stock}] / detailImages / status /
 * pickupEnabled / deliveryEnabled（商品级配送方式，2026-09-22 新增，不传 = 不修改）
 * 范围结论：规格页是独立整页；商品核心是上下架；编辑因无单商品详情接口，仅能回填列表项已有字段（title/mainImage/skus）。
 * 图片上传走 POST /api/common/upload（utils/request 的 uploadFile）。
 *
 * ⚠️ 编辑态三条硬规则（2026-09-21 实测后定，详见 doSave / buildPayload 注释；2026-09-22 追加第 3 条）：
 *   1. **不传 `status`** —— 后端一收到 status 就会连品牌级 `productStatus` 一起改（品牌下所有门店一起下线），
 *      本店上下架另走 `updateProductStatus()`（PUT /api/merchant/products/{id}/status）；
 *   2. **description / detailImages 回填不到就不提交** —— 整页覆盖语义下空值会清空线上内容；
 *   3. **`pickupEnabled` / `deliveryEnabled`（商品级配送方式）回填不到就不提交** ——
 *      语义是「不传 = 不修改」，提交默认值 1 会把商家已关掉的开关重新打开（后端下单拦截 13023/13024）。
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  saveMerchantProduct,
  updateMerchantProduct,
  updateProductStatus,
  type MerchantProductSaveDTO,
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

// ===== 商品级「配送方式」开关（2026-09-22 新增，§7b②） =====
/** 支持线下自提：1=支持, 0=不支持（新增态默认 1）。 */
const pickupEnabled = ref<0 | 1>(1)
/** 支持物流(0)/同城(2)配送：1=支持, 0=不支持（新增态默认 1）。 */
const deliveryEnabled = ref<0 | 1>(1)
/**
 * 回显是否拿到了这两个开关（来源：列表项 `MerchantProductVO.pickupEnabled` / `deliveryEnabled`）。
 *
 * ⚠️ 语义是「**不传 = 不修改**」（2026-09-22 上线）：编辑态**拿不到回显就不提交该字段** ——
 * 若提交默认值 1，会把商家已经关掉的自提/物流开关重新打开（下单侧会因此拦不住 13023/13024）。
 * 这与本页 `description` / `detailImages` 的防御原则同源（拿不到就不提交）。
 */
const pickupEchoed = ref(false)
const deliveryEchoed = ref(false)

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
  // 商品级配送方式：只记「回显拿到了没有」，拿不到就不提交（见 buildPayload / pickupEchoed 注释）
  const pickup = normalizeSwitch(cached.pickupEnabled)
  pickupEchoed.value = pickup !== null
  if (pickup !== null) pickupEnabled.value = pickup
  const delivery = normalizeSwitch(cached.deliveryEnabled)
  deliveryEchoed.value = delivery !== null
  if (delivery !== null) deliveryEnabled.value = delivery
}

/**
 * 配送方式开关回显归一化：`1/'1'/true → 1`，`0/'0'/false → 0`，**缺失 → null（= 拿不到回显）**。
 * ⚠️ 缺失既不能当 0 也不能当 1 —— 它代表「后端没下发这个字段」，提交时必须整个跳过。
 */
function normalizeSwitch(value: unknown): 0 | 1 | null {
  if (value === undefined || value === null || value === '') return null
  return value === 1 || value === '1' || value === true ? 1 : 0
}

/** 编辑态是否已回显到该开关（新增态恒为 true，按默认值 1 提交）。 */
function switchEditable(echoed: boolean): boolean {
  return !productId.value || echoed
}

/** 点击切换「支持线下自提」；拿不到回显时禁止切换（避免显示与线上不一致）。 */
function togglePickup(): void {
  if (!switchEditable(pickupEchoed.value)) {
    uni.showToast({ title: '未读取到该项当前设置，本次保存不会修改它', icon: 'none' })
    return
  }
  pickupEnabled.value = pickupEnabled.value === 1 ? 0 : 1
}

/** 点击切换「支持物流/同城配送」；拿不到回显时禁止切换。 */
function toggleDelivery(): void {
  if (!switchEditable(deliveryEchoed.value)) {
    uni.showToast({ title: '未读取到该项当前设置，本次保存不会修改它', icon: 'none' })
    return
  }
  deliveryEnabled.value = deliveryEnabled.value === 1 ? 0 : 1
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

/**
 * 组装保存请求体。
 *
 * ⚠️ 防御性处理（2026-09-21）：后端**没有单商品详情 GET 接口**，编辑页只能从列表项缓存回填
 * `title` / 第 1 张主图 / `skus`，拿不到 `description` 与 `detailImages`；而
 * `PUT /api/merchant/products/{id}` 是**整页覆盖**语义 —— 把空值放进去会静默清空描述与详情图
 * （用户反馈：每次编辑都会把描述、详情图清掉，主图从 N 张退化成 1 张）。
 * 所以**编辑态这两个字段为空就不放进 payload**（不传 = 不修改）。补上后端详情接口后，
 * 应改回「正常回填 + 正常提交」并删掉这里的条件。
 */
function buildPayload(): MerchantProductSaveDTO {
  const payload: MerchantProductSaveDTO = {
    title: title.value.trim(),
    mainImages: mainImages.value,
    skus: skus.value.map((s) => {
      const specName = s.specName.trim()
      // 规格名两个字段名都带同值：商家端生效的是 specName（2026-09-19 实测），
      // 平台端 2026-09-22 起对 skuName 加了 @NotBlank 强校验（§7b①）；后端忽略未知字段，多带同值不影响
      return { specName, skuName: specName, price: s.price, stock: s.stock }
    }),
  }
  const desc = description.value.trim()
  // 新建态：用户看得到输入框，空就是真的不要描述；编辑态：空只代表「回填不到」，不能当作用户清空
  if (!productId.value || desc) payload.description = desc
  if (detailImages.value.length) payload.detailImages = detailImages.value
  // 商品级配送方式（2026-09-22）：语义「不传 = 不修改」——
  // 新增态没有回显，按默认值 1 显式提交；编辑态**只有回显确实拿到了才提交**，
  // 否则提交 1 会把商家已关掉的自提/物流开关重新打开。
  if (!productId.value || pickupEchoed.value) payload.pickupEnabled = pickupEnabled.value
  if (!productId.value || deliveryEchoed.value) payload.deliveryEnabled = deliveryEnabled.value
  return payload
}

/**
 * 保存商品。
 *
 * ⚠️ 2026-09-21 真实接口实测：`PUT /api/merchant/products/901155 { status: 0 }` →
 * 品牌级 `productStatus` 1 → 0（**品牌下所有门店的这件商品一起下线**），且 `skuId` 被重建
 * （801166 → 801167，SKU 关联漂移）。结论：**编辑态一律不传 `status`**（不传 = 上架状态完全不变）。
 *
 * 编辑态的上下架改走**本店专用接口** `updateProductStatus(id, status)`
 * （`PUT /api/merchant/products/{id}/status`，只改本店 shopStatus）：
 * 「保存到仓库」= 保存内容 + 本店下架(0)，「保存并上架」= 保存内容 + 本店上架(1)。
 * 新建态（无 productId）保持原行为：`saveMerchantProduct(payload)` 带 status 建商品。
 */
async function doSave(status: 0 | 1): Promise<void> {
  if (saving.value) return
  const err = validate()
  if (err) {
    uni.showToast({ title: err, icon: 'none' })
    return
  }
  saving.value = true
  const editingId = productId.value
  try {
    if (!editingId) {
      // 新建态：status 决定建出来的商品在售还是入仓库（原行为不变）
      await saveMerchantProduct({ ...buildPayload(), status })
    } else {
      // 编辑态：先存内容（不带 status），再单独改本店上下架状态
      await updateMerchantProduct(editingId, buildPayload())
      try {
        await updateProductStatus(editingId, status)
      } catch (error) {
        // 内容已存成功、只有上下架没生效：既不能说「保存失败」（用户会重复提交内容），
        // 也不能说「保存成功」（状态其实没变）—— 给一句明确文案并留在本页让用户重试。
        uni.showToast({ title: '内容已保存，但上下架状态未生效，请重试', icon: 'none' })
        return
      }
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
      <!-- 编辑态诚实提示（2026-09-21）：后端**没有单商品详情 GET 接口**，本页只能回填标题/第 1 张主图/规格，
           拿不到 description 与 detailImages —— 提交时这两个字段会被跳过（不覆盖线上内容），
           所以本页对它们的修改不会生效。补后端详情接口后应改为正常回填并删掉这条提示。 -->
      <view v-if="productId" class="edit-notice">
        <text>当前版本编辑不会修改商品描述与详情图；主图只能回填第 1 张，保存后以这 1 张为准</text>
      </view>

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

      <!-- 卡 3：商品级「配送方式」开关（2026-09-22 新增，§7b②）
           与「模块开关」「门店是否上架」三重叠加：关闭后 C 端下单会报 13023（自提）/ 13024（物流·同城）。 -->
      <view class="card">
        <view class="switch-row">
          <view class="switch-copy">
            <text class="label-text">支持线下自提</text>
            <text class="switch-hint">关闭后用户下单不能选择到店自提</text>
          </view>
          <view
            class="toggle"
            :class="{ on: pickupEnabled === 1, disabled: !switchEditable(pickupEchoed) }"
            @click="togglePickup"
          >
            <view class="toggle-knob" />
          </view>
        </view>
        <view class="switch-row">
          <view class="switch-copy">
            <text class="label-text">支持物流/同城配送</text>
            <text class="switch-hint">关闭后用户下单不能选择物流(0)/同城(2)</text>
          </view>
          <view
            class="toggle"
            :class="{ on: deliveryEnabled === 1, disabled: !switchEditable(deliveryEchoed) }"
            @click="toggleDelivery"
          >
            <view class="toggle-knob" />
          </view>
        </view>
        <!-- 诚实告知：列表接口没下发这两个字段时保存会跳过它们（后端语义「不传 = 不修改」） -->
        <view v-if="productId && (!pickupEchoed || !deliveryEchoed)" class="switch-notice">
          <text>本次未能读取到商品级配送方式，保存不会修改这两项设置</text>
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
/* 编辑态的限制提示（后端无商品详情接口导致，属诚实告知，非报错） */
.edit-notice {
  margin-bottom: 15rpx;
  padding: 20rpx 23rpx;
  border-radius: 16rpx;
  background: #fff4e8;
  color: #ff6a01;
  font-size: 25rpx;
  line-height: 38rpx;
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

/* 商品级「配送方式」开关行（自绘开关，与本页其余表单项风格一致） */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 23rpx;
}
.switch-row + .switch-row {
  margin-top: 31rpx;
}
.switch-copy {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  min-width: 0;
  flex: 1;
}
.switch-hint {
  color: #86909c;
  font-size: 23rpx;
  line-height: 34rpx;
}
.toggle {
  position: relative;
  flex-shrink: 0;
  width: 88rpx;
  height: 50rpx;
  border-radius: 25rpx;
  background: #e5e6eb;
  transition: background 0.2s;
}
.toggle.on {
  background: linear-gradient(90deg, #ff9301 0%, #ff6a01 100%);
}
.toggle.disabled {
  opacity: 0.5;
}
.toggle-knob {
  position: absolute;
  top: 4rpx;
  left: 4rpx;
  width: 42rpx;
  height: 42rpx;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.2s;
}
.toggle.on .toggle-knob {
  transform: translateX(38rpx);
}
.switch-notice {
  margin-top: 23rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid #f2f3f7;
  color: #ff6a01;
  font-size: 23rpx;
  line-height: 36rpx;
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
