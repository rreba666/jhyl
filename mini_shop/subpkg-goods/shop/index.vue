<script setup lang="ts">
/**
 * C 端 · 店铺页（Figma 节点 `4045:5815`，`店铺_首页_两项`，390×1007）。
 *
 * ## 设计口径（全部取自实现说明的**实测值**，不是眼估）
 * | 区块 | 设计 y 区间 | 高 | 度量 |
 * |---|---|---|---|
 * | 渐变头图 | 0 → 248 | 248 | `linear-gradient(180deg, #704138 0%, #9A674D 100%)`（渲染图逐点核对一致） |
 * | 导航栏 | 0 → 92 | 48+44 | 白色返回箭头 + **居中白色标题**；不画 iOS 胶囊（微信原生提供） |
 * | 店铺卡 | 92 → 235 | 143 | ⚠️ **透明卡**（产品已定：白填充 `visible:false` 不画成白卡），白字压渐变 |
 * | 资质条 | 235 → 291 | 56 | `#FFF4E8`，圆角 **上12/上12/下0/下0** |
 * | 白内容区 | 279 → 1007 | 728 | 圆角 12/12/0/0，与资质条**重叠 12px** |
 * | Tab 栏 | 279 → 321 | 42 | 底部 1px `#F1F2F4`；选中 `#FF5500` + 28×2 下划线 |
 * | 筛选行 | 321 → 369 | 48 | 选中：`#FFF4E8` + 1px `#FF5500` 描边；未选中：`#F6F7F9` |
 * | 商品网格 | 369 → 967 | 598 | 每行 2 张、卡宽 177、列间距 12、行间距 24 |
 *
 * ## 与设计的差异（都要显式说明，不许"看起来差不多"）
 * 1. **负间距**：`Frame 130` 用 `itemSpacing = -12` 做「白卡压住资质条 12px」。
 *    小程序 flex 的 `gap` **不支持负值** ⇒ 这里改成 `margin-top: -23rpx`（= -12 设计 px）
 *    加在白内容区上，并用**文档顺序**保证层级（资质条在前 = 在下层，白卡在后 = 压在上面）。
 *    没有用 `z-index`：两条都不带定位，顺序即层级，少一个魔法值。
 * 2. **导航栏**：设计里它在渐变头图内部（48 系统栏 + 44 标题栏，共 92）。
 *    实现取「真实状态栏高度 + 44px」并**固定**在顶部（否则滚下去就没有返回入口了），
 *    背景用同一渐变的 **0→92 切片**（`#704138 → #7F4F40`，端点取自渲染图在 y=92 的实测色），
 *    这样未滚动时与 477rpx 的头图渐变**视觉连续**，滚动后返回箭头依然在。
 * 3. **无阴影**：设计里白卡那条 `DROP_SHADOW #E66A00@20%` 是 `visible:false` ⇒ 实现**不加阴影**
 *    （且 `clips` 也会裁掉向上偏移的阴影，见实现说明 §1.3 注解）。
 *
 * ## ⚠️ 数据现实（本页最大的约束）
 * 契约里**没有** C 端「单店详情」接口（`api_doc.json` 全量枚举：C 端公开侧只有 `/api/shop/all`
 * 与 `/api/shop/deliverable`）⇒ 本页的店铺档案走 `getShopById()`（拉全量启用门店再按 id 过滤，
 * 见 `api/shop.ts` 的注释与实现说明 §4.3 第 3 条）。
 *
 * 设计里这些元素**现有契约一个字段都没有**，因此**一律不渲染**（不编文案、不放 `0`/`—`、不硬编码
 * 设计稿的填充数字 `5.0` / `3484 粉丝` / `97.2%` / `12小时` / `14秒`）：
 * - 店铺**评分**：契约无 `rating`（`MerchantOverviewVO.serviceScore` 是**恒 null 占位**，不得挪用）；
 * - 店铺**粉丝数**：契约无 `fansCount`（`ShopVO.boundUserCount` = 「已绑定微信人数」，**语义不同**）；
 * - **服务表现**三格：契约无服务指标字段；
 * - **店铺收藏**：契约无关注/收藏店铺的读写接口（全库只有**商品**收藏）。
 * 缺口清单/优先级见 `docs/26/10.09/店铺页-Figma实现说明-2026-10-09.md` §4.3。
 *
 * **商品网格**同样被阻塞：`GET /api/product/list` 的 `shopId` 契约原文写明「PC 后台按门店筛选；
 * **C 端不传**」⇒ 本页**不发这个请求**（后端若忽略 `shopId`，页面会把全商城商品显示成"这家店的商品"
 * = 伪造归属关系）⇒ 只渲染网格外壳 + 空态占位，等后端确认 C 端口径或补
 * `GET /api/shop/{shopId}/products`（实现说明 §4.3 第 1 条，P0）。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getShopById, type EnabledShop } from '@/api/shop'
import type { ProductCard } from '@/api/product'

/** 页面入参：`/subpkg-goods/shop/index?shopId=…`（进店卡片跳转过来）。 */
const shopId = ref('')
/** 店铺档案；`null` = 未加载/未命中。 */
const shop = ref<EnabledShop | null>(null)
const loading = ref(true)
/** 取数失败（网络/接口异常）——与「店铺不存在」必须分开显示。 */
const errorMessage = ref('')
/** 门店不在「启用门店」列表里（已停用/被删除/id 不存在）。 */
const notFound = ref(false)

