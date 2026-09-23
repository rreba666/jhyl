<script setup lang="ts">
import { computed, getCurrentInstance, onMounted, ref, watch } from 'vue'

interface ImageInfo {
  path: string
}

interface CanvasImageNode {
  src: string
  onload: (() => void) | null
  onerror: (() => void) | null
}

interface PosterCanvasContext {
  clearRect(x: number, y: number, width: number, height: number): void
  drawImage(image: CanvasImageNode, x: number, y: number, width: number, height: number): void
}

interface PosterCanvasNode {
  width: number
  height: number
  createImage(): CanvasImageNode
  getContext(type: '2d'): PosterCanvasContext
  requestAnimationFrame?(callback: () => void): void
}

/**
 * 推广海报背景（多路径兜底，兼容不同层级调用方）。
 *
 * ⚠️ 2026-09-22 换新海报：**复用首页分享海报那张竖版整图切图**，不新增图片文件 ——
 *    主包余量只有约 0.25MB，新底图 WebP 为 178KB，再塞一张会把主包顶到 ~1.92MB（上限 2MB），
 *    因此这里直接引用 `components/home/HomeSharePoster.vue` 的 `POSTER_BACKGROUND` 同一份文件，
 *    并删除了旧的 `static/bg/promotion-code-poster.webp`（15KB，旧的纯色/装饰底）。
 */
const PROMOTION_BACKGROUND_PATHS = [
  '../static/design-cuts/figma-share/poster-portrait-background.jpg',
  '../../static/design-cuts/figma-share/poster-portrait-background.jpg',
  '/static/design-cuts/figma-share/poster-portrait-background.jpg',
] as const

/**
 * 海报画布尺寸 = 背景切图**原始像素**（`分享海报/share 2.png` → 1000×1600，比例 0.625）。
 * 旧实现按 1242×2400（比例 0.5175）绘制，若沿用会把新图纵向拉伸变形，故同步改为 1000×1600，
 * 与 `components/home/HomeSharePoster.vue` 的 POSTER_WIDTH / POSTER_HEIGHT 完全一致。
 */
const POSTER_WIDTH = 1000
const POSTER_HEIGHT = 1600

/**
 * 二维码落位（画布坐标，单位 = 背景切图原始像素），与 `HomeSharePoster.vue` 严格一致。
 *
 * 量测依据（2026-09-22，对 `static/design-cuts/figma-share/poster-portrait-background.jpg` 实测）：
 * 新背景底部是米色底 + **纯白圆形占位**（无内嵌二维码），用严格阈值（R/G/B 均 > 250）逐像素扫描
 * 并取最大连通域，得占位 bbox = **(377,1213)-(631,1466)**，即 255×254 的正圆
 * （连通域填充率 0.788 ≈ π/4，圆心 (504.5,1340)）。
 * 这里取 QR_X=375 / QR_Y=1211 / QR_SIZE=258：正方形按占位外接框绘制，左上/右下各外扩约 2px，
 * 用于吃掉抗锯齿边缘（阈值 >250 时边缘像素被排除，实际白圆视觉直径略大于 255px）。
 * 与首页分享海报保持同一组常量，避免同一张图两处坐标不一致。
 */
const QR_X = 385
const QR_Y = 1219
const QR_SIZE = 240

/**
 * 预览态 CSS 换算系数 = 0.56。
 *
 * 依据：`.promotion-code-sheet` 展示宽 560rpx ÷ 画布宽 1000px = 0.56；
 * 展示高 896rpx ÷ 画布高 1600px = 0.56，两者一致（同比例缩放，不变形）。
 * 于是：top = 1211 × 0.56 ≈ 678.2rpx、left = 375 × 0.56 = 210rpx、边长 = 258 × 0.56 = 144.5rpx。
 * ⚠️ 本组件展示宽是 560rpx（首页分享海报是 460rpx，系数 0.46），**不要照抄首页的数值**。
 */

