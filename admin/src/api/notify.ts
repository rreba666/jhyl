import { request } from './request'
import type {
  NotifyReachability,
  NotifyReceiverInfo,
  NotifyResponse,
  NotifySubscribeConfig,
  NotifySubscribeScene,
  NotifyTestSceneCode,
  NotifyTestSendRequest,
  NotifyTestSendResult,
} from '@/types/notify'

/**
 * 后台「微信通知」诊断接口层（**仅超级管理员 + 运营客服**）。
 *
 * 依据：`docs/前端对接说明-后台微信通知诊断-2026-09-29.md` §三。
 *
 * | 方法 | 路径 | 用途 |
 * |---|---|---|
 * | GET  | `/api/admin/notify/subscribe-config` | 订阅模板配置（只读） |
 * | GET  | `/api/admin/notify/reachability` | 门店可达性诊断（**`shopId` 必传**，不传后端返回 `1000`） |
 * | POST | `/api/admin/notify/test-send` | 真发一条（**消耗一次订阅授权额度**，每门店每日 3 次） |
 *
 * ⚠️ 这三个接口 **2026-09-29 10:36 上线**，而当时的 `api_doc.json` 快照（09:22）里还没有它们；
 *    现契约（**10:46 版**）已收录（tag「后台·微信通知（平台级）」），字段已逐项核对一致。
 *
 * ⚠️ 权限：商户管理员调用后端 **403**（本模块含跨商户信息面，且测试发送会消耗商家授权额度）
 *    —— 前端菜单与路由同口径，见 `utils/permission.ts` 的 `/notify`。
 */