/** 真实状态栏高度（px）；导航栏高度 = 状态栏 + 设计稿的 **44px 标题栏**。 */
const statusBarHeight = ref(0)
const navHeight = computed(() => statusBarHeight.value + 44)

/** 导航标题：优先店铺名（真实数据），未加载时用设计稿写的平台标题。 */
const navTitle = computed(() => String(shop.value?.name || '').trim() || '非遗老号')
const logo = computed(() => String(shop.value?.shopImage || '').trim())

/**
 * 当前 Tab（`首页` / `商品`）。
 * ⚠️ 设计只给了「首页」选中态的示例，**两个 Tab 的内容差异未定义**（实现说明 §5 第 7 条：
 *    「商品」Tab 是否就是同一份筛选 + 网格？）。因此这里**只做真实的前端状态切换**，
 *    内容区暂时共用同一套外壳；后端补齐「按门店查商品」后再按产品口径分叉。
 */
const activeTab = ref<'home' | 'goods'>('home')

/**
 * 当前排序。设计给了三个筛选项，映射关系（实现说明 §4.2）：
 * - `销量` → `sortBy=sold_desc` ✅ 契约支持；
 * - `价格` → `sortBy=price_asc|price_desc` ✅ 契约支持（图标上三角=升序、下三角=降序）；
 * - `口碑优品` → ⚠️ 契约**没有**对应枚举（`reputation_desc` 需后端补，§4.3 第 9 条）
 *   ⇒ 点它只给一句中性提示，**不切换选中态**（不能假装它已生效）。
 */
const activeSort = ref<'sold' | 'price'>('sold')
/** 价格排序方向：`asc` = 从低到高（设计稿渲染图里**上三角为深色** ⇒ 默认升序）。 */
const priceOrder = ref<'asc' | 'desc'>('asc')

/**
 * 店铺商品列表。
 *
 * ⚠️ **永远是空数组**：C 端「按门店查商品」的口径后端尚未确认（`/api/product/list` 的 `shopId`
 * 注明"C 端不传"，见文件头注释）⇒ 本页**不发该请求**。等后端确认后在这里接
 * `getProductList({ shopId, sortBy })` 即可，模板里的网格已经是按设计做好的。
 */
const products = ref<ProductCard[]>([])

/** 读页面参数并加载店铺档案。 */
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
    notFound.value = true
    loading.value = false
    return
  }
  try {
    shop.value = await getShopById(shopId.value)
    // 后端只返回**启用**门店 ⇒ 没命中就是「不存在 / 已停用 / 被删除」，如实显示，不编造店铺。
    notFound.value = !shop.value
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '店铺信息加载失败'
  } finally {
    loading.value = false
  }
})

/** 返回上一级；没有历史页面时回首页。 */
function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1 })
    return
  }
  uni.switchTab({ url: '/pages/index/index' })
}

