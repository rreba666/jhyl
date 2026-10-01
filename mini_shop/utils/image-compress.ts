/**
 * 图片上传前的压缩工具（选图 → 压缩 → 返回可上传的临时路径）。
 *
 * ## ⚠️ 为什么不能只靠 `uni.chooseImage({ sizeType: ['compressed'] })`
 *
 * `sizeType: ['compressed']` 是**微信自带**的压缩，它只保证「**比原图小**」，
 * **不保证尺寸、不保证体积、不保证比例** ⇒ 后端的业务要求根本管不住：
 *
 * | 场景 | 后端要求 | 实际来源 |
 * |---|---|---|
 * | 门店图片 `ShopCreateDTO.shopImage` | **690×345、< 2MB** | 契约注释 |
 * | 通用上传 `/api/common/upload` | 支持 jpg/jpeg/png/webp/gif、**≤ 10MB** | 契约 |
 *
 * ⇒ 用户随手拍一张 4000×3000 的照片（十几 MB）走 `sizeType:['compressed']` 之后
 *   仍然可能远超 2MB，而上传通道到 10MB 才拦 ⇒ **要么被后端拒、要么存下一张巨大的图**。
 * ⇒ 所以必须在前端**主动压缩到目标尺寸与目标体积**，不能指望用户自己处理。
 *
 * ## 策略（可靠性优先，逐级降级）
 *
 * 1. `uni.getImageInfo` 取原图尺寸 ⇒ 按**长边**算缩放比（**只缩不放**，避免把小图放大糊掉）；
 * 2. `uni.compressImage` 带 `compressedWidth/Height` + `quality` 压一次
 *    （⚠️ 尺寸参数需**基础库 2.13.0+**，不支持时自动退回「只压质量」的旧写法）；
 * 3. `uni.getFileInfo` 量输出体积，**仍超标就降质量重试**（最多 `MAX_ROUNDS` 轮）；
 * 4. 任何一步失败 ⇒ **回退原图**并 `console.warn`
 *    —— 目标是「先保证能传上去」，而不是「压不到目标就传不了」。
 *
 * ## 平台差异
 *
 * - **微信小程序**：`compressImage` 可用，尺寸+质量都可控（主力场景）；
 * - **H5**：没有 `uni.compressImage` ⇒ 直接返回原图（浏览器端由后端/OSS 处理）；
 * - **App**：`compressImage` 可用，但尺寸参数可能被忽略 ⇒ 仍会走体积重试。
 */

/** 压缩参数。 */
export interface ImageCompressOptions {
  /**
   * 目标**长边**上限（px）。默认 `1280`。
   * ⚠️ 传目标宽高比由原图自行保持（本工具**不裁剪**，避免把门店招牌裁掉半截）。
   */
  maxSize?: number
  /** 目标**体积**上限（KB）。默认 `500`。 */
  maxKB?: number
  /** 初始压缩质量（0–100）。默认 `80`。 */
  initialQuality?: number
}

/** 压缩后的结果，便于调用方按需展示「原图 → 压缩后」的提示。 */
export interface ImageCompressResult {
  /** 最终可上传的临时文件路径（压缩失败时 = 原路径）。 */
  path: string
  /** 是否真的压缩过（false = 原样返回，调用方可据此决定要不要提示）。 */
  compressed: boolean
  /** 压缩后体积（KB）；拿不到时为 `null`。 */
  sizeKB: number | null
  /** 压缩后的宽高；拿不到时为 `null`。 */
  width: number | null
  height: number | null
}

/** 质量逐级下探的档位（第 1 轮用 `initialQuality`，之后按此递减）。 */
const QUALITY_STEPS = [65, 50, 38, 28]

/** 体积重试的最大轮数（含首轮）。 */
const MAX_ROUNDS = 5

/** 微信端尺寸参数所需的基础库版本（不支持时退回"只压质量"）。 */
const MIN_LIB_FOR_DIMENSION = '2.13.0'

/**
 * 判断当前平台是否支持 `uni.compressImage`。
 *
 * ⚠️ H5 没有该 API（`uni.compressImage` 为 undefined）⇒ 直接返回原图，
 *    否则会一路抛错、把「选图」这个动作整体拖垮。
 */
function canCompress(): boolean {
  return typeof uni.compressImage === 'function'
}

