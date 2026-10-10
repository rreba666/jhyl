<script setup lang="ts">
/**
 * 商家端 · 结算与提现（主页）
 * ------------------------------------------------------------
 * 契约：`docs/商户提现-前端开发文档-2026-09-22.md`（§2.1 账户 / §2.3 规则 / §2.5 提交 / §4 状态机）
 * - `GET  /api/merchant/settlement/account`        → 账户卡片（可提现 / 冻结中 / 欠款 + 累计四项 + 让利比例）
 * - `GET  /api/merchant/settlement/withdraw/rules` → 规则与当前状态（无最低无上限 / 是否在审 / 是否绑微信 / blockReason）
 * - `POST /api/merchant/settlement/withdraw`       → 提交申请（发票图 1~6 张 + **单一金额** + 收款信息）**申请即冻结**
 * - `POST /api/common/upload`                      → 发票图 / 收款码上传（复用 `utils/request` 的 `uploadFile`）
 * 入口：本页可进「账户流水」（flows.vue）与「提现记录」（withdraw-list.vue）。
 *
 * 必须守住的口径（文档 §6「踩过的坑」，改动前先读）：
 * 1. **只留一个金额输入框**：后端强校验「发票金额 == 申请金额」（13014），
 *    提交体由 api 层 `buildWithdrawApplyPayload()` 用同一个金额填 `amount` + `invoiceAmount`；
 * 2. **同一张发票图不能复用**（13019，含被驳回的单）→ 后端报 13019 时清空已选发票并提示**重新上传发票**；
 * 3. **申请即冻结**：提交成功后必须重新拉 `account` 与 `rules`，**绝不把可提现金额缓存在本地**；
 * 4. `withdrawable=false` / `blockReason` 非空 / `hasActiveWithdraw=true` → 提现按钮**置灰**，
 *    且**直接展示后端下发的原因**（前端不自己拼文案）；
 * 5. 未绑定微信（8110）→ 弹窗引导去个人中心绑定；
 * 6. 时间只做字符串规范化（api 层 `formatSettlementTime`），**不用 `new Date`**（会时区漂移）；
 * 7. ⚠️ 2026-10-08（W8 §1）**换码**：提现被「品牌有未完结售后」拦下 = **`13025`**
 *    （旧码 `13023` 已归「商品不支持线下自提」，**那个码在本页与本文件里一律不处理**）。
 * 8. ⚠️ 2026-10-10（用户要求「说明太冗余，收进按钮后的弹框」）：本页**只留入口**，
 *    三块说明长文案的正文在 `components/WithdrawRulesSheet.vue`（三个话题共用，按 `mode` 切换）。
 *    ⇒ 改这些文案时去组件里改，**别抄回本页**（抄回来就又有两份会漂的正文了）。
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  SETTLEMENT_CODE_ACTIVE_WITHDRAW,
  SETTLEMENT_CODE_AFTER_SALE_BLOCK,
  SETTLEMENT_CODE_INVOICE_REUSED,
  SETTLEMENT_CODE_NOT_MERCHANT_OWNER,
  SETTLEMENT_CODE_WECHAT_UNBOUND,
  SETTLEMENT_ERROR_TEXT,
  applySettlementWithdraw,
  buildWithdrawApplyPayload,
  formatCommissionRate,
  formatSettlementAmount,
  getSettlementAccount,
  getSettlementWithdrawRules,
  resolveSettlementErrorMessage,
  validateWithdrawForm,
  type MerchantWithdrawPayeeType,
  type SettlementAccountVO,
  type SettlementWithdrawRulesVO,
} from '@/api/settlement'
import { isApiRequestError, resolveImageUrl, uploadFile } from '@/utils/request'
// ⚠️ 2026-10-09（W16）：**品牌（商户）级**让利比例的**自助修改**接口
//    （`PUT /api/merchant/business/commission-rate`，query 参数、**无请求体**、**不带 merchantId**）。
import { updateMerchantBusinessCommissionRate } from '@/api/merchant'
// ⚠️ 让利比例的区间 / 解析 / 校验 / 越界文案**只有这一份实现**（后端同码 13018）。
//    ⚠️ 本页用的是「**自助修改**」那一组文案（`MERCHANT_COMMISSION_RATE_EDIT_*`，语义 = 留空**不修改**）；
//    ⛔ 绝不能搬入驻页那一组（`..._INPUT_PLACEHOLDER` 写的"留空按平台默认"是**另一个端点**的语义）。
import {
  MERCHANT_COMMISSION_RATE_EDIT_BLANK_TOAST,
  MERCHANT_COMMISSION_RATE_EDIT_ENTRY_TEXT,
  MERCHANT_COMMISSION_RATE_EDIT_OMIT_NOTE,
  MERCHANT_COMMISSION_RATE_EDIT_SUCCESS_TEXT,
  MERCHANT_COMMISSION_RATE_ERROR_CODE,
  MERCHANT_COMMISSION_RATE_RANGE_TEXT,
  parseMerchantCommissionRateInput,
  validateMerchantCommissionRate,
} from '@/utils/product-commission'
// ⚠️ 2026-10-03 新增提现说明弹层（微信审核要求「提现页需清晰展示提现规则」）；
//    ⚠️ 2026-10-10 扩展为**三个话题共用一个组件**（`mode` = withdraw / release / rate）：
//    本页原来的三块说明长文案（资金释放时间 / 提现规则 / 让利比例说明）**已原样搬进该组件**，
//    页面只留入口行（用户要求：「说明太冗余了，放在几个按钮后点击弹框出现」）。
//    ⇒ ⛔ 别把这些文案再抄回本页，正文的单一来源是那个组件。
import WithdrawRulesSheet from '@/components/WithdrawRulesSheet.vue'
// ⚠️ 2026-10-10（真机反馈）：品牌级比例的**自助调整**从原生可编辑弹窗（`uni.showModal`）换成自建输入弹层
//    —— 原生弹窗的输入框控不了聚焦、也没有可控的占位（用户要求占位只写「3~20」），
//    还没有小数键盘（`type="digit"`）。弹层只负责采集**原文**，校验/提交全在本页（口径只有一处）。
import CommissionRateSheet from '@/components/CommissionRateSheet.vue'
// ⚠️ 2026-10-08 Step2：同城资金释放口径 = 「送达次日 0 点起，普通 +7 天 / 生鲜 +3 天」，**按档位分叉**。
//    ⚠️ 2026-10-10：该口径的文案常量（`SETTLEMENT_RELEASE_TEXT_SAME_CITY`）**已随「钱什么时候能提现？」
//    整段搬进 `components/WithdrawRulesSheet.vue`**（页面只留入口行）⇒ 本页**不再** import 它。
//    单一来源仍是 `utils/timing-category`（与 C 端「售后窗口」同一份），改口径时改那里。

const statusBarHeight = ref(0)
/** 内容区顶部留白 = 状态栏 + 自定义导航栏高度（与 bill/index.vue 同口径）。 */
const contentTop = computed(() => statusBarHeight.value + 44)

/** 结算账户（**不缓存到本地存储**，每次进页面/提交后都重新拉）。 */
const account = ref<SettlementAccountVO>({})
/** 提现规则与当前状态。 */
const rules = ref<SettlementWithdrawRulesVO>({})
const loading = ref(false)
const submitting = ref(false)
/** 非品牌主体（13016）：整页只显示提示，不渲染账户与表单（店长/店员误入）。 */
const notMerchantOwner = ref(false)
/**
 * 说明弹层显隐（2026-10-03 新增）。
 * ⚠️ 微信审核要求提现页**清晰展示提现规则**（可提现额度 / 每日提现次数 / 提现时间 / 到账时间）
 * ⇒ 入口放在「可提现余额」右侧，点开是 `WithdrawRulesSheet`（完整规则 + 规则速览）。
 */