function unwrap<T>(response: { data: NotifyResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 字符串兜底（`null` / 非字符串 → `''`）。 */
function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 可空字符串兜底（空串按「没值」处理 → `null`）。 */
function toNullableText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** 布尔兜底（只认严格 `true`，避免后端下发字符串 `'false'` 被判成真）。 */
function toBoolean(value: unknown): boolean {
  return value === true
}

/** 数字兜底。 */
function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 可空数字兜底（拿不到给 `null`，**不要给 0** —— 0 与「没取到」在页面上必须能区分）。 */
function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 中文清单兜底（过滤掉非字符串项）。 */
function toTextList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * 场景配置**白名单式重建**。
 *
 * ⚠️ 项目教训（今华有肽踩过 4 次）：白名单重建函数漏字段会造成
 * 「后端有、页面却没有」的静默 bug ⇒ **后端加字段时必须同步补这里**
 * （对照 `types/notify.ts` 的 `NotifySubscribeScene` 逐项核对）。
 */
function normalizeScene(value: unknown): NotifySubscribeScene {
  const row = (value || {}) as Partial<NotifySubscribeScene>
  return {
    key: toText(row.key),
    scene: toText(row.scene),
    role: toText(row.role),
    label: toText(row.label),
    templateId: toNullableText(row.templateId),
    configured: toBoolean(row.configured),
    variableName: toNullableText(row.variableName),
  }
}

/**
 * 通知接收人信息归一化（契约 `ReceiverInfo`）。
 * ⚠️ 后台版接口里该字段恒为 `null`（不含门店维度字段）—— 这里仍按协议解析，**不丢字段**，
 *    页面按 `null` 不展示即可（见 `types/notify.ts` 的说明）。
 */
function normalizeReceiver(value: unknown): NotifyReceiverInfo | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<NotifyReceiverInfo>
  return {
    shopId: toNullableNumber(row.shopId),
    bound: toBoolean(row.bound),
    desc: toText(row.desc),
  }
}

/**
 * `GET /api/admin/notify/subscribe-config` —— 订阅消息模板配置（只读）。
 * 页面用来展示：4 个场景的中文名 / 已配置状态 / 模板 ID / 文本变量名。
 */
export async function getNotifySubscribeConfig(): Promise<NotifySubscribeConfig> {
  const data = unwrap(
    await request.get<NotifyResponse<unknown>>('/api/admin/notify/subscribe-config'),
    '微信通知配置查询失败',
  )
  const row = (data || {}) as Partial<NotifySubscribeConfig>
  return {
    scenes: Array.isArray(row.scenes) ? row.scenes.map(normalizeScene) : [],
    // 模板 ID 列表：去掉空值（后端已去重，前端只做兜底过滤，**不重新聚合**）
    tmplIds: toTextList(row.tmplIds).filter((id) => !!id),
    receiver: normalizeReceiver(row.receiver),
    variableHint: toText(row.variableHint),
    note: toText(row.note),
  }
}

/** 可达性诊断结果**白名单式重建**（同上：后端加字段时同步补）。 */
function normalizeReachability(value: unknown): NotifyReachability {
  const row = (value || {}) as Partial<NotifyReachability>
  return {
    shopId: toNumber(row.shopId),
    shopName: toText(row.shopName),
    merchantId: toNullableNumber(row.merchantId),
    merchantName: toNullableText(row.merchantName),
    receiverName: toNullableText(row.receiverName),
    receiverRole: toNullableText(row.receiverRole),
    bound: toBoolean(row.bound),
    // ⚠️ 结构化的核心判定字段：页面一律用它，不要拿 reasons[] 的中文文案去匹配
    canReceiveWechat: toBoolean(row.canReceiveWechat),
    fallbackNote: toNullableText(row.fallbackNote),
    configuredSceneCount: toNullableNumber(row.configuredSceneCount),
    reasons: toTextList(row.reasons),
    suggestions: toTextList(row.suggestions),
  }
}

/** 门店 ID 归一化：必须是正整数（接口要求 `shopId` 必传，前端提前拦住比让后端报 1000 更友好）。 */
function toShopId(shopId: number | string): number {
  const id = Number(shopId)
  if (!Number.isFinite(id) || id <= 0) throw new Error('请选择要诊断的门店')
  return id
}

/**
 * `GET /api/admin/notify/reachability?shopId=` —— 门店微信通知可达性诊断。
 *
 * @param shopId 门店 ID（**必传**）。页面先选门店再调本接口。
 * 返回的 `reasons[]` / `suggestions[]` 是中文，**只逐条展示**；
 * 逻辑判断一律用 `canReceiveWechat`（`true` 也不代表一定能收到，详见类型注释）。
 */
export async function getNotifyReachability(shopId: number | string): Promise<NotifyReachability> {
  const id = toShopId(shopId)
  const data = unwrap(
    await request.get<NotifyResponse<unknown>>('/api/admin/notify/reachability', { params: { shopId: id } }),
    '门店微信通知可达性诊断失败',
  )
  return normalizeReachability(data)
}

/** 测试发送结果**白名单式重建**（同上）。 */
function normalizeTestResult(value: unknown): NotifyTestSendResult {
  const row = (value || {}) as Partial<NotifyTestSendResult>
  return {
    // 逻辑判断字段：sent / rateLimited / rawCode —— 页面的分支只看这三个（+ 结构化提示）
    sent: toBoolean(row.sent),
    rateLimited: toBoolean(row.rateLimited),
    receiverName: toNullableText(row.receiverName),
    receiverRole: toNullableText(row.receiverRole),
    // 展示字段：中文文案，只上屏不做判断
    failReason: toNullableText(row.failReason),
    suggestion: toNullableText(row.suggestion),
    rawCode: toNullableNumber(row.rawCode),
    rawMessage: toNullableText(row.rawMessage),
    usedToday: toNumber(row.usedToday),
    dailyLimit: toNumber(row.dailyLimit, 3),
    note: toText(row.note),
  }
}

/**
 * `POST /api/admin/notify/test-send` —— 真实发送一条测试消息。
 *
 * ⚠️ 副作用（页面上必须提示）：
 * 1. 订阅消息是**一次性授权**，**本次测试会消耗一次授权额度**（成功 / 失败都算）；
 * 2. 后端**每门店每日限流 3 次**（看返回的 `usedToday` / `dailyLimit`）；
 * 3. **只发微信** —— **不会**触发红点 / 短信 / 语音。
 *
 * @param shopId 门店 ID（必传）
 * @param scene 场景码（可省；不传后端按 `NEW_ORDER` 处理）
 */
export async function sendNotifyTest(
  shopId: number | string,
  scene?: NotifyTestSceneCode,
): Promise<NotifyTestSendResult> {
  const body: NotifyTestSendRequest = { shopId: toShopId(shopId) }
  // `scene` 可省：**不传**时后端默认 NEW_ORDER，这里也保持「不传就不带键」的语义
  if (scene) body.scene = scene
  const data = unwrap(
    await request.post<NotifyResponse<unknown>>('/api/admin/notify/test-send', body),
    '微信测试消息发送失败',
  )
  return normalizeTestResult(data)
}