const props = defineProps<{
  modelValue: boolean
  loading: boolean
  codeUrl: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
}>()

const actionLoading = ref(false)
const posterFilePath = ref('')
let posterSource = ''
const componentInstance = getCurrentInstance()?.proxy
const capsuleBottom = ref(uni.upx2px(96))
const maskStyle = computed(() => ({
  paddingTop: `${capsuleBottom.value + uni.upx2px(12)}px`,
  paddingBottom: `${uni.upx2px(20)}px`,
}))

onMounted(() => {
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect?.bottom) capsuleBottom.value = rect.bottom
  } catch {
    // 非微信环境使用默认安全间距。
  }
})

watch(() => props.codeUrl, (codeUrl, previousCodeUrl) => {
  if (codeUrl !== previousCodeUrl) {
    posterFilePath.value = ''
    posterSource = ''
  }
})

function close(): void {
  if (!props.loading && !actionLoading.value) emit('update:modelValue', false)
}

function getImageInfo(src: string): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({ src, success: resolve, fail: reject })
  })
}

async function getPosterBackgroundInfo(): Promise<ImageInfo> {
  let lastError: unknown = null
  for (const src of PROMOTION_BACKGROUND_PATHS) {
    try {
      return await getImageInfo(src)
    } catch (error) {
      lastError = error
      console.warn('[PromotionCodePoster] background path unavailable:', src, error)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('推广海报背景加载失败')
}

function getCanvasNode(): Promise<PosterCanvasNode> {
  return new Promise((resolve, reject) => {
    // @ts-ignore 微信小程序 2D canvas API
    const wxApi = typeof wx !== 'undefined' ? wx : null
    if (!wxApi || typeof wxApi.createSelectorQuery !== 'function') {
      reject(new Error('当前环境不支持海报画布'))
      return
    }
    // 优先在组件实例内查找，实例不可用时退回页面级查找
    const query = componentInstance
      ? wxApi.createSelectorQuery().in(componentInstance)
      : wxApi.createSelectorQuery()
    query
      .select('#promotion-code-poster-canvas')
      .fields({ node: true, size: true })
      .exec((result: Array<{ node?: PosterCanvasNode }>) => {
        const canvas = result?.[0]?.node
        if (!canvas) {
          reject(new Error('海报画布初始化失败'))
          return
        }
        resolve(canvas)
      })
  })
}

function loadCanvasImage(canvas: PosterCanvasNode, src: string): Promise<CanvasImageNode> {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('海报图片加载失败'))
    image.src = src
  })
}

