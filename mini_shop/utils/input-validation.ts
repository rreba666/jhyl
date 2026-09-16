export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string }

const ID_CARD_PATTERN = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[0-9X]$/
const ID_CARD_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CARD_CHECK_CODES = '10X98765432'
const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
const MAX_DECIMAL_AMOUNT = 99999999.99

function pass<T>(value: T): ValidationResult<T> {
  return { ok: true, value }
}

function fail<T = never>(message: string): ValidationResult<T> {
  return { ok: false, message }
}

function textLength(value: string): number {
  return Array.from(value).length
}

/** 清除不可见控制字符和首尾空白，保留正常中文、英文、数字、标点和表情。 */
export function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '')
    .trim()
}

/** 清除手机号、银行卡号中允许用户粘贴的空格和连字符。 */
export function cleanDigits(value: unknown): string {
  return String(value ?? '').trim().replace(/[\s-]+/g, '')
}

/** 将手机号整理为可编辑值；后端或缓存中的脱敏号码不能直接用于提交。 */
export function normalizeEditableMobile(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw || raw.includes('*')) return ''
  return cleanDigits(raw)
}

/** 清除身份证号输入空白并统一末位校验字符大小写。 */
export function cleanIdCard(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase()
}

export function validateText(
  value: unknown,
  options: { label: string; maxLength: number; required?: boolean },
): ValidationResult<string> {
  const normalized = cleanText(value)
  if (!normalized && options.required !== false) return fail(`请输入${options.label}`)
  if (textLength(normalized) > options.maxLength) return fail(`${options.label}不能超过${options.maxLength}个字符`)
  return pass(normalized)
}

export function validateMobile(value: unknown, label = '手机号'): ValidationResult<string> {
  const normalized = cleanDigits(value)
  if (!/^1[3-9]\d{9}$/.test(normalized)) return fail(`${label}格式不正确`)
  return pass(normalized)
}

function hasValidCalendarDate(value: string): boolean {
  const year = Number(value.slice(6, 10))
  const month = Number(value.slice(10, 12))
  const day = Number(value.slice(12, 14))
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function hasValidIdCardChecksum(value: string): boolean {
  const sum = value
    .slice(0, 17)
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * ID_CARD_WEIGHTS[index], 0)
  return value[17] === ID_CARD_CHECK_CODES[sum % 11]
}

export function validateIdCard(value: unknown): ValidationResult<string> {
  const normalized = cleanIdCard(value)
  if (!ID_CARD_PATTERN.test(normalized) || !hasValidCalendarDate(normalized) || !hasValidIdCardChecksum(normalized)) {
    return fail('身份证号校验失败，请检查后重试')
  }
  return pass(normalized)
}

export function validateBankCard(value: unknown): ValidationResult<string> {
  const raw = String(value ?? '').trim()
  const normalized = cleanDigits(value)
  if (!normalized || !/^\d{12,19}$/.test(normalized) || /[^\d\s-]/.test(raw)) {
    return fail('银行卡号只能填写12-19位数字')
  }
  return pass(normalized)
}

export function validateEmail(value: unknown): ValidationResult<string> {
  const normalized = cleanText(value)
  const atIndex = normalized.indexOf('@')
  const local = atIndex > 0 ? normalized.slice(0, atIndex) : ''
  const domain = atIndex > 0 ? normalized.slice(atIndex + 1) : ''
  const valid = atIndex === normalized.lastIndexOf('@')
    && !local.startsWith('.')
    && !local.endsWith('.')
    && !local.includes('..')
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)
  if (textLength(normalized) > 254 || !valid || !domain) {
    return fail('邮箱格式不正确')
  }
  return pass(normalized)
}

export function validateTaxNumber(value: unknown): ValidationResult<string> {
  const normalized = cleanText(value).replace(/\s+/g, '').toUpperCase()
  if (!/^[0-9A-Z]{15,20}$/.test(normalized) || !/\d/.test(normalized)) return fail('纳税人识别号格式不正确')
  return pass(normalized)
}

export function validatePositiveInteger(value: unknown, label = '用户ID'): ValidationResult<number> {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d*$/.test(normalized)) return fail(`${label}必须是正整数`)
  const numeric = Number(normalized)
  if (!Number.isSafeInteger(numeric)) return fail(`${label}超出有效范围`)
  return pass(numeric)
}

export function validateAmount(
  value: unknown,
  options: { label: string; min: number; max?: number },
): ValidationResult<number> {
  const normalized = String(value ?? '').trim()
  if (!DECIMAL_AMOUNT_PATTERN.test(normalized)) return fail(`${options.label}必须是数字且最多保留两位小数`)
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric) || numeric > MAX_DECIMAL_AMOUNT) return fail(`${options.label}金额超出有效范围`)
  if (numeric < options.min) return fail(`${options.label}不能低于${options.min.toFixed(2)}`)
  if (options.max != null && numeric > options.max) return fail(`${options.label}超过可用余额`)
  return pass(numeric)
}
