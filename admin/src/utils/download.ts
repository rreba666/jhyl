/**
 * 浏览器端文件下载工具（Blob → 临时 `<a>`）。
 *
 * ## 为什么抽出来
 * admin 有**多个** CSV 导出入口（留痕台账 `api/ledger.ts`、资金日报等），
 * 每个都要：解析 `Content-Disposition` 的文件名 + 造 `<a>` 触发下载 + 回收 objectURL。
 * 这段与本项目业务无关 ⇒ 抽到 utils 统一维护（原先在 `api/ledger.ts` 里是私有的）。
 */

/**
 * 从 `Content-Disposition` 头解析文件名。
 * 优先 `filename*=UTF-8''…`（含中文时必须用这个，后端已按此下发），回退普通 `filename=`。
 */
export function resolveDownloadFilename(disposition: string, fallback: string): string {
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      // 解码失败则继续尝试普通 filename
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(disposition)
  return plainMatch ? plainMatch[1] : fallback
}

/** 触发浏览器下载（Blob → 临时 `<a>`），并回收 objectURL。 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