/** 切换到指定 Tab（内容差异未定义，见 `activeTab` 注释）。 */
function switchTab(tab: 'home' | 'goods'): void {
  activeTab.value = tab
}

/** 选择排序项；`价格` 再点一次反转升降序。 */
function selectSort(sort: 'sold' | 'price'): void {
  if (sort === 'price' && activeSort.value === 'price') {
    priceOrder.value = priceOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }
  activeSort.value = sort
  if (sort === 'price') priceOrder.value = 'asc'
}

/**
 * 「口碑优品」：契约里 `sortBy` 没有对应枚举（实现说明 §4.3 第 9 条）⇒ 只给中性提示，
 * 不改选中态、不发请求（不假装生效）。
 */
function onReputationTap(): void {
  uni.showToast({ title: '该排序暂未开放', icon: 'none' })
}

/**
 * 「收藏」按钮：契约里**没有**店铺关注/收藏的读接口，也没有写接口
 * （`favorite` + `POST/DELETE /api/shop/{shopId}/favorite`，实现说明 §4.3 第 6 条）
 * ⇒ 按钮按设计渲染，但**不伪造已收藏状态**、也不发请求，只如实提示功能未开放。
 */
function onFavoriteTap(): void {
  uni.showToast({ title: '店铺收藏功能暂未开放', icon: 'none' })
}

/**
 * 「经营资质」：契约里没有资质内容接口、也没有资质页（实现说明 §4.3 第 8 条）
 * ⇒ 不静默留死链，点它给一句中性提示。
 */
function onQualificationTap(): void {
  uni.showToast({ title: '经营资质页暂未开放', icon: 'none' })
}

/** 打开商品详情（网格做出来后的既有跳转口径）。 */
function openProduct(product: ProductCard): void {
  if (!product?.id) return
  uni.navigateTo({ url: `/subpkg-goods/detail/detail?id=${encodeURIComponent(String(product.id))}` })
}

/** 价格展示：去掉整数金额后多余的 `.00`（与详情页 `formatAmount` 同口径）。 */
function formatAmount(value: number): string {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '')
}
</script>

