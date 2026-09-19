<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
  { name: '胡庆余堂', image: '/static/figma-category/brands/hu-qing-yu-tang.webp' },
  { name: '湖北白鸭', image: '/static/figma-category/brands/hu-bei-bai-ya.webp' },
  { name: '方家铺子', image: '/static/figma-category/brands/fang-jia-pu-zi.webp' },
  { name: '海天', image: '/static/figma-category/brands/hai-tian.webp' },
  { name: '巧媳妇', image: '/static/figma-category/brands/qiao-xi-fu.webp' },
  { name: '火宫殿', image: '/static/figma-category/brands/huo-gong-dian.webp' },
  { name: '义利', image: '/static/figma-category/brands/yi-li.webp' },
  { name: '珠江桥牌', image: '/static/figma-category/brands/zhu-jiang-qiao-pai.webp' },
  { name: '张小泉', image: '/static/figma-category/brands/zhang-xiao-quan.webp' },
  { name: '稻香村', image: '/static/figma-category/brands/dao-xiang-cun.webp' },
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
const fallbackCategories: CategoryNode[] = [
  { id: 'nutrition', name: '营养膳食', icon: '' },
  { id: 'water', name: '风生水起', icon: '' },
  { id: 'paper', name: '纸定发财', icon: '' },
  { id: 'heritage', name: '非遗老号', icon: '' },
  { id: 'landmark', name: '国家地标', icon: '' },
]

