/**
 * 后台「微信通知」（订阅消息诊断 + 测试发送）类型定义。
 *
 * 依据：`docs/前端对接说明-后台微信通知诊断-2026-09-29.md`（§三 三个接口 / §四 硬约束），
 * 并已与根目录 `api_doc.json`（**2026-09-29 10:46 版**，已收录本批三个接口）**逐项核对一致**：
 *
 * | tag「后台·微信通知（平台级）」 | 出参 schema |
 * |---|---|
 * | `GET /api/admin/notify/subscribe-config` | `MerchantSubscribeConfigVO`（与商家端同一份组装逻辑） |
 * | `GET /api/admin/notify/reachability`（`shopId` **required**） | `NotifyReachabilityVO` |
 * | `POST /api/admin/notify/test-send` | `TestSendRequest` → `NotifyTestSendVO` |
 *
 * ⚠️ 历史背景：这三个接口 **09-29 10:36** 上线，早于它们的 `api_doc.json` 快照（09:22）里查不到 ——
 *    当时的结论「契约里没有不代表接口不存在」已随契约刷新失效，本文件按**现行契约**书写。
 *
 * ⚠️ 页面必须**全中文**：下面这些英文字段名只允许出现在本文件与 `api/notify.ts` 里，
 *    `views/notify/index.vue` 负责把它们的语义翻译成中文后再上屏。
 */

/** 后端统一响应包装（与其它 api 模块一致）。 */
export interface NotifyResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

/** 单个订阅消息场景的配置（`GET /api/admin/notify/subscribe-config` 的 `scenes[]`）。 */
export interface NotifySubscribeScene {
  /** 后端配置键（如 `MERCHANT_NEW_ORDER`）—— ⚠️ 英文，**仅供排查，页面不展示**。 */
  key: string
  /**
   * 场景码（`NEW_ORDER` / `ACCEPT_TIMEOUT` / `EXCEPTION` / `CANCEL_REQUESTED`）。
   * 测试发送接口的 `scene` 入参就是这一组值（与 `scenes[].key` **不是**一回事）。
   */
  scene: string
  /** 接收角色（`MERCHANT` 等）—— ⚠️ 英文，**页面不展示**。 */
  role: string
  /** 场景中文名（后端下发，**直接展示**）。 */
  label: string
  /** 微信订阅消息模板 ID；未配置时为 `null`。 */
  templateId: string | null
  /**
   * 该场景的模板**是否已配置** —— 页面「已配置 / 未配置」只看它。
   * ⚠️ 不要拿 `templateId` 是否为空去反推（语义不同，后端才是权威）。
   */
  configured: boolean
  /**
   * 模板里必须包含的文本变量名（如 `thing1`）；未配置时为 `null`。
   * ⚠️ 契约（`SceneItem.variableName`）声明的是 `string`，这里按**可空**收：接口示例里 `configured=false`
   *    时该值语义上不成立，前端按可空处理才能保证页面显示「—」而不是 `null`。
   */
  variableName: string | null
}

/**
 * 订阅配置里的通知接收人信息（契约 `ReceiverInfo`）。
 * ⚠️ **后台版接口里恒为 `null`** —— 契约该端点的说明是「与商家端接口同一份组装逻辑；**后台版不含门店维度字段**」，
 *    而 `ReceiverInfo`（`shopId` / `bound` / `desc`）正是门店维度的。
 *    ⇒ 类型与归一化**保留**它（白名单式重建不能丢协议字段），但页面**不展示**；
 *      接收人一律以「门店可达性诊断」的 `receiverName` / `receiverRole` 为准（那是按门店查的、有权威值）。
 */
export interface NotifyReceiverInfo {
  /** 门店 ID。 */
  shopId: number | null
  /** 该门店通知接收人是否已绑定微信。 */
  bound: boolean
  /** 口径说明（中文，可直接展示）。 */
  desc: string
}

/** `GET /api/admin/notify/subscribe-config` 的 `data`（配置只读）。 */
export interface NotifySubscribeConfig {
  /** 4 个订阅消息场景。 */
  scenes: NotifySubscribeScene[]
  /**
   * 后端**聚合好**的订阅模板 ID 列表（已去重 / 已过滤空值 / 最多 3 个）。
   * 小程序端订阅授权 `wx.requestSubscribeMessage({ tmplIds })` 直接用它 ——
   * 自己 `scenes.map(s => s.templateId)` 会传出重复 ID，微信会拒整批（`Request list fail`）。
   */
  tmplIds: string[]
  /**
   * 订阅接收人信息 —— 契约里的 `ReceiverInfo`。
   * ⚠️ **后台版该字段恒为 `null`**（契约原话：后台版不含门店维度字段）⇒ 页面不展示；
   *    接收人请用 {@link NotifyReachability.receiverName} / `receiverRole`（按门店查，才是权威值）。
   */
  receiver: NotifyReceiverInfo | null
  /** 变量名限制的中文提示（后端下发，净化后展示即可）。 */
  variableHint: string
  /** 本接口的只读说明（后端下发中文，净化后展示即可）。 */
  note: string
}

