/**
 * 退款返货台账（中控）类型定义 —— 读接口 + **平台人工验收写接口**（2026-10-10 新增）。
 *
 * 依据：契约（仓库根 `api_doc.json`）的
 *   `GET /api/admin/delivery/returns?merchantId=&returnStatus=&page=&pageSize=`
 *   —— operationId `PlatformDeliveryController_returns`，summary「退款返货台账（全平台/按门店，V14011）」。
 * 前端对接背景：`docs/26/10.09/后端需求-返货验收放行与契约口径-2026-10-09.md` §一（R1）。
 *
 * ## 这一页解决什么
 * 后端待办 `DELIVERY_RETURN_ACCEPT`（返货待验收，`level=DANGER`）的 `route` 是
 * **`/delivery/returns?returnStatus=RETURNED`**，而此前 `admin/src` 里**没有任何** `delivery/returns`
 * 引用 ⇒ 铃铛点进去 = 路由不存在（待办形同虚设）。本页就是那个落点。
 *
 * ## ✅ 2026-10-10 更正：admin 侧写接口**已补上**，「只读 / 等后端补写接口」的说法**已作废**
 * 契约新增 `POST /api/admin/delivery/returns/{taskId}/accept`
 * （operationId `PlatformDeliveryController_acceptReturnByPlatform`，
 * summary「中控人工验收（确认收货 / 拒收记录货损）」）—— 平台（**超管 + 客服**，财务不含）
 * 对 `returnStatus=RETURNED`（骑手已返货到店、待商家验收）的任务人工验收：
 * - body **可整体不传**（≡ `accept=true` 确认收货 ⇒ `return_status → ACCEPTED`，
 *   此后该售后单可继续质检通过并退款）；
 * - `accept=false` 拒收 ⇒ `return_status → REJECTED_CLAIM` + `damageClaimStatus=RECORDED`
 *   （**不自动赔付**，须人工判定）；
 * - **幂等**：任务已是 `ACCEPTED`（含 2 小时超时自动确认）时重复调用**返回成功**、不覆盖既有结论。
 * ⚠️ 商家侧 `POST /api/merchant/delivery/tasks/{taskId}/accept-return` 与本页**无关**
 * （平台账号未绑商户，前端**不代调**、也不伪造）。
 *
 * ## ✅ 字段名：本接口**有**契约明细（与 `dividend-clawback` 那种空 schema 不同）
 * 200 schema = `ResultPageResultDeliveryTaskEntity`
 *   → `{ total, list[], page, pageSize }`
 *   → `list[]` = `DeliveryTaskEntity`（**33 个字段已落进契约**，含返货专有的
 *     `returnStatus / returnRequiredAt / returnDeadline / returnedAt / acceptDeadline /
 *      acceptResult / acceptRemark / acceptTime / acceptAuto / damageClaimStatus / returnFeeBearer`）。
 *
 * ⚠️ 但 2026-10-10 复核时 **dev 后端 `192.168.1.4:8080` 不可达**（TCP 8080 连接失败、`/v3/api-docs` 超时）
 * ⇒ 本期**没有拿到真实响应**、字段名**没有被真实数据验证过**。故仍保留两条诚实降级：
 * 1. api 层按**契约名优先 + 少量别名**读取（改名时不至于整列空白）；
 * 2. 每行都可在页面上**展开看到原始对象**，页底另有整段「原始数据」
 *    —— 字段名一旦与预期不符，以原始数据为准，**不猜**。
 * 3. 取不到就显示「—」（**绝不给默认值**）；枚举不认识就显示原值（**绝不归类**）。
 */

/** 后端统一响应外壳（与其它模块同形：`code` / `message` / `data` / `success`）。 */
export interface DeliveryReturnResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
  traceId?: string
  errorId?: string
}

/**
 * `data`：`PageResultDeliveryTaskEntity`（契约里有明细）。
 * ⚠️ 三处容错（读不到就当"后端没给"，不编）：
 * - `total`：契约说是总条数；**若实际缺失**，页面改按"本页是否满页"判断能否翻页，并如实标注；
 * - `list`：空数组 = 真的没有记录（与"接口失败"是两件事）；
 * - `page` / `pageSize`：仅用于回显，不参与分页判定。
 */
export interface DeliveryReturnPage {
  total?: number | null
  list?: Array<Record<string, unknown>> | null
  page?: number | null
  pageSize?: number | null
}

