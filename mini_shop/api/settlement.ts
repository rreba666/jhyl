import { isApiRequestError, request } from '@/utils/request'

/**
 * 商户结算与提现（商家端）
 * ------------------------------------------------------------
 * 依据：`docs/商户提现-前端开发文档-2026-09-22.md` + `docs/商户结算与提现-设计与口径-2026-09-22.md`
 * 后端积木：fengling-settlement；接口前缀 `/api/merchant/settlement/**`。
 * 鉴权：C 端 user token（`Authorization: Bearer <token>`）即可；**仅品牌主体**（staffRole=MERCHANT_OWNER）
 * 可访问，店长/店员返回 `13016`，被拦截器拦的角色直接 `1004`。
 *
 * 本文件承担三件"必须集中在一处"的事（散到页面里必踩坑）：
 * 1. **`invoiceImages` 归一化**：响应里它是 **JSON 字符串**（不是数组）→ 这里统一 `JSON.parse` 并兜底空数组；
 *    **请求侧仍传数组**（文档 §7 待优化项 1，后端随后会改成数组，改完这里无需动页面）。
 * 2. **发票金额 == 申请金额**：后端强校验（`13014`）→ 用 `buildWithdrawApplyPayload()` 把同一个金额
 *    同时赋给 `amount` 与 `invoiceAmount`，页面只留一个金额输入框。
 * 3. **错误码中文文案**：`SETTLEMENT_ERROR_TEXT` 逐条覆盖文档 §5 里商家端会遇到的码，
 *    供提交前本地校验与后端只回码不回文案时兜底。
 *
 * ⚠️ 口径提醒（不要在前端做"聪明事"）：
 * - 申请即冻结 → 提交成功后页面必须**重新拉 account 与 rules**，**不要把可提现金额缓存在本地**；
 * - `amount` 恒正数，正负号由 `direction`（1=收入 2=支出）决定；
 * - 时间字段形如 `yyyy-MM-ddTHH:mm:ss`，展示只做**字符串规范化**，禁止用 `new Date` 转（会时区漂移）。
 */

// ===== 账户 =====

/** 结算账户（对应后端 AccountView）。 */
export interface SettlementAccountVO {
  /** 结算主体类型，固定 MERCHANT（品牌）。 */
  subjectType?: string
  /** 结算主体 ID（品牌 `wx_merchant.id`）。 */
  subjectId?: number
  /** 结算主体名称（品牌名，页面标题处展示）。 */
  subjectName?: string
  /** 可提现余额（恒 ≥ 0，退款扣不回只会记欠款，不压成负数）。 */
  availableBalance?: number
  /** 提现冻结中（已申请未打款；驳回/失败会解冻回可提现）。 */
  frozenBalance?: number
  /** 欠款（平台已垫付的退款等）；> 0 时禁止提现，由后续订单入账自动抵扣。 */
  debtAmount?: number
  /** 累计商品净额（净额口径，退款扣回会减）。 */
  totalGoodsIncome?: number
  /** 累计平台抽成。 */
  totalCommission?: number
  /** 累计配送费（全额归商家）。 */
  totalDeliveryFee?: number
  /** 累计已打款（已提现）。 */
  totalWithdrawn?: number
  /** 当前让利比例（%），用于展示「平台抽成 X%」；只影响之后新下的订单。 */
  commissionRate?: number
  /** 当前能否提现。 */
  withdrawable?: boolean
  /** 不能提现的原因；**非空时直接展示后端原文**，前端不要自己拼文案。 */
  withdrawBlockReason?: string | null
}

/** 结算账户（可提现/冻结/欠款 + 累计四项 + 当前让利比例 + 不可提原因）。 */
export function getSettlementAccount(): Promise<SettlementAccountVO> {
  return request<SettlementAccountVO>({ url: '/api/merchant/settlement/account', method: 'GET' })
}

// ===== 账户流水 =====

/** 流水类型（对应后端 `type`）。不传 = 全部。 */
export type SettlementFlowType =
  /** 订单收入 */
  | 'ORDER_INCOME'
  /** 退款扣回 */
  | 'ORDER_REVERSE'
  /** 欠款抵扣 */
  | 'DEBT_OFFSET'
  /** 提现冻结 */
  | 'WITHDRAW_FREEZE'
  /** 提现打款 */
  | 'WITHDRAW_SUCCESS'
  /** 提现驳回解冻 */
  | 'WITHDRAW_UNFREEZE'
  /** 人工调账 */
  | 'ADJUST'

