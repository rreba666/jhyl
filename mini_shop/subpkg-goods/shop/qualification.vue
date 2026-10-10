<script setup lang="ts">
/**
 * C 端 · 店铺**经营资质**页（`subpkg-goods/shop/qualification?shopId=…`）。
 *
 * ## 设计来源（先说清楚：**Figma 里没有这张页面**）
 * 2026-10-10 把 Figma 文件（`ynZyYMhhYbCvlgFwMik6LL`）「店铺」页整棵节点树按
 * 「资质 / 营业执照 / 许可证 / 证照」四个词递归扫了一遍，**只命中店铺页那条入口本身**
 * （`店铺_首页_两项` 的 `查看经营资质` 88×20），没有对应画板；`组件` / `草稿` 两页也没有。
 * ⇒ 页面排版按用户提供的**真实小程序参考页**（别家店铺的「经营资质」）：
 *   标题「经营资质」→ 行「商家店铺名称」→ 行「商家主体」→ 分隔 →
 *   「网店营业执照信息公示如下：」+ 执照图 + 说明 →
 *   「网店食品经营许可证信息公示如下：」+ 许可证图 →（可能还有更多证照区块）。
 *
 * ## ⚠️ 数据现实（2026-10-10 复核 `api_doc.json` + dev `/v3/api-docs` + 真实响应）
 * 契约里**只有两项**能接（都来自本页唯一的数据源 `GET /api/shop/{shopId}` → `ShopVO`）：
 * | 页面元素 | 字段 | 实测 |
 * |---|---|---|
 * | 商家店铺名称 | `ShopVO.name` | ✅ 有值 |
 * | 商家主体 | `ShopVO.businessName`（契约注释「工商名称」） | ⚠️ 可空：`GET /api/shop/all` 14 家里只有 1 家填了 ⇒ 空时按「未公示」 |
 *
 * ⛔ **营业执照 / 食品经营许可证的图片，契约里没有门店级字段**：
 * - `licenseImage` 只存在于商户**入驻表单/审核**三处（`MerchantApplyDTO` / `MerchantApplyVO` /
 *   `AdminMerchantApplyVO`）—— 那是 B/C 端**商户自己的申请资料**，不是"这家店的公示证照"；
 * - `ThemeV2VO.companyName` / `businessLicenseNo` 是**平台运营方**（今华有礼）的主体信息
 *   （`GET /api/v2/setting/theme`，全站一份）⇒ 挂到某个门店名下就是**伪造归属**，一律不用。
 * ⇒ 图片区块走**诚实空态**「资质信息暂未公示」，**绝不**拿别家图/别的主体顶上。
 *   缺口与所需字段形状见 `docs/26/10.10/后端需求-店铺页数据缺口-2026-10-10.md`。
 *
 * ⚠️ **法律说明段只在真有执照图时才渲染**：那段话是「以上营业执照信息来源于卖家自行申报及
 *    工商系统数据…」，在没有图的时候显示它就成了**不实陈述** ⇒ 与图片同一个 `v-if` 分支。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getShopDetail, type EnabledShop } from '@/api/shop'
import { isApiRequestError } from '@/utils/request'

/**
 * 门店不存在的业务码（与店铺页同一口径：契约 §七 `8000` = 门店不存在（含停用/软删））。
 * ⚠️ 它是**业务码**（HTTP 仍是 200），由 `utils/request.ts` 转成 `ApiRequestError.code`。
 */
const SHOP_NOT_FOUND_CODE = 8000

/** 营业执照区块下方的法律说明（用户给的参考页原文；**只在有执照图时**渲染，见文件头）。 */
const LICENSE_NOTE = '以上营业执照信息来源于卖家自行申报及工商系统数据，具体以市场监管部门登记为准。'
  + '经营者需确保信息真实有效，平台也将定期核查。如与实际不符，为避免违规，请联系当地市场监管部门或平台客服更新。'

/** 一个证照区块（标题 + 图片 + 可选说明）。 */
interface QualificationSection {
  key: string
  heading: string
  images: string[]
  note?: string
}

const shopId = ref('')
const shop = ref<EnabledShop | null>(null)
const loading = ref(true)
/** 取数失败（网络/接口异常）——与「门店不存在」必须分开显示。 */
const errorMessage = ref('')
/** 门店**不存在 / 已停用 / 已被软删**（业务码 `8000`），或页面压根没带 `shopId`。 */
const shopUnavailable = ref(false)

