import type { ValidationResult } from './input-validation'

/**
 * 退款理由的清洗与校验（C 端「秒退」与「申请退款」共用）。
 *
 * 后端契约：`OrderRefundDTO.reason`（`api_doc.json`）——
 * - `maxLength: 200`（按**字符**算，不是字节）；
 * - `pattern`: `^[\u4e00-\u9fa5a-zA-Z0-9\s，。！？、（）()（）.,!?@#:：;；"'"'\-_=+]+$`，
 *   即**只允许**中文、字母、数字、空白与这些常用标点。
 *
 * ⚠️ 为什么必须在前端先校验：后端用的是 `@Pattern`，一旦含表情符号 / `~` / `/` / `%` / `&` 等，
 * 用户会在**点完提交之后**才拿到一个很难懂的报错（DTO 校验失败），理由白填。
 * 所以这里把规则**原样搬到前端**，提交前拦住并给出人话提示。
 */

/** 退款理由长度上限（与后端 `maxLength` 一致，按字符计）。 */
export const REFUND_REASON_MAX_LENGTH = 200

/**
 * 后端 `OrderRefundDTO.reason` 的字符白名单，**照抄** `api_doc.json` 的 pattern。
 * 注意这里刻意不放宽：前端放宽 = 用户填完才被后端拒。
 */
export const REFUND_REASON_PATTERN = /^[\u4e00-\u9fa5a-zA-Z0-9\s，。！？、（）()（）.,!?@#:：;；"'"'\-_=+]+$/

/**
 * 常用退款理由（一键填入，减少用户打字）。
 * ⚠️ **每一条都必须能通过 {@link validateRefundReason}**（见 `tests/refund-reason.test.ts` 的断言）——
 * 例如写「拍错了/买错了」会因为 `/` 不在白名单里，用户一点标签就必然提交失败。
 */
export const QUICK_REFUND_REASONS: string[] = [
  '不想要了',
  '拍错或买错',
  '重复下单',
  '地址或电话填错',
  '商品降价了',
  '与商家协商退款',
]

/** 理由的字符数（与后端一致：按 Unicode 字符计，不按字节）。 */
export function refundReasonCharCount(value: unknown): number {
  return Array.from(String(value ?? '')).length
}

/**
 * 清洗退款理由（**保留换行**）。
 *
 * ⚠️ 不能直接用 `utils/input-validation.ts` 的 `cleanText()`：它会把 `\u0000-\u001F` 全部删掉，
 * 其中包含 `\n`（换行）→ 用户写的多行理由会被拼成一行。而换行在后端的 `\s` 白名单里是**合法**的，
 * 所以这里单独实现，只去掉「除换行以外的控制字符」。
 */
export function cleanRefundReason(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n') // 统一换行为 \n（微信输入法/粘贴可能带 \r\n）
    .replace(/[\u3000\u00A0]/g, ' ') // 全角空格、不换行空格 → 半角（后端 Java 的 \s 不认这两种）
    .replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '') // 去掉除 \n 外的控制字符与零宽字符
    .replace(/[ \t]+/g, ' ') // 连续空格/制表符合并
    .replace(/\n{3,}/g, '\n\n') // 最多保留一个空行
    .trim()
}

/**
 * 校验退款理由。
 * @param value 用户输入
 * @param options.required 是否必填（秒退：必填；若将来人工退款允许不填，传 false）
 * @returns 通过时返回**清洗后**的值（提交时直接用这个值，不要再用原始输入）
 */
export function validateRefundReason(value: unknown, options: { required?: boolean } = {}): ValidationResult<string> {
  const required = options.required !== false
  const normalized = cleanRefundReason(value)
  if (!normalized) {
    // 非必填时空理由 = 合法（返回空串表示"不传这个字段"）
    return required ? { ok: false, message: '请填写退款理由' } : { ok: true, value: '' }
  }
  if (refundReasonCharCount(normalized) > REFUND_REASON_MAX_LENGTH) {
    return { ok: false, message: `退款理由不能超过${REFUND_REASON_MAX_LENGTH}个字符` }
  }
  if (!REFUND_REASON_PATTERN.test(normalized)) {
    return { ok: false, message: '退款理由里有不支持的符号，请改用中文、字母、数字或常用标点（不支持表情）' }
  }
  return { ok: true, value: normalized }
}

/**
 * 校验**售后申请**原因（`POST /api/after-sale/submit` 的 `AfterSaleSubmitDTO.reason`）。
 *
 * ⚠️⚠️ 为什么**不能**复用 {@link validateRefundReason}（2026-10-02 代码审查发现）：
 * 两个后端 DTO 的约束**不一样**：
 * | DTO | 长度 | 字符白名单 |
 * |---|---|---|
 * | `OrderRefundDTO.reason`（秒退/自助退款） | 200 | ✅ **有 `@Pattern`**（见 {@link REFUND_REASON_PATTERN}） |
 * | **`AfterSaleSubmitDTO.reason`**（售后申请） | 200 | ❌ **没有 pattern** |
 *
 * ⇒ 若售后也套退款的白名单，用户写个表情或 `~ / % &` 会被**前端**拦下，
 *   而后端**本来接受** ⇒ 属于"前端比后端更严"的假报错（用户被无理由挡住）。
 *
 * ⇒ 所以这里**只校验必填与长度**，字符交给后端（它没有白名单）。
 * ⚠️ 清洗仍复用 `cleanRefundReason`（去控制字符/零宽字符、合并空白），那是纯卫生处理、不影响合法性。
 */