const withdrawRulesVisible = ref(false)

/**
 * 说明弹层的**当前话题**（2026-10-10 新增）。
 * ⚠️ 本页三个说明入口共用**同一个**弹层组件（`components/WithdrawRulesSheet.vue`），靠这个
 *    值切换正文 —— 不再为每个话题各建一个弹层（弹层语言/滚动只有一份实现，多一份必然漂）。
 */
const rulesSheetMode = ref<'withdraw' | 'release' | 'rate'>('withdraw')

/**
 * 打开说明弹层到指定话题（三个入口的唯一入口函数）。
 *
 * - `'withdraw'`：「提现说明」（余额卡右侧）与「提现规则」（说明与规则卡）；
 * - `'release'` ：「钱什么时候能提现？」；
 * - `'rate'`     ：「让利比例说明」。
 */
function openRulesSheet(mode: 'withdraw' | 'release' | 'rate'): void {
  rulesSheetMode.value = mode
  withdrawRulesVisible.value = true
}

// ===== 提现申请表单（**金额只有一个输入框**） =====
const amountText = ref('')
const invoiceImages = ref<string[]>([])
const invoiceNo = ref('')
const payeeType = ref<MerchantWithdrawPayeeType>('WECHAT')
const payeeName = ref('')
const payeeAccount = ref('')
const payeeQrUrl = ref('')
const uploading = ref(false)
const qrUploading = ref(false)

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  uni.setNavigationBarTitle({ title: '结算与提现' })
})

// 每次显示都重新拉数据：提交后余额/规则会变（申请即冻结），返回本页也必须是最新值
onShow(() => { void refreshData() })

// ===== 金额与状态展示 =====

/**
 * 可提现余额。
 *
 * ⚠️ 2026-09-30 加固：原先写 `Number(account.value?.availableBalance || 0)`，
 * 会把「**字段缺失 / 为 null**」也变成 `0`，而该值同时又用于**本地 13011 校验**
 * （`:492` 的 `amount > balance`）⇒ 一旦后端没下发该字段，商家不但看到
 * 「可提现 ¥0.00」（以为钱没了），而且**任意金额都会被本地拦成「可提现金额不足」**，
 * **完全无法提交提现** —— 比单纯显示错误严重得多。
 * ⇒ 改为严格判空：只有确实 `null` / `undefined` 才回退 0；
 * ⚠️ `0` 本身是**合法值**（钱全在锁定期/已提完），必须原样保留。
 * ⚠️ 注意 `Number(null) === 0`（**不是 NaN**），所以必须**先判 `== null`** 再 `Number()`。
 */
const availableBalance = computed(() => {
  const raw = account.value?.availableBalance
  if (raw == null) return 0
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
})
const debtAmount = computed(() => Number(account.value?.debtAmount || 0))
/** 发票图张数上下限：以后端规则为准，缺失时兜底 1~6（文档 §2.4）。 */
const imageMin = computed(() => (Number(rules.value?.invoiceImageMin) > 0 ? Number(rules.value?.invoiceImageMin) : 1))
const imageMax = computed(() => (Number(rules.value?.invoiceImageMax) > 0 ? Number(rules.value?.invoiceImageMax) : 6))
/** 当前让利比例文案（「平台抽成 X%」）。 */
const commissionRateText = computed(() => formatCommissionRate(account.value?.commissionRate))

/**
 * 阻断原因：**后端原文优先**（`account.withdrawBlockReason` → `rules.blockReason`）。
 * 两者都空但 `hasActiveWithdraw=true` 时，用文档 §5 的 13013 文案（"有一笔在审核中"）。
 */
const submitBlockReason = computed(() => {
  const reason = String(account.value?.withdrawBlockReason || rules.value?.blockReason || '').trim()
  if (reason) return reason
  if (rules.value?.hasActiveWithdraw) return SETTLEMENT_ERROR_TEXT[SETTLEMENT_CODE_ACTIVE_WITHDRAW]
  return ''
})

/** 提现按钮是否置灰：后端明确 `withdrawable=false`，或存在任何阻断原因（含在途提现）。 */
const submitBlocked = computed(() => account.value?.withdrawable === false || Boolean(submitBlockReason.value))

/**
 * 后端只给 `withdrawable=false` 却没给原因时的兜底文案。
 * ⚠️ 这里**不能**猜成"有一笔提现正在审核中"（那是 13013 的语义，只在 `hasActiveWithdraw=true` 时成立）。
 */
const BLOCK_FALLBACK_TEXT = '当前不可提现，请稍后重试或联系平台'

/**
 * 阻断原因旁的补充说明（**Step3 §一 前端建议原文**）：
 * 该闸门的主因是「品牌有未完结售后（`withdrawable=false`）」，后端 `withdrawBlockReason` 只说明
 * "为什么现在不能提"，这句补上"**什么时候恢复**"——为避免退款时资金已被提走，
 * 售后全部完结后由后端**自动**放开（无需人工、无需重新申请）。
 *
 * ⚠️ **只在阻断原因确实与售后有关时才渲染**（见 `isAfterSaleBlock`）：`submitBlockReason` 也可能来自
 *    「未绑微信 / 有欠款 / 有在途提现 / 余额为 0」等**非售后**原因 —— 那些场景下写"售后处理完成后
 *    即可提现"会让用户误以为要等售后，反而更困惑（2026-10-08 复核补上这道闸门）。
 * ⚠️ 只在这里定义一次，模板两处引用同一个常量（两处各写一份必然漂）。
 * ⚠️ 2026-10-08（W8 §1）：该闸门在**提交层**对应的错误码已换为 `13025`
 *    （`SETTLEMENT_CODE_AFTER_SALE_BLOCK`；旧码 `13023` 归「商品不支持线下自提」，见 `api/settlement.ts`）。
 */
const WITHDRAW_AFTER_SALE_RESUME_HINT = '售后处理完成后即可提现'

/**
 * 当前阻断原因是否与「未完结售后」有关 —— 决定是否显示 {@link WITHDRAW_AFTER_SALE_RESUME_HINT}。
 *
 * ⚠️ 后端 `withdrawBlockReason` 是**自然语言文案**而非结构化枚举（契约 `MerchantSettlementController.account`
 *    只给了 `withdrawable: boolean` + `withdrawBlockReason: string`）⇒ 这里只能按关键词判。
 *    依据 Step3 §一，售后那条的后端原文是「当前有 N 笔未完结售后（待审核/退款中/待寄回/待收货）…」，
 *    **必然含「售后」二字**；其余原因（欠款 / 在途提现 / 余额为 0 / 未绑微信）都不含。
 * ⚠️ **展示层拿不到 `13025`**（它是提现**提交**被拦时的业务码，`account`/`rules` 响应里没有码字段）
 *    ⇒ 展示层这道闸门仍只能按文案关键词判，不要试图改成按码判断。
 * ⚠️ 若后端将来补了结构化字段（如 `withdrawBlockCode`），应改判该字段，不要再匹配文案。
 */
const isAfterSaleBlock = computed(() => submitBlockReason.value.includes('售后'))

// ===== 数据加载 =====

