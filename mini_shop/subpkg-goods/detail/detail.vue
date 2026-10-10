<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad, onShareAppMessage, onShow } from '@dcloudio/uni-app'
import { addSkuToCartWithStock } from '@/api/cart'
import { favoriteProduct, unfavoriteProduct } from '@/api/favorite'
import { getUserProfile, type UserProfile } from '@/api/user'
import { getProductDetail, type ProductDetail } from '@/api/product'
import { getAuth, isLoggedIn, isRegisteredUser } from '@/utils/auth'
import { bindStoredPromotionIfLoggedIn, buildPromotionSharePath, capturePromotionContext } from '@/utils/promotion'
import { getPromotionCode } from '@/api/promotion'
import { isApiRequestError } from '@/utils/request'
import { PURCHASE_LIMIT_ERROR_CODE, PURCHASE_LIMIT_MESSAGE } from '@/utils/dividend-limit'
// ⚠️ 2026-10-08 Step1/Step2/Step3：时效档位与「售后窗口」文案的**单一来源**
//    （同城按档位分叉、物流/自提与档位无关）。**不要在页面里另拼一份** —— 本批刚改过口径。
import { afterSaleTextsForProduct, isFreshTiming } from '@/utils/timing-category'
import PromotionCodePoster from '@/components/PromotionCodePoster.vue'
import LoginGuide from '@/components/LoginGuide.vue'
// ⚠️ 2026-10-08：`SkuSheet` 已挪回**主包** `components/goods/`（原因见该组件头部注释：
//    主包经 CDN 迁移后余量充足，主包 tabBar 页也要用它弹层）。分包页引用主包组件合法。
import SkuSheet from '@/components/goods/SkuSheet.vue'
// 2026-10-10 新增：商品详情页「进店卡片」（Figma 节点 `4029:5751`，主包组件，先例同 SkuSheet）。
import ShopEntryCard from '@/components/goods/ShopEntryCard.vue'
import { resolveProductShop, type EnabledShop } from '@/api/shop'

const menuTop = ref(0)
const menuHeight = ref(32)
const user = ref<UserProfile | null>(null)
const product = ref<ProductDetail | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const actionLoading = ref(false)
const paymentNavigationLoading = ref(false)
/** 当前商品是否已收藏（进页从详情 favorite 字段初始化）。 */
const favorite = ref(false)
/** 收藏操作进行中，防止连点重复请求。 */
const favoriteLoading = ref(false)
/** 分享抽屉（转发按钮弹出：推广码 / 分享好友）。 */
const shareSheetVisible = ref(false)
/** 推广码弹窗状态。 */
const promotionCodeVisible = ref(false)
const promotionCodeLoading = ref(false)
const promotionCodeUrl = ref('')
const loginGuideVisible = ref(false)

const navStyle = computed(() => ({ top: `${menuTop.value}px`, height: `${menuHeight.value}px` }))
const bodyTop = computed(() => menuTop.value + menuHeight.value + 10)

/** 合并主图和轮播图，去重后作为详情页顶部轮播数据。 */
const galleryImages = computed(() => {
  if (!product.value) return []
  return Array.from(new Set((product.value.images || []).filter(Boolean)))
})

/** 没有轮播图时使用商品主图作为静态封面，不把主图混入轮播序列。 */
const coverImage = computed(() => product.value?.mainImage || galleryImages.value[0] || '')

/**
 * 详情图列表（后端 `ProductDetailV2VO.detailImages` 下发的是 **OSS 直链数组**）。
 * ⚠️ 为空时**整块（标题 + 灰底容器）都不渲染**：`.detail-media` 有 `min-height: 520rpx` + 灰底，
 * 没有图时会留一块灰板，看起来就像"详情图没显示出来"（2026-09-22 用户反馈的观感问题之一）。
 */
const detailImageList = computed(() => (product.value?.detailImages || []).filter(Boolean))

/**
 * 该商品是否为「生鲜 · 鲜活易腐」档位（`timingCategory === 1`，2026-10-08 Step1/Step3）。
 *
 * ⚠️ 它是**商品属性**，但行为差异**只在同城配送单**体现 —— 所以下面只拿它决定
 *    「生鲜」标注与同城那条售后说明，**绝不能**用它去改物流/自提的窗口文案。
 */
const isFreshProduct = computed(() => isFreshTiming(product.value?.timingCategory))

/**
 * 「售后保障」条目（2026-10-08 Step3 §二 的表格）。
 *
 * 商品详情页**不知道用户最终选哪种配送方式**，所以按该商品**支持的每一种方式**如实列出窗口
 * （同城 / 物流 / 自提，后端三个开关各自独立，2026-09-29 起 `deliveryEnabled` 语义已收窄为"仅物流"）。
 * ⚠️ 文案全部取自 `@/utils/timing-category` 的单一来源，**不要在页面里再拼一份** ——
 *    本批（Step2）刚刚改过同城的起算点与档位分叉，硬编码的地方下次还会漂。
 */
const afterSaleRules = computed(() => afterSaleTextsForProduct(product.value))

/**
 * 加载失败的详情图 URL 集合。
 * 长图/超大图在部分机型与基础库上会加载失败（`@error` 不会冒泡，容易被误认为"后端没下发"），
 * 因此这里单独记下来给一句提示，并且**失败也允许点开**用微信原生预览看原图。
 * 不需要在商品切换时清空：详情页每次都是新的页面实例。
 */