export function validateAfterSaleReason(value: unknown, options: { required?: boolean } = {}): ValidationResult<string> {
  const required = options.required !== false
  const normalized = cleanRefundReason(value)
  if (!normalized) {
    return required ? { ok: false, message: '请填写售后原因' } : { ok: true, value: '' }
  }
  if (refundReasonCharCount(normalized) > REFUND_REASON_MAX_LENGTH) {
    return { ok: false, message: `售后原因不能超过${REFUND_REASON_MAX_LENGTH}个字符` }
  }
  // ⚠️ 刻意**不做**白名单校验：后端 AfterSaleSubmitDTO.reason 没有 @Pattern
  return { ok: true, value: normalized }
}

/**
 * 取消申请原因的**长度上限** 255（`CancelRequestBody.reason`，见 `api_doc.json`）。
 *
 * ⚠️ 与退款/售后的 **200** 不同：`CancelRequestBody.reason` 是 `maxLength: 255, minLength: 0`，
 *    **没有 `@Pattern`**、也**不在 `required` 里**（不传时后端记为"用户取消"）。
 *    ⛔ 拿 200 那个常量去卡取消原因 = 比后端更严（长理由会被前端无理由拦下）。
 */
export const CANCEL_REASON_MAX_LENGTH = 255

/**
 * 常用**取消**原因（一键填入）—— ⚠️ 与 {@link QUICK_REFUND_REASONS} **不是同一批**。
 *
 * 为什么必须分开：退款理由里有「商品降价了」这类**钱/退货**语义，而取消申请是
 * 「**这单我不要了 / 还没发货前撤回**」的语义（提交后进商家审核、可能被驳回）。
 * 把「商品降价了」摆在取消弹层里，用户会误以为点了就能因为降价而退差价。
 * ⚠️ 因为 {@link validateCancelReason} **没有字符白名单**（对齐后端 DTO），本表的条目
 *    不需要像退款那样逐条过白名单校验；但仍沿用「一句话、无表情」的写法保持四处口径一致。
 */
export const QUICK_CANCEL_REASONS: string[] = [
  '不想要了',
  '下错单了',
  '地址填错了',
  '想换其他商品',
  '配送太慢',
  '与商家协商取消',
]

/**
 * 校验**取消申请原因**（`POST /api/delivery/orders/{orderNo}/cancel-request` 的 `CancelRequestBody.reason`）。
 *
 * ⚠️⚠️ 为什么**不能**复用 {@link validateRefundReason}（2026-10-03 代码审查发现，P0 假报错）：
 * 后端两个 DTO 的约束**不一样**：
 * | DTO | 长度 | 字符白名单 | 必填 |
 * |---|---|---|---|
 * | `OrderRefundDTO.reason`（秒退/自助退款） | 200 | ✅ **有 `@Pattern`** | ✅ 必填（前端约定） |
 * | `AfterSaleSubmitDTO.reason`（售后申请） | 200 | ❌ 无 pattern | ✅ |
 * | **`CancelRequestBody.reason`**（取消申请） | **255** | ❌ **无 pattern** | ❌ **选填** |
 * ⇒ 取消申请套退款那套的后果有两条：① 超过 200 字的长原因被**前端**拦下；② 用户写个表情
 *   或 `~ / % &` 也被拦下 —— 而后端**两样都接受** ⇒ 属于"前端比后端更严"的**假报错**。
 * ⇒ 所以本档**只校验长度**（255），字符交给后端，且**默认不必填**（`required` 默认 false，
 *   与 DTO 一致：不填时后端记为"用户取消"）。
 *
 * ⚠️⚠️ 已知张力（按仓库规则**从后端**，不从"UI 想强制"）：取消弹层此前把原因当**必填**、
 *    且占位文案写「请填写取消原因（必填）」。但 DTO 明明是选填 ⇒ 强制必填就是"比后端更严"，
 *    会挡住"我就想直接取消、不想写理由"的用户。⇒ 现按 DTO 走**选填**，弹层占位同步改「（选填）」。
 *
 * ⚠️ 清洗仍复用 {@link cleanRefundReason}（去控制字符/零宽字符、合并空白），那是纯卫生处理、不影响合法性。
 */
export function validateCancelReason(value: unknown, options: { required?: boolean } = {}): ValidationResult<string> {
  // ⚠️ 与另两档**相反**：`=== true` 才算必填（默认 false = 选填，对齐后端 DTO 的 minLength 0）。
  const required = options.required === true
  const normalized = cleanRefundReason(value)
  if (!normalized) {
    return required ? { ok: false, message: '请填写取消原因' } : { ok: true, value: '' }
  }
  if (refundReasonCharCount(normalized) > CANCEL_REASON_MAX_LENGTH) {
    return { ok: false, message: `取消原因不能超过${CANCEL_REASON_MAX_LENGTH}个字符` }
  }
  // ⚠️ 刻意**不做**白名单校验：后端 CancelRequestBody.reason 没有 @Pattern
  return { ok: true, value: normalized }
}
