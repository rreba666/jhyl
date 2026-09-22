/**
 * 商品详情图「超长图自动切片 + 尺寸/体积收敛」工具（2026-09-22 新增）。
 *
 * 背景（生产实测，详见 docs/后端需求-商品详情长图切片与压缩-2026-09-22.md）：
 * 商品 id=5/6/7 的 `detailImages` 指向同一类图 —— HTTP 200 + `image/jpeg`（图本身是好的），
 * 但尺寸为 **790 × 21222px / 9.0MB**；解码成位图约 `790 × 21222 × 4 ≈ 67MB` 内存，
 * 移动端必然解码失败：小程序 `<image>` 只占位不显示（一片灰），`@error` 也未必触发
 * （属于渲染失败而非加载失败）。
 *
 * 结论：必须在上传侧让图变「可渲染」。`detailImages` 本来就是 **URL 数组**，
 * C 端是 `v-for` 顺序渲染，所以「一张长图 → 多段短图」对 C 端零改动，
 * 只需保证**切片顺序与阅读顺序一致**。
 *
 * 本模块职责划分（便于单测/算法自证）：
 * - `planDetailImageSlices()`：**纯函数**，只算分段，不碰 DOM；
 * - `readDetailImageSize()` / `sliceDetailImageToFiles()`：依赖浏览器 DOM（Image / canvas）。
 */

/**
 * 单段最大高度（px）：**3000**。
 * 依据：790×3000×4 ≈ 9.5MB 位图，任何手机都能解码（对比 790×21222×4 ≈ 67MB 必然失败）；
 * 3000 高在小程序详情页仍是「一屏以上的长条」，不会把图切得太碎
 * （实测那张 790×21222 只需 **8 段**）。
 */
export const DETAIL_SLICE_MAX_SEGMENT_HEIGHT = 3000

/**
 * 输出最大宽度（px）：**1200**。
 * 依据：后台详情图预览宽约 750px，小程序详情页实际渲染宽度 ≤ 屏宽×DPR ≈ 1080，
 * 1200 足够清晰（更高只是浪费体积）；**宽度 ≤ 1200 时不放大**，避免糊图。
 */
export const DETAIL_SLICE_MAX_WIDTH = 1200

/**
 * 切片输出格式：统一 JPEG。长图基本是**不透明**的照片/图文，JPEG 体积远小于 PNG，直接决定能否被小程序渲染。
 * 显式标注为 `string`：`buildDetailSegmentName()` 里要按它推扩展名，字面量类型会让 `=== 'image/png'` 被判为无重叠比较。
 */
export const DETAIL_SLICE_MIME: string = 'image/jpeg'

/** JPEG 初次编码质量：**0.85**（肉眼基本无损，体积约为 0.92 的 70%）。 */
export const DETAIL_SLICE_JPEG_QUALITY = 0.85

/** 单段体积仍超 `DETAIL_SLICE_MAX_SEGMENT_BYTES` 时的**降质量档位**，依次尝试直到达标。 */
export const DETAIL_SLICE_FALLBACK_QUALITIES = [0.7, 0.6, 0.5] as const

/** 单段体积上限：**2MB**（后端需求稿建议值「单文件 ≤ 2MB」）。 */
export const DETAIL_SLICE_MAX_SEGMENT_BYTES = 2 * 1024 * 1024

/** 详情图张数上限：**15**（与视图层 `:max="15"` 保持一致；切片后段数也占用这个额度）。 */
export const DETAIL_IMAGE_MAX_COUNT = 15

/** 一个切片段的几何信息（源图坐标 + 输出尺寸，均为整数像素）。 */
export interface DetailSliceSegment {
  /** 段号，从 **1** 开始（用于文件名 `xxx-part1.jpg`，保证顺序可读）。 */
  index: number
  /** 源图裁切起点 Y（原图像素）。 */
  sy: number
  /** 源图裁切高度（原图像素）。 */
  sHeight: number
  /** 输出画布宽度（= 整图输出宽度）。 */
  width: number
  /** 输出画布高度。 */
  height: number
}

