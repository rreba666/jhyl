<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getCategoryList, getGoodsBrands, getProducts, type CategoryNode, type CategoryProduct } from '@/api/category'
import { getLandingConfig, type LandingConfigV2 } from '@/api/homepage'
import { addSkuToCartWithStock } from '@/api/cart'
import { getProductDetail } from '@/api/product'
import { ApiRequestError, isApiRequestError } from '@/utils/request'
import { PURCHASE_LIMIT_ERROR_CODE, PURCHASE_LIMIT_MESSAGE } from '@/utils/dividend-limit'
import { createThrottle } from '@/utils/interaction'
import { isLoggedIn } from '@/utils/auth'
import LoginGuide from '@/components/LoginGuide.vue'
import CategoryProductCard from '@/components/category/CategoryProductCard.vue'
import CategoryTopBar from '@/components/category/CategoryTopBar.vue'

type CategoryTheme = 'nutrition' | 'heritage' | 'landmark'

const THEME_BY_INDEX: Record<string, CategoryTheme> = {
  '0': 'nutrition',
  '3': 'heritage',
  '4': 'landmark',
}

const theme = ref<CategoryTheme>('nutrition')
const statusBarHeight = ref(24)
/** 后台配置的落地页数据（头图/标题/布局等），未配置时为 null 用默认。 */
const landing = ref<LandingConfigV2 | null>(null)
const selectedBrandKey = ref('')
const brandExpanded = ref(false)
const cats = ref<CategoryNode[]>([])
const goods = ref<CategoryProduct[]>([])
const loading = ref(true)
const loadError = ref('')
const cartAdding = ref(false)
const loginGuideVisible = ref(false)
let categoryLoadPromise: Promise<void> | null = null
let goodsRequestToken = 0
const categoryGoodsCache = new Map<string, CategoryProduct[]>()
const navigationThrottle = createThrottle(500)

/** 内置默认品牌（后台未配置品牌时回退，logo 用本地静态图）。 */
const DEFAULT_BRANDS = [
  { name: '胡庆余堂', image: '/static/figma-category/brands/hu-qing-yu-tang.png' },
  { name: '湖北白鸭', image: '/static/figma-category/brands/hu-bei-bai-ya.png' },
  { name: '方家铺子', image: '/static/figma-category/brands/fang-jia-pu-zi.png' },
  { name: '海天', image: '/static/figma-category/brands/hai-tian.png' },
  { name: '巧媳妇', image: '/static/figma-category/brands/qiao-xi-fu.png' },
  { name: '火宫殿', image: '/static/figma-category/brands/huo-gong-dian.png' },
  { name: '义利', image: '/static/figma-category/brands/yi-li.png' },
  { name: '珠江桥牌', image: '/static/figma-category/brands/zhu-jiang-qiao-pai.png' },
  { name: '张小泉', image: '/static/figma-category/brands/zhang-xiao-quan.png' },
  { name: '稻香村', image: '/static/figma-category/brands/dao-xiang-cun.png' },
]
/** 品牌项：id 为空表示兜底品牌（不可按品牌筛选）。 */
interface BrandItem { id: number | null; name: string; image: string }
/** 接口返回的品牌（某大类下），优先于落地页配置与内置默认。 */
const brandList = ref<BrandItem[]>([])
/** 品牌唯一标识（有 id 用 id，否则用名称）。 */
function brandKey(brand: BrandItem): string { return brand.id != null ? `id:${brand.id}` : `name:${brand.name}` }
/** 品牌列表：接口（「商品品牌」模块按大类）优先 → 落地页旧配置品牌（兼容）→ 内置默认。 */
const brands = computed<BrandItem[]>(() => {
  if (brandList.value.length) return brandList.value
  const configured = (landing.value?.brands || []).filter((item) => item && item.name)
  if (configured.length) return configured.map((item) => ({ id: null, name: item.name, image: item.logo || '' }))
  return DEFAULT_BRANDS.map((item) => ({ id: null, name: item.name, image: item.image }))
})
/** 当前选中的品牌（用于高亮与按品牌筛选商品）。 */
const selectedBrand = computed<BrandItem | null>(() => brands.value.find((item) => brandKey(item) === selectedBrandKey.value) || null)
/**
 * 品牌圆形边框素材（2026-09-29 接入）。
 * ⚠️ 两张都是 **144×144 的透明圆环**，中心不遮挡 logo；品牌图本身是**透明背景**，
 * 因此这里**不再给 `.brand-icon` 铺底色**，圆环直接叠在 logo 上即可。
 */
const BRAND_RING_NORMAL = '/static/figma-category/brands/white-border.png'
const BRAND_RING_SELECTED = '/static/figma-category/brands/border.png'
/**
 * 取某品牌当前应叠加的边框素材：**未选中白框、选中橙框**。
 * ⚠️ 刻意写成函数而不是在模板里写三元表达式 —— 项目约定：小程序模板对复杂表达式支持有限，
 * 这类判断统一放到 script 里。
 */
