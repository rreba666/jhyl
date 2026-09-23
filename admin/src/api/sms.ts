import { request } from './request'
import type {
  SmsResponse,
  SmsTemplateCodeUpdate,
  SmsTemplateCodeUpdateResult,
  SmsTemplateItem,
  SmsTemplateListData,
} from '@/types/sms'

/**
 * 短信模板后台接口层。
 *
 * 依据：`docs/20269231438/短信模板后台-前端对接说明-2026-09-23.md` §1。
 *
 * | 方法 | 路径 | 副作用 |
 * |---|---|---|
 * | GET | `/api/admin/sms/templates` | 无 |
 * | PUT | `/api/admin/sms/templates/{displayKey}` | **写 DB + 写审计**；即时生效 |
 *
 * ⚠️ 鉴权：非超管 403（本页只给 `SUPER_ADMIN`）。
 */

function unwrap<T>(response: { data: SmsResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 数字兜底（`NaN` 会让概览渲染成空白）。 */
function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 布尔兜底。 */
function toBoolean(value: unknown): boolean {
  return value === true
}

/** 字符串数组兜底。 */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 明细归一化：补齐数组/布尔/可空字段，避免缺字段导致整页崩。 */
function normalizeItem(value: unknown): SmsTemplateItem {
  const row = (value || {}) as Partial<SmsTemplateItem>
  return {
    scene: String(row.scene ?? ''),
    displayKey: String(row.displayKey ?? ''),
    role: (row.role ?? 'USER') as SmsTemplateItem['role'],
    sceneLabel: String(row.sceneLabel ?? ''),
    channel: (row.channel ?? 'NONE') as SmsTemplateItem['channel'],
    configurable: toBoolean(row.configurable),
    smsApplicable: toBoolean(row.smsApplicable),
    templateCode: row.templateCode ?? null,
    templateCodeSource: (row.templateCodeSource ?? 'NONE') as SmsTemplateItem['templateCodeSource'],
    configured: toBoolean(row.configured),
    needsAction: toBoolean(row.needsAction),
    adminEditable: toBoolean(row.adminEditable),
    content: row.content ?? null,
    variables: toStringArray(row.variables),
    auditStatus: row.auditStatus ?? null,
    auditMessage: row.auditMessage ?? null,
    source: (row.source ?? 'MISSING') as SmsTemplateItem['source'],
    fetchedAt: row.fetchedAt ?? null,
    errorCode: row.errorCode ?? null,
    error: row.error ?? null,
    templateCodeConfigKey: row.templateCodeConfigKey ?? null,
    note: row.note ?? null,
  }
}

/**
 * 按业务阶段列出短信模板的真实文案与审核状态（**无副作用**）。
 *
 * ⚠️ **GET 的任何降级都不会让接口失败**（未配密钥 / 阿里云报错 / 超时都返回 `code=0`），
 * 用条目里的 `errorCode` 表达 ⇒ **前端不要用 HTTP 状态码判断"有没有取到模板"**。
 */
export async function getSmsTemplates(): Promise<SmsTemplateListData> {
  const data = unwrap(
    await request.get<SmsResponse<SmsTemplateListData>>('/api/admin/sms/templates'),
    '短信模板查询失败',
  )
  const row = (data || {}) as Partial<SmsTemplateListData>
  return {
    credentialsConfigured: toBoolean(row.credentialsConfigured),
    credentialsHint: row.credentialsHint ?? null,
    cacheTtlSeconds: toNumber(row.cacheTtlSeconds),
    fetchedAt: String(row.fetchedAt ?? ''),
    templateDocsUrl: String(row.templateDocsUrl ?? ''),
    notice: String(row.notice ?? ''),
    total: toNumber(row.total),
    configuredCount: toNumber(row.configuredCount),
    missingCount: toNumber(row.missingCount),
    contentReadCount: toNumber(row.contentReadCount),
    items: Array.isArray(row.items) ? row.items.map(normalizeItem) : [],
  }
}

/**
 * 修改某阶段的**模板编码**（或停用 / 清除后台覆盖）。
 *
 * @param displayKey `场景@角色`（取 GET 的 `displayKey`），且该条必须 `adminEditable=true`，
 *   否则后端返回 `1000`（不写库、不留痕）。
 *
 * ⚠️ 三种语义别混：
 * - 填码 + `enabled` 缺省 ⇒ 正常配置；
 * - 填码 + `enabled:false` ⇒ **显式停用**（保留 DB 行，**不回落**静态配置 ⇒ 短信发不出去）；
 * - **留空** + `enabled` 缺省/true ⇒ **清除后台覆盖**（回落服务端静态配置，可逆）；
 *   但若该阶段本来就没有 DB 覆盖，后端会以"语义二义"拒绝（`1000`）。
 */
export async function updateSmsTemplateCode(
  displayKey: string,
  body: SmsTemplateCodeUpdate,
): Promise<SmsTemplateCodeUpdateResult> {
  // displayKey 形如 `DELIVERED@USER`，编码后再进 path
  const path = `/api/admin/sms/templates/${encodeURIComponent(displayKey)}`
  const data = unwrap(
    await request.put<SmsResponse<SmsTemplateCodeUpdateResult>>(path, body),
    '模板编码修改失败',
  )
  const row = (data || {}) as Partial<SmsTemplateCodeUpdateResult>
  return {
    scene: String(row.scene ?? ''),
    role: String(row.role ?? ''),
    displayKey: String(row.displayKey ?? displayKey),
    templateCode: row.templateCode ?? null,
    configured: toBoolean(row.configured),
    enabled: row.enabled === undefined ? true : toBoolean(row.enabled),
    source: (row.source ?? 'NONE') as SmsTemplateCodeUpdateResult['source'],
    oldCode: row.oldCode ?? null,
    cleared: row.cleared ?? null,
  }
}
