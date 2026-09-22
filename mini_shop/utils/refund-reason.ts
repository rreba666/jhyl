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