/** 流水类型筛选项（流水页顶部 chips；`value` 为空串 = 全部）。 */
export const SETTLEMENT_FLOW_TYPE_OPTIONS: { label: string; value: SettlementFlowType | '' }[] = [
  { label: '全部', value: '' },
  { label: '订单收入', value: 'ORDER_INCOME' },
  { label: '退款扣回', value: 'ORDER_REVERSE' },
  { label: '欠款抵扣', value: 'DEBT_OFFSET' },
  { label: '提现冻结', value: 'WITHDRAW_FREEZE' },
  { label: '提现打款', value: 'WITHDRAW_SUCCESS' },
  { label: '提现解冻', value: 'WITHDRAW_UNFREEZE' },
  { label: '人工调账', value: 'ADJUST' },
]

/** 账户流水（对应后端 FlowView）。 */
export interface SettlementFlowVO {
  id?: number
  /** 流水类型（英文码）。 */
  type?: SettlementFlowType | string
  /** 流水类型中文文案（后端下发，直接展示）。 */
  typeText?: string
  /** 方向：**1 = 收入 2 = 支出**；`amount` 恒为正数，前端按 direction 加正负号。 */
  direction?: number
  /** 变动金额（恒正数）。 */
  amount?: number
  /** 变动后可提现余额快照（账单页「余额」列）。 */
  balanceAfter?: number
  /** 变动后欠款快照。 */
  debtAfter?: number
  /** 来源门店 ID；**提现/调账类流水为 null**，展示时要判空。 */
  shopId?: number | null
  /** 业务类型（如 ORDER / WITHDRAW）。 */
  bizType?: string
  /** 业务单号：订单号或提现单号。 */
  bizNo?: string
  /** 备注（后端原文，直接展示）。 */
  remark?: string
  /** 发生时间，`yyyy-MM-ddTHH:mm:ss`。 */
  createTime?: string
}

/** 账户流水分页结果（注意：后端 `size` 入参 → 响应里字段名是 `pageSize`）。 */
export interface SettlementFlowPageResult {
  total?: number
  list?: SettlementFlowVO[]
  page?: number
  pageSize?: number
}

/** 账户流水查询参数。 */
export interface SettlementFlowQuery {
  /** 流水类型，空 = 全部。 */
  type?: SettlementFlowType | ''
  /** 页码，从 1 开始。 */
  page?: number
  /** **每页条数（后端参数名是 `size`，不是 `pageSize`）**，1~100，默认 20。 */
  size?: number
}

/** 账户流水（分页）。 */
export function getSettlementFlows(params: SettlementFlowQuery = {}): Promise<SettlementFlowPageResult> {
  return request<SettlementFlowPageResult>({
    url: '/api/merchant/settlement/flows',
    method: 'GET',
    data: {
      // 空串 = 全部：转成 undefined 交给请求层丢弃，避免发出 `type=` 这种空参数
      type: params.type || undefined,
      page: params.page || 1,
      size: params.size || 20,
    },
  })
}

// ===== 提现规则 =====

/** 提现规则与当前状态（对应后端 RuleView）。 */
export interface SettlementWithdrawRulesVO {
  /** 最低提现金额（0 = 无最低）。 */
  minAmount?: number
  /** 最高提现金额（null = 无上限）。 */
  maxAmount?: number | null
  /** 是否要求已绑定微信（未绑定提交 → 8110）。 */
  requireWechatBinding?: boolean
  /** 是否要求上传发票图。 */
  requireInvoice?: boolean
  /** 发票图最少张数。 */
  invoiceImageMin?: number
  /** 发票图最多张数。 */
  invoiceImageMax?: number
  /** **true = 已有一笔在途提现（PENDING_REVIEW/APPROVED）→ 本次不能再提交**。 */
  hasActiveWithdraw?: boolean
  /** 可提现余额（与 account 同源，规则页也会下发）。 */
  availableBalance?: number
  /** 欠款金额。 */
  debtAmount?: number
  /** **不可提现原因，非空时直接展示后端原文**；null = 当前可以提现。 */
  blockReason?: string | null
}

/** 提现规则与当前状态（提现页加载时调用）。 */
export function getSettlementWithdrawRules(): Promise<SettlementWithdrawRulesVO> {
  return request<SettlementWithdrawRulesVO>({ url: '/api/merchant/settlement/withdraw/rules', method: 'GET' })
}

// ===== 提现单（列表 / 详情 / 提交响应） =====