const failedDetailImages = ref<Set<string>>(new Set())

function onDetailImageError(image: string): void {
  failedDetailImages.value = new Set(failedDetailImages.value).add(image)
  // ⚠️ 失败也必须标记「加载已结束」：否则骨架会常驻在裂图之上（看起来像"一直在加载"）。
  // 放在这里而不是模板里写两条语句 —— 小程序模板对行内多语句支持不可靠。
  detailSettled.value = new Set(detailSettled.value).add(image)
}

/**
 * 已「加载结束」的轮播图 URL 集合（2026-09-29 新增，图片加载体验优化）。
 *
 * 用途：加载期间在图片位置显示**骨架 + 扫光**（全局 `styles/motion.wxss` 的 `.skeleton-shimmer`），
 * 加载结束后收起骨架并让实图**淡入**（`.motion-image-in` + `.motion-image-loaded`）。
 *
 * ⚠️ 写法与 `failedDetailImages` 一致：**必须整体替换 Set**，reactive 的 Set 增删在小程序端不触发更新。
 * ⚠️ **加载失败也要记进来** —— 否则骨架会一直盖在图上（图裂了骨架却不消失，看起来像"永远在加载"）。
 * ⚠️ 不需要在商品切换时清空：详情页每次都是新的页面实例（同 `failedDetailImages`）。
 */
const gallerySettled = ref<Set<string>>(new Set())

/** 轮播图（或单图封面）加载结束（成功或失败都算）→ 收起骨架并淡入实图。 */
function onGalleryImageSettled(image: string): void {
  if (!image) return
  gallerySettled.value = new Set(gallerySettled.value).add(image)
}

/**
 * 轮播当前下标（2026-10-08 新增，点主图看大图要用）。
 *
 * ⚠️ `swiper` 带 `circular` ⇒ **不能**用渲染位置/滚动位置推断当前是第几张
 *    （下标会回绕），必须以 `@change` 事件里的 `detail.current` 为准 —— 它给的是
 *    `galleryImages` 里的**真实下标**（`0 … length - 1`）。
 */
const galleryIndex = ref(0)

/** 轮播切换 → 记录真实下标（`circular` 下唯一可靠来源，见上）。 */
function onGalleryChange(event: { detail?: { current?: number } }): void {
  const current = Number(event?.detail?.current)
  // 拿不到合法下标就保持原值：宁可沿用上一次，也不要跳回第一张。
  if (Number.isFinite(current) && current >= 0) galleryIndex.value = current
}

/**
 * 已「加载结束」的详情图 URL 集合（同上）。
 * ⚠️ 详情图是 `mode="widthFix"`，**加载前高度未知**，所以骨架只能给一个 `min-height` 占位，
 * 加载完图片把容器撑开 —— 这会有一次高度变化，但比"一片空白看不出在加载"要好。
 */
const detailSettled = ref<Set<string>>(new Set())

/** 详情图加载结束（成功或失败都算）→ 收起骨架并淡入。 */
function onDetailImageSettled(image: string): void {
  detailSettled.value = new Set(detailSettled.value).add(image)
}

/**
 * 点详情图 → 微信原生预览。
 * 长图在本页里是按宽度自适应的（`mode="widthFix"`），细节会被压得很小；
 * 原生预览支持双指缩放，是查看长图内容最可靠的方式（也是渲染失败时的兜底出口）。
 */
function previewDetailImage(index: number): void {
  const urls = detailImageList.value
  if (!urls.length) return
  uni.previewImage({ urls, current: urls[index] })
}

/**
 * 点主图 → 微信原生预览大图（2026-10-08 新增，与上面的详情图预览同一条路径）。
 *
 * ⚠️ 当前图**不能**用位置推断：轮播带 `circular`，渲染位置会回绕 ⇒ 下标一律取
 *    `@change` 维护的 `galleryIndex`；万一越界（列表变化）退回第一张 ——
 *    宁可给一张，也不要「点了没反应」。
 */
function previewGalleryImage(): void {
  const urls = galleryImages.value
  if (!urls.length) return
  const current = urls[galleryIndex.value] || urls[0]
  uni.previewImage({ urls, current })
}

/**
 * 点单图兜底封面 → 预览（`galleryImages` 为空时才走这一支）。
 *
 * ⚠️ 这里**只能**传 `coverImage` 这一张：此分支下 `galleryImages` 必为空，
 *    拿它去预览等于点了没反应。（模板里也不写数组字面量 —— 小程序事件表达式的
 *    取值机制对字面量支持最差，宁可多一个零参函数。）
 */
function previewCoverImage(): void {
  const url = coverImage.value
  if (!url) return
  uni.previewImage({ urls: [url], current: url })
}

/**
 * 默认选择第一个可用 SKU，详情页暂按该 SKU 进行加购和立即支付。
 *
 * ⚠️ 2026-09-30 加固：`?.` 原先只护到 `product.value`，**没有护 `skuList`** ——
 * 后端惯用 `null` 表示"无数据"，一旦 `skuList` 为 `null`，`.find` 会抛 TypeError，
 * 而这里是 `computed` ⇒ **整个商品详情页渲染崩溃（白屏）**。
 * 同项目 `api/cart.ts` 早已用 `skuList?.`，此处属漏网。
 */