function brandRing(brand: BrandItem): string {
  return selectedBrandKey.value === brandKey(brand) ? BRAND_RING_SELECTED : BRAND_RING_NORMAL
}
const fallbackCategories: CategoryNode[] = [
  { id: 'nutrition', name: '营养膳食', icon: '' },
  { id: 'water', name: '风生水起', icon: '' },
  { id: 'paper', name: '纸定发财', icon: '' },
  { id: 'heritage', name: '非遗老号', icon: '' },
  { id: 'landmark', name: '国家地标', icon: '' },
]

const themeConfig = computed(() => {
  const base = theme.value === 'heritage'
    ? { title: '非遗老号', mode: 'grid' as const, hero: '', className: 'theme-heritage', fallbackImage: '/static/figma-category/product-main-heritage.jpg', subtitle: '自然植萃麦角硫因&萝卜硫苷内外兼顾多项专利、实验临床', location: '', templateType: 'brandGrid' as const, headImageHeight: 0, // ⚠️ 2026-09-29：页面底色由 '#fff' 改为与**上方品牌栏一致**的浅暖色。
    // 品牌栏是 .heritage-header 的 #fff 底 + 头图 heritage-header.jpg 以 opacity .78 叠加，
    // 取头图占比最高的主色 #f8e0d8 与白色按 78% 混合 ⇒ 约 #f9e7e1（即品牌栏实际显示的颜色）。
    // 这样下方装商品卡片的米黄容器（#fae7c9）扣在这个底色上，**顶部圆角才看得出来**。
    backgroundColor: '#fff', categoryNames: ['非遗老号', '非遗老字号'] }
    : theme.value === 'landmark'
      ? { title: '膳食营养', mode: 'horizontal' as const, hero: '/static/figma-category/landmark-hero.jpg', className: 'theme-landmark', fallbackImage: '/static/figma-category/product-main-2.jpg', subtitle: '隆平低GI控糖稳血糖，高纤高蛋白双补，饱腹续航4小时+，0蔗糖0添加', location: '浙江-杭州', templateType: 'heroList' as const, headImageHeight: 476, backgroundColor: '#F6E7C8', categoryNames: ['国家地标', '膳食营养'] }
      : { title: '膳食营养', mode: 'horizontal' as const, hero: '/static/figma-category/nutrition-hero.jpg', className: 'theme-nutrition', fallbackImage: '/static/figma-category/product-main-1.jpg', subtitle: '隆平低GI控糖稳血糖，高纤高蛋白双补，饱腹续航4小时+，0蔗糖0添加', location: '', templateType: 'heroList' as const, headImageHeight: 696, backgroundColor: '#F6E7C8', categoryNames: ['营养膳食', '膳食营养'] }
  if (!landing.value) return base
  const l = landing.value
  return {
    title: l.title || base.title,
    // 品牌条模板（非遗老号）固定双列，忽略 layoutMode 配置，避免配成横向卡片。
    mode: (l.templateType === 'brandGrid' ? 'grid' : (l.layoutMode === 'grid' || l.layoutMode === 'horizontal' ? l.layoutMode : base.mode)),
    hero: l.headImage || base.hero,
    className: base.className,
    fallbackImage: l.fallbackImage || base.fallbackImage,
    subtitle: l.subtitle || base.subtitle,
    location: l.location ?? base.location,
    templateType: l.templateType || base.templateType,
    // headImageHeight 现在**只用于「头图加载完成前的占位高度」**（见下面的 heroStyle），不再写死容器高度：
    // 写死高度 + aspectFill 会把后台上传的任意比例头图裁掉（2026-09-22 用户反馈「头图被裁减」，已改为 widthFix 完整显示）。
    // 国家地标那张本地切图是 780×480 的横长图，仍按 476 占位；后端对未配置项兜底返回 696（与"真配 696"无法区分）。
    headImageHeight: (l.landingKey === '国家地标' && (!l.headImageHeight || l.headImageHeight === 696)) ? 476 : (l.headImageHeight || base.headImageHeight),
    backgroundColor: l.backgroundColor ?? base.backgroundColor,
    // ⚠️ 2026-09-29 新增「商品容器（米黄大盒子）底色」：
    // 此前盒子的背景直接复用 `themeConfig.backgroundColor`，**与页面底色是同一个值** ⇒
    // 圆角两侧永远同色 ⇒ 非遗老号的盒子圆角**视觉上永远看不出来**。
    // 用户明确：**页面底色应与上方品牌 icon 区域的背景一致（白）**，而**盒子是米黄**，
    // 所以这里给盒子单独一个固定色（按用户要求改为白色 #fff（原为 .category-products 的默认米黄 #fae7c9）），
    // 页面底色仍走 backgroundColor（后端配置）。
    boxBackgroundColor: theme.value === 'heritage' ? '#fff' : undefined,
    // ⚠️ 2026-09-29 同上：给**页面底色**也加一个固定值，避免被后端 `l.backgroundColor`
    // 覆盖成与盒子相同的颜色（那会让米黄容器的圆角彻底看不出来）。
    // heritage 取 #eaf7ef —— 即「品牌栏实际显示色」（#fff 底 + 头图 78% 叠加后的近似色）。
    pageBackgroundColor: theme.value === 'heritage' ? '#fff' : undefined,
    // 商品分类：优先用落地页配置的分类（后台「分类」字段），未配置才用主题默认。
    categoryNames: (l.categoryNames?.filter(Boolean).length ? l.categoryNames.filter(Boolean) : base.categoryNames),
  }
})