/** 真实状态栏高度（px）；导航栏高度 = 状态栏 + 44（仓库既有口径）。 */
const statusBarHeight = ref(0)
const navHeight = computed(() => statusBarHeight.value + 44)

/** 商家店铺名称（真实数据；后端保证有值，仍按空串兜底避免渲染 `undefined`）。 */
const shopName = computed(() => String(shop.value?.name || '').trim())
/**
 * 商家主体 = `ShopVO.businessName`（工商名称）。
 * ⚠️ 为空时显示「未公示」——这是**如实的"没有"**，不是占位假数据；**不得**用 `merchantName`
 *    （品牌名，不是工商主体）或主题配置里的平台公司名顶替。
 */
const businessName = computed(() => String(shop.value?.businessName || '').trim())

/**
 * 证照区块列表。
 *
 * ⚠️ **`images` 恒为空数组**：`ShopVO` 里没有门店级证照图片字段（见文件头）。这里仍然把
 *    **结构**写出来，是为了 ① 页面骨架 = 用户给的参考页；② 后端补字段后只改这一个 computed
 *    （例如新增 `ShopVO.qualificationImages: string[]` 或 `businessLicenseImage` /
 *    `foodPermitImage`），模板与空态都不用动。
 */
const sections = computed<QualificationSection[]>(() => [
  { key: 'business-license', heading: '网店营业执照信息公示如下：', images: [], note: LICENSE_NOTE },
  { key: 'food-permit', heading: '网店食品经营许可证信息公示如下：', images: [] },
])

/**
 * 真正有图的区块。
 * ⚠️ 一个都没有时模板**不渲染各证照标题**（"公示如下"后面跟"暂未公示"是自相矛盾的），
 *    改为单块诚实空态 —— 见模板 `v-else`。
 */
const licenceSections = computed(() => sections.value.filter((section) => section.images.length > 0))

/** 返回上一级；没有历史页面时回首页。 */
function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1 })
    return
  }
  uni.switchTab({ url: '/pages/index/index' })
}

/** 点证照图放大查看（图片真到位后才会有调用方）。 */
function previewImage(images: string[], current: number): void {
  if (!images.length) return
  uni.previewImage({ urls: images, current })
}

