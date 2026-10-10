import { sanitizeBonusText } from '@/utils/textSafe'
import type { StaffBindDTO } from '@/types/staff'

/**
 * 人员「微信绑定标识」的提交口径（2026-10-10 第二版：`openid` 已从契约删除）。
 *
 * ## 契约事实（`api_doc.json`，2026-10-10 逐字核对）
 *
 * `StaffAccountCreateDTO` / `StaffBindWechatDTO` 现在**只剩两个** key —— **`openid` 已删除**：
 * - `userId`：「C端用户ID（wx_user.id）」（建号 DTO 的描述原文是「微信用户ID（店长/骑手必填）」）；
 * - `wechatId`：「微信号（人工登记值；与 userId 二选一，优先 userId）」。
 *
 * 两个 schema 的 `properties` 里**都没有 `openid`**
 * （`StaffAccountCreateDTO.required = ["name"]`；`StaffBindWechatDTO.required = []`）。
 * 传 `openid` 会被后端**忽略**（= 等于没填）。
 *
 * ## ⚠️ 与上一版的根本差别：不再是"三选一"，而是"填了就发"
 *
 * 上一版对接口径（2026-09-29）是「微信标识三选一，优先 userId > 微信号 > openid」，
 * 当时的实现因此**只提交一个 key**，并把其余填了的 key 当作「已忽略」告诉运营。
 * 2026-10-10 的后端口径（`docs/26/10.10/前端对接说明-员工绑定只认微信号-2026-10-10.md` §三）改为：
 *
 * > 后端以 **`userId` 为身份权威**，微信号只作登记/核对：
 * > - 该用户 `wx_user.wx_id` **未登记** → 把填的微信号**顺手登记**到该用户名下，再按 `userId` 绑定 → ✅ 成功；
 * > - 已登记、**与填的一致** → 直接按 `userId` 绑定；
 * > - 已登记、**与填的不一致** → 报错，**不覆盖、不猜**。
 *
 * ⇒ **`userId` + 微信号 一起填是推荐做法** —— 这正是线上用户 `#90010` 绑不上的那个场景
 * （他档案里 `wx_user.wx_id` 为 NULL，旧口径下填什么都过不了）。
 * 所以本文件的解析口径是：**`userId` 填了就发 `userId`，`wechatId` 填了就发 `wechatId`**，
 * 两个都填 ⇒ **两个都发**（不再二选一）。`key` 仍表示"身份权威是谁"（`userId` 优先），
 * 只用于文案与提交前的必填校验，**不再**决定"发哪个 key"。
 *
 * ⚠️ 只填 `wechatId`、不填 `userId` 时，该微信号**必须已在「用户管理」登记过**
 * （否则后端报 `2000` 并提示去登记）—— 这是"按微信号反查是谁"的必要条件，本次未变。
 *
 * ⚠️ 一处**不变**的硬约束：`userId` 是契约的 `integer(int64)`。填了非正整数时
 * **必须阻断提交**，**绝不**自动降级成"那就只发微信号吧" —— 那是替运营猜（本项目反复踩过的静默兜底）。
 *
 * ## 报错文案（§四）：**直接透出后端 `message`**，前端**不按 code 映射** —— 见 `staffWechatErrorText()`。
 */

/**
 * 微信标识的两种 key（与契约字段名一一对应）。
 * ⚠️ `openid` **已从契约删除**，故**不在**本类型里 —— 它不该再有对应的输入框或提交分支。
 */
export type StaffWechatKey = 'userId' | 'wechatId'

/**
 * 排列顺序：`userId` 在前。
 *
 * ⚠️ 这个顺序**不是**"三选一优先级"（旧口径），而是**身份权威的次序**（§三：以 `userId` 为身份权威）：
 * 它只决定 `filled` 的排列与 `key`（= 身份权威）取谁，**不决定发几个 key** ——
 * 两个都填时**两个都会提交**。不要把这里改回"只发第一个"的逻辑。
 */
export const STAFF_WECHAT_PRIORITY: readonly StaffWechatKey[] = ['userId', 'wechatId']

/** 表单侧的原始输入（都是字符串，空串 = 没填）。 */
export interface StaffWechatInput {
  userId?: string
  wechatId?: string
}

/**
 * 两个 key 的中文标签（页面与提示文案共用一份，避免两处措辞漂移）。
 * ⚠️ 标签就是契约字段的中文名：`userId` = 「微信用户ID」，`wechatId` = 「微信号」。
 */
export const STAFF_WECHAT_LABELS: Record<StaffWechatKey, string> = {
  userId: '微信用户ID',
  wechatId: '微信号',
}

