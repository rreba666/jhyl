<script setup lang="ts">
/**
 * 门店管理（商家端）。
 *
 * 依据：`api_doc.json` 的 `/api/merchant/shop*`（2026-09-25 核对）。
 * - `GET  /api/merchant/shops`            门店列表（含每店店长/骑手/绑定微信人数）
 * - `POST /api/merchant/shop`             新建门店（品牌商家自建，自动归属当前品牌）
 * - `PUT  /api/merchant/shop/{id}/status` 启用 / 停用
 *
 * ## ⚠️ 本页**不做「编辑门店」**（有意为之，不是漏了）
 * 后端 `/api/merchant/shop/{id}` **只有 PUT、没有 GET**，而列表接口返回的是
 * `StaffAccountVO`（账号口径，**不含门店地址/图片/营业时间**）⇒ 拿不到单店现值、无法回填。
 * 硬做只能"让商家重新填一遍全部门店信息"，那比不做更容易出错。已记为待后端补单店详情接口。
 *
 * ## 与后台的关系
 * PC 后台走 `/api/admin/shop*`（全量）；本页走 `/api/merchant/shop*`，商家**只能看/管自己品牌**。
 */
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import {
  createMerchantShop,
  getMerchantShops,
  updateMerchantShopStatus,
  type MerchantShopVO,
} from '@/api/merchant'
import { uploadFile } from '@/utils/request'

/** 自定义导航栏需要自己避开状态栏。 */
const statusBarHeight = ref(0)

const loading = ref(true)
const submitting = ref(false)
const uploading = ref(false)
const shops = ref<MerchantShopVO[]>([])

/** 新建表单是否展开。 */
const formVisible = ref(false)

/** 新建门店表单。 */
const form = ref({
  name: '',
  address: '',
  phone: '',
  openTime: '',
  shopImage: '',
  latitude: null as number | null,
  longitude: null as number | null,
})

/** 启停中的门店 ID（防连点）。 */
const actingId = ref(0)

/** 内容区顶部内边距（状态栏 + 导航栏高度）。 */
const contentTop = computed(() => statusBarHeight.value + 44)

/** 门店状态文案（后端 `shopStatus`：1 启用 / 0 停用）。 */
function statusLabel(shop: MerchantShopVO): string {
  return Number(shop.shopStatus) === 1 ? '营业中' : '已停用'
}

