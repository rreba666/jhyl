/**
 * 语音配置后台（阿里云语音外呼）类型定义。
 *
 * 依据：`docs/20269231438/语音配置后台-前端对接说明-2026-09-24.md` §2 / §3 / §4。
 *
 * ## 与「短信模板管理」页的区别（别混）
 * - 短信页：只能改**用哪个模板码**，文案在阿里云短信控制台改；
 * - 本页：**能改"每个场景念什么"**（阿里云只提供通用 TTS 模板 `TTS_xxx`，正文由我们传入），
 *   场景只有 **3 条**（真的会打电话的），且**不做**新增/删除场景。
 */

/** 全局参数来源四态。 */
export type VoiceGlobalSource = 'DB' | 'DB_DISABLED' | 'YML_FALLBACK' | 'NONE'

/** 场景文案来源三态。 */
export type VoiceSceneSource = 'DB' | 'DB_DISABLED' | 'FALLBACK'

/** 当前生效模板码的来源。 */
export type VoiceEffectiveSource = 'DB' | 'CHANNEL_STATIC' | 'NONE'

/** 渠道静态配置只读视图（**只读，不要给编辑入口**）。 */
export interface VoiceChannelStatic {
  templateCode?: string | null
  callerNumber?: string | null
  callerNumberDescription?: string | null
  label?: string | null
}

/** 单个外呼场景。 */
export interface VoiceSceneItem {
  scene: string
  /** `场景@角色` —— **写接口的唯一键**。 */
  displayKey: string
  sceneLabel: string
  /** 被叫角色（`USER` 收货人 / `MERCHANT` 门店）。 */
  role: 'USER' | 'MERCHANT' | string
  /** 触发点说明（哪条链路、什么条件会打这通电话）。 */
  triggerPoint: string
  /** 当前生效的模板原文；`null` = 没配过（回落代码文案）。 */
  contentTemplate: string | null
  /** 文案来源三态。 */
  source: VoiceSceneSource
  /** 该场景当前是否允许外呼。 */
  enabled: boolean
  /** 是否被运营停用（= `!enabled`，**后端显式给出，前端不要反推**）。 */
  blocked: boolean
  /** 模板里出现的变量名（按首次出现顺序；无占位符为 `[]`）。 */
  variables: string[]
  /** **用示例变量渲染出来的文本**（让运营直接看到"最后会念什么"）。 */
  renderedSample: string
  /** 渲染样本**是否会在运行期被截断**（现网 50 字）。 */
  truncatedAtRuntime: boolean
  /** 截断上限（字符数）。 */
  runtimeMaxChars: number
  /** **运行期真正会播报的文本**（= 渲染后截断的结果）。 */
  runtimeText: string
  /** 截断提示（未截断为 `null`；截断时给出"会少念多少字"）。 */
  truncationHint: string | null
  /** 该条的人工提示（"不用管"类场景给的就是它）。 */
  note: string | null
}

/** `GET /api/admin/voice/config` 的 `data`。 */
export interface VoiceConfigData {
  /** **DB 里生效的**模板码；`null` = DB 没有覆盖（用服务端配置）。 */
  voiceCode: string | null
  /** **DB 里的**显号：`''` = 显式公共号池；`null` = 未设置（用服务端配置）。 */
  callerNumber: string | null
  /** 显号的人话描述 ⇒ **直接展示这个，不要自己判空串**。 */
  callerNumberDescription: string
  /** DB 行是否启用（无 DB 行时为 `true`）。 */
  enabled: boolean
  /** **`true` = 全局禁止外呼**（谁都不呼）⇒ 顶部红色横幅用它。 */
  blocked: boolean
  /** DB 里有没有行（含停用）。 */
  overriddenInDb: boolean
  /** 全局参数来源四态。 */
  source: VoiceGlobalSource
  /** 上次变更原因。 */
  remark: string | null
  /** 上次修改人的 adminUserId。 */
  updatedBy: number | null
  /** **渠道静态配置只读视图**；`null` = 该渠道不提供视图。 */
  channelStatic: VoiceChannelStatic | null
  /** **现在真正会用的**模板码（DB 生效值，否则渠道静态值）。 */
  effectiveVoiceCode: string | null
  /** 生效模板码的来源。 */
  effectiveVoiceCodeSource: VoiceEffectiveSource
  /** 3 个真实场景。 */
  items: VoiceSceneItem[]
  /** `items` 条数（⚠️ **不要写死 3**）。 */
  sceneCount: number
  /** 进程内缓存 TTL（秒），多实例下的最大滞后。 */
  cacheTtlSeconds: number
  /** 运行期播报字符上限（现为 **50**）。 */
  runtimeContentMaxChars: number
  /** 页面级提示语（建议原样展示）。 */
  notice: string
  /** 渠道静态值来自哪两个配置键（**只读**说明）。 */
  configKeyHint: string
  /** 本次响应生成时间（ISO-8601）。 */
  fetchedAt: string
}