export interface StaffWechatResolution {
  /**
   * **身份权威** key（`userId` 优先；§三）。`null` = 两个都没填。
   * ⚠️ 它**不再**表示"唯一会提交的 key" —— 实际提交见 `payload`（两个都填就两个都发）。
   */
  key: StaffWechatKey | null
  /** **实际提交**的请求体：填了的 key **各自独立**写入（两个都填 ⇒ 两个字段都在）。 */
  payload: StaffBindDTO
  /** 运营**已填**的 key（按 `STAFF_WECHAT_PRIORITY` 顺序）。 */
  filled: StaffWechatKey[]
  /**
   * `true` = `userId` 与微信号**都填了** ⇒ 后端按 `userId` 绑定，并在该用户微信号未登记时
   * **顺手登记**（§三），运营不需要先去补登记。
   */
  autoRegister: boolean
  /**
   * 填了 `userId`、但值**格式不合法**（契约是 `integer(int64)`）。
   * ⇒ 调用方必须**阻断提交并提示**，**不得**自动降级为"只发微信号"
   * （那等于替运营猜，就是本项目反复踩过的"静默兜底"）。
   */
  invalid: boolean
}

function trimmed(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 把两个输入解析成**要提交的请求体**：填了的 key 各自独立写入（见文件头 §三 的说明）。
 *
 * ⚠️ 纯函数、无副作用：页面与契约测试都以它为唯一口径。
 */
export function resolveStaffWechatBinding(input: StaffWechatInput): StaffWechatResolution {
  const filled = STAFF_WECHAT_PRIORITY.filter((key) => trimmed(input[key]) !== '')
  const key = filled[0] ?? null
  if (key === null) {
    return { key: null, payload: {}, filled, autoRegister: false, invalid: false }
  }
  const payload: StaffBindDTO = {}
  // userId：契约 integer(int64) ⇒ 非正整数一律判为非法（整份 payload 作废，见下方 invalid 分支）
  if (filled.includes('userId')) {
    const numeric = Number(trimmed(input.userId))
    if (!Number.isInteger(numeric) || numeric <= 0) {
      return { key, payload: {}, filled, autoRegister: false, invalid: true }
    }
    payload.userId = numeric
  }
  // ⚠️ 与旧口径的关键差别：**填了就发**，不再"三选一"。
  //    两个都填 ⇒ 两个字段都在请求体里 ⇒ 后端按 userId 绑定、未登记则顺手登记（§三）。
  if (filled.includes('wechatId')) {
    payload.wechatId = trimmed(input.wechatId)
  }
  return {
    key,
    payload,
    filled,
    autoRegister: filled.includes('userId') && filled.includes('wechatId'),
    invalid: false,
  }
}

/**
 * 提交前给运营看的一句话：说明**实际会提交什么、后端会怎么做**。
 * 返回值**始终非空**（两个都没填时提示需要填一个），调用方可直接展示。
 */
export function staffWechatRoutingHint(resolution: StaffWechatResolution): string {
  if (resolution.key === null) {
    return `请至少填写 ${STAFF_WECHAT_LABELS.userId} / ${STAFF_WECHAT_LABELS.wechatId} 中的一项`
  }
  if (resolution.autoRegister) {
    return `两个都会提交：按「${STAFF_WECHAT_LABELS.userId}」绑定；该用户没登记过微信号时，后端会把你填的「${STAFF_WECHAT_LABELS.wechatId}」顺手登记上去（已登记且不一致会报错，不会覆盖）。`
  }
  if (resolution.key === 'userId') {
    return `只填了「${STAFF_WECHAT_LABELS.userId}」：按它绑定（不校验微信号）。推荐把「${STAFF_WECHAT_LABELS.wechatId}」也填上。`
  }
  return `只填了「${STAFF_WECHAT_LABELS.wechatId}」：它必须已在「用户管理」登记过，否则后端会提示去登记；推荐同时填「${STAFF_WECHAT_LABELS.userId}」（未登记时后端会自动登记）。`
}

/**
 * 只填微信号时的前置条件（**提交前**的告知，不是错误映射）：
 * 契约原文口径 —— 微信号是人工登记值（小程序拿不到微信号），
 * **单填它**时需先在「用户管理」里登记，否则后端报 `2000` 并提示去登记；
 * **同时填了「微信用户ID」则由后端自动登记**（§三），无需先去补登记。
 */
export const WECHAT_ID_NEEDS_REGISTRATION_HINT =
  '微信号是人工登记值：只填它时需先在该用户的「用户管理 → 微信号登记」里登记过，否则后端会报错并提示去登记；同时填「微信用户ID」则不需要 —— 后端会按用户ID绑定并把微信号顺手登记上去。'

/**
 * 本流程的错误文案：**直接透出后端 `message`**（对接说明 §四），前端**不按 code 映射**。
 *
 * 为什么不做映射：后端已把三种场景写成**可直接展示**的句子
 * （微信号与档案不一致 / 该微信号还没登记到任何用户 / 两个标识都没给），
 * 前端再按 `code`（`2000` / `8112` / `8113` / `8114` / `7316`）翻译一遍只会与后端口径漂移
 * —— 本项目已经有过"前端自造文案与后端口径不一致"的教训。
 *
 * 这里只做两件事：① 取出 `message`（`Error.message` 由 `api/staff.ts` 的 `unwrap` 原样带出）；
 * ② 走项目统一的展示层归一化 `sanitizeBonusText()`（术语口径，见 CLAUDE.md §七）。
 * `message` 为空时（后端什么都没说）才回退到调用方给的兜底串。
 */
export function staffWechatErrorText(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : ''
  return sanitizeBonusText(raw).trim() || fallback
}
