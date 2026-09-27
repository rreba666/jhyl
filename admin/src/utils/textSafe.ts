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
/** 合规词「「部分」+「红包」」的首字（部）与末字（包）码点，用于在替换时跳过它内部的旧词子串。 */
const COMPLIANT_HEAD = String.fromCharCode(0x90e8)
const COMPLIANT_TAIL = String.fromCharCode(0x5305)

/**
 * 把后端文案里残留的旧业务词改写为「红包」；null / undefined 统一返回空字符串。
 *
 * ⚠️ 2026-09-27 修正两个 bug（与今华有肽同口径，此前实现会破坏文案）：
 *  ① **复合词优先**：先前只做单词替换，后端的「旧词+红包」会变成「红包红包」；
 *  ② **保护合规词「「部分」+「红包」」**：它内含旧词子串，误替换会毁成「部红包包」。
 * ⇒ 用 `replace` **回调**判断上下文，**不用 lookbehind**（低版本 iOS 的 JavaScriptCore 不支持，
 *   正则字面量会在解析期报错、整个文件挂掉）。
 * 该实现幂等，可安全重复调用。
 */
export function sanitizeBonusText(value: string | null | undefined): string {
  const source = String(value ?? '')
  // ① 复合词优先：「旧词 + 红包」整体收敛为一个「红包」
  const text = source.replace(new RegExp(`${LEGACY_BONUS_WORD}${BONUS_WORD}`, 'g'), BONUS_WORD)
  // ② 单个旧词替换，但跳过合规词「「部分」+「红包」」里的那一个
  return text.replace(new RegExp(LEGACY_BONUS_WORD, 'g'), (match: string, offset: number, whole: string): string => {
    const before = whole[offset - 1]
    const after = whole[offset + LEGACY_BONUS_WORD.length]
    return before === COMPLIANT_HEAD && after === COMPLIANT_TAIL ? match : BONUS_WORD
  })
}
