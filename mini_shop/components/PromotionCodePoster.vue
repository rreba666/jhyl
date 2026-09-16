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

const PROMOTION_BACKGROUND_PATHS = [
  '../static/bg/promotion-code-poster.png',
  '../../static/bg/promotion-code-poster.png',
  '/static/bg/promotion-code-poster.png',
] as const

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

/** 把海报背景和二维码合成一张 1242x2400 图片，保存/分享时保持设计稿完整。 */
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

  const canvasWidth = 1242
  const canvasHeight = 2400
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
  context.drawImage(codeImage, 228, 1372, 784, 784)
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
        <image class="promotion-code-bg" src="/static/bg/promotion-code-poster.png" mode="aspectFit" />
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
.promotion-code-sheet { position: relative; width: 560rpx; height: 1082rpx; padding: 0; box-sizing: border-box; background: transparent; }
.promotion-code-bg { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; }
.promotion-code-close { position: absolute; top: 20rpx; right: 24rpx; z-index: 3; color: #fff; font-size: 46rpx; font-weight: 300; line-height: 1; }
.promotion-code-image { position: absolute; top: 619rpx; left: 103rpx; z-index: 1; width: 354rpx; height: 354rpx; }
.promotion-code-loading { position: absolute; top: 619rpx; left: 103rpx; z-index: 1; display: flex; align-items: center; justify-content: center; width: 354rpx; height: 354rpx; color: #959595; font-size: 24rpx; }
.poster-actions { display: flex; gap: 16rpx; width: 560rpx; margin-top: 16rpx; }
.poster-action { flex: 1; height: 76rpx; margin: 0; padding: 0; border-radius: 38rpx; color: #fff; font-size: 25rpx; line-height: 76rpx; }
.poster-action::after { border: 0; }
.poster-save { background: #1677ff; }
.poster-share { background: #07c160; }
.poster-canvas { position: fixed; left: -9999px; top: 0; width: 310px; height: 600px; }
</style>
