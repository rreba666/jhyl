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
 * ## ⚠️ 数据现实（2026-10-10 **S4 第四轮重核**：门店级资质字段已经有了，本页渲染真实证照）
 * 契约里现在**有门店级资质字段**（`ShopVO`；`GET /api/shop/{shopId}` 与 `/api/shop/all` 都下发）：
 * | 页面元素 | 字段 | 说明 |
 * |---|---|---|
 * | 商家店铺名称 | `ShopVO.name` | ✅ 有值 |
 * | 商家主体 | `ShopVO.businessName`（契约注释「工商名称」） | ⚠️ 可空：`GET /api/shop/all` 14 家里只有 1 家填了 ⇒ 空时按「未公示」 |
 * | 营业执照编号 | `ShopVO.licenseNo` | ✅ 契约原文「营业执照编号（资质；C 端店铺页展示）」 |
 * | 营业执照图片 | `ShopVO.licenseImage` | ✅ 契约原文「营业执照图片 URL（资质；C 端店铺页展示）」 |
 * | 食品经营许可证编号 | `ShopVO.foodPermitNo` | ✅ 契约原文「食品经营许可证编号（资质；C 端店铺页展示）」 |
 * | 食品经营许可证图片 | `ShopVO.foodPermitImage` | ✅ 契约原文「食品经营许可证图片 URL（资质；C 端店铺页展示）」 |
 * | 许可证有效期至 | `ShopVO.foodPermitExpireDate`（`yyyy-MM-dd`） | ✅ 契约注「null = **未填或长期有效**」 |
 *
 * ⚠️ **第三轮写在这里的"契约里没有门店级证照字段、图片区块只能走诚实空态"已经不成立**
 *    —— 那是 S4 之前的契约快照（当时 `ShopVO` 无任何资质列）。
 *    那段推理本身（`licenseImage` 只存在于商户**入驻表单**、`ThemeV2VO.companyName` /
 *    `businessLicenseNo` 是**平台运营方**的主体 ⇒ 一律不得借来当某家店的公示证照）
 *    **仍然成立且已写进下面的禁止清单**，只是现在**有了门店自己的字段**，
 *    不需要再用"暂未公示"顶着 —— 有数据就渲染数据，没数据才空态。
 * ⚠️ **诚实空态必须保留、且按区块独立判断**：契约明写"当前线上门店**大多未录入**
 *    （值为 null ⇒ 被全局 `non_null` 省略）⇒ 前端请对缺失做**不渲染/占位**处理，不要显示空白框"。
 *    ⇒ 一家店只有营业执照、没有食品许可证时，就**只**显示营业执照那一段（另一段不占位、不留空框），
 *      两个都没有才是整页的「资质信息暂未公示」。
 * ⚠️ **图片与编号各自独立**：某店填了编号没传图（或反之）时，各自渲染自己有的那部分；
 *    **编号行不依赖图片**（编号是文本事实，不是图像声明）。
 * ⚠️ **有效期只在有值时才渲染**：契约把 `null` 同时定义为"未填"与"长期有效" ⇒ 前端**分不出来**
 *    ⇒ 不许写"长期有效"（那是替后端下结论），也不许写"已过期"（更糟）。没有值就不出现这一行。
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

/** 一个证照区块（标题 + 编号行 + 图片 + 可选说明 + 可选有效期）。 */
interface QualificationSection {
  key: string
  heading: string
  /** 证照编号（`licenseNo` / `foodPermitNo`）；契约里各自独立可空 ⇒ 空则不渲染该行。 */
  certNo?: string
  images: string[]
  note?: string
  /** 有效期至（只有食品经营许可证有；`yyyy-MM-dd`，null = 未填或长期有效 ⇒ 不渲染）。 */
  expireDate?: string
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
 * 证照区块列表（**真实字段驱动**，2026-10-10 S4）。
 *
 * ⚠️ 图片源**只认门店自己的字段**（`ShopVO.licenseImage` / `ShopVO.foodPermitImage`）：
 * 曾经（S4 之前）这里写死 `images: []`，理由是"门店级没有证照字段"；
 * 现在字段有了 ⇒ 改为读真实 URL。**依然禁止**用下面任一来源顶替（见 `qualification.contract` 的反向断言）：
 * - 商户**入驻表单**的 `licenseImage`（`MerchantApplyDTO` / `MerchantApplyVO` /
 *   `AdminMerchantApplyVO`）—— 那是**申请资料**，不是这家店的公示证照；
 * - 平台主题 `ThemeV2VO.companyName` / `businessLicenseNo`（`GET /api/v2/setting/theme`）——
 *   那是**平台运营方**的主体，挂到某家门店名下就是伪造归属。
 *
 * ⚠️ 每个字段都先 `trim` 再去空：后端下发空串（而非 null）时同样按"没有"处理
 *    —— 空字符串塞进 `<image :src>` 会渲染一个灰框（契约明确要求"不要显示空白框"）。
 */
const sections = computed<QualificationSection[]>(() => {
  const licenseImage = String(shop.value?.licenseImage || '').trim()
  const permitImage = String(shop.value?.foodPermitImage || '').trim()
  return [
    {
      key: 'business-license',
      heading: '网店营业执照信息公示如下：',
      certNo: String(shop.value?.licenseNo || '').trim(),
      // 有图才放图；`images` 为空 ⇒ 区块被判为"未公示"（见 `licenceSections`）。
      images: licenseImage ? [licenseImage] : [],
      // ⚠️ 法律说明段与图片**同分支**（这里把 note 挂在同一个区块上，模板再用 `v-if="section.note"`）：
      //    没有图却说"以上营业执照信息…"就是**不实陈述**。
      note: LICENSE_NOTE,
    },
    {
      key: 'food-permit',
      heading: '网店食品经营许可证信息公示如下：',
      certNo: String(shop.value?.foodPermitNo || '').trim(),
      images: permitImage ? [permitImage] : [],
      // 有效期（契约：`null` = 未填或长期有效 ⇒ 前端分不出来 ⇒ 没有值就整行不渲染）。
      expireDate: String(shop.value?.foodPermitExpireDate || '').trim(),
    },
  ]
})

/**
 * 真正**有图**的区块。
 * ⚠️ 判据是"有图"而**不是**"有编号"：法律说明段只对图片成立（"以上营业执照信息…"说的是那张图），
 *    而且契约给的展示口径就是"证照（图片）"，编号只是同一区块里的补充信息。
 * ⇒ 只有编号、没有图的店：该区块**不进** `licenceSections`（不渲染"公示如下"却没图），
 *    编号仍会出现在**没有图**时的那份诚实兜底里（见模板 `v-else` 的编号清单）。
 */
const licenceSections = computed(() => sections.value.filter((section) => section.images.length > 0))

/**
 * 既没图也**没编号** ⇒ 连"未公示"都不该按区块说，整页一句「资质信息暂未公示」。
 * （有编号时模板会把编号列出来 —— 那是**真有的事实**，比一句空态更有用。）
 */
const hasAnyCertNo = computed(() => sections.value.some((section) => Boolean(section.certNo)))

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

