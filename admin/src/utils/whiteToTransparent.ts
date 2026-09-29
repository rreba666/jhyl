/**
 * 白底图片 → 透明底（浏览器端 canvas 处理）。
 *
 * ## 为什么需要
 * 运营在后台「品牌管理」上传的品牌 logo 多为**白底图**（常见于从电商图/截图中裁出来的方形图）。
 * 而小程序品牌条把 logo 放在**透明圆形**里显示 —— 白底会变成一个方块，把圆形容器"填满"，
 * 视觉上很难看。CSS 无法把白底变透明（`mix-blend-mode` 在小程序里也不可靠），
 * 所以只能在**上传前**把白底抠掉（PC 浏览器有 canvas，可做）。
 *
 * ## 算法：**只去除"与图片边缘连通的白色"**（flood fill），而不是"所有白色"
 * ⚠️ 这一点很关键：如果无脑把所有近白像素设为透明，**logo 内部的白色**（例如
 * 「稻香村」白字、「H」字母中间的留白）会被一起镂空，图就毁了。
 * 因此这里从**四条边**出发做连通域扩散，只清除**能从边缘走到**的白色区域：
 * - 白底图的四周背景 ⇒ 与边缘连通 ⇒ 被清除 ✅
 * - logo 内部封闭的白色 ⇒ 与边缘不连通 ⇒ **保留** ✅
 *
 * ## 失败即降级
 * 任何一步出错（解码失败、canvas 不可用、跨域、结果为空白），一律**返回原文件**，
 * 保证上传流程不会因为抠图失败而中断 —— 大不了还是白底图，与改动前行为一致。
 */

/** 近白判定阈值：三通道同时 ≥ 该值才算"白"。故意取高一点，避免把浅灰/浅色误伤成透明。 */
export const WHITE_THRESHOLD = 240

/** 处理结果。 */
export interface WhiteRemovalResult {
  /** 处理后的文件（PNG；未做任何改动时就是原文件）。 */
  file: File
  /** 是否真的执行了去白（false = 原样返回，调用方可据此提示）。 */
  changed: boolean
  /** 被置为透明的像素数（便于日志/排查）。 */
  removedPixels: number
}

/** 判断单个像素是否"近白"。 */
export function isNearWhite(r: number, g: number, b: number, threshold: number = WHITE_THRESHOLD): boolean {
  return r >= threshold && g >= threshold && b >= threshold
}

/**
 * 把图片的**边缘连通白底**置为透明，返回新的 PNG 文件。
 *
 * @param file   原始图片文件（jpg/png/webp 均可，浏览器能解码即可）
 * @param options.threshold 近白阈值，默认 {@link WHITE_THRESHOLD}
 * @param options.padding   边缘判定时向外扩的像素数（默认 0）；用于跳过图片最外圈的压缩噪点边
 */
export async function removeWhiteBackground(
  file: File,
  options: { threshold?: number; padding?: number } = {},
): Promise<WhiteRemovalResult> {
  const threshold = options.threshold ?? WHITE_THRESHOLD
  // 未改动时返回原文件，调用方按旧行为处理
  const fallback = (): WhiteRemovalResult => ({ file, changed: false, removedPixels: 0 })

  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return fallback()

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const width = bitmap.width
    const height = bitmap.height
    if (!width || !height) return fallback()

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return fallback()
    ctx.drawImage(bitmap, 0, 0)

    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    const total = width * height

    /** 已访问标记：避免同一像素被反复入栈（用 Uint8Array 而非 Set，快且省内存）。 */
    const visited = new Uint8Array(total)
    /** 待扩散的像素下标栈（用数组模拟栈，避免递归在大图上爆栈）。 */
    const stack: number[] = []

    const isWhiteAt = (index: number): boolean => {
      const p = index * 4
      return isNearWhite(data[p], data[p + 1], data[p + 2], threshold)
    }

    // ① 四条边上的"近白"像素作为种子（只从边缘出发 ⇒ 内部封闭的白色不会被碰）
    for (let x = 0; x < width; x += 1) {
      const top = x
      const bottom = (height - 1) * width + x
      if (isWhiteAt(top)) stack.push(top)
      if (isWhiteAt(bottom)) stack.push(bottom)
    }
    for (let y = 0; y < height; y += 1) {
      const left = y * width
      const right = y * width + (width - 1)
      if (isWhiteAt(left)) stack.push(left)
      if (isWhiteAt(right)) stack.push(right)
    }

    // ② 连通域扩散：只清除"能从边缘走到"的白色
    let removedPixels = 0
    while (stack.length > 0) {
      const index = stack.pop() as number
      if (visited[index]) continue
      visited[index] = 1
      if (!isWhiteAt(index)) continue

      // 置为全透明（RGB 一并清零，避免某些渲染器对"透明但带色"的像素做边缘插值时透出白边）
      const p = index * 4
      data[p] = 0
      data[p + 1] = 0
      data[p + 2] = 0
      data[p + 3] = 0
      removedPixels += 1

      const x = index % width
      const y = (index - x) / width
      if (x > 0) stack.push(index - 1)
      if (x < width - 1) stack.push(index + 1)
      if (y > 0) stack.push(index - width)
      if (y < height - 1) stack.push(index + width)
    }

    // ③ 一个像素都没动（本来就没有可清除的白底）⇒ 原样返回，避免无谓地把 jpg 转成更大的 png
    if (removedPixels === 0) return fallback()

    ctx.putImageData(imageData, 0, 0)

    // ④ 导出 PNG（透明必须用 PNG；JPEG 不支持 alpha）
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return fallback()

    const nextName = file.name.replace(/\.[^.]+$/, '') + '.png'
    return { file: new File([blob], nextName, { type: 'image/png' }), changed: true, removedPixels }
  } catch (error) {
    // ⚠️ 抠图失败不能让上传中断：留痕后按原文件上传
    console.warn('[whiteToTransparent] 去白底失败，已按原图上传：', error)
    return fallback()
  } finally {
    bitmap?.close?.()
  }
}