/**
 * 返货状态（契约 description 里**逐个写明**的 4 个值）。
 * ⚠️ 只认这 4 个：真实响应出现别的值时，页面显示**原值**并标「未知状态」，
 * 而不是硬塞进某一档（那会伪造"卡在谁那里"的结论）。
 */
export const RETURN_STATUS_VALUES = ['PENDING', 'RETURNED', 'ACCEPTED', 'REJECTED_CLAIM'] as const

/** 返货状态字面量。 */
export type ReturnStatus = (typeof RETURN_STATUS_VALUES)[number]

/**
 * 返货配送费责任方（契约 description 列出的 4 个值）。
 * ⚠️ 契约同时明写：**只记录、不参与任何计费**（本项目没有骑手返货运价）⇒ 页面只展示，不做金额推定。
 */
export const RETURN_FEE_BEARER_VALUES = ['MERCHANT', 'USER', 'RIDER', 'UNKNOWN'] as const

/**
 * 货损判定状态：契约只登记了 `RECORDED`（商家拒收 → 已记录货损，**只记录、不自动赔付**）。
 * ⇒ 页面只给 `RECORDED` 配文案，其它值原样回显。
 */
export const DAMAGE_CLAIM_STATUS_RECORDED = 'RECORDED'

/** `pageSize` 契约默认值（`api_doc.json` 的 `default: 20`）。 */
export const DELIVERY_RETURNS_DEFAULT_PAGE_SIZE = 20

/**
 * `GET /api/admin/delivery/returns` 查询参数。
 * ⚠️ **不传 ≠ 默认值**：
 * - `merchantId` 不传 = **全平台**（平台岗跨店排查）；
 * - `returnStatus` 不传 = 后端只返回**未收口**的（`PENDING` + `RETURNED`，`RETURNED` 优先）
 *   —— **没有**"全部状态"这个取值，故前端也不提供"全部"选项，更不会用空串顶替。
 */
export interface DeliveryReturnQuery {
  /**
   * 门店/商户 ID；**不传 = 全平台**（本页默认不传，绝不兜底成某个 id）。
   * ⚠️ **ID 空间待后端确认（前端不下结论）**：2026-10-10 探针显示该参数实际按**门店 id** 过滤
   * —— dev 唯一一条记录的 `merchantId` 是 `90108`，该值出现在 `/api/admin/shop/all`（门店列表）里、
   * **不在**平台 11 个品牌 ID 之中，门店 90108 自身的 `merchantId` 是 `913`；
   * `?merchantId=90108` 命中该行、`?merchantId=913` 命中 0 行。
   * ⇒ 前端只把输入值**原样**作为 `?merchantId=` 传下去（**不换算、不自动填充**），语义以契约为准。
   */
  merchantId?: number
  /** 返货状态；**不传 = 未收口（PENDING + RETURNED）**。 */
  returnStatus?: ReturnStatus
  /** 页码，从 1 开始（契约 default 1）。 */
  page?: number
  /** 每页条数（契约 default 20）。 */
  pageSize?: number
}

/**
 * 单行（前端归一化后的形状）。
 * ⚠️ 所有字段都可能是 `null` = **后端没给**（显示「—」），**不是 0、不是空串**。
 */