const selectedSku = computed(() => product.value?.skuList?.find((sku) => sku.enabled !== 0) || product.value?.skuList?.[0])

/** 展示价格：从「SKU 划线价 → SKU 售价 → 商品最低价」中取第一个大于 0 的值（0 视为未设置，不能当价格用）。 */
const displayPrice = computed(() => {
  const candidates = [selectedSku.value?.originalPrice, selectedSku.value?.price, product.value?.minPrice]
  const hit = candidates.find((value) => Number(value) > 0)
  return Number(hit ?? 0)
})

/** 展示推广资金，整数金额不显示多余的小数位。 */
const promotionFundText = computed(() => formatAmount(product.value?.promotionFund || 0))

/** 仅在后端明确启用推广资金且金额有效时展示推广区域。 */
const promotionVisible = computed(() => {
  const enabled = product.value?.promotionEnabled
  return isRegisteredUser(user.value?.identity)
    && (enabled === 1 || enabled === '1' || enabled === true)
    && Number(product.value?.promotionFund || 0) > 0
})

/** 将金额格式化为设计稿使用的紧凑形式。 */
function formatAmount(value: number): string {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '')
}

/**
 * 「进店卡片」的门店（2026-10-10 新增，设计节点 `4029:5751`）。
 *
 * ⚠️ **拿不到就不出卡片** —— 这是刻意的 fail-closed：`ProductDetailV2VO` **没有** `shopId`
 * （只有 B 端语义的 `merchantId`；`shopIds` 是 B 端回填字段，2026-10-10 实测 C 端响应里
 * **根本没有这个键**），所以门店只能靠 `resolveProductShop()` 另行解析，规则是
 * 「该商品的全部 SKU 能被**唯一一家**门店全部提供」才认（见 `api/shop.ts` 的完整说明
 * 与 `docs/26/10.09/店铺页-Figma实现说明-2026-10-09.md` §4.3 第 2 条）。
 * ⇒ 解析不出（0 家 / 多家 / 接口抖动）时保持 `null`，`ShopEntryCard` 整块不渲染，
 *   **绝不用猜出来的 id 跳转**（多门店商品该进哪家，产品口径未定：实现说明 §5 第 11/16 条）。
 */
const shopEntryShop = ref<EnabledShop | null>(null)

/** 进店卡片与上方「价格/标题/标签」区之间的间距（自定义组件外边距只能内联传，见模板注释）。 */
const SHOP_ENTRY_GAP = '20rpx'

/** 解析当前商品所属门店；异常与"不唯一"一律落回 `null`（不打扰用户，见上）。 */
async function loadShopEntry(): Promise<void> {
  const detail = product.value
  if (!detail) return
  const skuIds = (detail.skuList || []).map((sku) => sku.id)
  shopEntryShop.value = await resolveProductShop(skuIds, detail.merchantId)
}

/** 点「进店」→ 进店铺页；id 由卡片（= 已解析出的真实门店）给出，这里再挡一次空值。 */
function onEnterShop(shopId: number): void {
  const id = String(shopId ?? '').trim()
  if (!id) return
  uni.navigateTo({ url: `/subpkg-goods/shop/index?shopId=${encodeURIComponent(id)}` })
}

/** 读取页面参数并加载商品详情。 */
onLoad(async (options) => {
  capturePromotionContext(options as Record<string, unknown>)
  void bindStoredPromotionIfLoggedIn()
  if (!options?.id) {
    errorMessage.value = '商品参数缺失'
    loading.value = false
    return
  }
  // 商品详情是公开接口，先启动商品请求，避免用户资料接口阻塞游客首屏。
  const productRequest = getProductDetail(String(options.id))
  const profileRequest = isLoggedIn()
    ? getUserProfile().catch(() => null)
    : Promise.resolve(null)
  try {
    product.value = await productRequest
    favorite.value = Boolean(product.value.favorite)
    // 进店卡片与用户资料并行取（卡片是可选增强块，不阻塞首屏）。
    void loadShopEntry()
    user.value = await profileRequest
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '商品详情加载失败'
  } finally {
    loading.value = false
  }
})


/** 商品详情原生转发保留商品 ID，并附带当前推广者身份。 */
onShareAppMessage(() => {
  const productId = product.value?.id
  const path = productId ? `/subpkg-goods/detail/detail?id=${encodeURIComponent(String(productId))}` : '/pages/index/index'
  return { title: product.value?.name || '商品详情', path: buildPromotionSharePath(path) }
})

/** 返回上一级页面，没有历史页面时回到首页。 */
function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1 })
    return
  }
  uni.switchTab({ url: '/pages/index/index' })
}

/** 返回购物车 TabBar 页面。 */
function goCart(): void {
  uni.switchTab({ url: '/pages/cart/cart' })
}

/** 切换收藏状态：已收藏→取消，未收藏→收藏。 */
async function toggleFavorite(): Promise<void> {
  if (!product.value || favoriteLoading.value) return
  if (!isLoggedIn()) {
    loginGuideVisible.value = true
    return
  }
  favoriteLoading.value = true
  try {
    if (favorite.value) {
      await unfavoriteProduct(product.value.id)
      favorite.value = false
    } else {
      await favoriteProduct(product.value.id)
      favorite.value = true
    }
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
  } finally {
    favoriteLoading.value = false
  }
}