/** 头图是否已加载完成：加载前用 headImageHeight 占位，加载后让位给图片真实比例 */
const heroLoaded = ref(false)
/**
 * 头图容器样式：**只有**「尚未加载完 + 后端给了 headImageHeight」时才给占位高度。
 * 图片加载完成后返回空对象 → 容器高度完全由 mode="widthFix" 的图片撑开，既不裁切也不留白。
 */
const heroStyle = computed<Record<string, string>>(() => (
  heroLoaded.value || !themeConfig.value.headImageHeight
    ? {}
    : { minHeight: `${themeConfig.value.headImageHeight}rpx` }
))

/** 头图加载完成：撤掉占位高度（图片自身已按真实比例撑开）。 */
function onHeroLoad(): void { heroLoaded.value = true }

// 切换落地页主题会换头图 → 重新走一遍「占位 → 按真实比例撑开」
watch(() => themeConfig.value.hero, () => { heroLoaded.value = false })

const sampleProducts = computed<CategoryProduct[]>(() => {
  const image = themeConfig.value.fallbackImage
  const names = theme.value === 'heritage'
    ? ['【限时多买多赠】专为3岁+宝宝研发，有助于提升宝宝体能，为宝宝健康成长', '非遗老字号匠心好物，传统工艺守护品质', '老字号经典味道，精选原料安心可享', '传承手艺甄选好物，送礼自用皆宜', '百年品牌匠心制造，品质看得见', '传统好物走进当代生活']
    : ['双补，饱腹续航4小时+，0蔗糖0添加隆平膳食低GI营养代餐粉，控糖稳血糖，高纤高蛋白', '低GI高蛋白营养粉，专业配方满足每日营养所需', '高纤轻负担营养代餐，开启安心膳食生活', '甄选国家地标好物，风物滋味一站式收藏']
  return names.map((name, index) => ({
    id: `figma-demo-${theme.value}-${index + 1}`,
    name,
    mainImage: image,
    minPrice: 299,
  }))
})

const visibleProducts = computed(() => goods.value.length ? goods.value : sampleProducts.value)
const gridLeftProducts = computed(() =>
  visibleProducts.value.filter((_item, index) => index % 2 === 0),
)
const gridRightProducts = computed(() =>
  visibleProducts.value.filter((_item, index) => index % 2 === 1),
)
const expandedBrands = computed(() => brands.value)

function resolveTheme(value: unknown): CategoryTheme {
  const key = String(value ?? '')
  if (key === 'nutrition' || key === 'heritage' || key === 'landmark') return key
  return THEME_BY_INDEX[key] || 'nutrition'
}

/** 当前落地页关联的大类 id：优先用后端直出的 categoryIds，否则按分类名匹配（存量兜底）。 */
const activeCategoryId = computed<string>(() => {
  const ids = landing.value?.categoryIds
  if (ids?.length) return String(ids[0])
  const names = themeConfig.value.categoryNames.filter(Boolean)
  return cats.value.find((item) => names.includes(item.name))?.id || ''
})

/** 加载当前大类下的品牌（接口为空时回退落地页配置 / 内置默认品牌）。 */
async function loadBrands(): Promise<void> {
  const categoryId = activeCategoryId.value
  if (!categoryId) { brandList.value = []; return }
  try {
    const list = await getGoodsBrands(Number(categoryId))
    brandList.value = (list || []).map((item) => ({ id: item.id, name: item.name, image: item.logo || '' }))
  } catch {
    brandList.value = []
  }
  // 默认选中第一个品牌，与设计稿一致（选中态高亮）
  if (!selectedBrandKey.value && brandList.value.length) selectedBrandKey.value = brandKey(brandList.value[0])
}

