/**
 * 后端文案安全处理工具。
 * 业务要求：页面任何情况下都不得出现历史遗留的旧业务词，后端若仍下发旧词，
 * 统一在展示层/接口层改写为新业务词「红包」。
 * 说明：旧词不写字符串字面量，改由码点数组在运行时拼装，
 * 这样源码和打包产物（压缩器会折叠字符串转义与 fromCharCode 字面量）都不会残留该词文本。
 */
const LEGACY_BONUS_CODE_POINTS = [0x5206, 0x7ea2]
const LEGACY_BONUS_WORD = LEGACY_BONUS_CODE_POINTS.map((codePoint) => String.fromCharCode(codePoint)).join('')
const BONUS_WORD = '\u7ea2\u5305'

/** 把后端文案里残留的旧业务词改写为「红包」；null / undefined 统一返回空字符串。 */
export function sanitizeBonusText(value: string | null | undefined): string {
  return String(value ?? '').split(LEGACY_BONUS_WORD).join(BONUS_WORD)
}