async function loadCanvasImageWithFallback(canvas: PosterCanvasNode, sources: readonly string[]): Promise<CanvasImageNode> {
  let lastError: unknown = null
  const tried = new Set<string>()
  for (const src of sources) {
    if (!src || tried.has(src)) continue
    tried.add(src)
    try {
      return await loadCanvasImage(canvas, src)
    } catch (error) {
      lastError = error
      console.warn('[PromotionCodePoster] canvas image path unavailable:', src, error)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('海报图片加载失败')
}

function waitForCanvasPaint(canvas: PosterCanvasNode): Promise<void> {
  return new Promise((resolve) => {
    const done = () => setTimeout(resolve, 150)
    if (typeof canvas.requestAnimationFrame === 'function') {
      canvas.requestAnimationFrame?.(done)
    } else {
      done()
    }
  })
}

/** 把海报背景和二维码合成一张 1000x1600 图片（背景切图原始尺寸），保存时保持设计稿完整。 */
async function createPosterFile(): Promise<string> {
  if (!props.codeUrl) throw new Error('推广码尚未生成')
  console.log('[Poster] 开始生成海报 codeUrl=', props.codeUrl)

  const background = await getPosterBackgroundInfo().catch((error) => {
    console.error('[Poster] 背景图信息获取失败', error)
    throw error
  })
  console.log('[Poster] 背景图 path=', background.path)

  const code = await getImageInfo(props.codeUrl).catch((error) => {
    console.error('[Poster] 推广码图片信息获取失败', error)
    throw error
  })
  console.log('[Poster] 推广码本地 path=', code.path)

  const canvasWidth = POSTER_WIDTH
  const canvasHeight = POSTER_HEIGHT
  const canvasNode = await getCanvasNode().catch((error) => {
    console.error('[Poster] 画布节点获取失败', error)
    throw error
  })
  console.log('[Poster] 画布节点获取成功')

  canvasNode.width = canvasWidth
  canvasNode.height = canvasHeight
  const [backgroundImage, codeImage] = await Promise.all([
    loadCanvasImageWithFallback(canvasNode, [background.path, ...PROMOTION_BACKGROUND_PATHS]),
    loadCanvasImageWithFallback(canvasNode, [code.path, props.codeUrl]),
  ]).catch((error) => {
    console.error('[Poster] 画布图片加载失败', error)
    throw error
  })
  console.log('[Poster] 画布图片加载完成')

  const context = canvasNode.getContext('2d')
  context.clearRect(0, 0, canvasWidth, canvasHeight)
  context.drawImage(backgroundImage, 0, 0, canvasWidth, canvasHeight)
  context.drawImage(codeImage, QR_X, QR_Y, QR_SIZE, QR_SIZE)
  await waitForCanvasPaint(canvasNode)
  console.log('[Poster] 绘制完成，开始导出')

  return new Promise((resolve, reject) => {
    // @ts-ignore 微信小程序 2D canvas API
    const wxApi = typeof wx !== 'undefined' ? wx : null
    if (!wxApi || typeof wxApi.canvasToTempFilePath !== 'function') {
      reject(new Error('当前环境不支持海报导出'))
      return
    }
    wxApi.canvasToTempFilePath({
      canvas: canvasNode,
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight,
      destWidth: canvasWidth,
      destHeight: canvasHeight,
      success: (result: { tempFilePath: string }) => {
        console.log('[Poster] 导出成功 tempFilePath=', result.tempFilePath)
        resolve(result.tempFilePath)
      },
      fail: (error) => {
        console.error('[Poster] 导出失败', error)
        reject(error)
      },
    }, componentInstance)
  })
}

async function getPosterFile(): Promise<string> {
  if (posterFilePath.value && posterSource === props.codeUrl) return posterFilePath.value

  try {
    const filePath = await createPosterFile()
    posterFilePath.value = filePath
    posterSource = props.codeUrl
    return filePath
  } catch (error) {
    posterFilePath.value = ''
    posterSource = ''
    throw error
  }
}

async function saveToPhone(): Promise<void> {
  if (actionLoading.value || props.loading) return
  actionLoading.value = true
  try {
    const filePath = await getPosterFile()
    await new Promise<void>((resolve, reject) => {
      uni.saveImageToPhotosAlbum({
        filePath,
        success: () => resolve(),
        fail: reject,
      })
    })
    uni.showToast({ title: '已保存到手机', icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    uni.showToast({ title: message.includes('auth deny') ? '请允许访问相册后重试' : '保存失败，请重试', icon: 'none' })
  } finally {
    actionLoading.value = false
  }
}

async function shareToFriend(): Promise<void> {
  if (actionLoading.value || props.loading) return
  actionLoading.value = true
  try {
    const filePath = await getPosterFile()
    // @ts-ignore 微信小程序分享图片 API
    const wxApi = typeof wx !== 'undefined' ? wx : null
    if (!wxApi || typeof wxApi.showShareImageMenu !== 'function') {
      uni.showToast({ title: '当前微信版本不支持发送图片', icon: 'none' })
      return
    }
    wxApi.showShareImageMenu({
      path: filePath,
      fail: () => uni.showToast({ title: '发送失败，请重试', icon: 'none' }),
    })
  } catch (error) {
    console.error('[PromotionCodePoster] share poster export failed:', error)
    uni.showToast({ title: '图片生成失败，请重试', icon: 'none' })
  } finally {
    actionLoading.value = false
  }
}
</script>

<template>
  <view v-show="modelValue" class="promotion-code-mask" :style="maskStyle" @click="close">
    <view class="promotion-code-dialog" @click.stop>
      <view class="promotion-code-sheet">
        <image class="promotion-code-bg" src="/static/design-cuts/figma-share/poster-portrait-background.jpg" mode="aspectFit" />
        <text class="promotion-code-close" @click="close">×</text>
        <view v-show="loading" class="promotion-code-loading">推广码生成中...</view>
        <image v-show="!loading && codeUrl" class="promotion-code-image" :src="codeUrl" mode="aspectFit" />
      </view>
      <view v-show="!loading && codeUrl" class="poster-actions">
        <button class="poster-action poster-save" :disabled="actionLoading" @click="saveToPhone">保存到手机</button>
        <button class="poster-action poster-share" :disabled="actionLoading" @click="shareToFriend">发送给好友</button>
      </view>
      <canvas type="2d" id="promotion-code-poster-canvas" class="poster-canvas" />
    </view>
  </view>
</template>

<style>
.promotion-code-mask { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; overflow-y: auto; padding: 20rpx; box-sizing: border-box; background: rgba(0, 0, 0, .62); }
.promotion-code-dialog { display: flex; flex-shrink: 0; flex-direction: column; align-items: center; }
.promotion-code-sheet { position: relative; width: 560rpx; height: 896rpx; padding: 0; box-sizing: border-box; background: transparent; }
.promotion-code-bg { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; }
/* 关闭按钮：换新海报后此处回归修复 —— 旧底图是绿色调（close 区均值 RGB≈115,186,128，白字可见），
   新切图右上角是米白照片区（均值 RGB≈244,242,232），纯白 × 几乎不可见，
   故加一层半透明深色圆底保证对比度（形态与首页分享海报的白色 close 图标区分开：那个在海报外）。 */
.promotion-code-close { position: absolute; top: 20rpx; right: 24rpx; z-index: 3; display: inline-block; width: 52rpx; height: 52rpx; border-radius: 50%; color: #fff; font-size: 40rpx; font-weight: 300; line-height: 50rpx; text-align: center; background: rgba(0, 0, 0, .38); }
/* 预览态二维码落点：与 createPosterFile() 的 QR_X/QR_Y/QR_SIZE 严格一致（换算系数 0.56，见上方常量注释）。
   top = 1211 × 0.56 ≈ 678.2rpx、left = 375 × 0.56 = 210rpx、边长 = 258 × 0.56 = 144.5rpx。 */
.promotion-code-image { position: absolute; top: 678.2rpx; left: 210rpx; z-index: 1; width: 144.5rpx; height: 144.5rpx; }
/* 生成中：整张海报加一层轻蒙层 + 居中提示。
   ⚠️ 旧的实现把提示文字放在 354rpx 的二维码方框里，新尺寸下该方框只剩 144.5rpx（约 7 个字宽），
   文案会溢出/挤压，故改为整图居中提示。 */
.promotion-code-loading { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 28rpx; background: rgba(0, 0, 0, .35); }
.poster-actions { display: flex; gap: 16rpx; width: 560rpx; margin-top: 16rpx; }
.poster-action { flex: 1; height: 76rpx; margin: 0; padding: 0; border-radius: 38rpx; color: #fff; font-size: 25rpx; line-height: 76rpx; }
.poster-action::after { border: 0; }
.poster-save { background: #1677ff; }
.poster-share { background: #07c160; }
/* 离屏画布：尺寸只为让节点有布局盒，实际绘制/导出尺寸由 canvasNode.width/height（1000×1600）决定。
   这里按 1000:1600 同比取 310px 宽 → 496px 高（旧值 310×600 对应旧的 1242×2400）。 */
.poster-canvas { position: fixed; left: -9999px; top: 0; width: 310px; height: 496px; }
</style>
