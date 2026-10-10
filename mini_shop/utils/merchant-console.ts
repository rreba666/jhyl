/**
 * 商家端 · 「电脑端后台（PC 控制台）登录说明」的**唯一地址与文案来源**（2026-10-10 新增）。
 *
 * ## 为什么有这个模块
 * 用户决策（原话）：
 * · 「**后台地址 = `https://ylapi.jinhuayou365.com`**」；
 * · 方案 **B** —— 「**可以在商家端加个按钮弹窗显示**」。
 * ⇒ 商家端（小程序）需要一个入口，把「去哪登录 / 用什么账号 / 初始密码是什么规则 / 现在有没有号」
 *    一次讲清楚。**地址与文案只在这里写一遍**（契约 `merchant-console-guide.contract.ps1`
 *    断言整个 `mini_shop` 源码里这个域名只出现 **1** 次），弹层只做排版。
 *
 * ## 数据现实（⚠️ 逐字段核对 `api_doc.json`，2026-10-10，528 paths / 625 schemas）
 * | 我们想要 | 契约里到底有什么 | 小程序能不能拿到 |
 * |---|---|---|
 * | 商家工号 | `MerchantApplyVO.accountUsername`「商家工号（**仅本人可见**）」 | ✅ 能（`GET /api/merchant/apply/my`，C 端 token，**只返回调用者自己的申请**） |
 * | 是否已发号 | `MerchantApplyVO.backendAccountIssued`「客服是否已发放B端账号（工号+密码已设）」 | ✅ 能 |
 * | 是否已绑微信 | `MerchantApplyVO.accountBound`「账号是否已绑定微信」 | ✅ 能（本弹层**用不到**：它只关乎 C 端入口，不关乎 PC 登录） |
 * | **密码** | ⛔ `MerchantApplyVO` **没有任何密码字段**；`IssueResult.password` 由
 *   `POST /api/admin/staff/{id}/issue-account`（**中控发号**）返回；`GET /api/admin/staff/{id}/login-password`
 *   契约原文「**仅中控/客服可用**，调用即写审计」 | ⛔ **拿不到**（也不该拿） |
 * ⇒ 因此本弹层**只讲规则、不显示密码**（⛔ 绝不渲染任何"密码"值，也绝不调用上面两个中控端点）。
 *
 * ## 初始密码规则：**契约里有**（所以可以如实讲，但必须带条件）
 * · `IssueBody.password`（发号请求，**可选**，`required = ["username"]`）原文：
 *   「登录密码（**不传**则由后端按「手机号后4位+身份证后4位」生成，且要求首登强制改密；传则 6~32 位）」
 * · `IssueResult.password` 原文：「本次实际生效的登录密码（走默认规则时为「手机号后4位+身份证后4位」，8 位）」；
 *   `IssueResult.passwordSource` enum `DEFAULT`（=走后端默认规则 ⇒ `mustChangePassword=true`）/ `SELF`（调用方显式传入）。
 * ⚠️ 两个推论必须体现在文案里，否则会误导商家去试一个不属于他的密码：
 *   ① **条件是「客服发号时没有单独设置密码」** —— 客服可以手输密码（`passwordSource=SELF`），那时规则**不适用**；
 *   ② 「适用身份范围 / 手机号取哪个字段 / 身份证取申请单还是实名库」等**规范部分契约没写**
 *      （`docs/26/10.10/后端待实现需求总表-2026-10-10.md` N6「规则**已实现**，「规范」部分未答复」）
 *      ⇒ 文案**不敢**写"一定是手机号后 4 位"以外的细节，末尾必须给一句「登录不了找客服重置」。
 *
 * ## 首登强制改密：**后端已上线**（所以文案可以说，但仍然不写死"一定会"）
 * `StaffLoginVO.mustChangePassword`「是否必须先修改初始密码（true=只能先改密；后端对业务请求返回 **8109**）」、
 * `POST /api/staff/auth/change-password`（b2 本人改密，`need_change_pwd` 清零 + 踢下线）。
 * ⇒ 文案写成「**若**首次登录被要求先改密，请按提示修改后再用其它功能」。
 * ⚠️ 商家端（小程序）**没有**改密页，PC 商户控制台是**另一个客户端**（`StaffLoginDTO.client` enum
 * `PC`/`H5`；契约原文「PC=PC商户控制台（仅商家账号）」）⇒ 改密只能在那边做，这里只负责指路。
 *
 * ## 安全口径（沿用本仓库既有姿态）
 * 1. **绝不显示密码**（明文或掩码都不显示）—— 只讲规则；
 * 2. **绝不替用户猜密码**、不把「手机号后 4 位 + 身份证后 4 位」写成一个"值"（那是伪造一个凭据）；
 * 3. 忘记密码/登录失败 ⇒ 只能找客服（小程序无法查看、无法重置）。
 */