<template>
  <view class="shop-page">
    <!-- 渐变头图层：设计里它是 `layoutPositioning=ABSOLUTE` 的**背景层**，
         不能进 flex 流（否则会占位把内容顶下去 —— 实现说明 §7.5）。
         高度 248 设计 px = 477rpx；y≥246 的部分会被资质条/白卡盖住，留出圆角处的渐变。 -->
    <view class="hero-gradient" />

    <!-- 导航栏：固定在最上方（滚下去也要能返回），背景取同一渐变的 0→92 切片。 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px`, height: `${navHeight}px` }">
      <!-- 返回箭头：设计是 9×17 白色折线（`#FFFFFF@90%`）；用两根边框旋转画，零切图。 -->
      <view class="nav-back" @click="goBack">
        <view class="nav-back-arrow" />
      </view>
      <text class="nav-title">{{ navTitle }}</text>
    </view>

    <!-- 内容层：顶部让出导航栏高度（= 设计里店铺卡的起点 y=92）。 -->
    <view class="shop-body" :style="{ paddingTop: `${navHeight}px` }">
      <view v-if="loading" class="page-state"><text>加载中...</text></view>
      <view v-else-if="errorMessage" class="page-state"><text>{{ errorMessage }}</text></view>
      <view v-else-if="notFound" class="page-state"><text>店铺不存在或已停业</text></view>

      <template v-else>
        <!-- ① 店铺卡：**透明卡**（产品已定）——白字直接压在渐变上，不画白底。
             圆角 12、内边距 上12/右12/下16/左12、纵向间距 16（设计值）。 -->
        <view class="shop-card">
          <view class="shop-card-head">
            <image v-if="logo" class="shop-logo" :src="logo" mode="aspectFill" />
            <view class="shop-card-main">
              <text class="shop-name">{{ shop?.name }}</text>
              <!-- ⚠️ 评分行（星级 + `5.0`）与粉丝数（`3484 粉丝`）在设计里是**写死的填充文案**，
                   契约里既没有 `rating` 也没有 `fansCount` ⇒ 整行不渲染。
                   注意：不得用 `MerchantOverviewVO.serviceScore`（恒 null 占位）或
                   `ShopVO.boundUserCount`（已绑定微信人数）顶替。 -->
            </view>
            <!-- 「收藏」按钮：设计 66×28 圆角 4，填充是**渐变** `#FF9900 → #FF3C00`
                 （方向 handle (0,0)→(1,1) = 左上→右下 ⇒ 135deg），文案白字 12px。
                 点击只提示（店铺收藏读写接口缺失，见 onFavoriteTap 注释）。 -->
            <view class="shop-fav" @click="onFavoriteTap">
              <text class="shop-fav-star">★</text>
              <text class="shop-fav-text">收藏</text>
            </view>
          </view>

          <!-- ⚠️ 服务表现三格（128/116/103 × 55，`#FFFFFF@10%`，圆角 6，左对齐）：
               契约无服务指标字段 ⇒ 整行不渲染（不放假数据）。 -->
        </view>

        <!-- ② 资质条：`#FFF4E8`，只有上圆角 12，内边距 上12/右12/下24/左12（下 24 是给白卡压叠留的）。 -->
        <view class="qualification-bar">
          <!-- ⚠️ 「店铺资质」在设计稿里是**转曲 VECTOR**（节点 `4045:5860`，67×14，#8C5D2A），
               节点树里**没有文字** ⇒ 文案待设计提供。这里按需求做成**占位 + 明确标注**，
               **不自己编文案**（实现说明 §7.2）。 -->
          <view class="qualification-label">
            <text class="qualification-placeholder">待设计提供文案</text>
          </view>
          <view class="qualification-link" @click="onQualificationTap">
            <view class="cert-badge"><text class="cert-check">✓</text></view>
            <text class="qualification-text">经营资质</text>
            <view class="qualification-arrow" />
          </view>
        </view>

        <!-- ③ 白内容区：圆角 12/12/0/0，`padding-bottom` 40px（设计值），
             ⚠️ `margin-top: -23rpx` 就是 `Frame 130` 的 **`gap: -12`**（负间距）在本平台的等价实现：
               小程序 flex 的 `gap` 不支持负值，只能用负外边距让白卡压住资质条 12 设计 px。
               层级靠**文档顺序**（资质条先渲染 = 在下层）。 -->
        <view class="shop-content">
          <!-- Tab 栏：390×42，底部 1px `#F1F2F4`（INSIDE）；两个等宽 195。 -->
          <view class="tab-bar">
            <view class="tab" @click="switchTab('home')">
              <text class="tab-text" :class="{ 'tab-text-active': activeTab === 'home' }">首页</text>
              <view v-if="activeTab === 'home'" class="tab-underline" />
            </view>
            <view class="tab" @click="switchTab('goods')">
              <text class="tab-text" :class="{ 'tab-text-active': activeTab === 'goods' }">商品</text>
              <view v-if="activeTab === 'goods'" class="tab-underline" />
            </view>
          </view>

          <!-- 筛选行：390×48，内边距 12，横向间距 8。 -->
          <view class="filter-row">
            <!-- 选中态：`#FFF4E8` 底 + 1px `#FF5500` 描边，文案 `#FF5500` -->
            <view class="filter-chip" :class="{ 'filter-chip-active': activeSort === 'sold' }" @click="selectSort('sold')">
              <text class="filter-text" :class="{ 'filter-text-active': activeSort === 'sold' }">销量</text>
            </view>
            <!-- 未选中态：`#F6F7F9` 底、无描边；`价格` 带 12×12 排序双三角
                 （上三角 `#1D2129` = 升序生效中，下三角 `#86909C` = 未生效）。 -->
            <view class="filter-chip" :class="{ 'filter-chip-active': activeSort === 'price' }" @click="selectSort('price')">
              <text class="filter-text" :class="{ 'filter-text-active': activeSort === 'price' }">价格</text>
              <view class="sort-arrows">
                <view class="sort-arrow-up" :class="{ 'sort-arrow-on': activeSort === 'price' && priceOrder === 'asc' }" />
                <view class="sort-arrow-down" :class="{ 'sort-arrow-on': activeSort === 'price' && priceOrder === 'desc' }" />
              </view>
            </view>
            <view class="filter-chip" @click="onReputationTap">
              <text class="filter-text">口碑优品</text>
            </view>
          </view>

          <!-- ④ 商品网格（设计：左右内边距 12、列间距 12、行间距 24、卡宽 177）。
               ⚠️ `products` 恒为空数组（C 端按门店筛选的商品接口未落地，见文件头注释）
               ⇒ 现在只会渲染下面的空态占位，**不伪造任何商品**。 -->
          <view v-if="products.length" class="goods-grid">
            <view v-for="product in products" :key="product.id" class="goods-card" @click="openProduct(product)">
              <view class="goods-image-wrap">
                <!-- 设计里图片容器是 177×177 圆角 8，内层图 `scaleMode=FILL` 被裁成方形。 -->
                <image class="goods-image" :src="product.mainImage" mode="aspectFill" />
              </view>
              <view class="goods-info">
                <text class="goods-title">{{ product.descriptionTitle || product.name }}</text>
                <text v-if="product.description" class="goods-selling">{{ product.description }}</text>
                <view class="goods-price">
                  <!-- 设计里 `¥` 与数字**字号不同**（`styleOverrides=8`）⇒ 两段 text，不写成一整串。 -->
                  <text class="goods-price-symbol">¥</text>
                  <text class="goods-price-value">{{ formatAmount(product.price) }}</text>
                </view>
              </view>
            </view>
          </view>
          <view v-else class="goods-empty">
            <text class="goods-empty-text">店铺商品暂未开放</text>
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<style>
/* 页面根：底色 `#F2F3F7`（设计值），并给渐变头图层一个**定位上下文**（`position: relative`），
   否则绝对定位的背景层会挂到初始包含块上、行为依赖平台实现。
   `overflow-x: hidden` 是仓库既有的 iOS 横向溢出兜底。 */