/**
 * 可用规格（`enabled !== 0`，与规格弹层同口径）。
 *
 * ⚠️ 2026-10-08 修（用户反馈「下单没有出现 SKU 弹层」）：此前本页**默认取第一个可用 SKU
 * 直接加购/立即购买**（历史注释原文：「默认选择第一个可用 SKU，详情页暂按该 SKU 进行加购和立即支付」）
 * ⇒ 多规格商品（950ml / 550ml / 330ml）用户**根本没法选规格**，下单的永远是列表第一个，
 * 甚至与页面上展示的价格不是同一个规格。现在**加购/立即购买必须先过规格弹层**。
 */
const availableSkus = computed(() => (product.value?.skuList || []).filter((sku) => Number(sku.enabled) !== 0))

/**
 * 规格弹层开关：**单规格也要弹**（2026-10-08 用户反馈「单规格商品没有这个弹框，导致如果要买多个
 * 的话需要去购物车加减，很不方便，所以单规格商品也需要这个弹框」）。
 *
 * ⚠️ 此前**只有多于一个可用规格时**才弹层：单规格走「不加询问、固定 1 件」的快捷执行 ——
 *    单规格商品想买多件只能先加购 1 件、再去购物车改数量。现在**加购与立即购买一律进弹层**：
 *    弹层为单规格商品渲染唯一一个规格 chip 并默认选中、数量默认 1，用户可在弹层里步进到该规格的
 *    库存上限；确认后按弹层给出的数量执行（加购 / 立即购买）= 「原来的动作 + 用户选定的数量」。
 * ⚠️ 库存校验仍在：弹层里缺货规格不可选、确认按钮 `disabled`，且 `doAddToCart` 照旧把该规格
 *    `stock` 交给 `addSkuToCartWithStock` 做二次校验（本页不新增任何请求/字段）。
 */
const skuSheetVisible = ref(false)

/**
 * 加购 / 立即购买的统一入口：**一律先弹层**选规格与数量（单规格商品同样进弹层）。
 *
 * ⚠️ 弹层里同时给「加入购物车 / 立即购买」两个按钮（用户可以在弹层里改主意，与主流电商一致），
 * 所以这里**不记忆"用户先点了哪个"** —— 只负责把弹层打开。
 * ⚠️ 保留原有的「无可用规格」阻断（全部禁用 / `skuList` 为 `null`）：弹层里没有任何可选规格，
 *    进去只会提示「请选择规格」，就地给一句「商品库存不足」与改动前的行为一致。
 */
function onTradeAction(): void {
  if (!product.value || actionLoading.value || paymentNavigationLoading.value) return
  if (!isLoggedIn()) {
    loginGuideVisible.value = true
    return
  }
  if (!availableSkus.value.length) {
    uni.showToast({ title: '商品库存不足', icon: 'none' })
    return
  }
  // 单规格与多规格**一律弹层**（单规格时弹层只渲染一个 chip 并默认选中，数量由用户步进）。
  skuSheetVisible.value = true
}

/** 规格弹层确认：按用户在弹层里点的动作执行（数量由弹层给出）。 */
function onSkuConfirm(payload: { action: 'cart' | 'buy'; sku: { id: string; price: number; stock: number }; quantity: number }): void {
  skuSheetVisible.value = false
  if (payload.action === 'cart') void doAddToCart(payload.sku, payload.quantity)
  else doBuyNow(payload.sku, payload.quantity)
}

/** 将指定规格按指定数量加入购物车。 */
async function doAddToCart(sku: { id: string; price: number; stock: number }, quantity: number): Promise<void> {
  if (!product.value) return
  actionLoading.value = true
  try {
    await addSkuToCartWithStock({
      productId: Number(product.value.id),
      skuId: Number(sku.id),
      stock: Number(sku.stock),
      quantity,
      dividendEnabled: product.value.dividendEnabled,
      price: Number(sku.price),
    })
    uni.showToast({ title: '已加入购物车', icon: 'success' })
  } catch (error) {
    uni.showToast({
      title: isApiRequestError(error) && error.code === 3001
        ? '库存不足'
        : isApiRequestError(error) && error.code === PURCHASE_LIMIT_ERROR_CODE
          ? PURCHASE_LIMIT_MESSAGE
          : (error instanceof Error ? error.message : '加入购物车失败'),
      icon: 'none',
    })
  } finally {
    actionLoading.value = false
  }
}

/** 立即购买：跳转确认订单页，由支付页按 skuId 直接下单（items），不污染购物车。 */
function doBuyNow(sku: { id: string; stock: number }, quantity: number): void {
  if (!product.value || paymentNavigationLoading.value) return
  if (!sku?.id || Number(sku.stock) <= 0) {
    uni.showToast({ title: '暂无可购买规格', icon: 'none' })
    return
  }
  paymentNavigationLoading.value = true
  uni.navigateTo({
    url: `/subpkg-order/payment/payment?productId=${product.value.id}&skuId=${sku.id}&quantity=${quantity}`,
    fail: (error) => {
      paymentNavigationLoading.value = false
      uni.showToast({ title: error?.errMsg || '打开确认订单失败', icon: 'none' })
    },
  })
}

