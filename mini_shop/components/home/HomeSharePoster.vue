<script setup lang="ts">
import { computed, getCurrentInstance, onMounted, shallowRef, watch } from 'vue'

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
 * ⚠️ 2026-10-08 CDN 迁移：海报底图已从包内 `static` 下的 `design-cuts/` 目录外挂到 CDN。
 * URL 形式**已实测锁定**：`fengling/2026-09-17-jinhuayouli/mini-static/` 这段长前缀是**必需的**
 * （CDN 回源不会剥掉它；少了它直接 404），别再"简化"成 `/mini-static/...` 或 `/static/...`。
 *
 * ⚠️⚠️ **代码之外的部署依赖（微信控制台，改代码解决不了）**：
 * `uni.getImageInfo()` 底层走 `wx.downloadFile` 的域名校验链路 ⇒ **必须**在小程序后台
 * 「开发管理 → 服务器域名 → downloadFile 合法域名」里加上 `https://jinhuayou.com`，
 * 否则拿网络 URL 生成海报会**直接失败**。
 * （注：纯 `<image src="https://...">` 的**展示**不受该白名单限制、只需 https —— 两者别混淆。）
 */
const POSTER_BACKGROUND = 'https://jinhuayou.com/fengling/2026-09-17-jinhuayouli/mini-static/design-cuts/figma-share/poster-portrait-background.jpg'
/**
 * 背景图**候选路径**（顺序敏感：`getImageInfo` 解析出的本地临时路径优先，其后才是这里的候选）。
 *
 * ⚠️ 2026-09-28 踩到：只用单一绝对路径时，`canvas.createImage()` 在某些环境下会 onerror
 * （表现是「保存失败，请重试」+ 控制台 `海报图片加载失败`）。
 * 同项目的 `PromotionCodePoster.vue` **早就踩过同一个坑**并加了多路径兜底
 * （它的「保存到手机」一直正常，就是靠这份兜底）⇒ 这里对齐同一套候选顺序。
 * ⚠️ 2026-10-08 CDN 迁移：包内 `static` 下那三个设计切图目录已整体删除，原来那三条
 * `../static/...` / `../../static/...` / `/static/...` 候选**全部会 404**
 * ⇒ 收敛为唯一仍可解析的 CDN 绝对 URL。候选链「按顺序逐个试」的行为**保持不变**
 * （调用处仍是 `[getImageInfo 解析出的 path, ...POSTER_BACKGROUND_SOURCES]`，
 * 两者形态不同、不会被去重吃掉）。
 */
const POSTER_BACKGROUND_SOURCES = [
  POSTER_BACKGROUND,
] as const
/** 二维码兜底素材（当前 tab 二维码加载不出来时用）。 */
const POSTER_QR_PLACEHOLDER = 'https://jinhuayou.com/fengling/2026-09-17-jinhuayouli/mini-static/design-cuts/figma-share/poster-qr-placeholder.jpg'
const POSTER_QR_SOURCES = [
  POSTER_QR_PLACEHOLDER,
] as const
const POSTER_QR_FALLBACK = POSTER_QR_PLACEHOLDER
const POSTER_CLOSE_ICON = 'https://jinhuayou.com/fengling/2026-09-17-jinhuayouli/mini-static/design-cuts/figma-share/poster-close.svg'
const POSTER_WIDTH = 1000
const POSTER_HEIGHT = 1600
/**
 * 二维码落位（画布坐标，单位 = 背景切图原始像素）。
 *
 * 依据（2026-09-22 换新背景 `分享海报/share 2.png` 实测）：新背景底部是米色底 + **纯白圆形占位**
 * （无内嵌二维码），用严格阈值（R/G/B 均 > 250）逐像素扫描并取最大连通域，得
 * 占位 bbox = **(375,1211)-(632,1467)**，即 258×257 的正圆（连通域填充率 0.786 ≈ π/4），圆心 (503.5,1339)。
 * 故 QR_X=375 / QR_Y=1211 / QR_SIZE=258：正方形按占位外接框绘制，与旧图（240 画在 ~256 白圆上）同口径。
 * 旧常量 385/1219/240 对应的是**旧背景里已经烘焙好的二维码**位置，新背景没有烘焙二维码，必须按上表重算。
 *
 * ⚠️ 二维码素材（含兜底 `poster-qr-placeholder.webp`）是**白底正方形**，四个角会盖住金环的对角位置；
 * 若设计希望金环完整可见，需换成四角透明的小程序码素材。
 */
