import { request } from './request'
import type { SysConfigItem, SysConfigRawList, SysConfigResponse, SysConfigUpdate } from '@/types/sysConfig'

/**
 * 系统配置管理接口层（平台级可调参数）。
 *
 * 依据：`docs/26/10.09/前端对接说明-商品级抽成与提现口径-2026-10-08.md` §2；`api_doc.json`。
 *
 * | 方法 | 路径 | 说明 |
 * |---|---|---|
 * | GET | `/api/admin/sys-config/list` | 白名单项（key / 类型 / 最小最大值 / 默认值 / 当前值 / 说明 / 是否可写） |
 * | PUT | `/api/admin/sys-config/{key}` | `{ value, remark? }`；**仅超管 / 财务可写**，其余角色只读（越权 `1004`） |
 *
 * ## 三条必须守住的口径
 * 1. **不做白名单副本**：那 5 个初始可调项（平台默认让利比例、提现手续费率与提现门槛/上限）是**后端**的白名单，
 *    ⛔ 前端**不得**写死一份 —— 白名单会加项/改范围，前端写死就会出现"后端有、页面没有"的静默缺口。
 *    页面渲染的是 `list` 返回什么就显示什么（含后端给的最小/最大值）。
 * 2. **非白名单键由后端拒绝**（`1004` / 参数错误），前端只**从 list 里取 key**，不构造新键。
 * 3. **值是字符串**：`value` 原样传给后端，前端不做数值/百分比换算。
 *
 * ⚠️ 字段名风险：`list` 的出参是 `Map<String,Object>`，**schema 为空、字段名无契约**。
 * 故 {@link pickText} 等一律走**多别名 + 大小写/下划线不敏感**的读取，并把原始对象整份带回页面。
 */

/** 后端响应校验（与其它模块同形；错误文案统一做旧词兜底）。 */
function ensureSuccess<T>(result: SysConfigResponse<T>, fallback: string): T {
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 字段名归一化：去掉下划线/连字符并转小写（`default_value` / `defaultValue` 视为同一个名字）。 */
function normalizeFieldName(name: string): string {
  return name.replace(/[_-]/g, '').toLowerCase()
}

/** 在一行原始对象里按**别名集合**取值（命中即返回；都取不到返回 `undefined`）。 */
function pickRaw(row: Record<string, unknown>, aliases: string[]): unknown {
  const wanted = aliases.map(normalizeFieldName)
  for (const [name, value] of Object.entries(row)) {
    if (wanted.includes(normalizeFieldName(name))) return value
  }
  return undefined
}

/**
 * 取文本：`null` / `undefined` / 空串一律返回 `null`（= 后端没给）。
 *
 * ⚠️ **不要**在这里给任何默认值（那正是"伪造数据"）：页面拿到 `null` 会显示「—」。
 */
function pickText(row: Record<string, unknown>, aliases: string[]): string | null {
  const value = pickRaw(row, aliases)
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

/** 取数值（用于最小值 / 最大值）：非有限数按"后端没给"处理（`null`）。 */
function pickNumber(row: Record<string, unknown>, aliases: string[]): number | null {
  const value = pickRaw(row, aliases)
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 取可写标记。
 * ⚠️ 兼容两种相反写法：`writable=true` 与 `readonly=true`（后者取反）。
 * 都没给时**按不可写**处理（fail-closed：宁可让运营看到"不可写"去找后端确认，
 * 也不要给一个假的可写按钮、点下去必然 `1004`）。
 */
function pickWritable(row: Record<string, unknown>): boolean {
  const writable = pickRaw(row, ['writable', 'canWrite', 'isWritable', 'editable', 'isEditable', 'writeable'])
  if (writable !== undefined) return writable === true || writable === 'true' || writable === 1 || writable === '1'
  const readonly = pickRaw(row, ['readonly', 'readOnly', 'isReadonly', 'readOnlyFlag', 'readonlyFlag'])
  if (readonly !== undefined) {
    const isReadonly = readonly === true || readonly === 'true' || readonly === 1 || readonly === '1'
    return !isReadonly
  }
  return false
}

/**
 * 单行归一化。
 *
 * ⚠️ `key` 是**唯一有文档依据**的字段名（spec §2 明写 `key` / PUT 路径参数），所以它排第一顺位；
 * 其余别名只是兜底。识别不出 key 的行**照样渲染**（可以在"原始数据"里看到），但**禁止编辑**。
 */
export function normalizeSysConfigItem(value: unknown): SysConfigItem {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const key = pickText(row, ['key', 'configKey', 'itemKey', 'paramKey', 'sysKey', 'code'])
  return {
    key: key ?? '',
    keyRecognized: key !== null,
    type: pickText(row, ['type', 'valueType', 'dataType', 'paramType', 'configType']) ?? '',
    min: pickNumber(row, ['min', 'minValue', 'minimum', 'lowerLimit', 'minVal']),
    max: pickNumber(row, ['max', 'maxValue', 'maximum', 'upperLimit', 'maxVal']),
    defaultValue: pickText(row, ['defaultValue', 'default', 'defaultVal', 'defaultValueText']),
    value: pickText(row, ['value', 'currentValue', 'current', 'configValue', 'currentVal']),
    description: pickText(row, ['description', 'desc', 'remark', 'label', 'comment', 'note', 'name']) ?? '',
    writable: pickWritable(row),
    raw: row,
  }
}

/**
 * 读：白名单配置项列表（**无副作用**）。
 *
 * ⚠️ 返回 `[]` 与"接口失败"是**两件事**：这里只有真的拿到空数组才返回 `[]`，
 * 请求失败/`code≠0` 一律抛错，由页面显示"查询失败，本次结果不可用" ——
 * 不把失败渲染成"没有可配置项"（那会让运营以为平台没配置项）。
 */
export async function getSysConfigList(): Promise<SysConfigItem[]> {
  const response = await request.get<SysConfigResponse<SysConfigRawList>>('/api/admin/sys-config/list')
  const data = ensureSuccess(response.data, '系统配置查询失败')
  const list = Array.isArray(data) ? data : []
  return list.map(normalizeSysConfigItem)
}

/**
 * 写：修改某个白名单配置项。
 *
 * @param key 取 `list` 返回的 `key`（⛔ 不要手写/猜测键名，非白名单键后端一律拒绝）。
 * @param body `value` 为**字符串**原值；`remark` 可选，不填就传 `null`（**不编造默认备注**）。
 *
 * ⚠️ 越权（非超管/财务）后端返回 `1004`，被 `request.ts` 的响应拦截器统一转成 `Error`；
 * 前端另有一层"非超管/财务不渲染可编辑控件"的展示层收敛（见页面 `canWrite`）。
 */
export async function updateSysConfig(
  key: string,
  body: SysConfigUpdate,
): Promise<Record<string, unknown> | null> {
  const path = `/api/admin/sys-config/${encodeURIComponent(key)}`
  const response = await request.put<SysConfigResponse<Record<string, unknown> | null>>(path, body)
  return ensureSuccess(response.data, '配置项保存失败')
}
