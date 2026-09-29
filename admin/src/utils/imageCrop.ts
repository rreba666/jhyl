/**
 * 图片裁剪工具：将任意尺寸图片等比缩放并居中裁剪到目标宽高（cover 模式）。
 * 无论原图大于或小于目标尺寸，输出结果都精确为目标宽高。
 */

/** 首屏轮播图目标尺寸（UI 统一规范 750×960 竖图）。 */
export const HERO_IMAGE_SIZE = { width: 750, height: 960 } as const

/**
 * 门店图片（门头图）目标尺寸。
 *
 * 690×345 ≈ 2:1，与 `types/shop.ts` 注释里「建议 690×345、<2MB」以及契约口径一致。
 * 之所以要**自动裁剪**：运营多半直接拿手机拍一张（如 4032×3024，4:3），
 * 比例与门头图完全不同，不处理就显示变形、也不能放。
 * ⇒ 走 {@link cropImageToSize} 的 cover 居中裁剪，输出精确 690×345
 *   （690×345 的 JPEG 通常只有几十 KB，**天然满足 <2MB**，无需再单独压缩）。
 */
export const SHOP_IMAGE_SIZE = { width: 690, height: 345 } as const

/** 通过 objectURL 加载图片，加载完成后自动释放内存。 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    img.src = url
  })
}

/** 将画布导出为 Blob（png 不支持质量参数，故条件传入）。 */
function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片导出失败'))),
      mime,
      quality,
    )
  })
}

/**
 * 将图片等比缩放并居中裁剪到目标宽高。
 * @param file        原始图片文件
 * @param targetWidth  目标宽度（像素）
 * @param targetHeight 目标高度（像素）
 * @param quality      JPEG 输出质量（0-1）
 */
export async function cropImageToSize(
  file: File,
  targetWidth: number,
  targetHeight: number,
  quality = 0.92,
): Promise<File> {
  const image = await loadImage(file)
  const { naturalWidth: width, naturalHeight: height } = image

  // cover 缩放：取覆盖目标所需的最大缩放比，保证输出恰好铺满目标尺寸
  const scale = Math.max(targetWidth / width, targetHeight / height)
  const cropWidth = targetWidth / scale
  const cropHeight = targetHeight / scale
  const cropX = (width - cropWidth) / 2
  const cropY = (height - cropHeight) / 2

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持 Canvas，无法裁剪图片')
  ctx.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight)

  // PNG 原图保持 PNG 以保留透明通道，其余统一转 JPEG 减小体积
  const isPng = file.type === 'image/png'
  const mime = isPng ? 'image/png' : 'image/jpeg'
  const blob = await canvasToBlob(canvas, mime, isPng ? undefined : quality)

  const baseName = file.name.replace(/\.[^.]+$/, '')
  const ext = isPng ? 'png' : 'jpg'
  return new File([blob], `${baseName}-${targetWidth}x${targetHeight}.${ext}`, { type: mime })
}