const QR_X = 385
const QR_Y = 1219
const QR_SIZE = 240

const props = defineProps<{
  modelValue: boolean
  codeUrl: string
  shareLink: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const actionLoading = shallowRef(false)
const posterFilePath = shallowRef('')
const componentInstance = getCurrentInstance()?.proxy
let posterSource = ''
const capsuleBottom = shallowRef(uni.upx2px(96))
const previewQrUrl = computed(() => props.codeUrl || POSTER_QR_FALLBACK)
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
  if (!actionLoading.value) emit('update:modelValue', false)
}

function getImageInfo(src: string): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({ src, success: resolve, fail: reject })
  })
}

function getCanvasNode(): Promise<PosterCanvasNode> {
  return new Promise((resolve, reject) => {
    // @ts-ignore 微信小程序 2D canvas API
    const wxApi = typeof wx !== 'undefined' ? wx : null
    if (!wxApi || typeof wxApi.createSelectorQuery !== 'function') {
      reject(new Error('当前环境不支持海报画布'))
      return
    }
    const query = componentInstance
      ? wxApi.createSelectorQuery().in(componentInstance)
      : wxApi.createSelectorQuery()
    query.select('#home-share-poster-canvas').fields({ node: true, size: true }).exec((result: Array<{ node?: PosterCanvasNode }>) => {
      const canvas = result?.[0]?.node
      if (!canvas) {
        reject(new Error('海报画布初始化失败'))
        return
      }
      resolve(canvas)
    })
  })
}

/**
 * 用 2D canvas 加载图片。
 *
 * ⚠️ `label` 是为了**区分是背景图还是二维码失败** —— 两者的来源完全不同（CDN 背景图 vs 后端二维码），
 * 混在一起报「海报图片加载失败」无法定位（2026-09-28 卡在这里）。
 * ⚠️ `createImage().src` 只接受特定形态：对 CDN URL 调 `getImageInfo` 会给出 `wxfile://` 临时路径（可用），
 * 但**开发者工具里可能给的是 `http://127.0.0.1:<port>/...` 之类的本地代理地址**，该地址若返回非 200 就会 onerror。
 */
/**
 * 逐个候选路径尝试加载，**任一成功即返回**；全失败才抛错。
 *
 * ⚠️ 与 `components/PromotionCodePoster.vue` 的 `loadCanvasImageWithFallback` 同构 ——
 * 2D canvas 的 `createImage().src` 对路径形态很挑，单一路径在部分环境会失败，
 * 多给几个候选能显著提高成功率（那边的「保存到手机」正因如此一直可用）。
 */
async function loadCanvasImageWithFallback(
  canvas: PosterCanvasNode,
  sources: readonly string[],
  label: string,
): Promise<CanvasImageNode> {
  let lastError: unknown = null
  const tried = new Set<string>()
  for (const src of sources) {
    if (!src || tried.has(src)) continue
    tried.add(src)
    try {
      return await loadCanvasImage(canvas, src, label)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('海报图片加载失败')
}

function loadCanvasImage(canvas: PosterCanvasNode, src: string, label: string): Promise<CanvasImageNode> {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage()
    image.onload = () => resolve(image)
    image.onerror = (err?: unknown) => {
      console.warn('[HomeSharePoster] canvas image failed:', JSON.stringify({
        label,
        src: String(src ?? '').slice(0, 140),
        err: err ?? null,
      }))
      reject(new Error('海报图片加载失败'))
    }
    image.src = src
  })
}

function waitForCanvasPaint(canvas: PosterCanvasNode): Promise<void> {
  return new Promise((resolve) => {
    const done = () => setTimeout(resolve, 120)
    if (typeof canvas.requestAnimationFrame === 'function') canvas.requestAnimationFrame(done)
    else done()
  })
}