/**
 * 比较基础库版本号（用于判断能否传 `compressedWidth` / `compressedHeight`）。
 *
 * ⚠️ 不用 `localeCompare`：`'2.9.0'` 与 `'2.13.0'` 按字符串比会把 2.9 判成更大。
 */
function isLibAtLeast(target: string): boolean {
  try {
    const info = uni.getSystemInfoSync() as { SDKVersion?: string }
    const current = info?.SDKVersion
    if (!current) return false
    const a = current.split('.').map((n) => Number(n) || 0)
    const b = target.split('.').map((n) => Number(n) || 0)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0
      const y = b[i] || 0
      if (x !== y) return x > y
    }
    return true
  } catch {
    // 取不到版本 ⇒ 按"不支持"处理，走最保守的降级路径
    return false
  }
}

/** 取图片尺寸（失败返回 null，不抛）。 */
function getImageSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    try {
      uni.getImageInfo({
        src,
        success: (res) => resolve({ width: Number(res.width) || 0, height: Number(res.height) || 0 }),
        fail: () => resolve(null),
      })
    } catch {
      resolve(null)
    }
  })
}

/** 取文件体积（KB；失败返回 null，不抛）。 */
function getFileSizeKB(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      uni.getFileInfo({
        filePath,
        success: (res) => resolve(Number(res.size) > 0 ? Number(res.size) / 1024 : null),
        fail: () => resolve(null),
      })
    } catch {
      resolve(null)
    }
  })
}

/**
 * 调一次 `uni.compressImage`。
 *
 * @param withDimension 是否带 `compressedWidth/Height`（基础库不支持时不带，否则整次调用会 fail）
 * @returns 压缩后的临时路径；失败返回 `null`
 */
function compressOnce(
  src: string,
  quality: number,
  withDimension: boolean,
  width: number,
  height: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    // ⚠️ 这里**故意不写 `UniApp.CompressImageOptions` 之类的类型标注**：
    //    mini_shop 是 HBuilderX-only、**没有 node_modules / 没有 TS 检查**，
    //    引用一个可能不存在的全局类型反而会让编译报错。
    //    用普通对象 + 可选字段，与该文件既有写法（`RealnameVerifySheet.vue`）保持一致。
    const options: Record<string, unknown> = {
      src,
      quality,
      success: (res: { tempFilePath?: string }) => resolve(res.tempFilePath || null),
      fail: () => resolve(null),
    }
    if (withDimension && width > 0 && height > 0) {
      // ⚠️ 尺寸参数需**微信基础库 2.13.0+**（已在调用前用 `isLibAtLeast` 判定，
      //    不支持时不带这两个字段，否则整次调用会 fail）。
      options.compressedWidth = width
      options.compressedHeight = height
    }
    try {
      // @ts-ignore uni.compressImage 的尺寸参数在部分 uni 类型定义里缺失
      uni.compressImage(options)
    } catch {
      resolve(null)
    }
  })
}

/**
 * 把图片压缩到「目标长边 + 目标体积」以内。
 *
 * @param filePath 原图临时路径（`uni.chooseImage` 的 `tempFilePaths[0]`）
 * @param options  压缩参数，见 {@link ImageCompressOptions}
 * @returns 压缩结果；**任何失败都会回退为原图**，绝不抛错（保证上传流程不被打断）
 *
 * @example
 * ```ts
 * const result = await compressImageForUpload(filePath, { maxSize: 1280, maxKB: 500 })
 * const url = await uploadFile(result.path)
 * if (result.compressed) console.info(`已压缩：${result.sizeKB?.toFixed(0)} KB`)
 * ```
 */
