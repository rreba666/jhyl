import { request } from './request'
import type {
  VoiceChannelStatic,
  VoiceConfigData,
  VoiceConfigUpdate,
  VoiceConfigUpdateResult,
  VoiceResponse,
  VoiceSceneItem,
  VoiceTemplateUpdate,
  VoiceTemplateUpdateResult,
} from '@/types/voice'

/**
 * 语音配置后台接口层。
 *
 * 依据：`docs/20269231438/语音配置后台-前端对接说明-2026-09-24.md` §1。
 *
 * | 方法 | 路径 | 用途 |
 * |---|---|---|
 * | GET | `/api/admin/voice/config` | 全局参数 + 3 个场景的文案明细 |
 * | PUT | `/api/admin/voice/config` | 全局参数（模板码 / 显号 / 全局开关） |
 * | PUT | `/api/admin/voice/templates/{displayKey}` | 某个场景的播报文案模板 |
 *
 * - 改完**即时生效**（多实例最多滞后 `cacheTtlSeconds`，现为 30 秒）；
 * - 非超管 `403`；`1000` = 参数校验失败（`message` 可直接展示）。
 */

function unwrap<T>(response: { data: VoiceResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 数字兜底。 */
function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 布尔兜底。 */
function toBoolean(value: unknown): boolean {
  return value === true
}

/** 字符串数组兜底。 */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 渠道静态视图归一化（可空）。 */
function normalizeChannelStatic(value: unknown): VoiceChannelStatic | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<VoiceChannelStatic>
  return {
    templateCode: row.templateCode ?? null,
    callerNumber: row.callerNumber ?? null,
    callerNumberDescription: row.callerNumberDescription ?? null,
    label: row.label ?? null,
  }
}

/** 场景明细归一化。 */
function normalizeItem(value: unknown): VoiceSceneItem {
  const row = (value || {}) as Partial<VoiceSceneItem>
  const enabled = row.enabled === undefined ? true : toBoolean(row.enabled)
  return {
    scene: String(row.scene ?? ''),
    displayKey: String(row.displayKey ?? ''),
    sceneLabel: String(row.sceneLabel ?? ''),
    role: String(row.role ?? 'USER'),
    triggerPoint: String(row.triggerPoint ?? ''),
    contentTemplate: row.contentTemplate ?? null,
    source: (row.source ?? 'FALLBACK') as VoiceSceneItem['source'],
    enabled,
    // 后端显式给 blocked；缺失时按 !enabled 兜底（前端不主动反推，仅防御）
    blocked: row.blocked === undefined ? !enabled : toBoolean(row.blocked),
    variables: toStringArray(row.variables),
    renderedSample: String(row.renderedSample ?? ''),
    truncatedAtRuntime: toBoolean(row.truncatedAtRuntime),
    runtimeMaxChars: toNumber(row.runtimeMaxChars, 50),
    runtimeText: String(row.runtimeText ?? ''),
    truncationHint: row.truncationHint ?? null,
    note: row.note ?? null,
  }
}

/** 读：全局参数 + 各场景文案明细。 */
export async function getVoiceConfig(): Promise<VoiceConfigData> {
  const data = unwrap(
    await request.get<VoiceResponse<VoiceConfigData>>('/api/admin/voice/config'),
    '语音配置查询失败',
  )
  const row = (data || {}) as Partial<VoiceConfigData>
  return {
    voiceCode: row.voiceCode ?? null,
    callerNumber: row.callerNumber ?? null,
    callerNumberDescription: String(row.callerNumberDescription ?? ''),
    enabled: row.enabled === undefined ? true : toBoolean(row.enabled),
    blocked: toBoolean(row.blocked),
    overriddenInDb: toBoolean(row.overriddenInDb),
    source: (row.source ?? 'NONE') as VoiceConfigData['source'],
    remark: row.remark ?? null,
    updatedBy: row.updatedBy ?? null,
    channelStatic: normalizeChannelStatic(row.channelStatic),
    effectiveVoiceCode: row.effectiveVoiceCode ?? null,
    effectiveVoiceCodeSource: (row.effectiveVoiceCodeSource ?? 'NONE') as VoiceConfigData['effectiveVoiceCodeSource'],
    items: Array.isArray(row.items) ? row.items.map(normalizeItem) : [],
    sceneCount: toNumber(row.sceneCount),
    cacheTtlSeconds: toNumber(row.cacheTtlSeconds, 30),
    runtimeContentMaxChars: toNumber(row.runtimeContentMaxChars, 50),
    notice: String(row.notice ?? ''),
    configKeyHint: String(row.configKeyHint ?? ''),
    fetchedAt: String(row.fetchedAt ?? ''),
  }
}

/**
 * 写：全局参数。
 *
 * ⚠️ **`callerNumber` 三态**：不传该键 = 不改；传 `''` = 公共号池；传号码 = 指定显号。
 * 只改模板码时**不要带这个键**（否则会把现有显号清掉）。
 */
export async function updateVoiceConfig(body: VoiceConfigUpdate): Promise<VoiceConfigUpdateResult> {
  const data = unwrap(
    await request.put<VoiceResponse<VoiceConfigUpdateResult>>('/api/admin/voice/config', body),
    '语音全局配置保存失败',
  )
  const row = (data || {}) as Partial<VoiceConfigUpdateResult>
  return {
    voiceCode: row.voiceCode ?? null,
    callerNumber: row.callerNumber ?? null,
    enabled: row.enabled === undefined ? true : toBoolean(row.enabled),
    blocked: toBoolean(row.blocked),
    source: (row.source ?? 'NONE') as VoiceConfigUpdateResult['source'],
    oldVoiceCode: row.oldVoiceCode ?? null,
    oldCallerNumber: row.oldCallerNumber ?? null,
    cleared: row.cleared ?? null,
  }
}

/**
 * 写：某个场景的播报文案模板。
 *
 * @param displayKey 只接受 3 个值：`DELIVERED@USER` / `EXCEPTION@USER` / `CANCEL_AUDIT_TIMEOUT@MERCHANT`
 *   ⇒ 前端不需要在这三个以外做入口（场景是代码里真实会呼的，**不做新增/删除场景**）。
 */
export async function updateVoiceTemplate(
  displayKey: string,
  body: VoiceTemplateUpdate,
): Promise<VoiceTemplateUpdateResult> {
  const path = `/api/admin/voice/templates/${encodeURIComponent(displayKey)}`
  const data = unwrap(
    await request.put<VoiceResponse<VoiceTemplateUpdateResult>>(path, body),
    '语音场景文案保存失败',
  )
  const row = (data || {}) as Partial<VoiceTemplateUpdateResult>
  return {
    scene: String(row.scene ?? ''),
    role: String(row.role ?? ''),
    displayKey: String(row.displayKey ?? displayKey),
    contentTemplate: row.contentTemplate ?? null,
    enabled: row.enabled === undefined ? true : toBoolean(row.enabled),
    blocked: toBoolean(row.blocked),
    source: (row.source ?? 'FALLBACK') as VoiceTemplateUpdateResult['source'],
    oldTemplate: row.oldTemplate ?? null,
    cleared: row.cleared ?? null,
  }
}