async function createPosterFile(): Promise<string> {
  // ⚠️ `getImageInfo` **自身**也可能失败（网络抖动 / 域名未加入 downloadFile 白名单 / 开发者工具代理返回 500）——
  // 不能让这里抛错就断掉整条链路：失败时让 path 为空，交给下面的多路径兜底继续试。
  const background = await getImageInfo(POSTER_BACKGROUND).catch(() => null)
  const qr = await getImageInfo(previewQrUrl.value).catch(() => null)
  // 诊断留痕：这里能看出 `getImageInfo` 究竟把 CDN 图解析成了什么形态
  // （真机通常 `wxfile://`；开发者工具可能是 `http://127.0.0.1:<port>/...`，后者若 500 就会让 createImage 失败）。
  console.warn('[HomeSharePoster] image info:', JSON.stringify({
    background: String(background?.path ?? '(getImageInfo 失败)').slice(0, 140),
    qr: String(qr?.path ?? '(getImageInfo 失败)').slice(0, 140),
  }))
  const canvas = await getCanvasNode()
  canvas.width = POSTER_WIDTH
  canvas.height = POSTER_HEIGHT

  const [backgroundImage, qrImage] = await Promise.all([
    // ⚠️ 先试 getImageInfo 解析出的 path（真机通常是 wxfile:// 临时路径，最可靠），
    //    失败再逐个试 POSTER_BACKGROUND_SOURCES 里的 CDN 绝对 URL 兜底。
    loadCanvasImageWithFallback(canvas, [background?.path || '', ...POSTER_BACKGROUND_SOURCES], 'background'),
    loadCanvasImageWithFallback(canvas, [qr?.path || '', ...POSTER_QR_SOURCES], 'qr'),
  ])
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)
  context.drawImage(backgroundImage, 0, 0, POSTER_WIDTH, POSTER_HEIGHT)
  context.drawImage(qrImage, QR_X, QR_Y, QR_SIZE, QR_SIZE)
  await waitForCanvasPaint(canvas)

  return new Promise((resolve, reject) => {
    // @ts-ignore 微信小程序 2D canvas API
    const wxApi = typeof wx !== 'undefined' ? wx : null
    if (!wxApi || typeof wxApi.canvasToTempFilePath !== 'function') {
      reject(new Error('当前环境不支持海报导出'))
      return
    }
    wxApi.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width: POSTER_WIDTH,
      height: POSTER_HEIGHT,
      destWidth: POSTER_WIDTH,
      destHeight: POSTER_HEIGHT,
      success: (result: { tempFilePath: string }) => resolve(result.tempFilePath),
      fail: reject,
    }, componentInstance)
  })
}

async function getPosterFile(): Promise<string> {
  if (posterFilePath.value && posterSource === previewQrUrl.value) return posterFilePath.value
  const filePath = await createPosterFile()
  posterFilePath.value = filePath
  posterSource = previewQrUrl.value
  return filePath
}

async function downloadPoster(): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    const filePath = await getPosterFile()
    await new Promise<void>((resolve, reject) => {
      uni.saveImageToPhotosAlbum({ filePath, success: () => resolve(), fail: reject })
    })
    uni.showToast({ title: '海报已保存', icon: 'success' })
  } catch (error) {
    // ⚠️ 不要把失败原因一律吞成「保存失败」：导出链路有三段（取画布 → 加载图片 → 写相册），
    // 真实原因分别是「海报画布初始化失败 / 海报图片加载失败 / auth deny」，
    // 统一提示会让排查无从下手（2026-09-28 就吃过这个亏）。
    const message = error instanceof Error ? error.message : ''
    let title = '保存失败，请重试'
    if (message.includes('auth deny') || message.includes('auth denied')) title = '请允许访问相册后重试'
    else if (message.includes('海报图片加载失败')) title = '海报素材加载失败，请检查网络后重试'
    else if (message.includes('海报画布初始化失败')) title = '海报生成失败，请重试'
    else if (message.includes('不支持')) title = message
    console.warn('[HomeSharePoster] 导出失败:', message)
    uni.showToast({ title, icon: 'none' })
  } finally {
    actionLoading.value = false
  }
}

function copyShareLink(): void {
  // 2026-09-28 用户要求：分享海报里**去掉「复制链接」选项**，故本函数不再被模板引用。
  // 保留实现仅为兼容（若将来要加回，直接恢复模板里那一行即可）；不参与分享链路。
  if (!props.shareLink) return
  uni.setClipboardData({
    data: props.shareLink,
    success: () => uni.showToast({ title: '链接已复制', icon: 'success' }),
  })
}