/** 一次切片的完整方案（纯数据，可直接断言）。 */
export interface DetailSlicePlan {
  /** 原图宽（naturalWidth）。 */
  sourceWidth: number
  /** 原图高（naturalHeight）。 */
  sourceHeight: number
  /** 收敛后的输出宽（≤ DETAIL_SLICE_MAX_WIDTH）。 */
  outputWidth: number
  /** 收敛后的输出总高。 */
  outputHeight: number
  /** 宽度缩放比（≤ 1，不放大）。 */
  scale: number
  /** **是否需要切片**（段数 > 1）。 */
  needSlice: boolean
  /** 段数（0 表示尺寸非法，调用方应按原图上传）。 */
  totalSegments: number
  /** 分段明细，按阅读顺序排列。 */
  segments: DetailSliceSegment[]
}

/**
 * 计算详情图切片方案（**纯函数**，无任何 DOM 依赖，可单测）。
 *
 * 规则：
 * 1. 宽度 > `maxWidth` 时**等比缩到 maxWidth**（只缩不放）；
 * 2. 按 `maxSegmentHeight` 从**上到下**均分，最后一段为余数（可能短于阈值）；
 * 3. 分段边界先算「输出坐标」（`round(边界 × scale)`），因此**相邻段首尾严格相接**：
 *    段高之和 ≡ `outputHeight`，**无重叠、无遗漏**；
 * 4. 源图裁切区间用整数原图像素表示，`drawImage` 时再映射到输出画布，缩放不产生接缝。
 *
 * @param sourceWidth       原图宽（naturalWidth）
 * @param sourceHeight      原图高（naturalHeight）
 * @param maxSegmentHeight  单段最大高度，默认 {@link DETAIL_SLICE_MAX_SEGMENT_HEIGHT}
 * @param maxWidth          输出最大宽度，默认 {@link DETAIL_SLICE_MAX_WIDTH}
 */
export function planDetailImageSlices(
  sourceWidth: number,
  sourceHeight: number,
  maxSegmentHeight: number = DETAIL_SLICE_MAX_SEGMENT_HEIGHT,
  maxWidth: number = DETAIL_SLICE_MAX_WIDTH,
): DetailSlicePlan {
  const invalid = !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0
  const safeSegmentHeight = Number.isFinite(maxSegmentHeight) && maxSegmentHeight > 0 ? Math.floor(maxSegmentHeight) : DETAIL_SLICE_MAX_SEGMENT_HEIGHT
  const safeMaxWidth = Number.isFinite(maxWidth) && maxWidth > 0 ? Math.floor(maxWidth) : DETAIL_SLICE_MAX_WIDTH

  // 尺寸非法：返回 0 段，调用方按「原图直接上传」处理（保持旧行为）
  if (invalid) {
    return { sourceWidth: 0, sourceHeight: 0, outputWidth: 0, outputHeight: 0, scale: 1, needSlice: false, totalSegments: 0, segments: [] }
  }

  const width = Math.floor(sourceWidth)
  const height = Math.floor(sourceHeight)
  // 只缩不放：宽度已经小于等于上限时保持原宽（原图 790px 宽 → 不放大）
  const scale = Math.min(1, safeMaxWidth / width)
  const outputWidth = Math.max(1, Math.round(width * scale))
  const outputHeight = Math.max(1, Math.round(height * scale))
  // 段数按「输出坐标」算，保证段高之和恰好等于 outputHeight
  const totalSegments = Math.max(1, Math.ceil(outputHeight / safeSegmentHeight))

  const segments: DetailSliceSegment[] = []
  for (let index = 0; index < totalSegments; index += 1) {
    /**
     * 段边界统一用「输出坐标」的整数边界，再分别映射回源图坐标：
     * `destStart/destEnd` 是输出画布上的整数边界（相邻段首尾相接，故合计 = outputHeight）；
     * `sy/sHeight` 是同一区间在源图上的整数区间（相邻段首尾相接，故合计 = height）。
     */
    const destStart = Math.min(outputHeight, index * safeSegmentHeight)
    const destEnd = index === totalSegments - 1 ? outputHeight : Math.min(outputHeight, (index + 1) * safeSegmentHeight)
    const canvasHeight = Math.max(1, destEnd - destStart)

    const sourceStart = Math.min(height, Math.round(destStart / scale))
    const sourceEnd = index === totalSegments - 1 ? height : Math.min(height, Math.round(destEnd / scale))
    const sourceSpan = Math.max(1, sourceEnd - sourceStart)

    segments.push({
      index: index + 1,
      sy: sourceStart,
      sHeight: sourceSpan,
      width: outputWidth,
      height: canvasHeight,
    })
  }

  return {
    sourceWidth: width,
    sourceHeight: height,
    outputWidth,
    outputHeight,
    scale,
    needSlice: totalSegments > 1,
    totalSegments,
    segments,
  }
}