export async function compressImageForUpload(
  filePath: string,
  options: ImageCompressOptions = {},
): Promise<ImageCompressResult> {
  const fallback: ImageCompressResult = { path: filePath, compressed: false, sizeKB: null, width: null, height: null }
  if (!filePath) return fallback

  // H5 / 非微信端没有 compressImage ⇒ 原样返回，不做无用功
  if (!canCompress()) return fallback

  const maxSize = options.maxSize ?? 1280
  const maxKB = options.maxKB ?? 500
  const initialQuality = options.initialQuality ?? 80

  // ① 原图尺寸 ⇒ 算目标宽高（保持比例、只缩不放）
  const origin = await getImageSize(filePath)
  let targetWidth = 0
  let targetHeight = 0
  if (origin && origin.width > 0 && origin.height > 0) {
    const longEdge = Math.max(origin.width, origin.height)
    const scale = longEdge > maxSize ? maxSize / longEdge : 1
    targetWidth = Math.max(1, Math.round(origin.width * scale))
    targetHeight = Math.max(1, Math.round(origin.height * scale))
  }

  // ② 逐轮压缩：首轮用初始质量，之后递减；每轮量体积，达标即停
  const withDimension = isLibAtLeast(MIN_LIB_FOR_DIMENSION)
  const qualities = [initialQuality, ...QUALITY_STEPS]
  let best: ImageCompressResult = fallback

  for (let round = 0; round < MAX_ROUNDS && round < qualities.length; round++) {
    const quality = qualities[round]
    const outPath = await compressOnce(filePath, quality, withDimension, targetWidth, targetHeight)
    // ⚠️ 某轮失败就停：继续降质量没有意义（多半是平台不支持该调用）
    if (!outPath) break

    const sizeKB = await getFileSizeKB(outPath)
    const size = await getImageSize(outPath)
    const candidate: ImageCompressResult = {
      path: outPath,
      compressed: outPath !== filePath,
      sizeKB,
      width: size?.width ?? (targetWidth || null),
      height: size?.height ?? (targetHeight || null),
    }
    // 记录当前最好结果：体积量不到时也先留着（宁可多压一次也不要退回原图）
    best = candidate

    // 体积已达标（或量不到体积、但确实压过一次）⇒ 收工
    if (sizeKB === null || sizeKB <= maxKB) return candidate
  }

  if (best.compressed) {
    // 压过多轮仍超标：仍然用**压过的**那张（比原图小），但把实情写进控制台，
    // 便于排查"为什么这张图还是很大"（例如原图分辨率极高、或平台忽略了尺寸参数）。
    if (best.sizeKB != null && best.sizeKB > maxKB) {
      console.warn(
        `[image-compress] 压缩后仍有 ${best.sizeKB.toFixed(0)} KB（目标 ${maxKB} KB，长边目标 ${maxSize}px）` +
          `，已按最优结果上传；原图 ${filePath}`,
      )
    }
    return best
  }

  console.warn('[image-compress] 压缩未生效，已回退原图：', filePath)
  return fallback
}

/**
 * 「选一张图 → 自动压缩」的一步到位封装（单张）。
 *
 * ⚠️ 仍然传 `sizeType: ['compressed']`：那是**微信再兜一层**（几乎无成本），
 *    本工具在其之上做**尺寸与体积**的确定性约束。
 *
 * @returns 压缩后的临时路径；用户取消选择时返回 `null`
 */
export async function chooseAndCompressImage(
  options: ImageCompressOptions = {},
  chooseOptions: { sourceType?: Array<'album' | 'camera'> } = {},
): Promise<ImageCompressResult | null> {
  const filePath = await new Promise<string | null>((resolve) => {
    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: chooseOptions.sourceType ?? ['album', 'camera'],
      success: (res) => resolve(res.tempFilePaths?.[0] ?? null),
      fail: () => resolve(null),
    })
  })
  if (!filePath) return null
  return compressImageForUpload(filePath, options)
}

/**
 * 预设：**门店图片**（门头 / 店内照）。
 *
 * ⚠️ 契约 `ShopCreateDTO.shopImage` 建议 **690×345、< 2MB**：
 *    - **不裁剪**（保持原图比例，避免把招牌裁掉半截）；
 *    - 长边按 **1280** 约束（比 690 宽的两倍还大，横竖构图都够清晰）；
 *    - 体积按 **800 KB** 约束（留出余量，远低于 2MB）。
 */
export const SHOP_IMAGE_COMPRESS: ImageCompressOptions = { maxSize: 1280, maxKB: 800 }

/**
 * 预设：**证件类**（营业执照 / 身份证正反面）。
 *
 * ⚠️ 证件要能看清文字 ⇒ 长边放宽到 **1600**，体积上限 **1000 KB**
 *    （上传通道允许 10MB，这里留足清晰度，同时避免十几 MB 的原图）。
 */
export const CERTIFICATE_IMAGE_COMPRESS: ImageCompressOptions = { maxSize: 1600, maxKB: 1000 }