export interface DeliveryReturnRow {
  /** 任务 ID；未识别出时为 `null`。 */
  id: number | null
  /** 是否从后端对象里识别出了任务 ID（识别不出 ⇒ 页面提示"关键字段没对上"，并请看原始数据）。 */
  idRecognized: boolean
  /** 骑手任务号。 */
  taskNo: string | null
  /** 订单号。 */
  orderNo: string | null
  /**
   * 门店/商户 ID —— 字段名是 `merchantId`，但**它属于哪个 ID 空间未经后端确认**：
   * 2026-10-10 探针里唯一一条记录该值是 `90108`（出现在 `/api/admin/shop/all`，门店 90108 的
   * `merchantId` 是 `913`，且 `?merchantId=90108` 命中、`?merchantId=913` 不命中）
   * ⇒ **不据此推断是门店 id 还是品牌 id**，也不换算。
   * 契约**没有**下发商户名/门店名 ⇒ 页面只能**原样显示 ID**，不猜名字。
   */
  merchantId: number | null
  /** 配送员 ID（契约同样没有姓名 ⇒ 只显示 ID）。 */
  deliveryPersonId: number | null
  /** **骑手任务状态**（`delivery_tasks.status`，与订单 `deliveryStatus` 是两套枚举）。 */
  status: string | null
  /** 指派方式（`MERCHANT_SELF` / `ASSIGN_TO_PERSON` / `PUBLISH_CLAIM`）。 */
  assignmentType: string | null
  /** 收货人姓名。 */
  receiverName: string | null
  /** 收货人电话。 */
  receiverPhone: string | null
  /** 收货地址。 */
  deliveryAddress: string | null
  /** 返货状态原值（应为 {@link RETURN_STATUS_VALUES} 之一；其它值照原样保留）。 */
  returnStatus: string | null
  /** 需要返货的时刻（订单退款、产生返货要求）。 */
  returnRequiredAt: string | null
  /** 返货时限。 */
  returnDeadline: string | null
  /** 骑手**已返货到店**的时刻（`RETURNED` 的起点；自动验收的 2 小时从它算起）。 */
  returnedAt: string | null
  /** 商家**验收时限**。 */
  acceptDeadline: string | null
  /** 验收结果原值（契约无枚举说明 ⇒ 原样显示，不做翻译）。 */
  acceptResult: string | null
  /**
   * 是否「超时自动确认收货」（契约：`acceptAuto=true` = 系统超时自动确认）。
   * - `true` = 系统自动；`false` = 非系统自动（商家点的）；`null` = 后端没给/值不认识（显示「—」）。
   * ⚠️ 只做**布尔原义**呈现，不据此推断"有没有人验收过"。
   */
  acceptAuto: boolean | null
  /** 验收备注（人工填写的说明；自动验收时由后端写入系统备注）。 */
  acceptRemark: string | null
  /** 验收时刻。 */
  acceptTime: string | null
  /** 货损判定状态原值（`RECORDED` = 已记录货损，待人工判定；不自动赔付）。 */
  damageClaimStatus: string | null
  /** 返货配送费责任方原值（只记录、不计费）。 */
  returnFeeBearer: string | null
  /** 任务创建时间。 */
  createTime: string | null
  /** 任务更新时间。 */
  updateTime: string | null
  /** 该行的**原始对象**（原样保留：字段名不符预期时，页面上仍能看到后端真正下发了什么）。 */
  raw: Record<string, unknown>
}

/** 一次查询的归一化结果（`rows` 与"分页信息"分开，因为 `total` 可能缺失）。 */
export interface DeliveryReturnPageResult {
  rows: DeliveryReturnRow[]
  /** 后端下发的总条数；**没给时是 `null`**（页面据此切换翻页判据，不猜）。 */
  total: number | null
  /** 后端回显的当前页；没给时 `null`。 */
  page: number | null
  /** 后端回显的每页条数；没给时 `null`。 */
  pageSize: number | null
}

/* ==================================================================== *
 * 写：平台人工验收（2026-10-10 后端新增，本页由此**不再是只读页**）
 * ==================================================================== */

/** 返货运费责任方（body 里的取值域 = 契约 enum，与 {@link RETURN_FEE_BEARER_VALUES} 同一份）。 */
export type ReturnFeeBearer = (typeof RETURN_FEE_BEARER_VALUES)[number]

/**
 * `POST /api/admin/delivery/returns/{taskId}/accept` 的请求体（`AcceptReturnByPlatformBody`）。
 *
 * ⚠️ **整个 body 可以不传**：契约 `requestBody.description` 原文
 * 「验收请求体；不传等价于 accept=true（确认收货）」—— 所以 `accept` 缺省**不等于**前端可以
 * 编一个 `true` 发过去；调用方不指定时应当**真的不发 body**（由后端按契约取默认值）。
 *
 * 三个字段的契约原文（`components.schemas.AcceptReturnByPlatformBody`）：
 * - `accept`：「true=确认收货（默认，此后不可申请货损）；false=拒绝收货（记录货损，等人工判定）」；
 * - `remark`：「验收备注（拒绝收货时请说明破损/缺失情况）」；
 * - `returnFeeBearer`：「返货费责任方（可选，只记录不自动计费）」，enum `MERCHANT|USER|RIDER|UNKNOWN`。
 */
export interface AcceptReturnByPlatformBody {
  /** `true` = 确认收货（放行退款）；`false` = 拒收并记录货损（**不自动赔付**）。**不传 = 契约默认 accept=true**。 */
  accept?: boolean
  /** 验收备注；**空 = 不传这个字段**（不拿空串顶替，也不编默认备注）。 */
  remark?: string
  /** 返货运费责任方；**不选 = 不传这个字段**（前端不发明枚举以外的值，也不替后端选一个）。 */
  returnFeeBearer?: ReturnFeeBearer
}
