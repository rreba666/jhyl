/**
 * 多品牌配置拉取层（mini_shop）
 * ------------------------------------------------------------
 * 依据：docs/plan/frontend-types.ts（类型契约）+ api-integration.md（联调文档）
 * 职责：
 *  1. 拉取当前品牌的模块开关（GET /api/v2/modules）
 *  2. 拉取客户端聚合配置（GET /api/v2/setting/client-content：模块+主题+协议+标签+规则）
 *  3. 提供 isModuleEnabled 等兜底工具（配置为空/接口异常 → 全功能开启，兼容线上）
 */
import { request } from './request'
import { ref, type Ref } from 'vue'

// ============================================================================
// 一、类型定义（与 docs/plan/frontend-types.ts 对齐）
// ============================================================================

/** 模块 key（前端硬编码匹配；后端可动态增删，勿写死集合校验） */
export type ModuleKey =
  | 'basic'      // 基础商城（恒启用，不可停用）
  | 'delivery'   // 物流配送
  | 'pickup'     // 门店自提
  | 'samecity'   // 同城配送（本期仅开关占位，不开放下单）
  | 'wallet'     // 钱包/提现
  | 'promotion'  // 分销推广
  | 'aftersale'  // 售后
  | 'invoice'    // 发票

/** 模块配置项 */
export interface ModuleConfig {
  key: string
  name: string
  enabled: 0 | 1
  sort: number
}

/** 主题（白标） */
export interface ThemeV2 {
  brandTitle?: string
  brandSlogan?: string
  logoUrl?: string
  homeBackgroundUrl?: string
  mineBackgroundUrl?: string
  promotionBackgroundUrl?: string
  walletBackgroundUrl?: string
  promotionPosterBackgroundUrl?: string
  welfareBackgroundUrl?: string
  companyName?: string
  customerServicePhone?: string
  customerServiceEmail?: string
  aboutUsContent?: string
  version?: string
}

/** 法律协议段落 */
export interface LegalSectionV2 {
  heading: string
  paragraphs: string[]
}

/** 法律协议文档（公开版） */
export interface LegalDocumentPublicV2 {
  code: 'USER_AGREEMENT' | 'PRIVACY'
  title: string
  subtitle?: string
  sections: LegalSectionV2[]
  content: string
  version: string
  updateDate: string
  enabled: boolean
  publishedAt?: string
}

/** 服务标签 */
export interface ServiceTagV2 {
  key: string
  label: string
  iconUrl?: string
  enabled: 0 | 1
  sortOrder: number
}

/** 业务规则（提现/推广/红包） */
export interface ClientRulesV2 {
  withdraw?: {
    minAmount: number
    feeRate: number
    wechatBalanceEnabled: boolean
    bankCardEnabled: boolean
  }
  promotion?: { freezeDays: number }
  dividend?: {
    priceThreshold: number
    purchaseLimit: number
    bonusPoolRate: number
    capMultiplier: number
  }
  version?: string
  text?: string
}

/** 客户端聚合配置（一次拉全） */
export interface ClientContentV2 {
  clientRulesConfig?: ClientRulesV2
  themeConfig?: ThemeV2
  legalDocuments?: LegalDocumentPublicV2[]
  serviceTagItems?: ServiceTagV2[]
  modules?: ModuleConfig[]
}

// ============================================================================
// 二、拉取层
// ============================================================================

/**
 * 拉取当前品牌模块启停（隆平后端已提供 GET /api/v2/modules）。
 * 返回全部模块（含停用），basic 恒 enabled=1；失败返回 null，调用方按全部启用兜底。
 */
export function getModules(): Promise<ModuleConfig[] | null> {
  return request<ModuleConfig[]>({ url: '/api/v2/modules', method: 'GET' })
    .then((data) => (Array.isArray(data) ? data : null))
    .catch(() => null)
}

/** 拉取当前品牌客户端聚合配置（模块+主题+协议+标签+规则）。失败返回 null，调用方走默认值。 */
export function getClientContent(): Promise<ClientContentV2 | null> {
  return request<ClientContentV2>({ url: '/api/v2/setting/client-content', method: 'GET' })
    .then((data) => (data && typeof data === 'object' ? data : null))
    .catch(() => null)
}

// ============================================================================
// 三、兜底工具（核心守则：配置为空/异常 → 全功能开启，兼容线上）
// ============================================================================

/** 模块是否启用；配置缺失/为空时兜底 true（默认全部启用，与线上行为一致）。 */
export function isModuleEnabled(modules: ModuleConfig[] | undefined | null, key: string): boolean {
  if (!modules || modules.length === 0) return true
  const m = modules.find((x) => x.key === key)
  return m ? m.enabled === 1 : true
}

/** 从聚合配置中提取模块列表；无则返回 null（调用方按全部启用处理）。 */
export function modulesFromContent(content: ClientContentV2 | null): ModuleConfig[] | null {
  if (!content) return null
  return Array.isArray(content.modules) ? content.modules : null
}

/** 品牌名（白标）；未配置时返回空字符串，由页面兜底本地默认名。 */
export function brandNameFromContent(content: ClientContentV2 | null): string {
  return content?.themeConfig?.brandTitle?.trim() || ''
}

/** 是否还有下一页（配合 PageResult 分页）。 */
export function hasNextPage(pageResult: { page: number; pageSize: number; total: number }): boolean {
  return pageResult.page * pageResult.pageSize < pageResult.total
}

// ============================================================================
// 四、模块守卫（深链防护：模块停用时拦截页面并提示）
// ============================================================================

/**
 * 模块守卫：拉取当前品牌模块开关，判断指定模块是否启用。
 * 模块停用 → 拦截页面（提示「功能未开通」），实现深链防护。
 * 模块配置为空/异常 → 全部启用（兼容线上，不拦截）。
 */
export function useModuleGuard(moduleKey: string): {
  moduleConfig: Ref<ModuleConfig[] | null>
  moduleEnabled: Ref<boolean>
  loadModuleConfig: () => Promise<void>
} {
  const moduleConfig = ref<ModuleConfig[] | null>(null)
  const moduleEnabled = ref(true)

  /** 拉取模块开关并计算目标模块是否启用。 */
  async function loadModuleConfig(): Promise<void> {
    try {
      const modules = await getModules()
      moduleConfig.value = modules && modules.length ? modules : null
      moduleEnabled.value = isModuleEnabled(moduleConfig.value, moduleKey)
    } catch {
      moduleConfig.value = null
      moduleEnabled.value = true
    }
  }

  return { moduleConfig, moduleEnabled, loadModuleConfig }
}