page { background: #F2F3F7; overflow-x: hidden; }
.shop-page { position: relative; min-height: 100vh; background: #F2F3F7; overflow-x: hidden; }

/* ① 渐变头图层（设计 0→248 设计 px）。色值 = 节点树的 GRADIENT_LINEAR 端点，
   且与渲染图逐点取色核对一致（实现说明 §1.2 表）。 */
.hero-gradient { position: absolute; top: 0; left: 0; right: 0; height: 477rpx; background: linear-gradient(180deg, #704138 0%, #9A674D 100%); }

/* ② 导航栏（固定）：背景是上面那条渐变的 **0→92 切片**，
   终点 `#7F4F40` 取渲染图在 y=92 的实测色（线性插值同为 #7F4F40）。 */
.nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, #704138 0%, #7F4F40 100%); box-sizing: border-box; }
/* 返回热区 40×44，右内边距 12 / 左内边距 16（设计值 → 23rpx / 31rpx） */
.nav-back { position: absolute; left: 0; bottom: 0; display: flex; align-items: center; width: 77rpx; height: 85rpx; padding-left: 31rpx; box-sizing: content-box; }
/* 箭头：9×17 的白色折线（#FFFFFF@90%）—— 边框旋转 45° 画法，不引入切图。 */
.nav-back-arrow { width: 17rpx; height: 17rpx; border-left: 4rpx solid rgba(255, 255, 255, 0.9); border-bottom: 4rpx solid rgba(255, 255, 255, 0.9); transform: rotate(45deg); }
/* 标题：17px/600/行高 23.8，`#FFFFFF`，水平居中（实现说明 §1.3 导航栏） */
.nav-title { max-width: 420rpx; overflow: hidden; color: #FFFFFF; font-size: 33rpx; font-weight: 600; line-height: 46rpx; white-space: nowrap; text-overflow: ellipsis; }

.page-state { padding: 200rpx 32rpx; color: #86909C; text-align: center; font-size: 26rpx; }

/* ③ 店铺卡：**透明**（产品决策，设计稿的白填充 visible:false 不画）。
   内边距 上12/右12/下16/左12（23/23/31/23rpx），纵向间距 16（31rpx）。 */
.shop-card { padding: 23rpx 23rpx 31rpx; }
.shop-card-head { display: flex; align-items: center; }
/* logo 44×44 圆角 6 */
.shop-logo { width: 85rpx; height: 85rpx; flex: none; border-radius: 12rpx; background: rgba(255, 255, 255, 0.1); }
/* 左组与 logo 间距 12（设计 Frame 130 gap=12 → 23rpx），与按钮间距 20（→ 38rpx） */
.shop-card-main { flex: 1; min-width: 0; margin-left: 23rpx; margin-right: 38rpx; display: flex; flex-direction: column; justify-content: center; }
/* 店名 16px/600/行高 24，白色 */
.shop-name { color: #FFFFFF; font-size: 31rpx; font-weight: 600; line-height: 46rpx; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
/* 「收藏」按钮 66×28 圆角 4，渐变 #FF9900 → #FF3C00（左上→右下），内边距 上4/右12/下4/左12，间距 4 */
.shop-fav { display: flex; align-items: center; flex: none; height: 54rpx; padding: 8rpx 23rpx; border-radius: 8rpx; background: linear-gradient(135deg, #FF9900 0%, #FF3C00 100%); box-sizing: border-box; }
.shop-fav-star { color: #FFFFFF; font-size: 25rpx; line-height: 38rpx; }
.shop-fav-text { margin-left: 8rpx; color: #FFFFFF; font-size: 23rpx; line-height: 38rpx; }

/* ④ 资质条：390×56（108rpx），`#FFF4E8`，**只有上圆角 12**，左右两侧 space-between、垂直居中。 */
.qualification-bar { display: flex; align-items: center; justify-content: space-between; height: 108rpx; padding: 23rpx 23rpx 46rpx; border-radius: 23rpx 23rpx 0 0; background: #FFF4E8; box-sizing: border-box; }
/* 「店铺资质」占位：设计里是转曲矢量字 67×14 `#8C5D2A`，**文案待设计提供** ⇒ 虚线占位 + 明确标注。 */
.qualification-placeholder { color: #8C5D2A; font-size: 21rpx; line-height: 30rpx; }
.qualification-label { display: flex; align-items: center; height: 35rpx; padding: 0 12rpx; border: 2rpx dashed #8C5D2A; border-radius: 6rpx; box-sizing: border-box; }
.qualification-link { display: flex; align-items: center; }
/* 绿色认证徽标 18×18（内部矢量 15×15 `#00B42A`）：实心圆 + 白色对勾字形，零切图。 */
.cert-badge { display: flex; align-items: center; justify-content: center; width: 35rpx; height: 35rpx; border-radius: 50%; background: #00B42A; }
.cert-check { color: #FFFFFF; font-size: 23rpx; line-height: 1; }
/* 「经营资质」13px/400/行高 20，`#86909C` */
.qualification-text { margin-left: 8rpx; color: #86909C; font-size: 25rpx; line-height: 38rpx; }
.qualification-arrow { width: 13rpx; height: 13rpx; margin-left: 8rpx; border-top: 3rpx solid #86909C; border-right: 3rpx solid #86909C; transform: rotate(45deg); }

/* ⑤ 白内容区：圆角 12/12/0/0 + 底部留白 40px（77rpx）。
   ⚠️ `margin-top: -23rpx` = 设计里 `Frame 130` 的 `gap: -12`（小程序 gap 不支持负值）。 */
.shop-content { margin-top: -23rpx; padding-bottom: 77rpx; border-radius: 23rpx 23rpx 0 0; background: #FFFFFF; }

/* Tab 栏：390×42（81rpx），底部 1px `#F1F2F4`（INSIDE）；两个等宽。 */
.tab-bar { display: flex; align-items: stretch; height: 81rpx; border-bottom: 2rpx solid #F1F2F4; box-sizing: border-box; }
.tab { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
/* 选中：14px/500 `#FF5500`；未选中：`#1D2129`。 */
.tab-text { color: #1D2129; font-size: 27rpx; font-weight: 500; line-height: 42rpx; }
.tab-text-active { color: #FF5500; }
/* 下划线 28×2（54×4rpx），与文案间距 8（15rpx） */
.tab-underline { width: 54rpx; height: 4rpx; margin-top: 15rpx; background: #FF5500; }

/* 筛选行：390×48（92rpx），内边距 12（23rpx），横向间距 8（15rpx）。 */
.filter-row { display: flex; align-items: center; height: 92rpx; padding: 23rpx; box-sizing: border-box; }
.filter-chip { display: flex; align-items: center; justify-content: center; height: 46rpx; margin-right: 15rpx; padding: 4rpx 15rpx; border: 2rpx solid transparent; border-radius: 8rpx; background: #F6F7F9; box-sizing: border-box; }
/* 选中项：`#FFF4E8` 底 + 1px `#FF5500` INSIDE 描边（小程序无 inset 描边 ⇒ 用透明占位的同一根边框换色，
   保证选中前后**尺寸不变**、不引发跳动）。 */
.filter-chip-active { border-color: #FF5500; background: #FFF4E8; }
.filter-text { color: #1D2129; font-size: 23rpx; line-height: 38rpx; }
.filter-text-active { color: #FF5500; }
/* 排序双三角 12×12：上三角 `#1D2129`（升序生效）/ 下三角 `#86909C`（未生效）。 */
.sort-arrows { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 23rpx; height: 23rpx; margin-left: 4rpx; }
.sort-arrow-up { width: 0; height: 0; border-right: 6rpx solid transparent; border-bottom: 6rpx solid #86909C; border-left: 6rpx solid transparent; }
.sort-arrow-down { width: 0; height: 0; margin-top: 3rpx; border-top: 6rpx solid #86909C; border-right: 6rpx solid transparent; border-left: 6rpx solid transparent; }
.sort-arrow-up.sort-arrow-on { border-bottom-color: #1D2129; }
.sort-arrow-down.sort-arrow-on { border-top-color: #1D2129; }

/* 商品网格：左右内边距 12（23rpx），列间距 12（23rpx），行间距 24（46rpx），卡宽 177（340rpx） */
.goods-grid { display: flex; flex-wrap: wrap; padding: 0 23rpx; box-sizing: border-box; }
.goods-card { width: 340rpx; margin-right: 23rpx; margin-bottom: 46rpx; }
.goods-card:nth-child(2n) { margin-right: 0; }
/* 图片容器 177×177 圆角 8（340rpx / 15rpx） */
.goods-image-wrap { width: 340rpx; height: 340rpx; overflow: hidden; border-radius: 15rpx; background: #F2F3F7; }
.goods-image { width: 100%; height: 100%; }
.goods-info { display: flex; flex-direction: column; margin-top: 15rpx; }
/* 标题 14px/600/行高 22，两行截断（设计高 44 = 2×22）；截断用仓库既有的 line-clamp 写法 */
.goods-title { display: -webkit-box; overflow: hidden; color: #1D2129; font-size: 27rpx; font-weight: 600; line-height: 42rpx; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
/* 卖点 13px/400/行高 20，`#FF7B2E`，一行 */
.goods-selling { display: -webkit-box; overflow: hidden; margin-top: 8rpx; color: #FF7B2E; font-size: 25rpx; line-height: 38rpx; -webkit-box-orient: vertical; -webkit-line-clamp: 1; }
/* 价格行：`¥` 小一号 + 金额 14px/600，`#FF5500` */
.goods-price { display: flex; align-items: baseline; margin-top: 23rpx; }
.goods-price-symbol { color: #FF5500; font-size: 22rpx; line-height: 42rpx; }
.goods-price-value { margin-left: 4rpx; color: #FF5500; font-size: 27rpx; font-weight: 600; line-height: 42rpx; }

/* 空态占位：商品列表接口未落地（C 端按门店筛选未承诺）⇒ 如实说明，不伪造商品。 */
.goods-empty { display: flex; align-items: center; justify-content: center; padding: 140rpx 24rpx; }
.goods-empty-text { color: #86909C; font-size: 26rpx; }
</style>