/** 加载商品：选中品牌 → 按品牌筛选；未选品牌 → 按大类取全部商品（含未挂品牌的）。 */
async function loadGoods(): Promise<void> {
  const brandId = selectedBrand.value?.id ?? null
  const categoryId = activeCategoryId.value
  const cacheKey = brandId != null ? `brand:${brandId}` : `category:${categoryId}`
  const requestToken = ++goodsRequestToken
  const cached = categoryGoodsCache.get(cacheKey)
  if (cached) {
    goods.value = cached
    return
  }
  try {
    const result = await getProducts(
      brandId != null
        ? { goodsBrandId: brandId, page: 1, pageSize: 20 }
        : { categoryId, page: 1, pageSize: 20 },
    )
    const list = result?.list || []
    categoryGoodsCache.set(cacheKey, list)
    if (requestToken === goodsRequestToken) goods.value = list
  } catch (error) {
    if (requestToken === goodsRequestToken) {
      loadError.value = error instanceof Error ? error.message : '商品加载失败'
      goods.value = []
    }
  }
}

/** 切换品牌：高亮该品牌并重新加载其商品（同时收起展开面板）。 */
function selectBrand(brand: BrandItem): void {
  selectedBrandKey.value = brandKey(brand)
  brandExpanded.value = false
  void loadGoods()
}

/** 落地页配置到达后：加载品牌条，并按配置的分类/品牌重新加载商品。 */
async function refreshGoodsForLanding(): Promise<void> {
  if (!cats.value.length) {
    try {
      const list = await getCategoryList()
      cats.value = list?.length ? list : fallbackCategories
    } catch {
      cats.value = fallbackCategories
    }
  }
  await loadBrands()
  await loadGoods()
}

async function loadCategoryPage(): Promise<void> {
  loadError.value = ''
  try {
    const list = await getCategoryList()
    cats.value = list?.length ? list : fallbackCategories
  } catch (error) {
    cats.value = fallbackCategories
    loadError.value = error instanceof Error ? error.message : '分类加载失败'
  }
  await loadGoods()
  loading.value = false
}

function refreshCategoryPage(): Promise<void> {
  if (categoryLoadPromise) return categoryLoadPromise
  const pending = loadCategoryPage()
  categoryLoadPromise = pending
  pending.finally(() => {
    if (categoryLoadPromise === pending) categoryLoadPromise = null
  })
  return pending
}

function goBack(): void {
  uni.navigateBack({ delta: 1 })
}

