<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type UploadRequestOptions } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import {
  getHomeConfigV2,
  getLandingConfigsV2,
  saveHomeConfigV2,
  saveLandingConfigsV2,
  uploadHomepageFile,
} from '@/api/homepage'
import { getAdminCategories } from '@/api/category'
import type { AdminCategory } from '@/types/category'
import type {
  HomeConfigV2,
  KingkongV2,
  LandingConfigV2,
  LinkType,
  MediaLinkV2,
  WelfareConfigV2,
  WelfareTabV2,
} from '@/types/homepage'

const LINK_TYPES: Array<{ value: LinkType; label: string }> = [
  { value: 'landing', label: '落地页' },
  { value: 'detail', label: '商品详情' },
  { value: 'page', label: '页面路径' },
  { value: 'url', label: '外部链接' },
  { value: 'miniprogram', label: '其他小程序' },
]
const LANDING_KEYS = ['nutrition', 'water', 'paper', 'heritage', 'landmark']
const LANDING_KEY_LABELS: Record<string, string> = { nutrition: '膳食营养', water: '风生水起', paper: '纸定发财', heritage: '非遗老号', landmark: '国家地标' }
function landingKeyLabel(key: string): string { return LANDING_KEY_LABELS[key] || key }

const loading = ref(false)
const saving = ref(false)
const activeHelp = ref<string[]>([])
/** 分类选项（下拉选择用：id + 名称；落地页按 id 取数，分类改名不受影响）。 */
const categoryOptions = ref<Array<{ id: number; name: string }>>([])

/** 递归收集分类（id + 名称，含子分类）。 */
function collectOptions(list: AdminCategory[], acc: Array<{ id: number; name: string }>): void {
  list.forEach((item) => {
    if (item.name) acc.push({ id: Number(item.id), name: item.name })
    if (item.children?.length) collectOptions(item.children, acc)
  })
}
async function loadCategories(): Promise<void> {
  try {
    const list = await getAdminCategories()
    const options: Array<{ id: number; name: string }> = []
    collectOptions(list, options)
    const seen = new Set<number>()
    categoryOptions.value = options.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
  } catch { categoryOptions.value = [] }
}
/** 按已选分类 id 同步分类名（categoryNames 作为冗余展示/兜底）。 */
function syncCategoryNames(key: string): void {
  const ids = landingMap[key].categoryIds || []
  landingMap[key].categoryNames = categoryOptions.value.filter((item) => ids.includes(item.id)).map((item) => item.name)
}
const uploading = ref(false)
const homeConfig = ref<HomeConfigV2>({ heroImages: [], kingkong: [], welfare: null })
/** 福利与资讯配置。 */
const welfareForm = reactive<WelfareConfigV2>({ title: '', backgroundUrl: '', tabs: [] })
/** 落地页配置：按 key 映射。 */
const landingMap = reactive<Record<string, LandingConfigV2>>({})
/** 当前选中的落地页（用于右侧预览）。 */
const activeLanding = ref('nutrition')

/** 手机预览主图高度（把配置的高度缩放到手机框内）。 */
function previewHeroHeight(h: number | undefined): string {
  const px = h && h > 0 ? h : 696
  return `${Math.round((px / 696) * 120)}px`
}

/** 初始落地页（默认值）。 */
function defaultLanding(key: string): LandingConfigV2 {
  const isHeritage = key === 'heritage'
  const title = key === 'heritage' ? '非遗老号' : key === 'landmark' ? '国家地标' : key === 'water' ? '风生水起' : key === 'paper' ? '纸定发财' : '膳食营养'
  return {
    landingKey: landingKeyLabel(key),
    templateType: isHeritage ? 'brandGrid' : 'heroList',
    headImageHeight: key === 'landmark' ? 476 : 696,
    backgroundColor: '',
    headImage: '',
    title,
    subtitle: '',
    location: '',
    layoutMode: isHeritage ? 'grid' : 'horizontal',
    headerMode: isHeritage ? 'brand' : 'hero',
    fallbackImage: '',
    brands: [],
    brandNames: isHeritage ? ['胡庆余堂', '湖北白鸭', '方家铺子'] : [],
    categoryIds: [],
    categoryNames: [],
  }
}

// 预初始化各 key 的默认值，避免模板在接口返回前访问 landingMap[key].xxx 报错。
LANDING_KEYS.forEach((key) => { landingMap[key] = defaultLanding(key) })

