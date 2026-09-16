/**
 * 剪贴板工具（后台常见需求：把订单号/收货信息复制到快递系统）。
 * 优先用 Clipboard API（需 https 或 localhost），不可用时回退 `execCommand('copy')`。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const value = String(text ?? '')
  if (!value) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* 继续走回退方案 */
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', 'readonly')
    textarea.style.position = 'fixed'
    textarea.style.top = '-1000px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