/** 加载门店列表。 */
async function loadShops(): Promise<void> {
  loading.value = true
  try {
    const list = await getMerchantShops()
    shops.value = Array.isArray(list) ? list : []
  } catch (error) {
    shops.value = []
    uni.showToast({ title: error instanceof Error ? error.message : '门店查询失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

/** 打开/收起新建表单，并重置内容。 */
function toggleForm(): void {
  formVisible.value = !formVisible.value
  if (formVisible.value) {
    form.value = { name: '', address: '', phone: '', openTime: '', shopImage: '', latitude: null, longitude: null }
  }
}

/**
 * 地图选点（GCJ-02，与后端同坐标系，不做转换）。
 * ⚠️ 坐标是**必填**：缺坐标的门店下单试算会被拒（"商家门店坐标未配置，暂不支持配送"）。
 */
function chooseLocation(): void {
  uni.chooseLocation({
    success: (res) => {
      form.value.latitude = res.latitude
      form.value.longitude = res.longitude
      // 选点同时回填地址（用户仍可手改）
      if (res.address || res.name) form.value.address = `${res.address || ''}${res.name || ''}`.trim() || form.value.address
    },
    fail: (error) => {
      const message = String((error as { errMsg?: string })?.errMsg || '')
      if (!/cancel/i.test(message)) uni.showToast({ title: '选择位置失败，请检查定位授权', icon: 'none' })
    },
  })
}

/** 门店图片：选图 → 上传 → 回填 URL（与入驻页同一套 `/api/common/upload` 通道）。 */
function chooseImage(): void {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    success: async (res) => {
      const filePath = res.tempFilePaths?.[0]
      if (!filePath) return
      uploading.value = true
      try {
        form.value.shopImage = await uploadFile(filePath)
        uni.showToast({ title: '门店图片已上传', icon: 'success' })
      } catch (error) {
        uni.showToast({ title: error instanceof Error ? error.message : '上传失败', icon: 'none' })
      } finally {
        uploading.value = false
      }
    },
  })
}

/** 提交新建门店。 */
async function submit(): Promise<void> {
  if (!form.value.name.trim()) { uni.showToast({ title: '请输入门店名称', icon: 'none' }); return }
  if (!form.value.address.trim()) { uni.showToast({ title: '请输入门店地址', icon: 'none' }); return }
  if (form.value.latitude == null || form.value.longitude == null) {
    uni.showToast({ title: '请先在地图上选择门店位置（必填）', icon: 'none' })
    return
  }
  submitting.value = true
  try {
    await createMerchantShop({
      name: form.value.name.trim(),
      address: form.value.address.trim(),
      phone: form.value.phone.trim() || undefined,
      openTime: form.value.openTime.trim() || undefined,
      shopImage: form.value.shopImage || undefined,
      latitude: form.value.latitude,
      longitude: form.value.longitude,
    })
    // ⚠️ 新门店**默认还不能同城配送**：C 端结算页的「发货门店」列表来自 `/api/shop/deliverable`，
    // 它按「该门店已上架这些商品（shop_product.status=1）」+ 门店启用状态筛选；
    // 新门店的同城配送规则默认是关闭的，必须去后台开启，否则用户下单时选不到这家店。
    uni.showModal({
      title: '门店已创建',
      content: '新门店默认还不能同城配送：请到「配送工作台」开启该店的配送规则，并把商品上架到该门店；'
        + '之后用户端结算页的「发货门店」才会出现它。',
      showCancel: false,
      confirmText: '知道了',
    })
    formVisible.value = false
    await loadShops()
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '创建失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

/** 启用 / 停用门店（停用后 C 端下单不可选该店，故先二次确认）。 */
async function toggleStatus(shop: MerchantShopVO): Promise<void> {
  const next: 0 | 1 = Number(shop.shopStatus) === 1 ? 0 : 1
  const tip = next === 1
    ? `确认启用「${shop.shopName}」？启用后 C 端下单可选该门店。`
    : `确认停用「${shop.shopName}」？停用后 C 端下单不可选该门店。`
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: next === 1 ? '启用门店' : '停用门店',
      content: tip,
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
  if (!confirmed) return
  actingId.value = shop.shopId
  try {
    await updateMerchantShopStatus(shop.shopId, next)
    uni.showToast({ title: next === 1 ? '已启用' : '已停用', icon: 'success' })
    await loadShops()
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
  } finally {
    actingId.value = 0
  }
}

/** 返回上一页。 */
function goBack(): void {
  uni.navigateBack()
}

onLoad(() => {
  const info = uni.getSystemInfoSync()
  statusBarHeight.value = info.statusBarHeight || 0
  void loadShops()
})

onPullDownRefresh(async () => {
  await loadShops()
  uni.stopPullDownRefresh()
})
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <!-- 自定义导航栏：本页 navigationStyle=custom，需自行避开状态栏 -->
    <view class="nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">门店管理</text>
      </view>
    </view>

    <view class="body">
      <!-- 新建门店 -->
      <view class="card">
        <view class="card-head" @click="toggleForm">
          <text class="card-title">新建门店</text>
          <text class="card-toggle">{{ formVisible ? '收起 ˄' : '展开 ˅' }}</text>
        </view>
        <template v-if="formVisible">
          <label class="field"><text class="field-label">门店名称 *</text><input v-model="form.name" class="field-input" placeholder="请输入门店名称" /></label>
          <label class="field"><text class="field-label">门店地址 *</text><input v-model="form.address" class="field-input" placeholder="选点后自动回填，可微调" /></label>
          <view class="field">
            <text class="field-label">门店定位 *</text>
            <button class="ghost-btn" @click="chooseLocation">{{ form.latitude == null ? '在地图上选择位置' : '重新选择位置' }}</button>
            <text v-if="form.latitude != null" class="field-ok">已选：{{ form.longitude }}, {{ form.latitude }}</text>
            <text v-else class="field-hint">必填。缺坐标的门店用户下单时不可配送。</text>
          </view>
          <label class="field"><text class="field-label">联系电话</text><input v-model="form.phone" class="field-input" type="number" maxlength="11" placeholder="选填，订单通知短信用" /></label>
          <label class="field"><text class="field-label">营业时间</text><input v-model="form.openTime" class="field-input" placeholder="如：06:00-23:00（选填）" /></label>
          <view class="field">
            <text class="field-label">门店图片</text>
            <view class="image-row">
              <image v-if="form.shopImage" class="shop-image" :src="form.shopImage" mode="aspectFit" @click="chooseImage" />
              <button class="ghost-btn" :disabled="uploading" @click="chooseImage">{{ uploading ? '上传中…' : (form.shopImage ? '重新上传' : '上传门店图片') }}</button>
            </view>
            <text class="field-hint">门头或店内实拍，建议 690×345、小于 2MB。</text>
          </view>
          <button class="primary-btn" :disabled="submitting" @click="submit">{{ submitting ? '提交中…' : '创建门店' }}</button>
        </template>
      </view>

      <!-- 门店列表 -->
      <view class="card">
        <view class="card-head"><text class="card-title">我的门店</text><text class="card-count">{{ shops.length }} 家</text></view>
        <text v-if="loading" class="tip">加载中…</text>
        <text v-else-if="!shops.length" class="tip">暂无门店，可展开上方「新建门店」创建</text>
        <view v-for="shop in shops" :key="shop.shopId" class="shop-item">
          <view class="shop-row">
            <text class="shop-name">{{ shop.shopName }}</text>
            <text class="shop-status" :class="Number(shop.shopStatus) === 1 ? 'is-on' : 'is-off'">{{ statusLabel(shop) }}</text>
          </view>
          <view class="shop-stats">
            <text class="stat">店长 {{ shop.managerCount ?? 0 }}</text>
            <text class="stat">骑手 {{ shop.riderCount ?? 0 }}</text>
            <text class="stat">绑定微信 {{ shop.boundUserCount ?? 0 }}</text>
          </view>
          <view class="shop-actions">
            <text class="shop-id">ID {{ shop.shopId }}</text>
            <button class="ghost-btn small" :disabled="actingId === shop.shopId" @click="toggleStatus(shop)">
              {{ Number(shop.shopStatus) === 1 ? '停用' : '启用' }}
            </button>
          </view>
        </view>
      </view>

      <!-- 新建门店后的必做事项：不是漏做，是链路要求 -->
      <view class="card note-card">
        <text class="note-title">新门店为什么在用户端选不到？</text>
        <text class="note-text">
          用户端结算页的「发货门店」由可配送门店接口筛选，条件有两层：
          ① 该门店已把这些商品上架（门店商品关系为启用）；② 该门店已启用同城配送规则。
          新门店两者默认都没开，所以只建店是不够的 —— 还要去后台开启该店配送规则、并把商品上架到该店。
        </text>
      </view>

      <!-- 编辑能力的说明：不是漏做 -->
      <view class="card note-card">
        <text class="note-title">为什么没有「编辑门店」</text>
        <text class="note-text">
          后端门店列表返回的是账号口径数据（不含地址/图片/营业时间），且单店接口目前只有修改、没有查询
          ⇒ 无法回填已有信息。需要修改门店资料请到平台后台，或等后端补上单店查询接口。
        </text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; box-sizing: border-box; background: #f5f6f8; }
.nav { position: fixed; top: 0; right: 0; left: 0; z-index: 20; background: #f5f6f8; }
.nav-inner { position: relative; display: flex; align-items: center; height: 44px; padding: 0 24rpx; }
.nav-back { display: flex; align-items: center; height: 88rpx; width: 56rpx; color: #1d2129; font-size: 46rpx; line-height: 1; }
.nav-title { color: #1d2129; font-size: 34rpx; font-weight: 600; }
.body { padding: 24rpx; }
.card { margin-bottom: 24rpx; padding: 28rpx; border-radius: 20rpx; background: #fff; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.card-title { color: #1d2129; font-size: 32rpx; font-weight: 700; }
.card-toggle { color: #ff5500; font-size: 26rpx; }
.card-count { color: #86909c; font-size: 26rpx; }
.tip { display: block; padding: 40rpx 0; color: #86909c; font-size: 27rpx; text-align: center; }
.field { display: block; margin-top: 24rpx; }
.field-label { display: block; margin-bottom: 10rpx; color: #4e5969; font-size: 26rpx; }
.field-input { width: 100%; height: 88rpx; padding: 0 24rpx; box-sizing: border-box; border: 1rpx solid #e5e6eb; border-radius: 16rpx; background: #fafbfc; color: #1d2129; font-size: 28rpx; }
.field-hint { display: block; margin-top: 10rpx; color: #86909c; font-size: 24rpx; line-height: 34rpx; }
.field-ok { display: block; margin-top: 10rpx; color: #12a150; font-size: 25rpx; }
.image-row { display: flex; align-items: center; gap: 20rpx; }
.shop-image { width: 180rpx; height: 180rpx; border-radius: 16rpx; background: #f2f3f5; }
.ghost-btn { margin: 0; border-radius: 16rpx; background: #f2f3f5; color: #1d2129; font-size: 28rpx; line-height: 80rpx; }
.ghost-btn.small { padding: 0 28rpx; line-height: 60rpx; font-size: 26rpx; }
.primary-btn { margin-top: 32rpx; border-radius: 44rpx; background: linear-gradient(135deg, #ffb341 0%, #ff5500 100%); color: #fff; font-size: 30rpx; line-height: 88rpx; }
.primary-btn[disabled] { opacity: .6; }
.shop-item { padding: 24rpx 0; border-bottom: 1rpx solid #f2f4f7; }
.shop-item:last-of-type { border-bottom: none; }
.shop-row { display: flex; align-items: center; justify-content: space-between; }
.shop-name { color: #1d2129; font-size: 30rpx; font-weight: 600; }
.shop-status { font-size: 25rpx; }
.shop-status.is-on { color: #12a150; }
.shop-status.is-off { color: #e0432a; }
.shop-stats { display: flex; gap: 24rpx; margin-top: 12rpx; }
.stat { color: #86909c; font-size: 24rpx; }
.shop-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 16rpx; }
.shop-id { color: #c9cdd4; font-size: 23rpx; }
.note-card { background: #f7f8fa; }
.note-title { display: block; margin-bottom: 10rpx; color: #4e5969; font-size: 27rpx; font-weight: 600; }
.note-text { color: #86909c; font-size: 25rpx; line-height: 38rpx; }
</style>