/**
 * `PUT /api/admin/voice/config` 请求体（全局参数）。
 *
 * ⚠️⚠️ **`callerNumber` 是"三态"**（文档 §3.1）：
 * - **不带这个键**（`undefined`）= **不改**（沿用 DB 现值）；
 * - 传空串 `''` = **显式公共号池**（不指定显号，由阿里云公共号池随机分配）；
 * - 传号码 = 该显号（只允许数字 / `+` / `-` / 空格，≤32 位）。
 *
 * ⇒ 运营只是"换个模板码"时**不要把 `callerNumber` 清空**，别带这个键即可。
 */
export interface VoiceConfigUpdate {
  /** 阿里云语音模板码（`TTS_` + 6~12 位数字，忽略大小写、落库转大写）。**留空 = 删除 DB 覆盖、回落服务端配置**。 */
  voiceCode?: string | null
  /** 见上方三态说明。 */
  callerNumber?: string | null
  /** 不传视为 `true`；`false` = **全局停用**（保留 DB 行、**不回落**、谁都不呼）。 */
  enabled?: boolean
  /** 变更原因（写审计留痕）。 */
  reason?: string | null
}

/** `PUT /api/admin/voice/config` 响应体（写后重新解析出的生效值）。 */
export interface VoiceConfigUpdateResult {
  voiceCode: string | null
  callerNumber: string | null
  enabled: boolean
  blocked: boolean
  source: VoiceGlobalSource
  oldVoiceCode: string | null
  oldCallerNumber: string | null
  /** `'DB_OVERRIDE_CLEARED'` 本次清除了覆盖 / `'NO_OVERRIDE_TO_CLEAR'` 本来就没有覆盖 / `null`。 */
  cleared: string | null
}

/**
 * `PUT /api/admin/voice/templates/{displayKey}` 请求体（场景文案）。
 *
 * ⚠️ 变量白名单**恰好 4 个**（大小写不敏感、**单遍替换**）：
 * `{orderNo}` 订单号 / `{taskNo}` 配送任务号（无任务时空串）/
 * `{message}` 代码里现成的摘要 / `{sceneLabel}` 场景中文名。
 * 写白名单外的变量（如 `{orderNoo}`）后端 **`1000` 拒绝**（TTS 会把字面量念出来）。
 */
export interface VoiceTemplateUpdate {
  /** 播报文案模板。**留空 = 删除该行、回落代码里现成的摘要文案**。业务上限 **200 字**（运行期还会截断到 50 字）。 */
  contentTemplate?: string | null
  /** 不传视为 `true`；`false` = **该场景不外呼**（保留行、**不回落**代码文案）。 */
  enabled?: boolean
  /** 变更原因。 */
  reason?: string | null
}

/** `PUT /api/admin/voice/templates/{displayKey}` 响应体。 */
export interface VoiceTemplateUpdateResult {
  scene: string
  role: string
  displayKey: string
  contentTemplate: string | null
  enabled: boolean
  blocked: boolean
  source: VoiceSceneSource
  oldTemplate: string | null
  cleared: string | null
}

/** 后端统一响应包装（与其它 api 模块一致）。 */
export interface VoiceResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

/** 变量白名单（前端做提示与校验，与后端保持一致）。 */
export const VOICE_TEMPLATE_VARIABLES = ['{orderNo}', '{taskNo}', '{message}', '{sceneLabel}'] as const
