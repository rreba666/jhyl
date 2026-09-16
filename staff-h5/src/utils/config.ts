import { request } from '@/api/request'

/**
 * 多品牌配置拉取层（staff-h5 核销端）
 * ------------------------------------------------------------
 * 依据：docs/plan/frontend-types.ts（契约）+ api-integration.md
 * 职责：
 *  1. 拉取当前品牌模块开关（隆平后端已提供 GET /api/v2/modules）
 *  2. 提供 isModuleEnabled 兜底（配置为空/异常 → 全功能开启，兼容线上）
 */

/** 模块配置项 */
export interface ModuleConfig {
  key: string
  name: string
  enabled: 0 | 1
  sort: number
}

/**
 * 拉取当前品牌模块启停（隆平后端已提供 GET /api/v2/modules）。
 * 返回全部模块（含停用），basic 恒 enabled=1；失败返回 null，调用方按全部启用兜底。
 */
export function getModules(): Promise<ModuleConfig[] | null> {
  return request<ModuleConfig[]>('/api/v2/modules', { method: 'GET' })
    .then((data) => (Array.isArray(data) ? data : null))
    .catch(() => null)
}

/** 模块是否启用；配置缺失/为空时兜底 true（默认全部启用，兼容线上）。 */
export function isModuleEnabled(modules: ModuleConfig[] | undefined | null, key: string): boolean {
  if (!modules || modules.length === 0) return true
  const m = modules.find((x) => x.key === key)
  return m ? m.enabled === 1 : true
}
