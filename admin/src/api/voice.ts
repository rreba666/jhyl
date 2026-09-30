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
  VoiceTestCallRequest,
  VoiceTestCallResult,
} from '@/types/voice'

/**
 * 语音配置后台接口层。
 *
 * 依据：`docs/20269231438/语音配置后台-前端对接说明-2026-09-24.md` §1；
 *      测试外呼依据 `docs/前端说明-语音模板测试外呼-2026-09-30.md` §二。
 *
 * | 方法 | 路径 | 用途 |
 * |---|---|---|
 * | GET | `/api/admin/voice/config` | 全局参数 + 3 个场景的文案明细 |
 * | PUT | `/api/admin/voice/config` | 全局参数（模板码 / 显号 / 全局开关） |
 * | PUT | `/api/admin/voice/templates/{displayKey}` | 某个场景的播报文案模板 |
 * | POST | `/api/admin/voice/test-call` | **测试外呼**（用指定 TTS 码真实打一通电话） |
 *
 * - 改完**即时生效**（多实例最多滞后 `cacheTtlSeconds`，现为 30 秒）；
 * - 非超管 `403`；`1000` = 参数校验失败（`message` 可直接展示）。
 * - ⚠️ `test-call` 是**真实外呼**、后端**无限流**，调用方必须自己防连点。
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
    // ⚠️ 2026-09-29 第十二批新增字段：**白名单重建里必须同步补**，
    //    否则后端下发了 ttsCode 也会被这里丢掉 —— 表现与"字段还没上线"完全一样，极难排查。
    ttsCode: row.ttsCode ?? null,
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

/**
 * 写：**测试外呼**（2026-09-30 新增）。
 *
 * 用**指定 TTS 码**真实拨打一通电话，让运营当场确认该模板能不能正常播报。
 *
 * ⚠️⚠️ **三条必须守住的语义**：
 * 1. **真实拨号**，不是模拟：调一次就是打一通电话、可能产生费用；后端**没有限流**
 *    ⇒ **调用方必须 loading + 防连点**（连点会连打多个真实电话）。
 * 2. **成败看 `data.success`，不是看 `code`**：渠道未受理时 HTTP 200 + `code=0`
 *    ⇒ 只看 `code` 会把"未受理"误报成"已发起"。
 * 3. `ttsCode` **原样传页面上「语音模板 ID」输入框的值**，且**不传模板变量** `params`
 *    （模板文案由渠道侧模板自带，测试时用渠道默认内容）。
 *
 * @returns 归一化后的结果；`success=false` **不抛错**（由调用方展示 `message`），
 *   只有 `code≠0`（`1000` 参数校验 / `1001` 语音渠道未启用）才抛 `Error`。
 */
export async function testVoiceCall(body: VoiceTestCallRequest): Promise<VoiceTestCallResult> {
  const response = await request.post<VoiceResponse<VoiceTestCallResult>>('/api/admin/voice/test-call', body)
  const result = response.data
  // ⚠️ 这里**不能复用上面的 `unwrap()`**：`unwrap` 把 `success === false` 也当异常抛出，
  //    而本接口"渠道未受理"恰恰是**外层 code=0 + 内层 data.success=false** —— 一旦 throw，
  //    就把后端给的 `data.message`（唯一能说明未受理原因的信息）丢掉了。
  //    ⇒ 只把「外层 code≠0」当异常。
  if (result.code !== 0) throw new Error(result.message || '测试外呼失败')
  const row = (result.data || {}) as Partial<VoiceTestCallResult>
  return {
    phone: row.phone ?? null,
    ttsCode: row.ttsCode ?? null,
    // 只有明确的 true 才算渠道已受理；缺失/非布尔一律按"未受理"处理（宁可提示，也不误报"已发起"）
    success: toBoolean(row.success),
    // null = 走渠道静态公共号池，属正常；页面展示时判空，别让 "null" 上屏
    callerNumber: row.callerNumber ?? null,
    message: row.message ?? null,
  }
}