/** 加入购物车（template 绑定入口）：一律先弹层选规格与数量。 */
function addProductToCart(): void {
  onTradeAction()
}

/** 立即购买（template 绑定入口）：一律先弹层选规格与数量。 */
function buyNow(): void {
  onTradeAction()
}

/** 打开分享抽屉。 */
function openShareSheet(): void {
  shareSheetVisible.value = true
}

/** 关闭分享抽屉。 */
function closeShareSheet(): void {
  shareSheetVisible.value = false
}

/** 生成并展示带当前推广者身份的小程序码（扫码进入首页后自动绑定关系）。 */
async function openPromotionCode(): Promise<void> {
  shareSheetVisible.value = false
  if (promotionCodeLoading.value) return
  if (!isLoggedIn() || !getAuth()?.userId) {
    loginGuideVisible.value = true
    return
  }
  promotionCodeLoading.value = true
  promotionCodeVisible.value = true
  try {
    promotionCodeUrl.value = await getPromotionCode()
    if (!promotionCodeUrl.value) throw new Error('推广码地址为空')
  } catch (error) {
    promotionCodeVisible.value = false
    uni.showToast({ title: error instanceof Error ? error.message : '推广码生成失败', icon: 'none' })
  } finally {
    promotionCodeLoading.value = false
  }
}

/** 获取胶囊按钮位置，让自定义返回按钮与系统导航区域对齐。 */
onMounted(() => {
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect) {
      menuTop.value = rect.top
      menuHeight.value = rect.height
    }
  } catch {
    // 非微信环境没有胶囊按钮，使用默认导航尺寸。
  }
})

onShow(() => {
  // 从确认订单页返回时允许再次购买。
  paymentNavigationLoading.value = false
})
</script>