const themeConfig = computed(() => {
  const base = theme.value === 'heritage'
    ? { title: '非遗老号', mode: 'grid' as const, hero: '', className: 'theme-heritage', fallbackImage: '/static/figma-category/product-main-heritage.webp', subtitle: '自然植萃麦角硫因&萝卜硫苷内外兼顾多项专利、实验临床', location: '', templateType: 'brandGrid' as const, headImageHeight: 0, backgroundColor: '#fff', categoryNames: ['非遗老号', '非遗老字号'] }
    : theme.value === 'landmark'
      ? { title: '膳食营养', mode: 'horizontal' as const, hero: '/static/figma-category/landmark-hero.webp', className: 'theme-landmark', fallbackImage: '/static/figma-category/product-main-2.webp', subtitle: '隆平低GI控糖稳血糖，高纤高蛋白双补，饱腹续航4小时+，0蔗糖0添加', location: '浙江-杭州', templateType: 'heroList' as const, headImageHeight: 476, backgroundColor: '#F6E7C8', categoryNames: ['国家地标', '膳食营养'] }
      : { title: '膳食营养', mode: 'horizontal' as const, hero: '/static/figma-category/nutrition-hero.webp', className: 'theme-nutrition', fallbackImage: '/static/figma-category/product-main-1.webp', subtitle: '隆平低GI控糖稳血糖，高纤高蛋白双补，饱腹续航4小时+，0蔗糖0添加', location: '', templateType: 'heroList' as const, headImageHeight: 696, backgroundColor: '#F6E7C8', categoryNames: ['营养膳食', '膳食营养'] }
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
    // 国家地标头图是横长图：默认 476；后端对未配置项兜底返回 696（与"真配 696"无法区分），
    // 故该页取到空或 696 时仍按 476 渲染，保证头图是横长长方形。
    headImageHeight: (l.landingKey === '国家地标' && (!l.headImageHeight || l.headImageHeight === 696)) ? 476 : (l.headImageHeight || base.headImageHeight),
    backgroundColor: l.backgroundColor ?? base.backgroundColor,
    // 商品分类：优先用落地页配置的分类（后台「分类」字段），未配置才用主题默认。
    categoryNames: (l.categoryNames?.filter(Boolean).length ? l.categoryNames.filter(Boolean) : base.categoryNames),
  }
})

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
  <view class="category-page" :class="themeConfig.className" :style="{ backgroundColor: themeConfig.backgroundColor || '' }">
    <view v-if="themeConfig.templateType !== 'brandGrid'" class="category-hero" :style="{ height: themeConfig.headImageHeight ? `${themeConfig.headImageHeight}rpx` : '' }">
      <image class="category-hero-image" :src="themeConfig.hero" mode="aspectFill" />
      <CategoryTopBar :title="themeConfig.title" :status-bar-height="statusBarHeight" :fixed="true" @back="goBack" />
    </view>

    <view v-else class="heritage-header">
      <image class="heritage-header-glow" src="/static/design-cuts/figma-category/heritage-header.webp" mode="scaleToFill" />
      <CategoryTopBar :title="themeConfig.title" :status-bar-height="statusBarHeight" :fixed="true" @back="goBack" />
      <view class="brand-strip">
        <scroll-view class="brand-scroll" scroll-x :show-scrollbar="false">
          <view class="brand-list">
            <view v-for="brand in brands" :key="brandKey(brand)" class="brand-item" :class="{ selected: selectedBrandKey === brandKey(brand) }" @click="selectBrand(brand)">
              <view class="brand-icon"><image class="brand-logo" :src="brand.image" mode="aspectFit" /></view>
              <text class="brand-name">{{ brand.name }}</text>
            </view>
          </view>
        </scroll-view>
        <view class="brand-expand-button" @click="brandExpanded = true">
          <view class="brand-expand-surface">
            <text class="brand-expand-text">展开</text>
            <view class="brand-expand-icon"><text class="brand-expand-bars">≡</text><text class="brand-expand-arrow">⌄</text></view>
          </view>
        </view>
      </view>
    </view>

    <view class="category-products" :class="{ 'products-grid': themeConfig.mode === 'grid' }" :style="{ backgroundColor: themeConfig.backgroundColor || '' }">
      <view v-if="loading" class="category-products-loading">加载中...</view>
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
        <image class="heritage-header-glow expanded" src="/static/design-cuts/figma-category/heritage-expanded-header.webp" mode="scaleToFill" />
        <CategoryTopBar :title="themeConfig.title" :status-bar-height="statusBarHeight" @back="goBack" />
        <view class="brand-expanded-grid">
          <view v-for="brand in expandedBrands" :key="brandKey(brand)" class="brand-item" :class="{ selected: selectedBrandKey === brandKey(brand) }" @click="selectBrand(brand)">
            <view class="brand-icon"><image class="brand-logo" :src="brand.image" mode="aspectFit" /></view>
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
.category-hero { position: relative; width: 100%; height: 696rpx; overflow: hidden; }
.category-hero-image { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.theme-landmark .category-hero { height: 476rpx; }
.category-products { position: relative; z-index: 2; margin-top: -24rpx; padding: 16rpx; box-sizing: border-box; border-radius: 24rpx 24rpx 0 0; background: #fae7c9; }
/* 头部固定（358rpx），商品区顶部让出同等高度；z-index 低于固定头部 */
.theme-heritage .category-products { z-index: 1; margin-top: 0; padding: 358rpx 23rpx 23rpx; border-radius: 0; background: #fff; }
.category-products-list { display: flex; flex-direction: column; gap: 16rpx; }
.category-products-waterfall { display: flex; align-items: flex-start; gap: 15rpx; }
.category-products-column { display: flex; width: calc((100% - 15rpx) / 2); flex-direction: column; gap: 46rpx; }
.category-product-slot { width: 100%; }
.category-products-loading { padding: 160rpx 0; color: #86909c; font-size: 28rpx; line-height: 44rpx; text-align: center; }
/* 非遗页头部整块固定：标题栏 + 品牌条不随商品滚动（与首页一致） */
.heritage-header { position: fixed; top: 0; right: 0; left: 0; z-index: 10; height: 358rpx; overflow: hidden; background: #fff; }
.heritage-header-glow { position: absolute; top: -204rpx; left: -216rpx; width: 1212rpx; height: 608rpx; opacity: .78; }
.heritage-header-glow.expanded { top: 0; left: 0; width: 100%; height: 100%; }
/* 品牌条紧贴导航栏下方（设计稿导航 177rpx 之下），不再留大段空白 */
.brand-strip { position: absolute; top: 177rpx; right: 0; left: 0; display: flex; height: 181rpx; align-items: flex-start; padding: 15rpx 23rpx 0; box-sizing: border-box; gap: 16rpx; }
.brand-scroll { width: 100%; height: 142rpx; white-space: nowrap; }
/* scroll-view 横向滚动推荐写法：inline-block + nowrap，避免品牌折行 */
.brand-list { display: inline-block; white-space: nowrap; padding-right: 160rpx; }
/* 品牌项：图标圆 92rpx + 名称 38rpx，inline-flex 保证图标与名称竖排 */
.brand-item { display: inline-flex; flex-shrink: 0; min-width: 92rpx; margin-right: 31rpx; flex-direction: column; align-items: center; gap: 12rpx; color: #1d2129; font-size: 21rpx; line-height: 38rpx; text-align: center; white-space: nowrap; vertical-align: top; }
.brand-icon { position: relative; display: flex; width: 92rpx; height: 92rpx; align-items: center; justify-content: center; border-radius: 50%; background: #f1f2f4; }
.brand-logo { position: relative; z-index: 1; display: block; width: 67rpx; height: 67rpx; }
.brand-name { padding: 0 10rpx; border-radius: 999rpx; }
/* 选中态：图标白底圆 + 名称橙色胶囊白字（设计稿） */
.brand-item.selected .brand-icon { background: #fff; }
.brand-item.selected .brand-name { background: #ff5500; color: #fff; }
/* 展开按钮：贴右、浮在品牌之上；左侧渐变到品牌条底色做遮罩，避免品牌透出显得突兀 */
.brand-expand-button { position: absolute; top: 15rpx; right: 0; z-index: 5; display: flex; height: 146rpx; align-items: center; padding-right: 6rpx; box-sizing: border-box; background: linear-gradient(90deg, rgba(234, 247, 239, 0) 0%, #eaf7ef 38%); }
.brand-expand-surface { display: flex; width: 92rpx; height: 140rpx; flex-direction: column; align-items: center; justify-content: center; gap: 10rpx; background: transparent; color: #1d2129; }
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
