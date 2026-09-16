export type HomepageEnabled = 0 | 1
export type HomepageEnabledValue = HomepageEnabled | '0' | '1' | boolean

export interface HomepageConfigSaveDTO {
  description: string
  logoUrl?: string
  imageUrl: string[]
  videoUrl: string[]
  coverUrl: string[]
  linkTarget: string[]
  bottomImageUrl: string[]
  bottomLinkTarget: string[]
  bottomTitle: string
  isEnabled: HomepageEnabled
}

export type HomepageConfigUpdateDTO = Partial<HomepageConfigSaveDTO>

export interface HomepageMediaItem {
  id: number | string
  description: string
  logoUrl?: string
  imageUrl: string[]
  videoUrl: string[]
  coverUrl: string[]
  linkTarget: string[]
  bottomImageUrl: string[]
  bottomLinkTarget: string[]
  bottomTitle: string
  isEnabled?: HomepageEnabledValue
}

export interface HomepageConfigVO extends HomepageMediaItem {
  isEnabled?: HomepageEnabledValue
}

export interface HomepageProductCard {
  id?: number
  name?: string
  mainImage?: string
  price?: number
  tag?: string
  soldCount?: number
  descriptionTitle?: string
  recommendTextEnabled?: HomepageEnabledValue
}

export interface HomepageVO {
  mediaList: HomepageMediaItem[]
  recommendedProducts: HomepageProductCard[]
}

export interface HomepageResponse<T> {
  code: number
  message: string
  data: T
  success?: boolean
}

/** V2 跳转类型。 */
export type LinkType = 'landing' | 'detail' | 'page' | 'url' | 'miniprogram'

/** hero 大图 + 跳转（MediaLinkV2）。 */
export interface MediaLinkV2 {
  url: string
  linkType: LinkType
  linkValue: string
}

/** 首页金刚区配置项（KingkongV2）。 */
export interface KingkongV2 {
  label: string
  icon: string
  background: string
  iconOffsetLeft?: number
  iconOffsetTop?: number
  linkType: LinkType
  linkValue: string
}

/** 首页配置（HomeConfigV2DTO）。 */
export interface HomeConfigV2 {
  heroImages: MediaLinkV2[]
  kingkong: KingkongV2[]
  welfare?: WelfareConfigV2 | null
}

/** 福利页签（WelfareTabV2）。 */
export interface WelfareTabV2 {
  key?: string
  label: string
  imageUrl?: string
  jumpType?: string
  appId?: string
  path?: string
  enabled?: number
  sortOrder?: number
}

/** 福利区配置（WelfareConfigV2DTO）。 */
export interface WelfareConfigV2 {
  title?: string
  subtitle?: string
  backgroundUrl?: string
  tabs?: WelfareTabV2[]
}

/** 金刚区落地页配置（LandingConfigV2DTO）。 */
export interface LandingConfigV2 {
  landingKey: string
  /** 模板类型：heroList=大图+横向卡片（膳食营养/国家地标）；brandGrid=品牌条+双列（非遗老号）。 */
  templateType?: 'heroList' | 'brandGrid'
  /** 主图高度（px，仅 heroList 用）。 */
  headImageHeight?: number
  /** 页面底色（hex）。 */
  backgroundColor?: string
  headImage: string
  title: string
  subtitle?: string
  location?: string
  layoutMode: 'grid' | 'horizontal'
  headerMode: 'hero' | 'brand'
  fallbackImage?: string
  /** 品牌（名称 + logo），品牌条模板使用；后台可增删并上传 logo。 */
  brands?: Array<{ name: string; logo: string }>
  brandNames: string[]
  /** 关联分类 id 列表（推荐：按 id 取数，分类改名不影响）。 */
  categoryIds?: number[]
  categoryNames: string[]
}
