/**
 * 短信模板后台（阶段 → 短信模板编码）类型定义。
 *
 * 依据：`docs/20269231438/短信模板后台-前端对接说明-2026-09-23.md` §7（类型参考）。
 *
 * ## 这个页面在管什么
 * 每个「业务阶段 × 角色」可能走一条短信。**文案（内容）在阿里云控制台改**，
 * 本页只改**模板编码**（把本地的阶段映射到阿里云某个模板），可停用、可清除后台覆盖。
 */

/** 文案来源四态（⚠️ 判红**不要**用它，用 `needsAction`）。 */
export type SmsTemplateSource = 'ALIYUN' | 'LOCAL_PLACEHOLDER' | 'MISSING' | 'CHANNEL_NOT_SMS'

/** 编码来源四态（告运营"我在改哪一层"）。 */
export type SmsTemplateCodeSource = 'DB' | 'DB_DISABLED' | 'YML_FALLBACK' | 'NONE'

/** 该阶段实际走的通道。 */
export type SmsTemplateChannel = 'SMS' | 'VOICE' | 'SUBSCRIBE' | 'NONE'

/** 阿里云审核状态原文（⚠️ 只有 `source=ALIYUN`（读到内容）时才有值）。 */
export type SmsAuditStatus =
  | 'AUDIT_STATE_PASS'
  | 'AUDIT_STATE_INIT'
  | 'AUDIT_STATE_NOT_PASS'
  | 'AUDIT_STATE_CANCEL'

/** 失败原因码。 */
export type SmsTemplateErrorCode =
  | 'CREDENTIALS_NOT_CONFIGURED'
  | 'ALIYUN_ERROR'
  | 'FETCH_EXCEPTION'
  | 'TEMPLATE_CODE_BLANK'
  | 'PORT_UNAVAILABLE'

/** 单个阶段明细。 */
export interface SmsTemplateItem {
  /** 阶段标识（与后端发送口径一致）。 */
  scene: string
  /** `场景@角色` —— **列表 key 用它**（同一场景的用户侧/商家侧是两条），也是 PUT 的路径参数。 */
  displayKey: string
  role: 'USER' | 'MERCHANT' | 'DELIVERY_PERSON'
  /** 阶段中文名。 */
  sceneLabel: string
  /** 该阶段实际走的通道。 */
  channel: SmsTemplateChannel
  /** 该阶段**是否具备**短信模板配置位（false ⇒ 不走短信，无需处理）。 */
  configurable: boolean
  /** **该阶段当前是否走短信**（= `channel === 'SMS'`）。与 `configurable` 的区别见文档 §3.4。 */
  smsApplicable: boolean
  /** 当前**生效**的阿里云模板编码。 */
  templateCode: string | null
  /** 这个编码**来自哪一层**（`DB` / `DB_DISABLED` / `YML_FALLBACK` / `NONE`）。 */
  templateCodeSource: SmsTemplateCodeSource
  /** 当前是否有可用编码（false = 短信发不出去）。 */
  configured: boolean
  /** **是否需要运营处理** ⇒ ✅ 判红 + 徽标**只看它**（不要用 `source` / `configured`）。 */
  needsAction: boolean
  /** **该条能否在本页 PUT 修改**（false ⇒ 不要渲染编辑框）。 */
  adminEditable: boolean
  /** 阿里云模板文案原文（未读到为 null）。 */
  content: string | null
  /** 模板变量名（如 `['code']`，按首次出现顺序）。 */
  variables: string[]
  /** 阿里云审核状态原文。 */
  auditStatus: SmsAuditStatus | null
  /** 审核/驳回说明。 */
  auditMessage: string | null
  /** **文案**来源（四态）。 */
  source: SmsTemplateSource
  /** **该条内容上次成功抓取**的时间；从未成功为 null。 */
  fetchedAt: string | null
  /** 失败原因码。 */
  errorCode: SmsTemplateErrorCode | null
  /** 失败原因（人可读，可直接展示）。 */
  error: string | null
  /** 编码取自哪个配置键（运维补静态配置时要知道改哪里）。 */
  templateCodeConfigKey: string | null
  /** 人工提示（如"该阶段没有短信通道""该码来自服务端配置，本页不可改"）。 */
  note: string | null
}

/** `GET /api/admin/sms/templates` 的 `data`。 */
export interface SmsTemplateListData {
  /** 短信凭证（AccessKeyId/Secret/signName）是否齐备 ⇒ **false 时用顶部全局黄色横幅**，不要逐条报"没有模板"。 */
  credentialsConfigured: boolean
  /** 未配凭证时的处置提示（已配为 null）。 */
  credentialsHint: string | null
  /** **模板内容（文案）**缓存 TTL（秒），默认 600 ⇒ 页面写"文案数据最多滞后 N 分钟"。 */
  cacheTtlSeconds: number
  /** 本次响应生成时间（ISO-8601）。 */
  fetchedAt: string
  /** 阿里云短信控制台模板管理地址（"去阿里云改文案"按钮的 `href`）。 */
  templateDocsUrl: string
  /** 固定提示（含"改文案去阿里云""本页可改编码"）。 */
  notice: string
  /** 阶段总数。 */
  total: number
  /** 已配模板编码的阶段条目数。 */
  configuredCount: number
  /** **缺模板条数**（= `needsAction=true` 的条数）⇒ ✅ **本页最重要的告警数字**。 */
  missingCount: number
  /** 成功读到阿里云文案的条目数。 */
  contentReadCount: number
  /** 全部阶段明细。 */
  items: SmsTemplateItem[]
}

/** `PUT /api/admin/sms/templates/{displayKey}` 请求体。 */
export interface SmsTemplateCodeUpdate {
  /**
   * 阿里云短信模板编码（`SMS_` + 6~12 位数字，忽略大小写、落库转大写）。
   * **留空 = 删除该阶段的后台覆盖、回落服务端静态配置**（"清除覆盖"，可逆）。
   */
  templateCode?: string | null
  /** 不传视为 `true`；`false` = **显式停用**（保留 DB 行、**不回落**静态配置 ⇒ 该阶段短信发不出去）。 */
  enabled?: boolean
  /** 变更原因（写审计留痕）。 */
  reason?: string | null
}

/** PUT 响应体（写后重新解析出的生效值，可直接回显）。 */
export interface SmsTemplateCodeUpdateResult {
  scene: string
  role: string
  displayKey: string
  templateCode: string | null
  configured: boolean
  enabled: boolean
  source: SmsTemplateCodeSource
  /** 变更前的编码（回显"从 X 改成 Y"）。 */
  oldCode: string | null
  /** `'DB_OVERRIDE_CLEARED'` = 本次清除了覆盖；否则 null。 */
  cleared: string | null
}

/** 后端统一响应包装（与其它 api 模块一致）。 */
export interface SmsResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