/**
 * 由原文件名生成切片文件名：`详情图.png` → `详情图-part1.jpg`（扩展名统一换成切片输出格式）。
 * 保留原扩展名之外的全部字符，避免破坏中文名与已有后缀。
 */
export function buildDetailSegmentName(originalName: string, index: number): string {
  const ext = DETAIL_SLICE_MIME === 'image/png' ? 'png' : 'jpg'
  const baseName = (originalName || 'detail').replace(/\.[^./\\]+$/, '') || 'detail'
  return `${baseName}-part${index}.${ext}`
}

/** 把原生 File 读成已解码的图片元素；**返回的 objectURL 由调用方负责 revoke**。 */
function createDecodedImage(file: File): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    // createObjectURL 避免把大图读成 base64 字符串（9MB 图转 base64 会再翻 1/3 内存）
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve({ image, objectUrl })
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('图片解码失败'))
    }
    image.src = objectUrl
  })
}

/** 读取图片真实尺寸（naturalWidth / naturalHeight）；用后立即 revokeObjectURL 释放内存。 */
export async function readDetailImageSize(file: File): Promise<{ width: number; height: number }> {
  const { image, objectUrl } = await createDecodedImage(file)
  const size = { width: image.naturalWidth, height: image.naturalHeight }
  URL.revokeObjectURL(objectUrl)
  return size
}

/** 读尺寸 + 出方案：切片链路的入口（读图失败会抛错，由调用方回退为原图上传）。 */
export async function planDetailSliceForFile(file: File): Promise<DetailSlicePlan> {
  const { width, height } = await readDetailImageSize(file)
  return planDetailImageSlices(width, height)
}

/** canvas → Blob（`toBlob` 是回调式，这里包成 Promise）。 */
function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片导出失败'))),
      DETAIL_SLICE_MIME,
      quality,
    )
  })
}

/**
 * 把单段画布编码成 File：
 * - 先按 `DETAIL_SLICE_JPEG_QUALITY`（0.85）编码；
 * - 若仍 > `DETAIL_SLICE_MAX_SEGMENT_BYTES`（2MB），按 `DETAIL_SLICE_FALLBACK_QUALITIES` **自动降质量重编码**；
 * - 全部档位仍超标时返回最小的一次（不阻断上传，由调用方提示）。
 */
async function encodeSegmentToFile(canvas: HTMLCanvasElement, fileName: string, index: number): Promise<File> {
  const qualities = [DETAIL_SLICE_JPEG_QUALITY, ...DETAIL_SLICE_FALLBACK_QUALITIES]
  let best: Blob | null = null
  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, quality)
    best = blob
    if (blob.size <= DETAIL_SLICE_MAX_SEGMENT_BYTES) break
  }
  if (!best) throw new Error('图片导出失败')
  return new File([best], buildDetailSegmentName(fileName, index), { type: DETAIL_SLICE_MIME })
}

/**
 * 按方案把长图逐段绘制并编码成**有序的** File 数组。
 *
 * 核心是 `drawImage` 的 9 参数形式：用源图偏移 `sy` / 裁切高 `sHeight` 只取这一段，
 * 再缩放绘制到 `outputWidth × 段高` 的画布上（宽度方向已收敛到 ≤ 1200）。
 * 用后 revoke objectURL，避免大图长期占用内存。
 */
export async function sliceDetailImageToFiles(file: File, plan: DetailSlicePlan): Promise<File[]> {
  const { image, objectUrl } = await createDecodedImage(file)
  try {
    const files: File[] = []
    // 严格串行：顺序即阅读顺序，绝不能并发/乱序
    for (const segment of plan.segments) {
      const canvas = document.createElement('canvas')
      canvas.width = segment.width
      canvas.height = segment.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('当前环境不支持 Canvas，无法切片详情图')
      // JPEG 无透明通道：先铺白底，避免原图透明区域在切片后变黑
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, segment.sy, plan.sourceWidth, segment.sHeight, 0, 0, segment.width, segment.height)
      files.push(await encodeSegmentToFile(canvas, file.name, segment.index))
    }
    return files
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