/** 判断是否为「非品牌主体」（13016，店长/店员误入结算接口）。 */
function isNotMerchantOwnerError(error: unknown): boolean {
  return isApiRequestError(error) && Number(error.code) === SETTLEMENT_CODE_NOT_MERCHANT_OWNER
}

/** 拉结算账户；13016 → 整页置为「仅品牌主体可见」。 */
async function loadAccount(): Promise<void> {
  try {
    const raw = (await getSettlementAccount()) || {}
    account.value = raw
    logAccountDiagnostic(raw)
    notMerchantOwner.value = false
  } catch (error) {
    account.value = {}
    if (isNotMerchantOwnerError(error)) {
      notMerchantOwner.value = true
      return
    }
    uni.showToast({ title: resolveSettlementErrorMessage(error, '结算账户加载失败'), icon: 'none' })
  }
}

/**
 * ⚠️ **临时诊断**（2026-10-02 加入）：核对「待结算」金额是否为后端口径问题。
 *
 * 起因：用户实测下 3 单各 ¥0.01（**合计 ¥0.03**），页面「待结算」却显示 **0.30**（**×10**）。
 * 已核实**前端全链路无任何 ×10 / ÷100 换算**（`formatSettlementAmount` 只是 `Number(v).toFixed(2)`，
 * 模板直接绑 `account.pendingSettlementAmount`）⇒ 需看**后端原始值**才能定性。
 *
 * ⚠️ 若原始值确为 `0.3` ⇒ **后端计算问题**（反馈后端）；
 *    若原始值为 `0.03` 而页面显示 0.30 ⇒ **前端渲染问题**（回来查这里）。
 * ⚠️ 定位后**应删除**本函数与调用（避免长期留噪音日志）。
 */
function logAccountDiagnostic(raw: SettlementAccountVO): void {
  console.warn('[MerchantSettlement] account raw:', JSON.stringify({
    availableBalance: raw.availableBalance,
    pendingSettlementAmount: raw.pendingSettlementAmount,
    frozenBalance: raw.frozenBalance,
    debtAmount: raw.debtAmount,
    totalGoodsIncome: raw.totalGoodsIncome,
    totalCommission: raw.totalCommission,
    totalDeliveryFee: raw.totalDeliveryFee,
    totalWithdrawn: raw.totalWithdrawn,
    commissionRate: raw.commissionRate,
  }))
}

/** 拉提现规则（失败静默：阻断原因与张数限制退化为兜底值，不打断主流程）。 */
async function loadRules(): Promise<void> {
  try {
    rules.value = (await getSettlementWithdrawRules()) || {}
  } catch (error) {
    rules.value = {}
    if (isNotMerchantOwnerError(error)) notMerchantOwner.value = true
  }
}

/** 刷新账户 + 规则（提交成功后必须调用，见口径 3）。 */
async function refreshData(): Promise<void> {
  loading.value = true
  try {
    await Promise.all([loadAccount(), loadRules()])
  } finally {
    loading.value = false
  }
}

// ===== 让利比例（**品牌级**）自助修改（2026-10-09 W16）=====

/** 自助修改提交中（防连点 + 入口置灰 + 弹层禁关闭）。 */
const commissionSubmitting = ref(false)

/** 自助调整弹层显隐（2026-10-10：由自建弹层采集输入，见 `components/CommissionRateSheet.vue`）。 */
const commissionSheetVisible = ref(false)

/** 打开自助调整弹层（提交中不响应）。 */
function openCommissionRateEdit(): void {
  if (commissionSubmitting.value) return
  commissionSheetVisible.value = true
}

/**
 * 自助调整弹层的「确认」：校验 → 提交 → 成功后关弹层并刷新卡片。
 *
 * 契约：`PUT /api/merchant/business/commission-rate?commissionRate=5.5`
 * （**query 参数、无请求体**；身份由服务端从登录态解析 —— ⛔ 页面**不得**带 `merchantId`，
 * 那个请求属性装的是**门店 ID**，用在本接口上是错的）。
 *
 * ⚠️ 三条口径（改前先读 `utils/product-commission.ts` 的「自助修改」一节）：
 * 1. **本端点是「不传 = 不修改」** —— 与**入驻申请**的「不传/null = 用平台默认 3%」**不是一回事**：
 *    输入框留空 = **一个请求都不发**（既不改成 0，也不掉回平台默认），只如实提示"本次不修改"。
 *    ⇒ 文案只用 `MERCHANT_COMMISSION_RATE_EDIT_*`；⛔ 不得搬入驻页那组（那句写的是"留空按平台默认"）。
 * 2. 区间 **3~20** 与越界文案**复用** `utils/product-commission`（同一个后端码 `13018`），
 *    本页**不重写**任何字面量；后端仍报 `13018` 时用同一句话兜底。
 *    ⚠️ 归一化（`3%` / `３` / 零宽字符 ⇒ 当 3 处理）也在那个共享函数里，**本页不写第二份**。
 * 3. 成功后**重新拉账户**（`loadAccount()`）—— 卡片显示的必须是最新值，**不信本地缓存**。
 *
 * ⚠️ 弹层**不在这里关**（成功那次除外）：留空/越界/提交失败都让弹层开着，用户改一下就能重试，
 *    输入不丢；成功才关。`commissionSubmitting` 一律在 `finally` 复位，弹层在提交中也不可关闭
 *    ⇒ 不会出现"弹层关了、`commissionSubmitting` 还卡在 true"。
 * ⚠️ 生效口径：只影响之后**新下**的订单（下单快照），在途/历史订单不变。
 */
async function editCommissionRate(text: string): Promise<void> {
  if (commissionSubmitting.value) return
  // ⚠️ 留空 = **不修改**（本端点语义）：**不发请求**，也**不**谎报"已更新"
  if (!String(text ?? '').trim()) {
    commissionSheetVisible.value = false
    uni.showToast({ title: MERCHANT_COMMISSION_RATE_EDIT_BLANK_TOAST, icon: 'none' })
    return
  }
  // 本地硬校验 3~20（越界用后端 13018 同一句话）；弹层保持打开，用户改一下即可重试
  const commissionError = validateMerchantCommissionRate(text)
  if (commissionError) {
    uni.showToast({ title: commissionError, icon: 'none' })
    return
  }
  const commissionParsed = parseMerchantCommissionRateInput(text)
  if (commissionParsed.kind !== 'value') {
    uni.showToast({ title: MERCHANT_COMMISSION_RATE_RANGE_TEXT, icon: 'none' })
    return
  }
  commissionSubmitting.value = true
  try {
    await updateMerchantBusinessCommissionRate(commissionParsed.value)
    // 成功即刷新卡片（后端写的是**品牌级** `wx_merchant.commission_rate`）
    await loadAccount()
    // 只有成功才关弹层（失败/越界保持打开，见函数头注释）
    commissionSheetVisible.value = false
    uni.showToast({ title: MERCHANT_COMMISSION_RATE_EDIT_SUCCESS_TEXT, icon: 'success' })
  } catch (error) {
    // 13018（越界）：本地已拦一遍，这里是后端兜底 —— 用同一句话
    if (isApiRequestError(error) && Number(error.code) === MERCHANT_COMMISSION_RATE_ERROR_CODE) {
      uni.showToast({ title: MERCHANT_COMMISSION_RATE_RANGE_TEXT, icon: 'none' })
      return
    }
    uni.showToast({ title: resolveSettlementErrorMessage(error, '让利比例修改失败'), icon: 'none' })
  } finally {
    commissionSubmitting.value = false
  }
}

// ===== 发票图 / 收款码上传 =====