/** 提现单状态。 */
export type MerchantWithdrawStatus = 'PENDING_REVIEW' | 'APPROVED' | 'SUCCESS' | 'REJECTED' | 'FAILED'

/** 提现单状态中文文案（文档 §2.6 的展示建议）。 */
export const MERCHANT_WITHDRAW_STATUS_TEXT: Record<string, string> = {
  PENDING_REVIEW: '审核中',
  APPROVED: '待打款',
  SUCCESS: '已到账',
  REJECTED: '已驳回',
  FAILED: '打款失败',
}

/** 收款方式：WECHAT=微信（默认）/ BANK_CARD=银行卡。 */
export type MerchantWithdrawPayeeType = 'WECHAT' | 'BANK_CARD'

/** 提现单（对应后端 MerchantWithdrawOrderEntity；`invoiceImages` 已归一化为数组）。 */
export interface MerchantWithdrawOrderVO {
  id?: number
  /** 提现单号（详情页入参）。 */
  withdrawNo?: string
  merchantId?: number
  subjectType?: string
  applyStaffId?: number
  applyUserId?: number
  /** 申请人姓名。 */
  applyName?: string
  /** 申请提现金额（元）。 */
  amount?: number
  /** 商家填写的发票金额（后端已校验 == amount）。 */
  invoiceAmount?: number
  /** 发票号（选填）。 */
  invoiceNo?: string | null
  /**
   * 发票图 URL 数组（1~6 张）。
   * ⚠️ **后端响应里是 JSON 字符串**，已由 `normalizeInvoiceImages()` 在 api 层归一化成数组，页面直接用。
   */
  invoiceImages?: string[]
  /** 提交时的可提现余额快照（财务三数核对的数字②）。 */
  balanceSnapshot?: number
  payeeType?: MerchantWithdrawPayeeType | string
  /** 收款人姓名。 */
  payeeName?: string
  /** 收款账号：微信号 / 手机号 / 银行卡号。 */
  payeeAccount?: string
  /** 收款码图片 URL（选填）。 */
  payeeQrUrl?: string | null
  status?: MerchantWithdrawStatus | string
  /** 财务审核意见（驳回/失败原因）。 */
  reviewRemark?: string | null
  /** 审核时间。 */
  reviewTime?: string | null
  /** 打款流水号（SUCCESS 时展示）。 */
  payNo?: string | null
  /** 打款凭证图 URL。 */
  payVoucherUrl?: string | null
  /** 打款时间（SUCCESS 时展示）。 */
  paidAt?: string | null
  /** 申请时间。 */
  createTime?: string
  updateTime?: string
}

/** 后端原始提现单：`invoiceImages` 未归一化（JSON 字符串 / 数组 / null 都可能）。 */
type RawMerchantWithdrawOrderVO = Omit<MerchantWithdrawOrderVO, 'invoiceImages'> & { invoiceImages?: unknown }

/**
 * 归一化发票图字段为字符串数组。
 *
 * ⚠️ 后端**响应**里 `invoiceImages` 是 **JSON 字符串**（如 `"[\"https://oss…/a.png\"]"`），不是数组
 * —— 这是文档 §7 的待优化项 1；**请求侧仍然是数组**（见 `buildWithdrawApplyPayload`）。
 * 兼容三种情况：已是数组（后端改好后）、JSON 字符串、脏数据 → 解析失败按**空数组**兜底，不抛错。
 */
export function normalizeInvoiceImages(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  const text = value.trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => String(item ?? '').trim()).filter(Boolean)
  } catch {
    // 解析失败按空数组处理（历史脏数据不能让提现记录页整页崩掉）
    return []
  }
}

/** 把后端原始提现单整形成页面可直接渲染的结构（发票图 → 数组）。 */
function normalizeWithdrawOrder(raw: RawMerchantWithdrawOrderVO | null | undefined): MerchantWithdrawOrderVO | null {
  if (!raw || typeof raw !== 'object') return null
  return { ...raw, invoiceImages: normalizeInvoiceImages(raw.invoiceImages) }
}

/** 提现记录分页结果。 */
export interface MerchantWithdrawPageResult {
  total?: number
  list?: MerchantWithdrawOrderVO[]
  page?: number
  pageSize?: number
}

/** 提现记录查询参数（**每页条数参数名是 `size`**）。 */
export interface MerchantWithdrawListQuery {
  /** 状态筛选，不传 = 全部。 */
  status?: MerchantWithdrawStatus | ''
  page?: number
  size?: number
}

