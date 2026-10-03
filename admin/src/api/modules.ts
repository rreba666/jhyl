/**
 * 功能模块开关（V2 模块配置）接口层。
 *
 * 用途：让运营在后台控制小程序各功能模块的**启停**，
 * 例如关掉「商家入驻」入口（小程序 `pages/mine/mine.vue` 按 `merchant` 键显隐）。
 *
 * ⚠️ **停用模块的后果不只是隐藏前端入口**：后端会按该模块的 `pathPatterns` **拦截接口**
 *   （见 `ModuleConfigEntity.pathPatterns` 注释）⇒ 页面在关闭前必须把影响面展示清楚。
 *
 * ⚠️ 写入字段是 `name` / `enabled` / `sort`，**不是**读出来的 `moduleName` / `sortOrder`。
 */
import { request } from './request'
import type { ModuleConfigEntity, ModuleConfigSaveDTO, ModuleResponse } from '@/types/module'

/** 解包统一响应；`code !== 0` 或 `success === false` 视为失败并抛后端原文。 */
function unwrap<T>(response: { data: ModuleResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 模块配置列表（管理端，**含停用项**）。 */
export async function getModuleConfigList(): Promise<ModuleConfigEntity[]> {
  const data = unwrap(await request.get<ModuleResponse<unknown>>('/api/admin/v2/modules'), '模块配置查询失败')
  if (!Array.isArray(data)) return []
  // ⚠️ 做一个轻量防御：后端可能返回缺 `moduleKey` 的脏数据，过滤掉免得整页崩。
  return (data as ModuleConfigEntity[]).filter((item) => !!item && typeof item.moduleKey === 'string')
}

/**
 * 保存单个模块的配置（启停 / 名称 / 排序）。
 * @param key 模块标识（`moduleKey`），会做 URL 编码
 * @param payload ⚠️ 只能用 `name` / `enabled` / `sort` 三个字段
 */
export async function saveModuleConfig(key: string, payload: ModuleConfigSaveDTO): Promise<void> {
  unwrap(
    await request.put<ModuleResponse<unknown>>(`/api/admin/v2/modules/${encodeURIComponent(key)}`, payload),
    '模块配置保存失败',
  )
}
