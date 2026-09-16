import { request } from '@/utils/request'

/** V2 跳转类型 */
export type LinkType = 'landing' | 'detail' | 'page' | 'url' | 'miniprogram'

/** hero 大图 + 跳转（MediaLinkV2） */
export interface MediaLinkV2 {
  url: string
  linkType: LinkType
  linkValue: string
}

/** 首页金刚区配置项（KingkongV2） */
export interface KingkongItem {
  label: string
  icon: string
  background: string
  iconOffsetLeft: number
  iconOffsetTop: number
  linkType: LinkType
  linkValue: string
}

/** 首页福利（V2） */
export interface WelfareTabV2 {
  key: string
  label: string
  imageUrl: string
  jumpType: string
  appId: string
  path: string
  enabled: number
  sortOrder: number
}
export interface WelfareConfigV2 {
  title: string
  subtitle: string
  backgroundUrl: string
  tabs: WelfareTabV2[]
}

export interface HomepageMediaItem {
  id: string
  description: string
  logoUrl?: string
  imageUrl: string[]
  videoUrl: string[]
  coverUrl: string[]
  linkTarget: string[]
  bottomImageUrl: string[]
  bottomLinkTarget: string[]
  bottomTitle: string
  isEnabled: number
}

export interface HomepageProduct {
  id: string
  name: string
  mainImage: string
  price: number
  /** 划线价/原价（元），纯展示，为 null 表示无划线价。 */
  minOriginalPrice?: number
  /** 兼容字段：部分接口返回 originalPrice 而非 minOriginalPrice。 */
  originalPrice?: number
  tag?: string
  soldCount?: number
  descriptionTitle?: string
  recommendTextEnabled?: 0 | 1 | '0' | '1' | boolean
}

export interface HomepageData {
  mediaList: HomepageMediaItem[]
  recommendedProducts: HomepageProduct[]
  /** V2：大图轮播（含跳转）。 */
  heroImages?: MediaLinkV2[]
  /** V2：金刚区。 */
  kingkong?: KingkongItem[]
  /** V2：福利区。 */
  welfare?: WelfareConfigV2 | null
}

/** 保留底部推荐两个固定位置，避免缺失图片后下标发生位移。 */
export function normalizeBottomRecommendationSlots(value: unknown): string[] {
  const source = Array.isArray(value) ? value : []
  return [0, 1].map((index) => (typeof source[index] === 'string' ? source[index] : ''))
}

/** 获取小程序首页聚合数据。 */
export async function getHomepageData(): Promise<HomepageData> {
  const data = await request<HomepageData>({ url: '/api/v2/homepage', method: 'GET' })
  return {
    ...data,
    mediaList: (data.mediaList || []).map((item) => ({
      ...item,
      bottomImageUrl: normalizeBottomRecommendationSlots(item.bottomImageUrl),
      bottomLinkTarget: normalizeBottomRecommendationSlots(item.bottomLinkTarget),
    })),
  }
}

/** 获取商品分类树。 */
export function getCategoryList<T = unknown>(): Promise<T> {
  return request<T>({ url: '/api/category/list', method: 'GET' })
}

/** 金刚区落地页配置（LandingConfigV2DTO）。 */
export interface LandingConfigV2 {
  landingKey: string
  /** 中文友好名（后台展示）。 */
  name?: string
  /** 模板类型：heroList=大图+横向卡片；brandGrid=品牌条+双列。 */
  templateType?: 'heroList' | 'brandGrid'
  headImage: string
  /** 主图高度（px，仅 heroList 用）。 */
  headImageHeight?: number
  /** 页面底色（hex）。 */
  backgroundColor?: string
  title: string
  subtitle?: string
  location?: string
  layoutMode: 'grid' | 'horizontal'
  headerMode: 'hero' | 'brand'
  fallbackImage?: string
  /** 品牌（名称 + logo 图），品牌条模板使用。 */
  brands?: Array<{ name: string; logo: string }>
  brandNames: string[]
  /** 关联分类 id 列表（后端直出；优先按 id 取数，分类改名不影响）。 */
  categoryIds?: number[]
  categoryNames: string[]
}

/** 读取单个落地页配置；landingKey 走查询参数（中文只编码在 query，不拼进路径）。不存在返回 null，前端回退默认。 */
export async function getLandingConfig(landingKey: string): Promise<LandingConfigV2 | null> {
  const result = await request<LandingConfigV2 | null>({ url: `/api/v2/landing?landingKey=${encodeURIComponent(landingKey)}`, method: 'GET' })
  return result
}