/** 我的提现记录（分页，按申请时间倒序）。 */
export async function getSettlementWithdrawList(params: MerchantWithdrawListQuery = {}): Promise<MerchantWithdrawPageResult> {
  const raw = await request<{ total?: number; list?: RawMerchantWithdrawOrderVO[]; page?: number; pageSize?: number }>({
    url: '/api/merchant/settlement/withdraw/list',
    method: 'GET',
    data: {
      status: params.status || undefined,
      page: params.page || 1,
      size: params.size || 20,
    },
  })
  return {
    total: Number(raw?.total || 0),
    page: Number(raw?.page || params.page || 1),
    pageSize: Number(raw?.pageSize || params.size || 20),
    list: (Array.isArray(raw?.list) ? raw.list : []).map((item) => normalizeWithdrawOrder(item) as MerchantWithdrawOrderVO),
  }
}

/**
 * 提现单详情。
 * ⚠️ 非本商户的单后端按「不存在」处理（`1002`），页面按"单子不存在"提示即可。
 */
export async function getSettlementWithdrawDetail(withdrawNo: string): Promise<MerchantWithdrawOrderVO | null> {
  const raw = await request<RawMerchantWithdrawOrderVO>({
    url: `/api/merchant/settlement/withdraw/${encodeURIComponent(String(withdrawNo || ''))}`,
    method: 'GET',
  })
  return normalizeWithdrawOrder(raw)
}

// ===== 提交提现申请 =====

/** 提现申请请求体（对应后端 MerchantWithdrawApplyDTO）。 */
export interface MerchantWithdrawApplyDTO {
  /** 申请提现金额（> 0，最多两位小数，必须 ≤ 可提现余额）。 */
  amount: number
  /** 发票对应金额；**后端强校验必须等于 `amount`**。 */
  invoiceAmount: number
  /** 发票图片 URL 数组（1~6 张，来自 `POST /api/common/upload`）。 */
  invoiceImages: string[]
  /** 发票号（选填）。 */
  invoiceNo?: string
  /** 收款方式，默认 WECHAT。 */
  payeeType?: MerchantWithdrawPayeeType
  /** 收款人姓名（必填）。 */
  payeeName: string
  /** 收款账号：微信号 / 手机号 / 银行卡号（必填）。 */
  payeeAccount: string
  /** 收款码图片 URL（选填）。 */
  payeeQrUrl?: string
}

/** 页面收集到的提现表单（**只有一个金额字段**）。 */
export interface MerchantWithdrawApplyInput {
  /** 申请提现金额（元）——同时作为发票金额，二者同源。 */
  amount: number
  /** 发票图 URL 数组（1~6 张）。 */
  invoiceImages: string[]
  invoiceNo?: string
  payeeType?: MerchantWithdrawPayeeType
  payeeName: string
  payeeAccount: string
  payeeQrUrl?: string
}

/**
 * 由**单一金额**构造提交体。
 *
 * 后端强校验「发票金额必须等于申请金额」（不一致报 `13014`），所以前端**只留一个金额输入框**：
 * 这里把同一个 `amount` 同时写进 `amount` 与 `invoiceAmount`，从源头消除两者不一致的可能。
 * 请求侧的 `invoiceImages` 始终是**数组**（与响应侧的 JSON 字符串不同，见 `normalizeInvoiceImages`）。
 */
export function buildWithdrawApplyPayload(input: MerchantWithdrawApplyInput): MerchantWithdrawApplyDTO {
  return {
    amount: input.amount,
    // ⚠️ 同一个值 → 发票金额与申请金额天然一致（13014 不可能由前端产生）
    invoiceAmount: input.amount,
    invoiceImages: Array.isArray(input.invoiceImages) ? [...input.invoiceImages] : [],
    invoiceNo: input.invoiceNo || undefined,
    payeeType: input.payeeType || 'WECHAT',
    payeeName: input.payeeName,
    payeeAccount: input.payeeAccount,
    payeeQrUrl: input.payeeQrUrl || undefined,
  }
}

/**
 * 提交提现申请（**申请即冻结**）。
 * 入参是**已经构造好的请求体**：页面必须先用 `buildWithdrawApplyPayload()` 组装
 * （这样"发票金额 == 申请金额"这条强校验由 api 层保证，页面无法写歪）。
 * ⚠️ 成功后 `availableBalance` 立刻减少、`frozenBalance` 增加 →
 * 调用方必须重新拉 `getSettlementAccount()` 与 `getSettlementWithdrawRules()`，**不要把余额缓存在本地**。
 */