/** `GET /api/admin/notify/reachability?shopId=` 的 `data`（单个门店的微信通知可达性）。 */
export interface NotifyReachability {
  shopId: number
  shopName: string
  merchantId: number | null
  merchantName: string | null
  /** 当前解析到的接收人（店长优先 → 回退门店主账号）；**没有接收人时为 `null`（页面显示「—」）**。 */
  receiverName: string | null
  /** 接收人身份 —— **后端已给中文**（「店长」/「门店主账号」）；没有接收人时为 `null`。 */
  receiverRole: string | null
  /** 该接收人是否已绑微信（`false` ⇒ 微信通道会被跳过，**红点 / 短信照常**）。 */
  bound: boolean
  /**
   * 综合判断 = 模板已配 **且** 接收人存在 **且** 已绑微信。
   * ⚠️ `true` **不代表一定能收到** —— 还取决于用户是否点过订阅授权，而**微信不提供授权状态查询**
   *    （对接说明 §四）。页面上必须写明这句，否则会被误判成「可用就该收到」。
   */
  canReceiveWechat: boolean
  /**
   * 口径补充：例如「店长未绑微信、但门店主账号已绑 ⇒ 实际发送会回退到主账号，仍可送达」。
   * **有值时必须展示**，用来避免把「会回退」误判成「收不到」。
   */
  fallbackNote: string | null
  /** 已配置模板的场景数（可空：拿不到时页面不显示这一项）。 */
  configuredSceneCount: number | null
  /**
   * 中文原因清单 —— **只逐条展示**。
   * ⚠️ 逻辑判断请用 {@link NotifyReachability.canReceiveWechat}，**绝不要匹配这里的文案**
   *    （文案可能微调：对接说明 §3.2 已列全 3 种取值）。
   */
  reasons: string[]
  /** 中文建议清单（逐条展示，例如「请在 PC 后台『店员管理』中为该门店店长绑定微信」）。 */
  suggestions: string[]
}

/** 测试发送可选场景 —— **后端白名单，只有这 4 个**（对接说明 §3.3）。 */
export type NotifyTestSceneCode = 'NEW_ORDER' | 'ACCEPT_TIMEOUT' | 'EXCEPTION' | 'CANCEL_REQUESTED'

/** `POST /api/admin/notify/test-send` 的请求体。 */
export interface NotifyTestSendRequest {
  /** 门店 ID（**必传**）。 */
  shopId: number
  /** 场景码；不传时后端按 `NEW_ORDER` 处理。 */
  scene?: NotifyTestSceneCode
}

/** `POST /api/admin/notify/test-send` 的 `data`。 */
export interface NotifyTestSendResult {
  /** **是否成功交给微信** —— 逻辑判断用这个，不要拿 `failReason` 的文案去匹配。 */
  sent: boolean
  /** 是否触发「每门店每日 3 次」限流 —— 逻辑判断用这个。 */
  rateLimited: boolean
  /** 实际发给谁（可能为 `null`，页面显示「—」）。 */
  receiverName: string | null
  /** 接收人身份（后端已给中文）。 */
  receiverRole: string | null
  /**
   * 中文失败原因 —— **直接展示**（对接说明 §3.3 已列全 6 种取值）。
   * ⚠️ **不要**对它做字符串匹配，文案可能微调。
   */
  failReason: string | null
  /** 中文建议（逐条/整句展示）。 */
  suggestion: string | null
  /**
   * 微信原始错误码（**仅供排查**，默认折叠展示）。
   * 已知：`43101` = 用户未授权 / 拒收（本页据此给出「让他重新点一次订阅」的结构化提示）。
   */
  rawCode: number | null
  /** 微信原始错误信息（英文，**仅供排查**）。 */
  rawMessage: string | null
  /** 本门店**今日已用**的测试次数。 */
  usedToday: number
  /** 后端限流上限（现为 3）。 */
  dailyLimit: number
  /** 后端下发的中文提示（含「本次已消耗一次授权额度」的口径，原样展示）。 */
  note: string
}