onLoad(async (options) => {
  try {
    const info = uni.getSystemInfoSync()
    statusBarHeight.value = Number(info?.statusBarHeight) || 0
  } catch {
    // 非微信环境拿不到系统信息：退化为仅 44px 标题栏。
    statusBarHeight.value = 0
  }
  shopId.value = String(options?.shopId || '').trim()
  if (!shopId.value) {
    // 没带 shopId 就没法定位门店：如实说"门店不存在"，不编一个默认店。
    shopUnavailable.value = true
    loading.value = false
    return
  }
  try {
    shop.value = await getShopDetail(shopId.value)
  } catch (error) {
    // ⚠️ `8000` 是**独立状态**（门店不存在/停用），不是通用错误。
    if (isApiRequestError(error) && Number(error.code) === SHOP_NOT_FOUND_CODE) {
      shopUnavailable.value = true
    } else {
      errorMessage.value = error instanceof Error ? error.message : '资质信息加载失败'
    }
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <view class="qual-page">
    <!-- 导航栏：白底 + 深色标题（仓库既有的自定义导航口径：真实状态栏 + 44px）。 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px`, height: `${navHeight}px` }">
      <view class="nav-back" @click="goBack">
        <view class="nav-back-arrow" />
      </view>
      <text class="nav-title">经营资质</text>
    </view>

    <view class="qual-body" :style="{ paddingTop: `${navHeight}px` }">
      <view v-if="loading" class="page-state"><text>加载中...</text></view>
      <view v-else-if="errorMessage" class="page-state"><text>{{ errorMessage }}</text></view>
      <!-- ⚠️ `8000 SHOP_NOT_FOUND` 独立于通用错误：契约 §七 给的建议文案就是这句。 -->
      <view v-else-if="shopUnavailable" class="page-state"><text>店铺不存在或已停用</text></view>

      <template v-else>
        <!-- ① 主体信息：两项都来自 `GET /api/shop/{shopId}`（真实数据）。 -->
        <view class="qual-card">
          <view class="qual-row">
            <text class="qual-row-label">商家店铺名称</text>
            <text class="qual-row-value">{{ shopName }}</text>
          </view>
          <!-- 「商家主体」= `ShopVO.businessName`（工商名称）。为空时显示「未公示」＝如实的"没有"。 -->
          <view class="qual-row">
            <text class="qual-row-label">商家主体</text>
            <text class="qual-row-value" :class="{ 'qual-row-empty': !businessName }">{{ businessName || '未公示' }}</text>
          </view>
        </view>

        <!-- ② 证照区块：有图才渲染各证照标题 + 图 + 说明。 -->
        <template v-if="licenceSections.length">
          <view v-for="section in licenceSections" :key="section.key" class="qual-card">
            <text class="qual-section-title">{{ section.heading }}</text>
            <image
              v-for="(image, index) in section.images"
              :key="image"
              class="qual-image"
              :src="image"
              mode="widthFix"
              @click="previewImage(section.images, index)"
            />
            <!-- ⚠️ 法律说明与图片同分支：没有图就说"以上营业执照信息…"＝不实陈述。 -->
            <text v-if="section.note" class="qual-note">{{ section.note }}</text>
          </view>
        </template>
        <!-- ③ 诚实空态：契约里**没有**门店级证照字段（见文件头），所以只能说"暂未公示"。 -->
        <view v-else class="qual-card">
          <text class="qual-section-title">经营资质公示</text>
          <view class="qual-empty"><text class="qual-empty-text">资质信息暂未公示</text></view>
        </view>
      </template>
    </view>
  </view>
</template>

<style>
/* 页面底色取仓库既有的浅灰；标题栏白底深字（与店铺页那条渐变导航不同，本页是普通内容页）。 */
page { background: #F2F3F7; overflow-x: hidden; }
.qual-page { position: relative; min-height: 100vh; background: #F2F3F7; overflow-x: hidden; }

.nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: #FFFFFF; box-sizing: border-box; }
.nav-back { position: absolute; left: 0; bottom: 0; display: flex; align-items: center; width: 77rpx; height: 85rpx; padding-left: 31rpx; box-sizing: content-box; }
.nav-back-arrow { width: 17rpx; height: 17rpx; border-left: 4rpx solid #1D2129; border-bottom: 4rpx solid #1D2129; transform: rotate(45deg); }
.nav-title { max-width: 420rpx; overflow: hidden; color: #1D2129; font-size: 33rpx; font-weight: 600; line-height: 46rpx; white-space: nowrap; text-overflow: ellipsis; }

.qual-body { padding-bottom: 40rpx; }
.page-state { padding: 200rpx 32rpx; color: #86909C; text-align: center; font-size: 26rpx; }

/* 卡片：白底、圆角 12、左右外边距 12（与仓库其它内容页同款留白）。 */
.qual-card { margin: 23rpx; padding: 23rpx; border-radius: 23rpx; background: #FFFFFF; box-sizing: border-box; }

/* 信息行：左标签 / 右值，值可换行（工商名称可能较长）。 */
.qual-row { display: flex; align-items: flex-start; }
.qual-row + .qual-row { margin-top: 23rpx; }
.qual-row-label { flex: none; width: 180rpx; color: #86909C; font-size: 27rpx; line-height: 42rpx; }
.qual-row-value { flex: 1; min-width: 0; color: #1D2129; font-size: 27rpx; line-height: 42rpx; word-break: break-all; }
/* 未公示：与"有值"在视觉上区分开，避免把"没有"读成一个值。 */
.qual-row-empty { color: #86909C; }

/* 证照区块标题：14px/600，与下方内容间距 16。 */
.qual-section-title { display: block; color: #1D2129; font-size: 27rpx; font-weight: 600; line-height: 42rpx; }
/* 证照图：宽度撑满卡片，高度按比例（widthFix），点开可放大。 */
.qual-image { display: block; width: 100%; margin-top: 23rpx; border-radius: 12rpx; background: #F2F3F7; }
/* 法律说明：12px/行高 20，中性灰，与图片间距 16。 */
.qual-note { display: block; margin-top: 23rpx; color: #86909C; font-size: 23rpx; line-height: 38rpx; }

/* 诚实空态：居中灰字，与标题间距 16。 */
.qual-empty { display: flex; align-items: center; justify-content: center; padding: 60rpx 24rpx 40rpx; }
.qual-empty-text { color: #86909C; font-size: 26rpx; }
</style>