/** 电脑端后台（PC 控制台）地址 —— **全仓唯一来源**（域名在 `mini_shop` 源码里只允许出现这一处）。 */
export const MERCHANT_CONSOLE_URL = 'https://ylapi.jinhuayou365.com'

/** 工作台入口行的标题（不含地址 —— 地址只在弹层里显示）。 */
export const MERCHANT_CONSOLE_ENTRY_TITLE = '电脑端后台'

/** 工作台入口行的副标题。 */
export const MERCHANT_CONSOLE_ENTRY_SUB = '登录地址 · 商家工号 · 初始密码说明'

/** 弹层标题。 */
export const MERCHANT_CONSOLE_SHEET_TITLE = '电脑端后台登录说明'

/** 弹层副标题（说明这套凭据服务于哪个客户端）。 */
export const MERCHANT_CONSOLE_SHEET_SUB = '商家主账号登录 PC 控制台；小程序门店管理不受影响'

/**
 * 初始密码**规则**（不是密码）—— 逐字对齐契约 `IssueBody.password` / `IssueResult.password`。
 * ⚠️ 条件必须写在句子里（「客服未单独设置」），否则客服手设过密码的商家会拿这条规则反复试。
 */
export const MERCHANT_CONSOLE_PASSWORD_RULE =
  '密码由客服发号时设置。若客服未单独设置，后端按「手机号后 4 位 + 身份证后 4 位」生成 8 位初始密码。'

/** 安全与改密提示（不显示密码 / 首登可能要求改密 / 忘了找客服）。 */
export const MERCHANT_CONSOLE_PASSWORD_NOTE =
  '小程序不显示密码。首次登录若被要求先修改初始密码，请按提示修改后再使用其它功能；忘记密码或提示密码错误，请联系客服重置。'

/**
 * 账号状态（弹层「登录账号」那一格的取值口径）。
 * - `issued`：工号已下发 ⇒ 显示工号本身；
 * - `partial`：契约说已发号、但 `accountUsername` 没随申请状态下发 ⇒ **不许编一个工号**，如实说"未返回"；
 * - `pending`：还没发号 ⇒ 如实说「尚未发放」（**不阻塞小程序**，见 `note`）；
 * - `unknown`：查不到申请单（老接口/`data=null`/该微信不是申请人）⇒ 如实说"未查到"。
 */
export type MerchantConsoleAccountState = 'issued' | 'partial' | 'pending' | 'unknown'

/** 弹层「登录账号」格的视图模型。 */
export interface MerchantConsoleAccount {
  state: MerchantConsoleAccountState
  /** 工号（**只有** `issued` 时非空；其余状态恒为空串 —— 不用占位符冒充工号）。 */
  username: string
  /** 该格要显示的值。 */
  value: string
  /** 该状态下要多说一句的说明（没有就空串）。 */
  note: string
}

/** 本模块消费的最小申请单形状（结构类型，避免为一个弹层去依赖整份 `MerchantApplyVO`）。 */
export interface MerchantConsoleAccountSource {
  /** `MerchantApplyVO.backendAccountIssued`：「客服是否已发放B端账号（工号+密码已设）」。 */
  backendAccountIssued?: boolean
  /** `MerchantApplyVO.accountUsername`：「商家工号（仅本人可见）」。 */
  accountUsername?: string
}

/**
 * 把**真实拿到的**申请状态翻成弹层里那一格。
 *
 * ⚠️ 判据是「字段有没有值」，不是「真假」：`accountUsername` 为空就是没有工号
 *    （⛔ 不得兜成手机号、不得兜成"待定"之类的假值）。
 * ⚠️ `backendAccountIssued === true` 但工号为空时**不能**说"尚未发放"（那是与后端字段矛盾的说法），
 *    也不能编一个工号 ⇒ 单列一个 `partial` 状态如实说"工号未返回，请联系客服核对"。
 */
export function merchantConsoleAccount(
  apply: MerchantConsoleAccountSource | null | undefined,
): MerchantConsoleAccount {
  if (!apply) {
    // `GET /api/merchant/apply/my` 契约原文：「从未申请过返回 data=null（不是报错）」。
    return {
      state: 'unknown',
      username: '',
      value: '未查到入驻申请记录',
      note: '若不是你本人提交的入驻申请，请联系客服核对后台账号。',
    }
  }
  const username = String(apply.accountUsername || '').trim()
  if (username) {
    return { state: 'issued', username, value: username, note: '' }
  }
  if (apply.backendAccountIssued === true) {
    return {
      state: 'partial',
      username: '',
      value: '已发放，工号未返回',
      note: '客服已发放账号，但工号没有随申请状态下发，请联系客服核对。',
    }
  }
  return {
    state: 'pending',
    username: '',
    value: '尚未发放',
    note: '客服发放工号后即可登录电脑端后台；小程序的「门店管理」不受影响，审核通过即可使用。',
  }
}