/**
 * 选图（拍照或相册）：小程序端 `uni.chooseMedia` 返回 `tempFiles[].tempFilePath`。
 * 返回临时文件路径数组；用户取消时 reject，由调用方按"已取消"静默处理。
 */
function chooseMedia(count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    uni.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res: { tempFiles?: { tempFilePath?: string }[] }) => {
        resolve((res?.tempFiles || []).map((item) => String(item?.tempFilePath || '')).filter(Boolean))
      },
      fail: (error: { errMsg?: string }) => reject(new Error(error?.errMsg || '已取消选择')),
    })
  })
}

/** 用户主动取消选图不算失败，不弹错误提示。 */
function isCancelError(error: unknown): boolean {
  return /cancel/i.test(String((error as Error)?.message || ''))
}

/**
 * 追加发票图：先选本地图 → 逐张 `uploadFile()` 换成后端 OSS 直链 → 存 URL 数组。
 * 一次最多补足到上限（1~6 张）；**已上传的图不能复用到下一笔提现**（后端 13019）。
 */
async function chooseInvoiceImages(): Promise<void> {
  if (uploading.value || submitting.value) return
  const remain = imageMax.value - invoiceImages.value.length
  if (remain <= 0) {
    uni.showToast({ title: `最多上传 ${imageMax.value} 张发票`, icon: 'none' })
    return
  }
  uploading.value = true
  try {
    const files = await chooseMedia(remain)
    for (const filePath of files) {
      const url = await uploadFile(filePath)
      if (url) invoiceImages.value = [...invoiceImages.value, url]
    }
  } catch (error) {
    if (!isCancelError(error)) {
      uni.showToast({ title: resolveSettlementErrorMessage(error, '发票图上传失败'), icon: 'none' })
    }
  } finally {
    uploading.value = false
  }
}

/** 删除某张发票图（索引越界直接忽略）。 */
function removeInvoiceImage(index: number): void {
  if (index < 0 || index >= invoiceImages.value.length) return
  invoiceImages.value = invoiceImages.value.filter((_, current) => current !== index)
}

/** 预览发票图（财务要能看清票面金额，故必须可放大）。 */
function previewInvoiceImages(current: string): void {
  if (!invoiceImages.value.length) return
  uni.previewImage({ urls: invoiceImages.value.map((item) => resolveImageUrl(item)), current: resolveImageUrl(current) })
}

/** 上传收款码（选填，1 张）。 */
async function choosePayeeQr(): Promise<void> {
  if (qrUploading.value || submitting.value) return
  qrUploading.value = true
  try {
    const files = await chooseMedia(1)
    if (!files.length) return
    payeeQrUrl.value = await uploadFile(files[0])
  } catch (error) {
    if (!isCancelError(error)) {
      uni.showToast({ title: resolveSettlementErrorMessage(error, '收款码上传失败'), icon: 'none' })
    }
  } finally {
    qrUploading.value = false
  }
}

/** 预览收款码。 */
function previewPayeeQr(): void {
  if (!payeeQrUrl.value) return
  uni.previewImage({ urls: [resolveImageUrl(payeeQrUrl.value)] })
}

// ===== 提交提现申请 =====

/** 重置表单（成功后调用；发票图必须清空 —— 同一张图不能复用于下一笔）。 */
function resetForm(): void {
  amountText.value = ''
  invoiceImages.value = []
  invoiceNo.value = ''
  payeeQrUrl.value = ''
}

/** 提交失败按错误码给差异化引导（文案一律取文档 §5 口径）。 */
function handleSubmitError(error: unknown): void {
  const code = isApiRequestError(error) ? Number(error.code) : NaN

  // 8110：提现前置是已绑定微信 → 引导去个人中心
  if (code === SETTLEMENT_CODE_WECHAT_UNBOUND) {
    uni.showModal({
      title: '需要先绑定微信',
      content: SETTLEMENT_ERROR_TEXT[SETTLEMENT_CODE_WECHAT_UNBOUND],
      confirmText: '去绑定',
      success: (result: { confirm?: boolean }) => { if (result.confirm) uni.switchTab({ url: '/pages/mine/mine' }) },
    })
    return
  }

  // 13019：同一张发票图被任何历史提现单用过都会被拒 → 清空发票并要求重新上传
  if (code === SETTLEMENT_CODE_INVOICE_REUSED) {
    invoiceImages.value = []
    uni.showToast({ title: '该发票图已用过，请重新上传发票', icon: 'none' })
    void refreshData()
    return
  }

  // 13013：已有一笔在途提现 → 刷新规则，让按钮进入置灰态并展示原因
  if (code === SETTLEMENT_CODE_ACTIVE_WITHDRAW) {
    uni.showToast({ title: SETTLEMENT_ERROR_TEXT[SETTLEMENT_CODE_ACTIVE_WITHDRAW], icon: 'none' })
    void refreshData()
    return
  }

  // 13025（2026-10-08 W8 §1 换码，旧码 13023）：品牌有未完结售后 → 展示原因并刷新账户与规则，
  // 让「说明与规则」卡里的阻断原因与「售后处理完成后即可提现」补充说明（isAfterSaleBlock）立刻生效。
  // ⚠️ 13023 是「商品不支持线下自提」（下单侧），**与本处无关**，绝不要在此处理它。
  if (code === SETTLEMENT_CODE_AFTER_SALE_BLOCK) {
    uni.showToast({ title: resolveSettlementErrorMessage(error, SETTLEMENT_ERROR_TEXT[SETTLEMENT_CODE_AFTER_SALE_BLOCK]), icon: 'none' })
    void refreshData()
    return
  }

  uni.showToast({ title: resolveSettlementErrorMessage(error, '提现申请失败'), icon: 'none' })
  // 13012（欠款）/13022（商户状态）等会改变可提现状态，失败后同样刷新账户与规则
  if (code === 13012 || code === 13022 || code === 13011) void refreshData()
}

/** 提交提现申请：本地硬校验 → POST → **重新拉账户与规则**（申请即冻结）。 */
async function handleSubmit(): Promise<void> {
  if (submitting.value) return
  // 按钮已置灰时点击：把后端下发的阻断原因原样提示（不改写、不自己拼）
  if (submitBlocked.value) {
    uni.showToast({ title: submitBlockReason.value || BLOCK_FALLBACK_TEXT, icon: 'none' })
    return
  }
  // 提交前的本地硬校验（13020 金额格式 / 13017 发票张数 / 13021 收款信息 / 13011 超余额）
  const invalidMessage = validateWithdrawForm({
    amount: amountText.value,
    invoiceImages: invoiceImages.value,
    payeeName: payeeName.value,
    payeeAccount: payeeAccount.value,
    availableBalance: availableBalance.value,
    invoiceImageMin: imageMin.value,
    invoiceImageMax: imageMax.value,
  })
  if (invalidMessage) {
    uni.showToast({ title: invalidMessage, icon: 'none' })
    return
  }

  submitting.value = true
  try {
    // ⚠️ 只用**一个金额**：buildWithdrawApplyPayload 把同一金额写进 amount 与 invoiceAmount
    //    （后端强校验两者相等，不一致报 13014，页面无从写歪）
    await applySettlementWithdraw(buildWithdrawApplyPayload({
      amount: Number(String(amountText.value).trim()),
      invoiceImages: [...invoiceImages.value],
      invoiceNo: invoiceNo.value.trim() || undefined,
      payeeType: payeeType.value,
      payeeName: payeeName.value.trim(),
      payeeAccount: payeeAccount.value.trim(),
      payeeQrUrl: payeeQrUrl.value || undefined,
    }))
    resetForm()
    // 申请即冻结：不缓存余额，重新拉账户与规则（可提现↓、冻结↑、hasActiveWithdraw=true）
    await refreshData()
    uni.showToast({ title: '提现申请已提交，待财务审核', icon: 'success' })
    // 文档 §4：提交成功后进记录列表看这笔「审核中」
    setTimeout(() => uni.navigateTo({ url: '/subpkg-merchant/settlement/withdraw-list' }), 900)
  } catch (error) {
    handleSubmitError(error)
  } finally {
    submitting.value = false
  }
}