function goDetail(id: string): void {
  if (!navigationThrottle()) return
  if (id.startsWith('figma-demo-')) {
    uni.showToast({ title: '示例商品', icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/subpkg-goods/detail/detail?id=${encodeURIComponent(id)}` })
}

async function onAddCart(product: CategoryProduct): Promise<void> {
  if (cartAdding.value) return
  if (String(product.id).startsWith('figma-demo-')) {
    uni.showToast({ title: '示例商品', icon: 'none' })
    return
  }
  if (!isLoggedIn()) {
    loginGuideVisible.value = true
    return
  }
  cartAdding.value = true
  try {
    const detail = await getProductDetail(String(product.id))
    const sku = detail.skuList.find((item) => item.enabled !== 0) || detail.skuList[0]
    const stock = Number(sku?.stock ?? 0)
    if (!sku || !Number.isFinite(stock) || stock <= 0) throw new ApiRequestError('库存不足', 3001)
    await addSkuToCartWithStock({
      productId: Number(product.id),
      skuId: Number(sku.id),
      stock,
      quantity: 1,
      dividendEnabled: detail.dividendEnabled,
      price: Number(sku.price),
    })
    uni.showToast({ title: '已加入购物车', icon: 'success' })
  } catch (error) {
    uni.showToast({
      title: isApiRequestError(error) && error.code === 3001
        ? '库存不足'
        : isApiRequestError(error) && error.code === PURCHASE_LIMIT_ERROR_CODE
          ? PURCHASE_LIMIT_MESSAGE
          : (error instanceof Error ? error.message : '加购失败'),
      icon: 'none',
    })
  } finally {
    cartAdding.value = false
  }
}

onLoad((options) => {
  // 金刚区跳转时 landingKey 做了 encodeURIComponent，这里必须先解码，否则中文 key 变成 %E9%A3%8E… 查不到配置。
  let key = String(options?.theme ?? options?.category ?? '')
  try { key = decodeURIComponent(key) } catch { /* 非法编码时保持原值 */ }
  theme.value = resolveTheme(key)
  void getLandingConfig(key).then((cfg) => {
    // 临时调试：确认小程序实际拿到的落地页配置（templateType/backgroundColor 等）
    console.log('[landing-config]', key, JSON.stringify(cfg))
    if (cfg) {
      landing.value = cfg
      // 中文 landingKey 无法直接映射主题，用 templateType 决定模板（brandGrid→非遗老号，heroList→营养）。
      theme.value = cfg.templateType === 'brandGrid' ? 'heritage' : 'nutrition'
    } else if (key) {
      // 后端未命中该 key（data=null）：用 key（中文名）兜底，避免所有落地页都显示成"膳食营养"。
      landing.value = {
        landingKey: key,
        title: key,
        templateType: 'heroList',
        headImage: '',
        headImageHeight: 696,
        backgroundColor: '#F6E7C8',
        subtitle: '',
        location: '',
        layoutMode: 'horizontal',
        headerMode: 'hero',
        fallbackImage: '',
        brandNames: [],
        categoryNames: [key],
      }
      theme.value = 'nutrition'
    }
    // 配置（或兜底）到位后，按配置的分类重新拉商品，避免仍显示主题默认分类的商品。
    void refreshGoodsForLanding()
  }).catch(() => { /* 读取失败用默认 */ })
})

onMounted(() => {
  try {
    statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 24
  } catch { /* 非微信环境使用设计稿默认值 */ }
  void refreshCategoryPage()
})
</script>

<template>
  <view class="category-page" :class="themeConfig.className" :style="{ backgroundColor: themeConfig.pageBackgroundColor || themeConfig.backgroundColor || '' }">
    <!--
      头图（2026-09-22 优化：用户反馈「头图被裁减」）
      原来是「固定高度 + mode="aspectFill"」：容器高度写死（默认 696rpx、国家地标 476rpx，或用后端 headImageHeight），
      而 aspectFill 的语义是「填满容器、把溢出部分裁掉」→ 只要后台上传的头图比例与容器不一致，
      就会被上下裁掉一大截（**被裁的是后端配置的 headImage**；本地那两张切图比例刚好匹配，所以看不出问题）。
      现改为 mode="widthFix"：宽度撑满、高度按原图真实比例自适应，**任何比例的头图都完整显示、绝不裁切**。
      占位：图片加载完成前用后端给的 headImageHeight 撑住高度，加载后立刻让位给图片真实比例（既不跳动也不留白）。
      ⚠️ 不要再用 headImageHeight 写死容器高度 —— 那正是裁图的根源。
    -->
    <!-- ⚠️ 非遗老号顶部装饰层（2026-09-29 按 Figma node 2187:10303 补）：
         Figma `Frame 105` 里是「透明渐变圆 + 浅绿 #D3FBE2 圆（304×304，位于页面右上）」，
         圆角之所以可见，就是因为商品容器的顶部圆角正好切在这块浅绿上。
         ⚠️ 只覆盖顶部 404rpx（品牌区 358 + 容器圆角 32 + 余量）——**绝不铺满整屏**，
            上一版铺满整屏导致页面到处是花纹、效果很差。
         ⚠️ 用 absolute（随页面滚动）而非 fixed：fixed 会在滚动后与固定头部错位。
         参数与 .heritage-header-glow 完全一致 ⇒ 两者在 358rpx 交界处自然衔接、无色差。 -->
    <view v-if="themeConfig.className === 'theme-heritage'" class="heritage-top-glow">
      <image src="/static/design-cuts/figma-category/heritage-header.jpg" mode="scaleToFill" />
    </view>
    <view v-if="themeConfig.templateType !== 'brandGrid'" class="category-hero" :style="heroStyle">
      <image class="category-hero-image" :src="themeConfig.hero" mode="widthFix" @load="onHeroLoad" />
      <CategoryTopBar :title="themeConfig.title" :status-bar-height="statusBarHeight" :fixed="true" @back="goBack" />
    </view>

    <view v-else class="heritage-header">
      <image class="heritage-header-glow" src="/static/design-cuts/figma-category/heritage-header.jpg" mode="scaleToFill" />
      <CategoryTopBar :title="themeConfig.title" :status-bar-height="statusBarHeight" :fixed="true" @back="goBack" />
      <view class="brand-strip">
        <scroll-view class="brand-scroll" scroll-x :show-scrollbar="false">
          <view class="brand-list">
            <view v-for="brand in brands" :key="brandKey(brand)" class="brand-item" :class="{ selected: selectedBrandKey === brandKey(brand) }" @click="selectBrand(brand)">
              <view class="brand-icon"><image class="brand-logo" :src="brand.image" mode="aspectFit" /><image class="brand-ring" :src="brandRing(brand)" mode="aspectFit" /></view>
              <text class="brand-name">{{ brand.name }}</text>
            </view>
          </view>
        </scroll-view>
        <view class="brand-expand-button" @click="brandExpanded = true">
          <view class="brand-expand-surface">
            <!-- ⚠️ 展开按钮的圆形底（2026-09-29 按 Figma node 2220:10768 的 Frame 97 补）：
                 设计稿为 60×60、fill #567F65（墨绿）透明度 15%、带 LAYER_BLUR 柔光。
                 小程序对 filter: blur 支持有限且耗性能，这里用同色值 + 径向渐变近似。 -->
            <view class="brand-expand-glow" />
            <text class="brand-expand-text">展开</text>
            <view class="brand-expand-icon"><text class="brand-expand-bars">≡</text><text class="brand-expand-arrow">⌄</text></view>
          </view>
        </view>
      </view>
    </view>

    <view class="category-products" :class="{ 'products-grid': themeConfig.mode === 'grid' }" :style="{ backgroundColor: themeConfig.boxBackgroundColor || themeConfig.backgroundColor || '' }">
      <view v-if="loading" class="category-products-loading">加载中...</view>
      <!-- 空状态（用户 2026-09-22）：金刚区落地页「没有商品」时**直接提示「暂无商品」**即可 ——
           这里刻意不用插画空状态（那套只用于骑手端/商家端的三处列表），保持与其它商品类列表一致的轻提示。 -->
      <view v-else-if="!goods.length" class="category-products-loading">暂无商品</view>
      <view v-else-if="themeConfig.mode === 'grid'" class="category-products-waterfall">
        <view class="category-products-column">
          <view v-for="product in gridLeftProducts" :key="product.id" class="category-product-slot">
            <CategoryProductCard
              :product="product"
              :mode="themeConfig.mode"
              :subtitle="themeConfig.subtitle"
              :fallback-image="themeConfig.fallbackImage"
              @select="goDetail"
              @add="onAddCart"
            />
          </view>
        </view>
        <view class="category-products-column">
          <view v-for="product in gridRightProducts" :key="product.id" class="category-product-slot">
            <CategoryProductCard
              :product="product"
              :mode="themeConfig.mode"
              :subtitle="themeConfig.subtitle"
              :fallback-image="themeConfig.fallbackImage"
              @select="goDetail"
              @add="onAddCart"
            />
          </view>
        </view>
      </view>
      <view v-else class="category-products-list">
        <CategoryProductCard
          v-for="product in visibleProducts"
          :key="product.id"
          :product="product"
          :mode="themeConfig.mode"
          :subtitle="themeConfig.subtitle"
          :fallback-image="themeConfig.fallbackImage"
          @select="goDetail"
          @add="onAddCart"
        />
      </view>
    </view>

    <view v-if="brandExpanded" class="brand-expanded-layer" @click="brandExpanded = false">
      <view class="brand-expanded-panel" @click.stop>
        <image class="heritage-header-glow expanded" src="/static/design-cuts/figma-category/heritage-expanded-header.jpg" mode="scaleToFill" />
        <CategoryTopBar :title="themeConfig.title" :status-bar-height="statusBarHeight" @back="goBack" />
        <view class="brand-expanded-grid">
          <view v-for="brand in expandedBrands" :key="brandKey(brand)" class="brand-item" :class="{ selected: selectedBrandKey === brandKey(brand) }" @click="selectBrand(brand)">
            <view class="brand-icon"><image class="brand-logo" :src="brand.image" mode="aspectFit" /><image class="brand-ring" :src="brandRing(brand)" mode="aspectFit" /></view>
            <text class="brand-name">{{ brand.name }}</text>
          </view>
        </view>
        <view class="brand-collapse" @click="brandExpanded = false"><text>点击收起</text><text class="brand-collapse-arrow">⌃</text></view>
      </view>
    </view>

    <LoginGuide v-model="loginGuideVisible" />
  </view>
</template>

<style>
.category-page { position: relative; min-height: 100vh; overflow: hidden; background: #fff; color: #1d2129; }
/* 头图容器：高度由图片自己撑开（配合 mode="widthFix"），**不能写死高度**，否则又变成裁图。
   仅在"图片加载完成前"可能由内联的 headImageHeight 做一次性占位（见 heroStyle）。 */
.category-hero { position: relative; width: 100%; overflow: hidden; background: #f2f3f5; }
.category-hero-image { display: block; width: 100%; height: auto; }
.category-products { position: relative; z-index: 2; margin-top: -24rpx; padding: 16rpx; box-sizing: border-box; border-radius: 24rpx 24rpx 0 0; background: #fae7c9; }
/* 头部固定（358rpx），商品区顶部让出同等高度；z-index 低于固定头部 */
/* ⚠️ 2026-09-29 按设计稿修正两点：
   ① 顶部圆角（原来 border-radius: 0 把 .category-products 默认的 24rpx 圆角覆盖掉了）；
   ② 商品卡片与盒子顶部留出间距 —— padding-top 由 358rpx（正好等于固定头部高度）加到 381rpx，
      多出的 23rpx 与左右内边距同值，视觉最协调。注意用 padding 而不是 margin：
      盒子顶部仍与固定头部（.heritage-header height: 358rpx）无缝相接，只是卡片下移。 */
/* ⚠️ 2026-09-29 修正（用户反馈"米黄大盒子上方两个角应是圆角，且商品卡片与盒子顶部有距离"）：
   关键在 margin-top —— 原来是 0，盒子从**页面最顶端 y=0** 开始，只用 padding-top 358rpx 把卡片推到头部下方，
   于是**盒子的顶边（圆角所在处）留在 y=0，被 fixed 头部（z-index 10、高 358rpx、纯白底）整块盖住**，
   圆角等于不存在（只加 border-radius 治不了这个问题）。
   ⇒ 改为 margin-top: 374rpx 把盒子顶推到头部下方（358 头部 + 16 露缝），圆角才真正可见；
     露出的 16rpx 缝是页面底色，与盒子同为米黄（内联 #F6E7C8），所以过渡自然、不是一条突兀的线。
   ⇒ padding-top 由 358rpx 降为 24rpx：让位给 fixed 头部的活现在由 margin-top 承担，
     padding-top 只保留"商品卡片与盒子顶部"的那点间距。
   注：background 那行实际被模板内联的 themeConfig.backgroundColor 覆盖（heritage 为 #F6E7C8）。 */
/* ⚠️ 2026-09-29 第三轮：用户要求「盒子与上方没有间距」+「高度撑满整个页面」。
   ⇒ margin-top 由 374rpx（358 + 16 露缝）改回 **358rpx**，正好等于固定头部高度 ⇒ 盒子顶与头部**无缝相接**。
   ⇒ 圆角依然可见：border-radius 的弧**向下凹在盒子内部**，弧的外侧露出的是**页面底色**（pageBackgroundColor
     的 #f9e7e1 浅暖色），而盒子是白色 ⇒ 有对比。
   ⇒ min-height 用 calc(100vh - 358rpx)：扣掉固定头部的 358rpx，让盒子**撑满剩余整屏**（商品少时也不留白）。 */
/* ⚠️ 2026-09-29 按 Figma 设计稿（node 2187:10303「金刚区_非遗老号」）校准：
   · Figma `Frame 103`（商品容器）radii = 16,16,0,0（设计稿 1x，390px 宽）
     ⇒ 16px × (750/390) ≈ 30.8rpx ⇒ 取 **32rpx**（原为 24rpx，偏小）；
   · Figma 根容器 / `Frame 104`（品牌区）/ `Frame 103` 三者 fill **都是 #FFFFFF**
     ⇒ 页面底色与品牌栏底色都应为**纯白**（此前误改成 #eaf7ef 已回退）；
   · 圆角之所以在设计稿里可见，是因为右上角有一个 **浅绿 `#D3FBE2` 的圆**（`Ellipse 4`，304×304，
     覆盖到容器顶下方 16px），圆角正好切在它上面 ⇒ 装饰层只覆盖顶部那一段，**不能铺满整屏**。 */
.theme-heritage .category-products { z-index: 1; margin-top: 358rpx; min-height: calc(100vh - 358rpx); padding: 24rpx 23rpx 23rpx; border-radius: 32rpx 32rpx 0 0; overflow: hidden; background: #fff; }
.category-products-list { display: flex; flex-direction: column; gap: 16rpx; }
.category-products-waterfall { display: flex; align-items: flex-start; gap: 15rpx; }
/* 列内卡片间距 46rpx -> 24rpx（2026-09-22「像首页一样」：首页 waterfall-column 就是 24rpx，
   46rpx 在双列瀑布流里显得两列之间空得慌，也让卡片看起来更"散"） */
.category-products-column { display: flex; width: calc((100% - 15rpx) / 2); flex-direction: column; gap: 24rpx; }
.category-product-slot { width: 100%; }
.category-products-loading { padding: 160rpx 0; color: #86909c; font-size: 28rpx; line-height: 44rpx; text-align: center; }
/* 非遗页头部整块固定：标题栏 + 品牌条不随商品滚动（与首页一致） */
.heritage-header { position: fixed; top: 0; right: 0; left: 0; z-index: 10; height: 358rpx; overflow: hidden; background: #fff; }
.heritage-header-glow { position: absolute; top: -204rpx; left: -216rpx; width: 1212rpx; height: 608rpx; opacity: .78; }
/* 非遗老号顶部装饰层：只盖住「品牌区 + 商品容器顶部圆角」这一段（高 404rpx = 头部 358 + 圆角 32 + 余量）。
   z-index 0 ⇒ 商品容器（1）与固定头部（10）都在它之上；固定头部自带白底，
   所以 0~358rpx 由头部自己的 glow 呈现，本层只在 358rpx 之下露出 ⇒ 正好给容器圆角当背景。
   ⚠️ 定位参数必须与 .heritage-header-glow 一致，否则两段花纹在 358rpx 处会错位。 */
.heritage-top-glow { position: absolute; top: 0; left: 0; z-index: 0; width: 100%; height: 404rpx; overflow: hidden; }
.heritage-top-glow image { position: absolute; top: -204rpx; left: -216rpx; width: 1212rpx; height: 608rpx; opacity: .78; }
.heritage-header-glow.expanded { top: 0; left: 0; width: 100%; height: 100%; }
/* 品牌条紧贴导航栏下方（设计稿导航 177rpx 之下），不再留大段空白 */
.brand-strip { position: absolute; top: 177rpx; right: 0; left: 0; display: flex; height: 181rpx; align-items: flex-start; padding: 15rpx 23rpx 0; box-sizing: border-box; gap: 16rpx; }
.brand-scroll { width: 100%; height: 142rpx; white-space: nowrap; }
/* scroll-view 横向滚动推荐写法：inline-block + nowrap，避免品牌折行 */
.brand-list { display: inline-block; white-space: nowrap; padding-right: 160rpx; }
/* 品牌项：图标圆 92rpx + 名称 38rpx，inline-flex 保证图标与名称竖排 */
.brand-item { display: inline-flex; flex-shrink: 0; min-width: 92rpx; margin-right: 31rpx; flex-direction: column; align-items: center; gap: 12rpx; color: #1d2129; font-size: 21rpx; line-height: 38rpx; text-align: center; white-space: nowrap; vertical-align: top; }
.brand-icon { position: relative; display: flex; width: 92rpx; height: 92rpx; align-items: center; justify-content: center; border-radius: 50%; background: transparent; }
.brand-logo { position: relative; z-index: 2; display: block; width: 67rpx; height: 67rpx; }
/* 圆形边框图：位于 logo **下层**（品牌 icon 必须完整显示、不被圆环压住边缘；圆环中心透明，隔在下面照样能看到外圈） */
.brand-ring { position: absolute; top: 0; left: 0; z-index: 1; display: block; width: 92rpx; height: 92rpx; }
.brand-name { padding: 0 10rpx; border-radius: 999rpx; }
/* 选中态：名称橙色胶囊白字（图标已不铺白底，选中高亮由圆形边框图 border.png 体现） */
.brand-item.selected .brand-icon { background: transparent; }
.brand-item.selected .brand-name { background: #ff5500; color: #fff; }
/* 展开按钮：贴右、浮在品牌之上；左侧渐变到品牌条底色做遮罩，避免品牌透出显得突兀 */
.brand-expand-button { position: absolute; top: 15rpx; right: 0; z-index: 5; display: flex; height: 146rpx; align-items: center; padding-right: 6rpx; box-sizing: border-box; background: linear-gradient(90deg, rgba(234, 247, 239, 0) 0%, #eaf7ef 38%); }
.brand-expand-surface { position: relative; display: flex; width: 92rpx; height: 140rpx; flex-direction: column; align-items: center; justify-content: center; gap: 10rpx; background: transparent; color: #1d2129; }
/* 展开按钮圆形底（Figma Frame 97 / Rectangle 3）：60×60px ⇒ 60 × 1.923 ≈ 115rpx。
   色值 #567F65 透明度 15%；设计稿带 LAYER_BLUR，这里用径向渐变近似那层柔光。 */
.brand-expand-glow { position: absolute; top: 15rpx; left: 50%; width: 115rpx; height: 115rpx; margin-left: -57rpx; border-radius: 50%; background: radial-gradient(circle, rgba(86, 127, 101, .15) 0%, rgba(86, 127, 101, .15) 62%, rgba(86, 127, 101, 0) 100%); }
.brand-expand-text { width: 28rpx; color: #1d2129; font-size: 24rpx; line-height: 30rpx; text-align: center; word-break: break-all; }
.brand-expand-icon { display: flex; flex-direction: column; align-items: center; }
.brand-expand-bars { color: #1d2129; font-size: 28rpx; line-height: 22rpx; }
.brand-expand-arrow { color: #1d2129; font-size: 22rpx; line-height: 18rpx; }
.brand-expanded-layer { position: absolute; inset: 0; z-index: 10; background: rgba(0, 0, 0, .5); }
.brand-expanded-panel { position: absolute; top: 0; left: 0; width: 100%; min-height: 600rpx; overflow: hidden; background: #fff; }
.brand-expanded-grid { position: relative; display: grid; grid-template-columns: repeat(5, 1fr); row-gap: 31rpx; padding: 15rpx 31rpx 0; box-sizing: border-box; }
.brand-expanded-grid .brand-item { display: flex; width: auto; margin-right: 0; }
.brand-collapse { position: relative; display: flex; height: 69rpx; align-items: center; justify-content: center; gap: 8rpx; color: #4e5969; font-size: 23rpx; line-height: 40rpx; }
.brand-collapse-arrow { font-size: 28rpx; line-height: 1; }
@media (prefers-reduced-motion: reduce) { .brand-expand-surface { transition: none; } }
</style>