        <!-- ② 证照区块：**有图**才渲染该区块的标题 + 编号 + 图 + 说明
             （`licenceSections` 的判据是"有图"，见该 computed 注释）。 -->
        <template v-if="licenceSections.length">
          <view v-for="section in licenceSections" :key="section.key" class="qual-card">
            <text class="qual-section-title">{{ section.heading }}</text>
            <!-- 编号行（`licenseNo` / `foodPermitNo`）：契约里与图片**各自独立可空** ⇒ 有值才渲染。
                 编号是**文本事实**，不依赖图片是否存在。 -->
            <view v-if="section.certNo" class="qual-row qual-row-cert">
              <text class="qual-row-label">证照编号</text>
              <text class="qual-row-value">{{ section.certNo }}</text>
            </view>
            <!-- 有效期（只有食品经营许可证有）：契约 `null` = 未填**或**长期有效，前端分不出来
                 ⇒ 只有拿到具体日期才渲染，**不写"长期有效"也不写"已过期"**（都是替后端下结论）。 -->
            <view v-if="section.expireDate" class="qual-row qual-row-cert">
              <text class="qual-row-label">有效期至</text>
              <text class="qual-row-value">{{ section.expireDate }}</text>
            </view>
            <image
              v-for="(image, index) in section.images"
              :key="image"
              class="qual-image"
              :src="image"
              mode="widthFix"
              @click="previewImage(section.images, index)"
            />
            <!-- ⚠️ 法律说明与图片同分支（`section.note` 只在营业执照区块上、且该区块进到这里
                 就意味着有图）：没有图就说"以上营业执照信息…"＝**不实陈述**。 -->
            <text v-if="section.note" class="qual-note">{{ section.note }}</text>
          </view>
        </template>
        <!-- ③ 诚实空态（**保留**，契约明写线上门店大多还没录入资质）：
             · 完全没有证照图 —— 有编号就把编号如实列出来（那是真有的事实），并明说图片未公示；
               连编号都没有，才是干净的一句「资质信息暂未公示」。 -->
        <view v-else class="qual-card">
          <text class="qual-section-title">经营资质公示</text>
          <template v-if="hasAnyCertNo">
            <view v-for="section in sections.filter((item) => item.certNo)" :key="section.key" class="qual-row qual-row-cert">
              <text class="qual-row-label">{{ section.key === 'food-permit' ? '食品经营许可证' : '营业执照' }}</text>
              <text class="qual-row-value">{{ section.certNo }}</text>
            </view>
            <view class="qual-empty"><text class="qual-empty-text">证照图片暂未公示</text></view>
          </template>
          <view v-else class="qual-empty"><text class="qual-empty-text">资质信息暂未公示</text></view>
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
/* 证照区块里的编号/有效期行：与区块标题之间留白（与 `.qual-image` 的 margin-top 同档）。 */
.qual-row-cert { margin-top: 23rpx; }

/* 证照区块标题：14px/600，与下方内容间距 16。 */
.qual-section-title { display: block; color: #1D2129; font-size: 27rpx; font-weight: 600; line-height: 42rpx; }
/* 证照图：宽度撑满卡片，高度按比例（widthFix），点开可放大。
   ⚠️ 用相邻选择器给"图与上面内容"的间距：证照区块里图前面可能是标题、也可能是编号/有效期行
   （S4 起两行都可能出现），统一 23rpx 的区块内留白，且**不重复叠加**。 */
.qual-image { display: block; width: 100%; margin-top: 23rpx; border-radius: 12rpx; background: #F2F3F7; }
/* 法律说明：12px/行高 20，中性灰，与图片间距 16。 */
.qual-note { display: block; margin-top: 23rpx; color: #86909C; font-size: 23rpx; line-height: 38rpx; }

/* 诚实空态：居中灰字，与标题间距 16。 */
.qual-empty { display: flex; align-items: center; justify-content: center; padding: 60rpx 24rpx 40rpx; }
.qual-empty-text { color: #86909C; font-size: 26rpx; }
</style>