// ===== 跳转 =====

/** 账户流水页（按 type 筛选 + 分页）。 */
function goFlows(): void {
  uni.navigateTo({ url: '/subpkg-merchant/settlement/flows' })
}

/** 提现记录页。 */
function goWithdrawList(): void {
  uni.navigateTo({ url: '/subpkg-merchant/settlement/withdraw-list' })
}

/**
 * 结算单页（P6，2026-10-02 新增）。
 *
 * ⚠️ 与「账户流水」的区别：流水是**资金变动**（入账/退款/提现…），
 * 结算是**按订单（拆单后按子单）一条**的明细（商品金额/抽成/配送费/商家应得/状态）⇒ 用于对账。
 */
function goStatements(): void {
  uni.navigateTo({ url: '/subpkg-merchant/settlement/statements' })
}

/**
 * 去「账单」看品牌营业额（**无结算权限时的唯一退路**）。
 *
 * ⚠️ 店长/店员即使没有结算权限，**仍然可以**查看所属品牌（结算归属）的订单口径营业额，
 * 所以这个入口对无权限用户保留。
 *
 * ⚠️ 账单的归属维度自 2026-10-01 起是「**结算归属品牌商家**」而不是「履约门店」
 * （后端按 `wx_order.settlement_merchant_id` 解析）⇒ 店长看到的**不是本门店**营业额，
 * 而是**该门店所属品牌**的营业额。
 * ⚠️ 但 2026-10-02 起后端已把 `settlement/account` 也切到同一口径（P1/P2 改造），
 * 所以两者现在**同口径**；界面文案仍不要主动宣传"账单金额 = 可提现余额"
 * （可提现还受**释放期**影响：钱可能还在「待结算」里）。
 */
function goBill(): void {
  uni.navigateTo({ url: '/subpkg-merchant/bill/index' })
}