export async function applySettlementWithdraw(payload: MerchantWithdrawApplyDTO): Promise<MerchantWithdrawOrderVO | null> {
  const raw = await request<RawMerchantWithdrawOrderVO>({
    url: '/api/merchant/settlement/withdraw',
    method: 'POST',
    data: payload,
  })
  return normalizeWithdrawOrder(raw)
}

// ===== 错误码文案与提交前校验 =====

/** 未绑定微信（需引导去个人中心绑定）。 */
export const SETTLEMENT_CODE_WECHAT_UNBOUND = 8110
/** 非商户品牌主体（店长/店员误入，应隐藏入口）。 */
export const SETTLEMENT_CODE_NOT_MERCHANT_OWNER = 13016
/** 发票图已被其它提现单用过（需重新上传发票）。 */
export const SETTLEMENT_CODE_INVOICE_REUSED = 13019
/** 已有一笔在审提现（不允许再提交）。 */
export const SETTLEMENT_CODE_ACTIVE_WITHDRAW = 13013

/**
 * 商家端结算/提现错误码 → 中文文案（对应文档 §5）。
 * 逐条覆盖本批前端会遇到的码：后端文案优先（`13011/13012/13014` 会带具体金额），
 * 本表用于**提交前本地校验**与后端只回码不回文案时的兜底。
 */
export const SETTLEMENT_ERROR_TEXT: Record<number, string> = {
  13010: '商户结算账户不存在，请稍后重试或联系平台',
  13011: '可提现金额不足',
  13012: '账户存在欠款，需先由后续订单入账抵扣后才能提现',
  13013: '您有一笔提现正在审核中，请等待处理完成后再申请',
  13014: '发票金额与申请提现金额不一致',
  13015: '提现单状态已变化，请刷新后重试',
  13016: '仅商户品牌主体可查看结算账户与提现',
  13017: '请上传发票图片（1~6 张）',
  13019: '该发票图片已用于其它提现单，请勿重复提交（每次提现都要重新上传发票）',
  13020: '提现金额必须大于 0，最多两位小数',
  13021: '请填写收款人姓名与收款账号（微信号/手机号）',
  13022: '该商户当前状态不支持结算，请联系平台',
  8110: '请先在个人中心绑定微信后再提现',
}

/**
 * 把请求异常转成可直接 toast 的中文文案。
 * 优先用**后端原文**（`13012/13014` 带具体金额、欠款金额等，前端不该自己拼）；
 * 后端没给文案时按 `SETTLEMENT_ERROR_TEXT` 回退；都没有才用 `fallback`。
 */
export function resolveSettlementErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (isApiRequestError(error)) {
    const message = String(error.message || '').trim()
    if (message) return message
    const code = Number(error.code)
    if (Number.isFinite(code) && SETTLEMENT_ERROR_TEXT[code]) return SETTLEMENT_ERROR_TEXT[code]
    return fallback
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/** 提交前本地校验的入参。 */
export interface SettlementWithdrawFormCheck {
  /** 用户输入的金额原文（字符串，便于判断小数位）。 */
  amount: string | number
  /** 已上传的发票图 URL 数组。 */
  invoiceImages: string[]
  payeeName: string
  payeeAccount: string
  /** 当前可提现余额（来自 account/rules，**不缓存**）。 */
  availableBalance: number
  /** 发票图张数下限（默认取 rules.invoiceImageMin，兜底 1）。 */
  invoiceImageMin?: number
  /** 发票图张数上限（默认取 rules.invoiceImageMax，兜底 6）。 */
  invoiceImageMax?: number
}

/** 金额字符串是否合法：> 0 且最多两位小数。 */
function isValidAmountText(value: string | number): boolean {
  const text = String(value ?? '').trim()
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) return false
  const num = Number(text)
  return Number.isFinite(num) && num > 0
}