async function load(): Promise<void> {
  loading.value = true
  try {
    await loadCategories()
    homeConfig.value = await getHomeConfigV2()
    const w = homeConfig.value.welfare || null
    welfareForm.title = w?.title || ''
    welfareForm.subtitle = w?.subtitle || ''
    welfareForm.backgroundUrl = w?.backgroundUrl || ''
    welfareForm.tabs = [...(w?.tabs || [])].map((tab) => ({ ...tab }))
    const landingList = await getLandingConfigsV2()
    LANDING_KEYS.forEach((key) => {
      // 兼容存量数据：库里有的是「英文 landingKey + 中文 title」，这里按中文名或 title 命中，并统一规范成中文 landingKey。
      const label = landingKeyLabel(key)
      const found = landingList.find((item) => item.landingKey === label || item.title === label)
      if (found) {
        // 兼容存量：只有 brandNames（无 brands）时，用名称生成品牌列表（logo 待补）。
        const brands = found.brands?.length
          ? found.brands.map((item) => ({ name: item.name, logo: item.logo || '' }))
          : (found.brandNames || []).map((name) => ({ name, logo: '' }))
        // 兼容存量：只有 categoryNames（无 categoryIds）时，按名字反查一次 id（分类列表已先加载）。
        const categoryIds = found.categoryIds?.length
          ? found.categoryIds
          : categoryOptions.value.filter((item) => (found.categoryNames || []).includes(item.name)).map((item) => item.id)
        landingMap[key] = { ...found, landingKey: label, brands, categoryIds }
      } else {
        landingMap[key] = defaultLanding(key)
      }
    })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '配置加载失败')
  } finally {
    loading.value = false
  }
}

/** 上传单个图片，返回 URL。 */
async function uploadOne(options: UploadRequestOptions): Promise<string> {
  const file = options.file as File
  if (!file.type.startsWith('image/')) { ElMessage.error('请上传图片'); return '' }
  if (file.size > 10 * 1024 * 1024) { ElMessage.error('图片不能超过 10MB'); return '' }
  uploading.value = true
  try {
    return await uploadHomepageFile(file)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '上传失败')
    return ''
  } finally {
    uploading.value = false
  }
}

async function addHero(): Promise<void> {
  homeConfig.value.heroImages.push({ url: '', linkType: 'landing', linkValue: '' })
}
async function removeHero(i: number): Promise<void> { homeConfig.value.heroImages.splice(i, 1) }
async function uploadHero(i: number, options: UploadRequestOptions): Promise<void> {
  const url = await uploadOne(options)
  if (url) homeConfig.value.heroImages[i].url = url
}

async function addKingkong(): Promise<void> {
  homeConfig.value.kingkong.push({ label: '', icon: '', background: '', iconOffsetLeft: 0, iconOffsetTop: 0, linkType: 'landing', linkValue: '' })
}
async function removeKingkong(i: number): Promise<void> { homeConfig.value.kingkong.splice(i, 1) }
async function uploadKingkongIcon(i: number, options: UploadRequestOptions): Promise<void> {
  const url = await uploadOne(options)
  if (url) homeConfig.value.kingkong[i].icon = url
}
async function uploadKingkongBg(i: number, options: UploadRequestOptions): Promise<void> {
  const url = await uploadOne(options)
  if (url) homeConfig.value.kingkong[i].background = url
}
async function uploadHeadImage(key: string, options: UploadRequestOptions): Promise<void> {
  const url = await uploadOne(options)
  if (url) landingMap[key].headImage = url
}
async function uploadWelfareBg(options: UploadRequestOptions): Promise<void> {
  const url = await uploadOne(options)
  if (url) welfareForm.backgroundUrl = url
}
async function uploadWelfareImg(i: number, options: UploadRequestOptions): Promise<void> {
  const url = await uploadOne(options)
  if (url && welfareForm.tabs) welfareForm.tabs[i].imageUrl = url
}
function addWelfareTab(): void {
  welfareForm.tabs = welfareForm.tabs || []
  welfareForm.tabs.push({ label: '', imageUrl: '', jumpType: 'page', appId: '', path: '', enabled: 1, sortOrder: welfareForm.tabs.length + 1 })
}
function removeWelfareTab(i: number): void { welfareForm.tabs?.splice(i, 1) }