function goBack(): void {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <text class="nav-back" @click="goBack">‹</text>
      <text class="nav-title">结算与提现</text>
    </view>

    <scroll-view class="content" scroll-y :enhanced="true" :bounces="true" :show-scrollbar="false">
      <!-- 13016：当前品牌下没有商家主体身份（2026-10-02 后端口径变更后唯一的原因） -->
      <view v-if="notMerchantOwner" class="blocked-card">
        <text class="blocked-title">仅商户品牌主体可查看结算账户与提现</text>
        <!-- ⚠️ 2026-10-01 文案更正：账单归属维度已改为「结算归属品牌商家」（详见 goBill 的注释） -->
        <text class="blocked-desc">当前账号在该品牌下没有商家主体身份，可以查看所属品牌（结算归属）的订单口径营业额。</text>
        <!--
          ⚠️⚠️ 2026-10-02 后端改造（P1P2 §一.3）：放行条件由「**当前身份**必须是 MERCHANT_OWNER」
          改为「**该账号在当前品牌下拥有** MERCHANT_OWNER 绑定」⇒
            · 既有店长身份、又拥有该品牌 owner 绑定的账号，**现在能进来**（不再返回 13016）；
            · 因此**能走到这个提示的，就必然是真的没有该品牌的商家主体身份** ——
              原来那句"检测到你拥有商家身份，请去切换身份"已**不可能成立**，故删除；
            · 后端也明确要求：⚠️ **前端不要再引导用户"切换身份"**
              （商家与店长进的是同一个工作台，用户无从感知两个身份的区别）。
        -->
        <text class="blocked-hint">
          当前账号在该品牌下没有商家主体身份，所以看不到结算账户与提现。如需开通请联系平台。
        </text>
        <view class="blocked-button" @click="goBill">去「账单」看品牌营业额</view>
      </view>

      <template v-else>
        <!-- 账户卡片：可提现 / 待结算 / 冻结中 / 欠款（四金额务必分清，P1P2 §一.1） -->
        <view class="account-card">
          <text class="account-subject">{{ account.subjectName || '我的商户' }}</text>
          <!-- ⚠️ 2026-10-03 新增：微信审核要求「提现页面清晰展示提现规则（可提现额度、每日提现次数、
               提现时间、到账时间等）」⇒ 在「可提现余额」**右侧**加「提现说明」入口，点开是完整规则弹层。
               ⚠️ 2026-10-10：入口改为走 `openRulesSheet('withdraw')`（弹层现在有三个话题，见其注释）。 -->
          <view class="account-label-row">
            <text class="account-label">可提现余额（元）</text>
            <view class="account-rules-entry" @click="openRulesSheet('withdraw')">
              <text class="account-rules-text">提现说明</text>
            </view>
          </view>
          <text class="account-value">{{ formatSettlementAmount(account.availableBalance) }}</text>
          <!-- ⚠️ 提现按钮只认可提现余额；待结算是"已支付但未满释放期"的钱，到点才进可提现 -->
          <view class="account-sub">
            <view class="sub-item">
              <text class="sub-value">{{ formatSettlementAmount(account.pendingSettlementAmount) }}</text>
              <text class="sub-label">待结算（未满释放期）</text>
            </view>
            <view class="sub-divider" />
            <view class="sub-item">
              <text class="sub-value">{{ formatSettlementAmount(account.frozenBalance) }}</text>
              <text class="sub-label">冻结中（已申请未打款）</text>
            </view>
            <view class="sub-divider" />
            <view class="sub-item">
              <text class="sub-value" :class="{ 'is-debt': debtAmount > 0 }">{{ formatSettlementAmount(account.debtAmount) }}</text>
              <text class="sub-label">欠款（大于 0 不可提现）</text>
            </view>
          </view>
        </view>

        <!-- ⚠️⚠️ 2026-10-10（用户要求：「这个商家提现页的说明太冗余了，放在几个按钮后点击弹框出现」）：
             本卡原先是「钱什么时候能提现？」的**内联长文案**（物流/同城/自提三种起算点 + 三句规则注解），
             现已**原样搬进** `components/WithdrawRulesSheet.vue` 的 `release` 话题；本页只留**入口行**。
             ⚠️ 同城那一行的起算点/天数口径**唯一来源**仍是 `utils/timing-category`（组件里取常量渲染），
                本页**不得**再写一遍天数或旧口径的起算基准（否则两处必然漂）。
             ⚠️ 这里同时收拢了原「提现规则」卡片的入口：那张卡片的七条要点与本弹层「一~六」节**逐条重复**
                （其中两条**逐字相同**：无手续费那句、发票图张数与发票金额那句；其余是同义改写或
                拆到了不同小节）⇒ 内联重复项已删除。
                仅**保留阻断原因**——它是「现在能不能提」的状态信息（后端原文），不是说明文案。 -->
        <view class="card">
          <text class="card-title">说明与规则</text>
          <!-- 阻断原因：后端原文直接展示（它决定"现在能不能提"，比任何规则都该先被看到） -->
          <view v-if="submitBlockReason" class="block-banner">
            <text class="block-text">{{ submitBlockReason }}</text>
            <!-- Step3 §一：附一句"什么时候恢复"。
                 ⚠️ 只在原因是「未完结售后」时显示 —— 非售后原因（欠款 / 在途提现 / 未绑微信 / 余额为 0）
                    写这句会误导用户以为要等售后（见 `isAfterSaleBlock` 注释）。 -->
            <text v-if="isAfterSaleBlock" class="block-hint">{{ WITHDRAW_AFTER_SALE_RESUME_HINT }}</text>
          </view>
          <!-- 入口行（三个话题共用一个弹层，按 `mode` 切换正文；正文不再内联） -->
          <view class="doc-entry" @click="openRulesSheet('withdraw')">
            <text class="doc-entry-label">提现规则</text>
            <text class="doc-entry-arrow">›</text>
          </view>
          <view class="doc-entry" @click="openRulesSheet('release')">
            <text class="doc-entry-label">钱什么时候能提现？</text>
            <text class="doc-entry-arrow">›</text>
          </view>
          <view class="doc-entry" @click="openRulesSheet('rate')">
            <text class="doc-entry-label">让利比例说明</text>
            <text class="doc-entry-arrow">›</text>
          </view>
        </view>

        <!-- 累计口径（净额口径） -->
        <view class="card">
          <text class="card-title">累计账目（净额口径）</text>
          <view class="total-grid">
            <view class="total-item">
              <text class="total-value">{{ formatSettlementAmount(account.totalGoodsIncome) }}</text>
              <text class="total-label">商品净额</text>
            </view>
            <view class="total-item">
              <text class="total-value">{{ formatSettlementAmount(account.totalCommission) }}</text>
              <text class="total-label">平台抽成</text>
            </view>
            <view class="total-item">
              <text class="total-value">{{ formatSettlementAmount(account.totalDeliveryFee) }}</text>
              <text class="total-label">配送费</text>
            </view>
            <view class="total-item">
              <text class="total-value">{{ formatSettlementAmount(account.totalWithdrawn) }}</text>
              <text class="total-label">已提现</text>
            </view>
          </view>
        </view>

        <!-- ⚠️ 2026-10-02 新增（用户要求 B 方案）：把「让利比例」从累计账目卡里的一行小字
             提升为独立卡片。起因：商家只看到一行「当前让利比例（平台抽成）X%」，
             既不知道**为什么**是这个数，也不知道**要去哪改**。
             ⚠️ 2026-10-08 口径更正：**商品级**比例商家**可以自己设**（商品管理 → 编辑商品），
                卡片里那句"商家端不能改比例"已作废。
             ⚠️⚠️ 2026-10-09（W16）**再更正**：**品牌（商户）级**比例商家**现在也能自己改**了
                （`PUT /api/merchant/business/commission-rate`）⇒ 原第 3 条指引
                「需要调整请联系平台（由平台在 PC 商户后台设置）」是**假话**，**已删除**；
                改为卡片里直接给「自助调整」入口（`rate-edit-entry`），商家不必再找平台。
             ⚠️ 平台默认让利比例 2026-10-08 由 5% 改为 **3%**（spec §6）⇒ 未设置时的文案必须点到 3%，
                否则商家无法判断要不要设商品级比例。 -->
        <view class="card">
          <text class="card-title">让利比例（平台抽成）</text>
          <view class="rate-row">
            <!-- ⚠️ 取不到比例时显示「未设置（按上级/平台默认 3%）」，**绝不能显示 0%**：
                 0% 会让商家以为平台不抽成，而实际会按 物流专用 → 品牌级 → 平台默认 3% 链来抽。 -->
            <text v-if="commissionRateText === '—'" class="rate-value rate-unset">未设置（按上级/平台默认 3%）</text>
            <text v-else class="rate-value">{{ commissionRateText }}</text>
            <!-- ⚠️ 2026-10-09（W16）：品牌级比例的**自助调整**入口。
                 ⚠️ 本入口的「留空 = 不修改」与**入驻申请**的「留空 = 平台默认」**是两个端点的两种语义**，
                    文案单一出口在 `utils/product-commission.ts` 且按端点分开命名，**不得互相搬运**。
                 ⚠️ 2026-10-10：点击**只打开弹层**（`openCommissionRateEdit`），提交由弹层的「确认」走
                    `editCommissionRate` —— 原来是原生 `uni.showModal`，输入框控不了聚焦与占位。 -->
            <view class="rate-edit-entry" :class="{ 'is-disabled': commissionSubmitting }" @click="openCommissionRateEdit">
              <text class="rate-edit-text">{{ MERCHANT_COMMISSION_RATE_EDIT_ENTRY_TEXT }}</text>
            </view>
          </view>
          <!-- ⚠️ 2026-10-10：本卡原来的四段说明里，**三段已搬进** `components/WithdrawRulesSheet.vue`
               的 `rate` 话题（抽取口径/不抽配送费、快照语义、商品级去哪设）—— 用户要求页面只留入口。
               ⚠️ 只留下面这一句：它是对**右侧「自助调整」按钮本体**的就地注解（含"点右侧入口"），
                  搬进弹层就会变成"点右侧入口却看不到入口"的死指引。 -->
          <!-- ⚠️ 这里展示的是**品牌（商户）级**比例；「自助调整」走的正是改它的那个端点
               （写品牌级 `wx_merchant.commission_rate`）。留空的语义由 OMIT_NOTE 说清（= 不修改）。 -->
          <text class="rule-note">⚠️ 这里展示的是「品牌（商户）级」比例，点右侧入口即可自助修改（3%~20%）。{{ MERCHANT_COMMISSION_RATE_EDIT_OMIT_NOTE }}</text>
        </view>

        <!-- ⚠️⚠️ 2026-10-10：原「提现规则」卡片已**整卡删除**（用户要求说明收进弹层）。
             它的七条要点与「提现说明」弹层的「一~六」节**逐条重复**（两条逐字相同，其余同义改写）——
             重复的正文只留弹层那一份；阻断原因已上移到「说明与规则」卡（入口行上方），
             提交按钮下方仍有一处 `submit-reason`（同一状态、同一常量，见 `isAfterSaleBlock`）。
             ⛔ 别把这些要点抄回本页：正文单一来源是 `components/WithdrawRulesSheet.vue`。 -->

        <!-- 提现申请表单 -->
        <view class="card">
          <text class="card-title">提现申请</text>

          <text class="field-label">发票图片（{{ invoiceImages.length }}/{{ imageMax }}）</text>
          <view class="image-grid">
            <view v-for="(image, index) in invoiceImages" :key="image + index" class="image-item">
              <image class="image-thumb" :src="resolveImageUrl(image)" mode="aspectFill" @click="previewInvoiceImages(image)" />
              <view class="image-remove" @click.stop="removeInvoiceImage(index)">×</view>
            </view>
            <view v-if="invoiceImages.length < imageMax" class="image-add" @click="chooseInvoiceImages">
              <text class="image-add-text">{{ uploading ? '上传中…' : '+ 上传发票' }}</text>
            </view>
          </view>
          <text class="field-hint">支持 jpg/jpeg/png/webp/gif，单张 ≤ 10MB；点击图片可放大核对票面金额。</text>

          <text class="field-label">提现金额（元）</text>
          <input
            v-model="amountText"
            class="field-input"
            type="digit"
            maxlength="11"
            :disabled="submitting"
            placeholder="请输入提现金额，最多两位小数"
          />
          <text class="field-hint">可提现余额 ¥{{ formatSettlementAmount(account.availableBalance) }}；发票金额与申请金额一致，无需重复填写。</text>

          <text class="field-label">收款方式</text>
          <view class="chip-row">
            <view class="chip" :class="{ 'is-active': payeeType === 'WECHAT' }" @click="payeeType = 'WECHAT'">微信</view>
            <view class="chip" :class="{ 'is-active': payeeType === 'BANK_CARD' }" @click="payeeType = 'BANK_CARD'">银行卡</view>
          </view>

          <text class="field-label">收款人姓名</text>
          <input v-model="payeeName" class="field-input" maxlength="30" :disabled="submitting" placeholder="财务转账核对用，必填" />

          <text class="field-label">收款账号</text>
          <input v-model="payeeAccount" class="field-input" maxlength="64" :disabled="submitting" placeholder="微信号 / 手机号 / 银行卡号" />

          <text class="field-label">发票号（选填）</text>
          <input v-model="invoiceNo" class="field-input" maxlength="64" :disabled="submitting" placeholder="便于财务核验，可不填" />

          <text class="field-label">收款码（选填）</text>
          <view class="image-grid">
            <view v-if="payeeQrUrl" class="image-item">
              <image class="image-thumb" :src="resolveImageUrl(payeeQrUrl)" mode="aspectFill" @click="previewPayeeQr" />
              <view class="image-remove" @click.stop="payeeQrUrl = ''">×</view>
            </view>
            <view v-else class="image-add" @click="choosePayeeQr">
              <text class="image-add-text">{{ qrUploading ? '上传中…' : '+ 上传收款码' }}</text>
            </view>
          </view>

          <!-- 阻断时置灰：点击只提示后端原因，不发起请求 -->
          <view class="submit-button" :class="{ 'is-disabled': submitBlocked || submitting }" @click="handleSubmit">
            {{ submitting ? '提交中…' : '提交提现申请' }}
          </view>
          <text v-if="submitBlockReason" class="submit-reason">{{ submitBlockReason }}</text>
          <!-- 与上方「说明与规则」卡里的补充说明**同源**（同一常量、同一渲染条件 `isAfterSaleBlock`）——
               两处若各写一份条件必然漂。 -->
          <text v-if="isAfterSaleBlock" class="submit-reason-hint">{{ WITHDRAW_AFTER_SALE_RESUME_HINT }}</text>
        </view>

        <!-- 二级入口 -->
        <view class="entry-list">
          <!-- ⚠️ 2026-10-02 新增（P6）：结算单 —— 按订单（拆单后按子单）逐条列出商品金额/抽成/配送费/商家应得，可导出 CSV 对账 -->
          <view class="entry-item" @click="goStatements">
            <text class="entry-label">结算单</text>
            <text class="entry-arrow">›</text>
          </view>
          <view class="entry-item" @click="goFlows">
            <text class="entry-label">账户流水</text>
            <text class="entry-arrow">›</text>
          </view>
          <view class="entry-item" @click="goWithdrawList">
            <text class="entry-label">提现记录</text>
            <text class="entry-arrow">›</text>
          </view>
        </view>

        <view v-if="loading" class="loading-tip">加载中…</view>
      </template>
    </scroll-view>

    <!-- ⚠️ 2026-10-03 新增：提现说明弹层（微信审核要求，详见 WithdrawRulesSheet.vue 顶部说明）。
         放在 scroll-view **之外** —— 它是 fixed 定位的全屏遮罩，脱离滚动容器更稳定。
         ⚠️ 可提现额度传的是**真实余额**（computed），不是写死的文案。
         ⚠️ 2026-10-10：本页**三个入口共用这一个弹层**（`mode` 决定正文话题，见 `openRulesSheet`）——
            点「提现说明」/「提现规则」= withdraw、「钱什么时候能提现？」= release、
            「让利比例说明」= rate。⛔ 别再为某个话题单独挂第二个弹层（弹层语言会漂）。 -->
    <WithdrawRulesSheet
      v-model="withdrawRulesVisible"
      :mode="rulesSheetMode"
      :available-balance="availableBalance"
      :invoice-image-min="imageMin"
      :invoice-image-max="imageMax"
      :has-active-withdraw="!!rules.hasActiveWithdraw"
      :block-reason="rules.blockReason || null"
    />

    <!-- ⚠️ 2026-10-10：品牌级比例「自助调整」输入弹层（替代原生可编辑弹窗）。
         同样放在 scroll-view **之外**（fixed 全屏遮罩，脱离滚动容器更稳）。
         ⚠️ 现状值传的是**卡片上那个** `commissionRateText`（同一个 computed，不另算一份）；
         ⚠️ `@confirm` 抛的是**输入原文**，校验/提交仍在 `editCommissionRate` 里（口径只有一处）。 -->
    <CommissionRateSheet
      v-model="commissionSheetVisible"
      :current-rate-text="commissionRateText"
      :submitting="commissionSubmitting"
      @confirm="editCommissionRate"
    />
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  box-sizing: border-box;
  background: #f2f3f7;
}
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 85rpx;
  background: #f2f3f7;
}
.nav-back {
  position: absolute;
  left: 23rpx;
  color: #1d2129;
  font-size: 46rpx;
  line-height: 1;
  top: auto;
  bottom: 0;
  display: flex;
  height: 88rpx;
  align-items: center;
}
.nav-title {
  color: #1d2129;
  font-size: 33rpx;
  font-weight: 600;
}
.content {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 0 31rpx 60rpx;
}