</script>

<template>
  <view v-show="modelValue" class="home-share-mask" :style="maskStyle" @click="close">
    <view class="home-share-dialog" @click.stop>
      <view class="home-share-poster">
        <image class="home-share-poster-bg" :src="POSTER_BACKGROUND" mode="aspectFill" />
        <image class="home-share-poster-qr" :src="previewQrUrl" mode="aspectFit" />
      </view>
      <image class="home-share-close" :src="POSTER_CLOSE_ICON" mode="aspectFit" @click="close" />
      <view class="home-share-actions">
        <view class="home-share-action" @click="downloadPoster"><text>下载海报</text></view>
        <button class="home-share-send" open-type="share" :disabled="actionLoading" @click="close"><text>发送群或好友</text></button>
      </view>
      <canvas type="2d" id="home-share-poster-canvas" class="home-share-canvas" />
    </view>
  </view>
</template>

<style>
.home-share-mask { position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; overflow-y: auto; padding-right: 0; padding-left: 0; box-sizing: border-box; background: rgba(0, 0, 0, .22); }
.home-share-dialog { display: flex; width: 100%; flex-shrink: 0; flex-direction: column; align-items: center; padding-bottom: 48rpx; box-sizing: border-box; }
.home-share-poster { position: relative; width: 460rpx; height: 736rpx; overflow: hidden; border-radius: 16rpx; background: #f5f1ea; box-shadow: 0 16rpx 48rpx rgba(0, 0, 0, .18); }
.home-share-poster-bg { display: block; width: 100%; height: 100%; }
/* 预览态二维码落点：与 createPosterFile() 的 QR_X/QR_Y/QR_SIZE 严格一致。
   换算系数 0.46 = 海报展示宽 460rpx ÷ 画布宽 1000px（高度同为 736rpx ÷ 1600px = 0.46）：
   left = 375 × 0.46 = 172.5rpx、top = 1211 × 0.46 ≈ 557rpx、宽高 = 258 × 0.46 ≈ 118.7rpx。 */
.home-share-poster-qr { position: absolute; top: 557rpx; left: 172.5rpx; width: 118.7rpx; height: 118.7rpx; }
/* 关闭按钮：设计稿 32x32，与海报、与下方按钮区各间距 24px ≈ 46rpx */
.home-share-close { display: block; width: 62rpx; height: 62rpx; margin-top: 46rpx; }
/* 操作区（2026-09-24 按用户确认）：**整个盒子没有背景色**（透明），按钮直接浮在遮罩上；
   仍是跟在关闭按钮下方、属于弹窗内容流（不贴屏幕底）。
   实测：高 70px / 内边距 16px / 按钮间距 8px（×1.923 → 135rpx / 31rpx / 15rpx） */
.home-share-actions { display: flex; width: 100%; height: 135rpx; align-items: center; justify-content: center; gap: 15rpx; margin-top: 46rpx; padding: 31rpx; box-sizing: border-box; background: transparent; }
/* 按钮：高 38px ≈ 73rpx、全圆角、左右内边距 24px ≈ 46rpx；
   ⚠️ **按内容自适应宽度**（设计稿实测 104 / 104 / 132，**不是等宽**） */
.home-share-action, .home-share-send { display: flex; flex: 0 0 auto; height: 73rpx; align-items: center; justify-content: center; padding: 0 46rpx; box-sizing: border-box; border-radius: 999rpx; color: #ff5500; font-size: 28rpx; line-height: 44rpx; white-space: nowrap; }
.home-share-action { background: #fff4e8; }
.home-share-send { flex: 0 0 auto; margin: 0; border: 0; background: linear-gradient(135deg, #ffb341 0%, #ff5500 100%); color: #fff; }
.home-share-send::after { border: 0; }
.home-share-canvas { position: fixed; top: 0; left: -9999px; width: 310px; height: 496px; }
/* ⚠️ 离屏画布也不要写成 1px×1px：微信 2D canvas 需要有真实布局盒，
   1px 的节点在部分机型上会导致 canvasToTempFilePath 失败（表现为"保存失败，请重试"）。
   这里与 PromotionCodePoster.vue 保持同一尺寸口径；真正的绘制/导出尺寸由 canvas.width/height（1000×1600）决定。 */
</style>