<template>
  <view class="detail-page">
    <view class="nav" :style="navStyle">
      <image class="back-button" src="/static/left_arrow.png" mode="aspectFit" @click="goBack" />
    </view>

    <scroll-view class="detail-scroll" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false" :style="{ paddingTop: `${bodyTop}px` }">
      <view v-show="loading" class="state">加载中...</view>
      <view v-show="!loading && errorMessage" class="state error">{{ errorMessage }}</view>

      <view v-show="!loading && !errorMessage && product" class="product-body">
        <swiper v-if="galleryImages.length" class="gallery" circular indicator-dots @change="onGalleryChange">
          <swiper-item v-for="image in galleryImages" :key="image">
            <!-- ⚠️ 每张轮播图各自持有一层骨架：`.gallery` 高度固定（100vw）⇒ 骨架不引起任何布局跳动。
                 加载结束（成功或失败）才收起骨架并让实图淡入（见 onGalleryImageSettled）。
                 ⚠️ 点图看大图：`circular` 下当前下标只能来自 `@change`，预览打开的是 `galleryIndex` 记下的那一张。 -->
            <view class="gallery-slide">
              <view v-if="!gallerySettled.has(image)" class="gallery-skeleton skeleton-shimmer" />
              <image
                class="gallery-image motion-image-in"
                :class="{ 'motion-image-loaded': gallerySettled.has(image) }"
                :src="image"
                mode="aspectFill"
                @click="previewGalleryImage()"
                @load="onGalleryImageSettled(image)"
                @error="onGalleryImageSettled(image)"
              />
            </view>
          </swiper-item>
        </swiper>
        <view v-else class="gallery gallery-single">
          <view v-if="!gallerySettled.has(coverImage)" class="gallery-skeleton skeleton-shimmer" />
          <!-- ⚠️ 单图兜底只传 `coverImage` 这一张：此处 `galleryImages` 必为空，传它等于点了没反应。 -->
          <image
            class="gallery-image motion-image-in"
            :class="{ 'motion-image-loaded': gallerySettled.has(coverImage) }"
            :src="coverImage"
            mode="aspectFill"
            @click="previewCoverImage()"
            @load="onGalleryImageSettled(coverImage)"
            @error="onGalleryImageSettled(coverImage)"
          />
        </view>

        <view class="summary">
          <text class="price">¥{{ formatAmount(displayPrice) }}</text>
          <view class="title-row">
            <text class="name">{{ product?.name }}</text>
            <view class="title-icons">
              <image class="title-icon" :src="favorite ? '/static/ProductDetails/已收藏_slices/已收藏.png' : '/static/ProductDetails/收藏_slices/收藏.png'" mode="aspectFit" @click="toggleFavorite" />
              <image class="title-icon" src="/static/ProductDetails/分享_slices/分享.png" mode="aspectFit" @click="openShareSheet" />
            </view>
          </view>
          <text class="description">{{ product?.description || product?.descriptionTitle || '' }}</text>

          <view v-show="promotionVisible" class="promotion-row">
            <text class="promotion-label">分享本商品成功可得</text>
            <text class="promotion-value">{{ promotionFundText }}</text>
            <text class="promotion-label">推广金</text>
          </view>

          <view class="tag-row">
            <view class="tag"><image class="tag-icon" src="/static/ProductDetails/包邮_slices/包邮.png" mode="aspectFit" /><text>包邮</text></view>
            <!-- ⚠️ 2026-10-08 Step3（**保留不给生鲜挂这枚标签**，用户已确认选项 A）：
                 生鲜·鲜活易腐商品**法定不适用七日无理由退货** ——
                 《消费者权益保护法》第二十五条（"根据商品性质不宜退货"经消费者确认可不适用）
                 +《网络购买商品七日无理由退货暂行办法》第二十条明确把「鲜活易腐的」列为**不适用**情形
                 ⇒ 而这枚标签的图标本身就是「7」字盾牌、文字就是「七天无理由」，
                   给生鲜挂上它 = 向用户**承诺一项法律上并不存在的权利**，属于违规承诺。
                   故：生鲜不渲染它（改由下方「售后保障」块如实给出该商品真正的窗口）。

                 ⚠️⚠️ 关键区分（别把两件事当成一件）：**「七天无理由」是法定"无理由退货权"**，
                    而下面的售后窗口（物流 7 天 / 同城普通 7 天 / **同城生鲜 48 小时** / 自提 30 天）
                    是**售后申请时限**（有理由：质量问题、少发错发等），两者**正交、互不推导**。
                    ⇒ 生鲜商品**去掉这枚标签**，与售后保障块里那行
                      「确认收货/完成的次日 0 点起 7 天内可申请售后」（物流，W8 §5 新口径；
                      文案本身取自 `utils/timing-category.ts` 的常量，这里只是引用，**不要硬编码**）
                      **并不矛盾**：那行讲的是"能申请售后"，
                      这枚标签讲的是"能无理由退货"。生鲜仍是"可申请售后"的，只是不能"无理由"。

                 ⚠️ 非生鲜商品**必须保留**这枚标签（物流/自提/同城普通的 7 天窗口与它一致）。
                 ⚠️ 该守卫只作用于**这一枚**标签：判据 `isFreshProduct` 只读商品档位
                    （`timingCategory`，见 script 里 `isFreshProduct` 的定义），**与配送方式无关**，不依赖 `pickupType`；
                    同一 `tag-row` 里的「包邮」标签（上一行，无 `v-if`）不受影响。 -->
            <view v-if="!isFreshProduct" class="tag"><image class="tag-icon" src="/static/ProductDetails/七天无理由_slices/七天无理由.png" mode="aspectFit" /><text>七天无理由</text></view>
          </view>
        </view>

        <!-- 进店卡片（2026-10-10 新增，Figma 节点 `4029:5751`「详情页进店卡片」）：
             设计只给了**独立画板**，没有标注它插在详情页的哪两个模块之间（实现说明 §5 第 15 条）
             ⇒ 这里放在「价格/标题/标签」区之后、售后保障之前（主流电商的位置，也是本页最贴近
               「店铺归属」语义的落点）。
             ⚠️ `shopEntryShop` 为 null（解析不出唯一门店）时组件**整块不渲染**；
             ⚠️ 给自定义组件加外边距必须用**内联 `:style`**（小程序 `styleIsolation: isolated`，
               父页面的 class 规则作用不到子组件根节点）。 -->
        <ShopEntryCard :shop="shopEntryShop" :style="{ marginTop: SHOP_ENTRY_GAP }" @enter="onEnterShop" />

        <!-- 售后保障（2026-10-08 Step3 新增，依据《前端对接-Step3》§二 + 《前端对接-Step2》§三）：
             按该商品**支持的配送方式**逐条列出售后窗口；同城那条再按生鲜/普通档位分叉。
             ⚠️ 物流与自提**永远不出现**"次日 0 点""48 小时"这类同城专属口径 —— 这一点由
                `afterSaleTextsForProduct` 的结构保证（档位只在同城分支被读取），不靠模板自觉。 -->
        <view v-if="afterSaleRules.length" class="after-sale-card">
          <view class="after-sale-head">
            <text class="after-sale-title">售后保障</text>
            <text v-if="isFreshProduct" class="after-sale-fresh-tag">生鲜 · 鲜活易腐</text>
          </view>
          <view v-for="rule in afterSaleRules" :key="rule.label" class="after-sale-row">
            <text class="after-sale-label">{{ rule.label }}</text>
            <text class="after-sale-text">{{ rule.text }}</text>
          </view>
          <text v-if="isFreshProduct" class="after-sale-note">生鲜·鲜活易腐商品不适用「七日无理由退货」；若存在质量问题，不受上述时限限制，请联系客服处理。</text>
          <text v-else class="after-sale-note">不同配送方式的售后时限不同，以您下单时选择的配送方式为准。</text>
        </view>

        <!-- 详情图（2026-09-22 加固）：没有详情图时**不渲染这一整块**（避免留灰板）；
             单张加载失败只标记该张并提示，用户可点图用原生预览看原图 -->
        <template v-if="detailImageList.length">
          <view class="detail-heading"><text>产品详情</text></view>
          <view class="detail-media">
            <!-- ⚠️ 详情图是 mode="widthFix"（高度由图片自身决定）⇒ 加载前**无法预知高度**，
                 骨架只能给一个 min-height 占位；好处是用户能看到「正在加载」而不是一片空白。 -->
            <view v-for="(image, index) in detailImageList" :key="image" class="detail-image-wrap">
              <view v-if="!detailSettled.has(image)" class="detail-image-skeleton skeleton-shimmer" />
              <image
                class="product-detail-image motion-image-in"
                :class="{ 'is-failed': failedDetailImages.has(image), 'motion-image-loaded': detailSettled.has(image) }"
                :src="image"
                mode="widthFix"
                @click="previewDetailImage(index)"
                @load="onDetailImageSettled(image)"
                @error="onDetailImageError(image)"
              />
            </view>
            <view v-if="failedDetailImages.size" class="detail-image-tip">有详情图加载失败，点图可查看原图</view>
          </view>
        </template>
      </view>
    </scroll-view>

    <view v-show="!loading && !errorMessage && product" class="product-detail-actions">
      <view class="cart-action" @click="goCart"><image class="cart-icon" src="/static/ProductDetails/购物车_slices/购物车.png" mode="aspectFit" /><text>购物车</text></view>
      <view class="action-button add-button" @click="addProductToCart">加入购物车</view>
      <view class="action-button buy-button" :class="{ disabled: paymentNavigationLoading }" @click="buyNow">{{ paymentNavigationLoading ? '打开中...' : '立即支付' }}</view>
    </view>

    <!-- 分享抽屉（推广码 / 分享好友） -->
    <view v-show="shareSheetVisible" class="mask share-mask" @click="closeShareSheet">
      <view class="share-sheet" @click.stop>
        <view class="share-sheet-head"><text>分享商品</text></view>
        <view class="share-option" @click="openPromotionCode">
          <view class="share-option-main"><text class="share-option-title">推广码</text></view>
        </view>
        <button class="share-option share-option-button" open-type="share" @click="closeShareSheet">
          <view class="share-option-main"><text class="share-option-title">分享好友</text></view>
        </button>
      </view>
    </view>

    <PromotionCodePoster v-model="promotionCodeVisible" :loading="promotionCodeLoading" :code-url="promotionCodeUrl" />
    <LoginGuide v-model="loginGuideVisible" />
    <!-- 规格选择弹层（加购/立即购买前必过：多规格选规格、单规格选数量；2026-10-08 补） -->
    <SkuSheet v-model:visible="skuSheetVisible" :product="product" @confirm="onSkuConfirm" />
  </view>