/* 13016 提示卡 */
.blocked-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 60rpx;
  padding: 60rpx 38rpx;
  border-radius: 23rpx;
  background: #ffffff;
}
.blocked-title {
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
  text-align: center;
}
.blocked-desc {
  margin-top: 16rpx;
  color: #86909c;
  font-size: 25rpx;
  line-height: 40rpx;
  text-align: center;
}
/* 可操作指引（2026-09-23）：商户主体被卡在「店长」身份时，明确告诉他去哪儿切回来 */
.blocked-hint {
  margin-top: 20rpx;
  color: #4e5969;
  font-size: 24rpx;
  line-height: 38rpx;
  text-align: center;
}
.blocked-button {
  margin-top: 38rpx;
  padding: 0 46rpx;
  height: 77rpx;
  display: flex;
  align-items: center;
  border-radius: 39rpx;
  background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%);
  color: #ffffff;
  font-size: 27rpx;
  font-weight: 600;
}

/* 账户卡片 */
.account-card {
  margin-top: 23rpx;
  padding: 38rpx 31rpx 31rpx;
  border-radius: 23rpx;
  background: linear-gradient(135deg, #ff9301 0%, #ff6a01 55%, #ff4202 100%);
  color: #ffffff;
}
.account-subject {
  display: block;
  color: rgba(255, 255, 255, 0.9);
  font-size: 25rpx;
}
/* ⚠️ 2026-10-03：「可提现余额」标签与「提现说明」入口同一行 ⇒ 上间距改由外层 row 承担 */
.account-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 19rpx;
}
.account-label {
  display: block;
  color: rgba(255, 255, 255, 0.88);
  font-size: 25rpx;
}
/* 「提现说明」入口按钮：半透明白描边胶囊 —— 压在橙色渐变卡上也要清晰可见（审核要求规则入口显眼） */
.account-rules-entry {
  display: flex;
  flex: none;
  align-items: center;
  height: 44rpx;
  padding: 0 20rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.66);
  border-radius: 9999rpx;
}
.account-rules-text {
  color: #ffffff;
  font-size: 23rpx;
}
.account-value {
  display: block;
  margin-top: 8rpx;
  font-size: 62rpx;
  font-weight: 700;
  line-height: 1.1;
}
.account-sub {
  display: flex;
  align-items: center;
  margin-top: 31rpx;
  padding-top: 23rpx;
  border-top: 2rpx solid rgba(255, 255, 255, 0.25);
}
.sub-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}
.sub-value {
  font-size: 31rpx;
  font-weight: 600;
}
.sub-value.is-debt {
  color: #fff3b0;
}
.sub-label {
  color: rgba(255, 255, 255, 0.85);
  font-size: 21rpx;
  text-align: center;
}
.sub-divider {
  flex: none;
  width: 2rpx;
  height: 54rpx;
  background: rgba(255, 255, 255, 0.28);
}