/**
 * 提交前的**前端硬校验**（对应文档 §2.5 的硬校验表），提前拦掉本地能判断的项，
 * 别让商家填完一堆信息才被后端打回。返回 `null` = 通过，否则返回可直接展示的中文文案。
 *
 * 本地拦的是：金额格式（13020）、发票张数（13017）、收款信息（13021）、金额是否超余额（13011）。
 * 只有后端能判的（欠款 13012 / 在途提现 13013 / 发票图被用过 13019 / 未绑微信 8110）留给后端，
 * 但页面在按钮置灰与提示里都会用到本文件的 `SETTLEMENT_ERROR_TEXT` 文案。
 *
 * ⚠️ 为什么不复用 `@/utils/input-validation` 的 `validateAmount()`：它给的文案
 * （"提现金额必须是数字且最多保留两位小数" / "提现金额超过可用余额"）与本批要求**逐条对齐文档 §5**
 * 的 13020 / 13011 官方文案不一致，故金额校验统一从 `SETTLEMENT_ERROR_TEXT` 出口。
 * 另外需求是「提现无最低、无上限」（`rules.minAmount=0`、`maxAmount=null`），
 * 所以本地只校验"金额 > 0 + 最多两位小数"和"不超过可提现余额"这两条。
 */
export function validateWithdrawForm(form: SettlementWithdrawFormCheck): string | null {
  if (!isValidAmountText(form.amount)) return SETTLEMENT_ERROR_TEXT[13020]
  const amount = Number(String(form.amount).trim())
  const min = Number.isFinite(Number(form.invoiceImageMin)) && Number(form.invoiceImageMin) > 0 ? Number(form.invoiceImageMin) : 1
  const max = Number.isFinite(Number(form.invoiceImageMax)) && Number(form.invoiceImageMax) > 0 ? Number(form.invoiceImageMax) : 6
  const imageCount = Array.isArray(form.invoiceImages) ? form.invoiceImages.length : 0
  if (imageCount < min || imageCount > max) return SETTLEMENT_ERROR_TEXT[13017]
  if (!String(form.payeeName || '').trim() || !String(form.payeeAccount || '').trim()) return SETTLEMENT_ERROR_TEXT[13021]
  const balance = Number(form.availableBalance)
  if (Number.isFinite(balance) && amount > balance) return SETTLEMENT_ERROR_TEXT[13011]
  return null
}

// ===== 展示格式化（只做字符串/数值处理，不做时区转换） =====

/** 提现单状态中文文案（未识别的状态原样返回，避免显示空白）。 */
export function withdrawStatusText(status?: string | null): string {
  const key = String(status || '').trim()
  if (!key) return '—'
  return MERCHANT_WITHDRAW_STATUS_TEXT[key] || key
}

/**
 * 时间展示规范化：`yyyy-MM-ddTHH:mm:ss` → `yyyy-MM-dd HH:mm:ss`。
 *
 * ⚠️ **禁止用 `new Date` 解析再格式化**：后端下发的时间**不带时区**，
 * 小程序端把 `2026-09-22T15:19:00` 交给 `new Date` 时，iOS 会按 UTC 解析，展示时漂移 8 小时。
 * 这里只做纯字符串替换，保证"后端给什么就展示什么"。
 */
export function formatSettlementTime(value?: string | null): string {
  const text = String(value ?? '').trim()
  if (!text) return '—'
  return text.replace('T', ' ').replace(/\.\d+$/, '')
}

/** 时间展示（列表用短格式）：`yyyy-MM-ddTHH:mm:ss` → `MM-DD HH:mm`，同样只做字符串处理。 */
export function formatSettlementTimeShort(value?: string | null): string {
  const text = formatSettlementTime(value)
  const matched = /^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2})/.exec(text)
  if (!matched) return text
  return `${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}`
}

/** 金额格式化：固定两位小数（后端按分 HALF_UP，前端展示同样两位）。 */
export function formatSettlementAmount(value?: number | null): string {
  const num = Number(value)
  return Number.isFinite(num) ? num.toFixed(2) : '0.00'
}

/** 让利比例文案：`5` → `5%`，`5.5` → `5.5%`。 */
export function formatCommissionRate(value?: number | null): string {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return '—'
  return `${Number.isInteger(num) ? num : num.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`
}

/**
 * 流水金额带符号展示：`direction = 1` 收入（`+`）、`2` 支出（`-`）。
 * `amount` 恒正数，符号与颜色都由 `direction` 决定（页面据此加 `.is-income` / `.is-expense` 类）。
 */
export function formatSettlementFlowAmount(flow: { direction?: number; amount?: number } | null | undefined): string {
  const sign = Number(flow?.direction) === 2 ? '-' : '+'
  return `${sign}${formatSettlementAmount(flow?.amount)}`
}

/** 流水是否为收入（1=收入 2=支出）。 */
export function isSettlementFlowIncome(flow: { direction?: number } | null | undefined): boolean {
  return Number(flow?.direction) !== 2
}