</template>

<style>
.detail-page { height: 100vh; overflow: hidden; background: #fff; color: #222; }
.nav { position: fixed; left: 0; right: 0; z-index: 30; display: flex; align-items: center; padding-left: 20rpx; background: #fff; box-sizing: border-box; }
.back-button { width: 40rpx; height: 40rpx; }
.detail-scroll { width: 100%; height: 100vh; padding-bottom: 140rpx; box-sizing: border-box; }
.product-body { background: #fff; }
.gallery { width: 100%; height: 100vw; background: #d7d7d7; }
.gallery-empty { display: block; }
.gallery-image { width: 100%; height: 100%; }
/* ── 图片加载体验（2026-09-29）─────────────────────────────────────────────
   骨架 / 扫光 / 淡入三个类都来自全局 styles/motion.wxss（App.vue 已 @import），
   分包页面可直接使用，无需在本文件重复引入：
     .skeleton-shimmer  —— 骨架底 + 横向扫光
     .motion-image-in   —— 未加载完时 opacity:0
     .motion-image-loaded —— 加载完淡入到 opacity:1
   ⚠️ 轮播的 `.gallery` 高度固定（100vw）⇒ 骨架不会引起任何布局跳动；
   ⚠️ 详情图是 widthFix（高度由图决定）⇒ 骨架只能 min-height 占位，加载完会撑开一次。 */
.gallery-slide { position: relative; width: 100%; height: 100%; }
/* ⚠️ 单图兜底**不能**复用 `.gallery-slide`：两者选择器优先级相同、而 `.gallery-slide` 定义在后，
   它的 `height: 100%` 会覆盖 `.gallery` 的 `height: 100vw`；单图的父容器高度是 auto ⇒ 百分比无法解析
   ⇒ 整个容器高度塌成 0、封面图直接消失。所以单图只借一个 `position: relative`（高度仍由 `.gallery` 给）。 */
.gallery-single { position: relative; }
.gallery-skeleton { position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 1; }
.detail-image-wrap { position: relative; width: 100%; }
.detail-image-skeleton { width: 100%; min-height: 240rpx; }
.summary { padding: 22rpx 20rpx 0; background: #fff; }
.price { display: block; color: #d40000; font-size: 40rpx; font-weight: 700; line-height: 1.2; }
.title-row { display: flex; align-items: flex-start; justify-content: space-between; margin-top: 22rpx; gap: 18rpx; }
.name { flex: 1; min-width: 0; color: #222; font-size: 32rpx; font-weight: 600; line-height: 1.35; }
.title-icons { display: flex; flex-shrink: 0; align-items: center; gap: 36rpx; padding-top: 4rpx; }
.title-icon { width: 40rpx; height: 40rpx; flex-shrink: 0; }
/* 商品描述文案（2026-10-08 用户要求「改为橘黄色淡一点」）：`#999` → `#C8843A`（浅橘黄）。
   ⚠️ 用户在需求里给的 `#E0A45E` 在白底（`.product-body`/`.summary` 均为 `#fff`）上对比度只有 2.18:1，
   比它替换掉的 `#999`（2.85:1）**还低**，24rpx 正文会明显发飘 ⇒ 取同色相（~31°）**略深一档**的
   `#C8843A`（3.08:1），既是浅橘黄、又不比原灰更难读。不要再往亮里调。 */
.description { display: block; margin-top: 16rpx; color: #C8843A; font-size: 24rpx; line-height: 1.45; }
.promotion-row { display: flex; align-items: center; min-height: 74rpx; margin-top: 24rpx; padding: 0 18rpx; background: #fff0e6; box-sizing: border-box; }
.promotion-label { color: #444; font-size: 23rpx; white-space: nowrap; }
.promotion-value { margin: 0 10rpx; color: #df1919; font-size: 34rpx; font-weight: 700; line-height: 1; }
.tag-row { display: flex; align-items: center; gap: 32rpx; padding: 24rpx 0 28rpx; border-bottom: 1px solid #eee; }
.tag { display: flex; align-items: center; color: #555; font-size: 23rpx; }
.tag-icon { width: 36rpx; height: 36rpx; margin-right: 12rpx; flex-shrink: 0; }
/* 「售后保障」块（2026-10-08 Step3 新增）：按配送方式列出售后窗口 + 生鲜标注。
   ⚠️ 色值沿用本页既有中性灰（#555/#999）与页面底色，不引入新配色。 */
.after-sale-card { margin-top: 20rpx; padding: 22rpx 20rpx; background: #fff; }
.after-sale-head { display: flex; align-items: center; gap: 14rpx; margin-bottom: 14rpx; }
.after-sale-title { color: #222; font-size: 27rpx; font-weight: 600; }
.after-sale-fresh-tag { padding: 4rpx 14rpx; border: 1rpx solid #ff9301; border-radius: 6rpx; color: #ff6a00; background: #fff6ec; font-size: 21rpx; line-height: 1.4; }
.after-sale-row { display: flex; align-items: flex-start; margin-top: 10rpx; }
.after-sale-label { width: 132rpx; flex-shrink: 0; color: #555; font-size: 23rpx; line-height: 1.5; }
.after-sale-text { flex: 1; min-width: 0; color: #666; font-size: 23rpx; line-height: 1.5; }
.after-sale-note { display: block; margin-top: 14rpx; color: #999; font-size: 21rpx; line-height: 1.5; }
.detail-heading { display: flex; align-items: center; justify-content: center; height: 116rpx; color: #555; background: #fff; font-size: 25rpx; }
.detail-media { min-height: 520rpx; background: #d6d6d6; }
.product-detail-image { display: block; width: 100%; height: auto; }
/* 加载失败的那张：给一块可点的浅灰底 + 保留高度，避免长图失败后整块塌成一条线 */
.product-detail-image.is-failed { min-height: 240rpx; background: #f2f2f2; }
.detail-image-tip { padding: 16rpx 0; color: #86909c; font-size: 24rpx; text-align: center; }
.product-detail-actions { position: fixed; right: 0; bottom: 0; left: 0; z-index: 40; display: flex; align-items: center; gap: 12rpx; padding: 12rpx 20rpx calc(12rpx + env(safe-area-inset-bottom)); background: #fff; box-sizing: border-box; }
.cart-action { display: flex; width: 124rpx; flex-shrink: 0; flex-direction: column; align-items: center; justify-content: center; color: #333; font-size: 22rpx; }
.cart-icon { width: 64rpx; height: 64rpx; margin-bottom: 2rpx; flex-shrink: 0; }
.action-button { display: flex; align-items: center; justify-content: center; height: 82rpx; font-size: 28rpx; box-sizing: border-box; }
.add-button { flex: 1; border: 2rpx solid #222; color: #222; background: #fff; }
.buy-button { flex: 1; color: #fff; background: #050505; }
.action-button.disabled { opacity: .55; }
.state { padding: 180rpx 32rpx; color: #8a96a8; text-align: center; }
.error { color: #d94d3f; }
/* 分享抽屉 */
.share-mask { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .5); }
.share-sheet { width: 100%; padding: 30rpx 28rpx calc(30rpx + env(safe-area-inset-bottom)); background: #fff; box-sizing: border-box; border-radius: 24rpx 24rpx 0 0; }
.share-sheet-head { display: flex; justify-content: center; padding: 10rpx 0 24rpx; color: #222; font-size: 30rpx; font-weight: 700; }
.share-option { display: flex; align-items: center; min-height: 100rpx; padding: 0 24rpx; border-top: 1px solid #f2f2f2; }
.share-option-button { width: 100%; margin: 0; background: #fff; border: none; line-height: normal; text-align: left; box-sizing: border-box; }
.share-option-button::after { border: 0; }
.share-option-main { display: flex; flex-direction: column; align-items: flex-start; }
.share-option-title { color: #222; font-size: 28rpx; font-weight: 600; }
.sheet-head { position: relative; display: flex; align-items: center; justify-content: center; min-height: 54rpx; }
.sheet-title { color: #222; font-size: 30rpx; font-weight: 700; }
.sheet-close { position: absolute; right: 0; color: #888; font-size: 42rpx; font-weight: 300; line-height: 1; }
</style>