/* 通用卡片 */
.card {
  margin-top: 23rpx;
  padding: 31rpx;
  border-radius: 23rpx;
  background: #ffffff;
}
.card-title {
  display: block;
  color: #1d2129;
  font-size: 29rpx;
  font-weight: 600;
}
/* ⚠️ 2026-10-10：`.rule-lead` / `.release-list` / `.release-item` / `.release-form` /
   `.release-rule` / `.release-hint`（原「钱什么时候能提现？」的内联版式）与 `.rule-line`
   （原「提现规则」卡片的条目）都随正文搬进 `components/WithdrawRulesSheet.vue` 而**删除** ——
   页面不再有这些节点；样式留在页面上只会让下一个人以为还有内联正文。 */

/* 「说明与规则」入口行（2026-10-10 新增）：浅灰底 + 右侧箭头，点开对应话题的弹层 */
.doc-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 92rpx;
  margin-top: 16rpx;
  padding: 0 23rpx;
  border-radius: 15rpx;
  background: #f7f8fa;
}
.doc-entry-label {
  color: #1d2129;
  font-size: 27rpx;
}
.doc-entry-arrow {
  color: #c9cdd4;
  font-size: 34rpx;
  line-height: 1;
}

.rule-note {
  display: block;
  margin-top: 14rpx;
  color: #86909c;
  font-size: 23rpx;
  line-height: 36rpx;
}
/* ⚠️ 2026-10-02：让利比例独立卡片里的**大号比例数字**（原来挤在累计账目卡的一行小字里） */
.rate-value {
  display: block;
  margin-top: 12rpx;
  color: #ff5500;
  font-size: 48rpx;
  font-weight: 700;
  line-height: 60rpx;
}
/* 未设置时的占位文案（字号小一些，避免和真比例一样抢眼） */
.rate-value.rate-unset { color: #86909c; font-size: 30rpx; font-weight: 600; }
/* ⚠️ 2026-10-09（W16）：比例数字与「自助调整」入口同一行（入口靠右、可点） */
.rate-row { display: flex; align-items: center; justify-content: space-between; }
.rate-row .rate-value { flex: 1; min-width: 0; }
.rate-edit-entry { flex: none; margin-top: 12rpx; padding: 8rpx 26rpx; border: 1rpx solid #ff5500; border-radius: 999rpx; }
.rate-edit-entry.is-disabled { opacity: .5; }
.rate-edit-text { color: #ff5500; font-size: 26rpx; line-height: 40rpx; }
.total-grid {
  display: flex;
  flex-wrap: wrap;
  margin-top: 23rpx;
}
.total-item {
  width: 50%;
  display: flex;
  flex-direction: column;
  margin-bottom: 23rpx;
}
.total-value {
  color: #1d2129;
  font-size: 31rpx;
  font-weight: 600;
}
.total-label {
  margin-top: 6rpx;
  color: #86909c;
  font-size: 23rpx;
}
/* 阻断原因：直接展示后端原文，样式上必须显眼（商家要一眼看到为什么不能提） */
.block-banner {
  margin-top: 23rpx;
  padding: 19rpx 23rpx;
  border-radius: 15rpx;
  background: #fff7ed;
  border: 2rpx solid rgba(255, 106, 43, 0.28);
}
.block-text {
  color: #9a3412;
  font-size: 24rpx;
  line-height: 36rpx;
}
/* 补充说明（何时恢复）：比后端原文弱一档，别抢"为什么不能提"的主信息 */
.block-hint {
  display: block;
  margin-top: 8rpx;
  color: #b45309;
  font-size: 22rpx;
  line-height: 34rpx;
}

/* 表单 */
.field-label {
  display: block;
  margin-top: 31rpx;
  color: #1d2129;
  font-size: 26rpx;
  font-weight: 500;
}
.field-input {
  box-sizing: border-box;
  width: 100%;
  height: 84rpx;
  margin-top: 15rpx;
  padding: 0 23rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
  color: #1d2129;
  font-size: 27rpx;
}
.field-hint {
  display: block;
  margin-top: 12rpx;
  color: #86909c;
  font-size: 22rpx;
  line-height: 34rpx;
}
.chip-row {
  display: flex;
  gap: 19rpx;
  margin-top: 15rpx;
}
.chip {
  flex: 1;
  height: 77rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 15rpx;
  background: #f6f7f9;
  color: #4e5969;
  font-size: 26rpx;
}
.chip.is-active {
  background: #fff4e8;
  color: #ff5500;
  border: 2rpx solid rgba(255, 85, 0, 0.35);
}

/* 图片九宫格 */
.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 19rpx;
  margin-top: 15rpx;
}
.image-item {
  position: relative;
  width: 150rpx;
  height: 150rpx;
}
.image-thumb {
  width: 150rpx;
  height: 150rpx;
  border-radius: 15rpx;
  background: #f6f7f9;
}
.image-remove {
  position: absolute;
  top: -14rpx;
  right: -14rpx;
  width: 40rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(29, 33, 41, 0.7);
  color: #ffffff;
  font-size: 27rpx;
  line-height: 1;
}
.image-add {
  width: 150rpx;
  height: 150rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 15rpx;
  border: 2rpx dashed #d7dbe0;
  background: #fafbfc;
}
.image-add-text {
  color: #86909c;
  font-size: 22rpx;
  text-align: center;
}

/* 提交 */
.submit-button {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  margin-top: 46rpx;
  border-radius: 23rpx;
  background: linear-gradient(90deg, #ff9301 0%, #ff4202 100%);
  color: #ffffff;
  font-size: 31rpx;
  font-weight: 600;
}
/* 置灰：仍然可点（点了给原因），但视觉上明确不可提交 */
.submit-button.is-disabled {
  background: #e5e6eb;
  color: #a9aeb8;
}
.submit-reason {
  display: block;
  margin-top: 16rpx;
  color: #c2410c;
  font-size: 23rpx;
  line-height: 36rpx;
  text-align: center;
}
.submit-reason-hint {
  display: block;
  margin-top: 4rpx;
  color: #b45309;
  font-size: 22rpx;
  line-height: 34rpx;
  text-align: center;
}

/* 二级入口 */
.entry-list {
  margin-top: 23rpx;
  border-radius: 23rpx;
  background: #ffffff;
  overflow: hidden;
}
.entry-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 108rpx;
  padding: 0 31rpx;
  border-bottom: 2rpx solid #f2f3f7;
}
.entry-item:last-child {
  border-bottom: 0;
}
.entry-label {
  color: #1d2129;
  font-size: 28rpx;
}
.entry-arrow {
  color: #c9cdd4;
  font-size: 34rpx;
  line-height: 1;
}
.loading-tip {
  padding: 31rpx 0;
  text-align: center;
  color: #86909c;
  font-size: 24rpx;
}
</style>