async function save(): Promise<void> {
  saving.value = true
  try {
    await saveHomeConfigV2({
      heroImages: homeConfig.value.heroImages.map((item) => ({ ...item })),
      kingkong: homeConfig.value.kingkong.map((item) => ({ ...item })),
      welfare: { title: welfareForm.title, subtitle: welfareForm.subtitle, backgroundUrl: welfareForm.backgroundUrl, tabs: [...(welfareForm.tabs || [])] },
    })
    // 统一口径：提交给后端的 landingKey 一律用中文；品牌由「商品品牌」模块按大类维护，落地页不再提交品牌。
    const landingList = LANDING_KEYS.map((key) => {
      const item = { ...landingMap[key] } as Record<string, unknown>
      delete item.brands
      return { ...item, landingKey: landingKeyLabel(key) }
    }).filter((item) => item.landingKey) as unknown as LandingConfigV2[]
    await saveLandingConfigsV2(landingList)
    ElMessage.success('配置已保存')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => { void load() })

function linkTypeLabel(type: LinkType): string {
  return LINK_TYPES.find((item) => item.value === type)?.label || type
}
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div><h1>金刚区与落地页配置</h1><p>配置首页 hero 大图轮播、金刚区入口，以及金刚区落地页（含头图）。</p></div>
      <div class="heading-actions"><el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button><el-button type="primary" :loading="saving" @click="save">保存配置</el-button></div>
    </div>

    <el-collapse v-model="activeHelp" class="help-collapse">
      <el-collapse-item name="help" title="配置说明（点击展开 / 收起）">
        <ul class="help-list">
          <li><b>hero 大图轮播</b>：首页顶部横长图。传图（建议 2.6:1）+ 选跳转类型 / 填跳转值。</li>
          <li><b>金刚区</b>：首页图标入口。填名称 + 图标 + 背景 + 跳转；「+ 添加金刚区」控制数量。</li>
          <li><b>金刚区落地页</b>：点图标后打开的页面。选<b>模板类型</b>（大图+横向卡片 / 品牌条+双列），填主图高度、底色、头图、分类等。<br>膳食营养 / 国家地标：主要换「头图 + 主图高度 + 底色」；非遗老号：选大类分类后，<b>品牌条自动读取「商品品牌」模块里归属该大类的品牌</b>（无需在此配置品牌）。<br>商品卡上的<b>产地</b>取自<b>商品自身信息</b>（商品编辑里的产地），此处无需配置。</li>
          <li><b>福利与资讯</b>：底部板块。标题 + 背景图 + 页签（名称 / 大图 / 跳转类型 / 跳转配置 / 启用）。</li>
          <li>每项改完点右上角「<b>保存配置</b>」才生效；没配置项显示 No Data，小程序端回退默认，不白屏。</li>
        </ul>
      </el-collapse-item>
    </el-collapse>

    <el-card shadow="never" class="content-card">
      <div class="card-title">首页配置（左配置 · 右预览）</div>
      <div class="landing-layout">
        <div class="landing-pane">
          <div class="card-title">hero 大图轮播</div>
          <el-table :data="homeConfig.heroImages" border size="small">
            <el-table-column label="图片（含点击跳转）" min-width="360">
              <template #default="{ row, $index }">
                <div class="array-row">
                  <el-image v-if="row.url" :src="row.url" :preview-src-list="[row.url]" fit="cover" class="img-thumb-hero" preview-teleported />
                  <el-upload :show-file-list="false" :http-request="(o: UploadRequestOptions) => uploadHero($index, o)" accept="image/*">
                    <el-button size="small" :loading="uploading">上传</el-button>
                  </el-upload>
                  <el-select v-model="row.linkType" style="width:110px"><el-option v-for="t in LINK_TYPES" :key="t.value" :label="t.label" :value="t.value" /></el-select>
                  <el-input v-model="row.linkValue" placeholder="跳转值" style="width:150px" />
                  <el-button size="small" type="danger" link @click="removeHero($index)">删除</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <el-button link type="primary" @click="addHero">+ 添加大图</el-button>

          <div class="card-title" style="margin-top: 20px">金刚区</div>
          <el-table :data="homeConfig.kingkong" border size="small">
            <el-table-column label="名称" width="120"><template #default="{ row }"><el-input v-model="row.label" /></template></el-table-column>
            <el-table-column label="图标" width="150"><template #default="{ row, $index }"><div class="array-row"><el-image v-if="row.icon" :src="row.icon" :preview-src-list="[row.icon]" fit="cover" class="img-thumb" preview-teleported /><el-upload :show-file-list="false" :http-request="(o: UploadRequestOptions) => uploadKingkongIcon($index, o)" accept="image/*"><el-button size="small" :loading="uploading">上传</el-button></el-upload></div></template></el-table-column>
            <el-table-column label="背景" width="150"><template #default="{ row, $index }"><div class="array-row"><el-image v-if="row.background" :src="row.background" :preview-src-list="[row.background]" fit="cover" class="img-thumb" preview-teleported /><el-upload :show-file-list="false" :http-request="(o: UploadRequestOptions) => uploadKingkongBg($index, o)" accept="image/*"><el-button size="small" :loading="uploading">上传</el-button></el-upload></div></template></el-table-column>
            <el-table-column label="图标偏移" width="160"><template #default="{ row }"><div class="array-row"><el-input-number v-model="row.iconOffsetLeft" :step="1" size="small" /><el-input-number v-model="row.iconOffsetTop" :step="1" size="small" /></div></template></el-table-column>
            <el-table-column label="跳转" min-width="230"><template #default="{ row }"><div class="array-row"><el-select v-model="row.linkType" style="width:110px"><el-option v-for="t in LINK_TYPES" :key="t.value" :label="t.label" :value="t.value" /></el-select><el-input v-model="row.linkValue" placeholder="跳转值" /></div></template></el-table-column>
            <el-table-column label="操作" width="80"><template #default="{ $index }"><el-button size="small" type="danger" link @click="removeKingkong($index)">删除</el-button></template></el-table-column>
          </el-table>
          <el-button link type="primary" @click="addKingkong">+ 添加金刚区</el-button>
        </div>

        <div class="landing-pane landing-pane-preview">
          <div class="phone-frame">
            <div class="phone-screen">
              <div class="phone-home-search">老字号精选好物</div>
              <el-image v-if="homeConfig.heroImages[0]?.url" class="phone-home-hero" :src="homeConfig.heroImages[0].url" fit="cover"><template #error><div class="phone-img-error">图未加载</div></template></el-image>
              <div class="phone-home-kingkong">
                <div v-for="item in homeConfig.kingkong" :key="item.label" class="phone-home-kk">
                  <div class="phone-home-kk-icon-wrap"><img class="phone-home-kk-icon" :src="item.icon" /></div>
                  <span class="phone-home-kk-label">{{ item.label }}</span>
                </div>
              </div>
              <div class="phone-home-products">
                <div class="phone-home-section-title"><span>精选好物</span><span class="phone-home-toggle">⊞ ≡</span></div>
                <div class="phone-home-product">
                  <div class="phone-home-product-imgbox"><img class="phone-home-product-img" :src="homeConfig.kingkong[0]?.icon || ''" /></div>
                  <div class="phone-home-product-info">
                    <div class="phone-home-product-name">商品标题</div>
                    <div class="phone-home-product-desc">详情描述 · 安心品质</div>
                    <div class="phone-home-product-foot"><span class="phone-home-product-price">¥25.00</span><span class="phone-home-product-buy">立即购买</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="muted phone-preview-tip">▲ 模拟首页（实际以小程序端为准）</div>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" class="content-card">
      <div class="card-title">金刚区落地页（左配置 · 右预览）</div>
      <el-tabs v-model="activeLanding">
        <el-tab-pane v-for="key in LANDING_KEYS" :key="key" :name="key" :label="landingKeyLabel(key)">
          <div class="landing-layout">
            <div class="landing-pane">
              <el-form label-width="90px" size="small">
                <el-form-item v-if="landingMap[key].templateType !== 'brandGrid'" label="头图">
                  <div class="array-row">
                    <el-image v-if="landingMap[key].headImage" :src="landingMap[key].headImage" :preview-src-list="[landingMap[key].headImage]" fit="cover" class="img-thumb" preview-teleported />
                    <el-upload :show-file-list="false" :http-request="(o: UploadRequestOptions) => uploadHeadImage(key, o)" accept="image/*">
                      <el-button :loading="uploading">上传头图</el-button>
                    </el-upload>
                  </div>
                </el-form-item>
                <el-form-item label="标题"><el-input v-model="landingMap[key].title" /></el-form-item>
                <el-form-item label="模板类型">
                  <el-radio-group v-model="landingMap[key].templateType"><el-radio value="heroList">大图 + 横向卡片</el-radio><el-radio value="brandGrid">品牌条 + 双列</el-radio></el-radio-group>
                </el-form-item>
                <el-form-item v-if="landingMap[key].templateType !== 'brandGrid'" label="主图高度"><el-input-number v-model="landingMap[key].headImageHeight" :min="0" :step="10" controls-position="right" /><span class="muted" style="margin-left:8px">px（大图模板）</span></el-form-item>
                <el-form-item label="底色"><el-color-picker v-model="landingMap[key].backgroundColor" /><span class="muted" style="margin-left:8px">页面底色</span></el-form-item>
                <el-form-item v-if="landingMap[key].templateType !== 'brandGrid'" label="布局">
                  <el-radio-group v-model="landingMap[key].layoutMode"><el-radio value="grid">双列瀑布</el-radio><el-radio value="horizontal">横向卡片</el-radio></el-radio-group>
                </el-form-item>
                <el-form-item label="副文案"><el-input v-model="landingMap[key].subtitle" /></el-form-item>
                <el-form-item label="占位图">
                  <div class="array-row"><el-upload :show-file-list="false" :http-request="(o: UploadRequestOptions) => uploadHeadImage(key, o)" accept="image/*"><el-button>上传</el-button></el-upload></div>
                </el-form-item>
                <el-form-item label="分类">
                  <el-select v-model="landingMap[key].categoryIds" multiple filterable collapse-tags collapse-tags-tooltip :collapse-tags-limit="5" placeholder="选择分类（该落地页展示的商品）" style="width:100%" @change="syncCategoryNames(key)">
                    <el-option v-for="c in categoryOptions" :key="c.id" :label="c.name" :value="c.id" />
                  </el-select>
                </el-form-item>
              </el-form>
            </div>

            <div class="landing-pane landing-pane-preview">
              <div class="phone-frame">
                <div class="phone-screen" :style="{ backgroundColor: landingMap[key].backgroundColor || '#fff' }">
                  <template v-if="landingMap[key].templateType !== 'brandGrid'">
                    <div class="phone-hero-wrap">
                      <el-image v-if="landingMap[key].headImage" class="phone-hero" :src="landingMap[key].headImage" :style="{ height: previewHeroHeight(landingMap[key].headImageHeight) }" fit="cover"><template #error><div class="phone-img-error">图未加载（地址不可访问）</div></template></el-image>
                      <div v-else class="phone-hero phone-hero-empty" :style="{ height: previewHeroHeight(landingMap[key].headImageHeight) }" />
                      <div class="phone-hero-nav"><span class="phone-back">‹</span><span class="phone-nav-title">{{ landingMap[key].title }}</span></div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="phone-nav"><span class="phone-back">‹</span><span class="phone-nav-title">{{ landingMap[key].title }}</span></div>
                    <div class="phone-brands"><div v-for="b in landingMap[key].brandNames" :key="b" class="phone-brand">{{ b }}</div></div>
                  </template>
                  <div class="phone-body">
                    <div v-if="landingMap[key].subtitle" class="phone-subtitle">{{ landingMap[key].subtitle }}</div>
                    <div class="phone-products" :class="landingMap[key].layoutMode === 'grid' ? 'products-grid' : 'products-list'">
                      <div v-for="i in 2" :key="i" class="phone-product">
                        <img class="phone-product-img" :src="landingMap[key].fallbackImage" />
                        <div class="phone-product-info">
                          <div class="phone-product-name">{{ landingMap[key].subtitle }}</div>
                          <div v-if="landingMap[key].location" class="phone-location">{{ landingMap[key].location }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="muted phone-preview-tip">▲ 模拟预览（实际以小程序端为准）</div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-card shadow="never" class="content-card">
      <div class="card-title">福利与资讯</div>
      <el-form label-width="90px" size="small">
        <el-form-item label="标题"><el-input v-model="welfareForm.title" style="max-width:420px" /></el-form-item>
        <el-form-item label="背景图">
          <div class="array-row">
            <el-image v-if="welfareForm.backgroundUrl" :src="welfareForm.backgroundUrl" :preview-src-list="[welfareForm.backgroundUrl]" fit="cover" class="img-thumb" preview-teleported />
            <el-upload :show-file-list="false" :http-request="(o: UploadRequestOptions) => uploadWelfareBg(o)" accept="image/*"><el-tooltip content="建议方形图，用作板块背景"><el-button :loading="uploading">上传</el-button></el-tooltip></el-upload>
          </div>
        </el-form-item>
      </el-form>
      <div class="landing-block">
        <div class="landing-title">页签（更多福利/今华有礼/更多资讯）</div>
        <el-table :data="welfareForm.tabs" border size="small">
          <el-table-column label="名称" min-width="110"><template #default="{ row }"><el-input v-model="row.label" /></template></el-table-column>
          <el-table-column label="大图" min-width="190"><template #default="{ row, $index }"><div class="array-row"><el-image v-if="row.imageUrl" :src="row.imageUrl" :preview-src-list="[row.imageUrl]" fit="cover" class="img-thumb-welfare" preview-teleported /><el-upload :show-file-list="false" :http-request="(o: UploadRequestOptions) => uploadWelfareImg($index, o)" accept="image/*"><el-tooltip content="点击上传图片（建议横图 700×320）"><el-button size="small" :loading="uploading">上传</el-button></el-tooltip></el-upload></div></template></el-table-column>
          <el-table-column label="跳转类型" min-width="200"><template #default="{ row }"><el-select v-model="row.jumpType" clearable placeholder="无" style="width:100%"><el-option label="小程序" value="miniprogram" /><el-option label="页面" value="page" /><el-option label="外链" value="url" /></el-select></template></el-table-column>
          <el-table-column label="跳转配置" min-width="260"><template #default="{ row }"><el-input v-if="row.jumpType === 'miniprogram'" v-model="row.appId" placeholder="目标小程序 appId" /><el-input v-else-if="row.jumpType === 'page'" v-model="row.path" placeholder="小程序页面路径" /><el-input v-else-if="row.jumpType === 'url'" v-model="row.appId" placeholder="外部链接 URL" /><span v-else class="muted">选择上方跳转类型后填写</span></template></el-table-column>
          <el-table-column label="启用" width="70"><template #default="{ row }"><el-switch v-model="row.enabled" :active-value="1" :inactive-value="0" /></template></el-table-column>
          <el-table-column label="操作" width="70"><template #default="{ $index }"><el-button size="small" type="danger" link @click="removeWelfareTab($index)">删除</el-button></template></el-table-column>
        </el-table>
        <el-button link type="primary" @click="addWelfareTab">+ 添加页签</el-button>
      </div>
    </el-card>

    <div class="form-footer"><el-button type="primary" :loading="saving" @click="save">保存配置</el-button></div>
  </section>
</template>

<style scoped>
.content-card { margin-bottom: 16px; }
.card-title { margin-bottom: 12px; font-size: 15px; font-weight: 600; }
.array-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.array-row .el-input { min-width: 60px; }
.img-thumb { width: 56px; height: 56px; border-radius: 6px; flex-shrink: 0; background: #f2f3f5; }
.img-thumb-hero { width: 188px; height: 72px; border-radius: 6px; flex-shrink: 0; background: #f2f3f5; }
.img-thumb-welfare { width: 100px; height: 46px; border-radius: 6px; flex-shrink: 0; background: #f2f3f5; }
.heading-actions { display: flex; align-items: center; gap: 10px; }
.muted { color: var(--vben-muted); font-size: 13px; }
.help-collapse { margin-bottom: 16px; border: 1px solid var(--vben-border); border-radius: 8px; }
.help-list { margin: 0; padding: 4px 18px 8px; color: var(--vben-text); font-size: 13px; line-height: 24px; list-style: none; }
.help-list li { position: relative; margin-bottom: 6px; padding-left: 14px; }
.help-list li::before { position: absolute; top: 9px; left: 2px; width: 4px; height: 4px; border-radius: 50%; background: var(--vben-primary); content: ''; }
.landing-block { margin-bottom: 20px; padding: 16px; border: 1px solid var(--vben-border); border-radius: 8px; }
.landing-title { margin-bottom: 12px; font-weight: 600; }
.landing-layout { display: flex; gap: 24px; align-items: flex-start; }
.landing-pane { flex: 1; min-width: 0; }
.landing-pane-preview { flex: 0 0 260px; display: flex; flex-direction: column; align-items: center; }
.phone-frame { width: 232px; padding: 10px; border-radius: 22px; background: #111827; box-shadow: 0 6px 20px rgba(0,0,0,.18); }
.phone-screen { width: 212px; height: 400px; overflow: hidden; border-radius: 14px; background: #fff; }
.phone-nav { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; color: #1f2937; font-size: 12px; font-weight: 600; }
.phone-back { color: #98a2b3; font-size: 16px; }
.phone-nav-title { flex: 1; text-align: center; }
.phone-hero { display: block; width: 100%; }
.phone-hero-wrap { position: relative; }
.phone-hero-empty { background: #f2f3f5; }
.phone-hero-nav { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; color: #fff; font-size: 12px; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,.35); }
.phone-img-error { display: grid; width: 100%; height: 100%; place-items: center; background: #f2f3f5; color: #98a2b3; font-size: 10px; }
.phone-brands { display: flex; gap: 6px; padding: 8px 10px; overflow: hidden; }
.phone-brand { flex-shrink: 0; padding: 3px 8px; border-radius: 10px; background: #f2f3f5; color: #4e5969; font-size: 11px; }
.phone-body { padding: 8px 10px; }
.phone-subtitle { margin-bottom: 8px; color: #1f2937; font-size: 11px; line-height: 16px; }
.phone-products.products-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.phone-products.products-list { display: flex; flex-direction: column; gap: 8px; }
.phone-product { display: flex; flex-direction: column; overflow: hidden; border: 1px solid #eceef1; border-radius: 6px; background: #fff; }
.phone-products.products-list .phone-product { flex-direction: row; }
.phone-product-img { width: 100%; height: 84px; background: #f2f3f5; }
.phone-products.products-list .phone-product-img { width: 76px; height: 76px; flex: 0 0 76px; }
.phone-product-info { padding: 6px; min-width: 0; }
.phone-product-name { display: -webkit-box; overflow: hidden; color: #1f2937; font-size: 10px; line-height: 14px; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.phone-location { margin-top: 4px; color: #98a2b3; font-size: 10px; }
.phone-preview-tip { margin-top: 8px; text-align: center; }
.phone-home-search { margin: 8px 10px; padding: 6px 10px; border-radius: 12px; background: #f2f3f5; color: #98a2b3; font-size: 10px; }
.phone-home-hero { display: block; width: 100%; height: 88px; background: #f2f3f5; }
.phone-home-kingkong { display: flex; flex-wrap: wrap; padding: 10px; }
.phone-home-kk { display: flex; flex-direction: column; align-items: center; flex: 0 0 20%; min-width: 0; }
.phone-home-kk-icon-wrap { width: 34px; height: 34px; border-radius: 50%; overflow: hidden; background: #f2f3f5; display: flex; align-items: center; justify-content: center; }
.phone-home-kk-icon { width: 30px; height: 30px; }
.phone-home-kk-label { margin-top: 3px; overflow: hidden; color: #4e5969; font-size: 9px; white-space: nowrap; text-overflow: ellipsis; }
.phone-home-products { padding: 0 10px 10px; }
.phone-home-section-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; color: #1f2937; font-size: 12px; font-weight: 700; }
.phone-home-toggle { color: #98a2b3; font-size: 10px; font-weight: 400; }
.phone-home-product { display: flex; gap: 8px; padding: 8px; border: 1px solid #eceef1; border-radius: 8px; background: #fff; }
.phone-home-product-imgbox { width: 56px; height: 56px; overflow: hidden; border-radius: 6px; background: #f2f3f5; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.phone-home-product-img { width: 100%; height: 100%; }
.phone-home-product-info { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.phone-home-product-name { color: #1f2937; font-size: 10px; line-height: 14px; }
.phone-home-product-desc { color: #86909c; font-size: 9px; line-height: 13px; }
.phone-home-product-foot { display: flex; align-items: center; justify-content: space-between; margin-top: auto; }
.phone-home-product-price { color: #ff661a; font-size: 12px; font-weight: 600; }
.phone-home-product-buy { padding: 3px 9px; border-radius: 999rpx; background: linear-gradient(135deg, #ffb341, #ff5500); color: #fff; font-size: 9px; }
.form-footer { display: flex; justify-content: flex-end; margin-top: 8px; }
</style>
