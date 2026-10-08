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
  /* ⚠️ 2026-09-29 新增：圆角裁剪所需的方法（见 clipRoundedRect）。均为小程序 Canvas 2D 标准 API。 */
  save(): void
  restore(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void
  closePath(): void
  clip(): void
}

interface PosterCanvasNode {
  width: number
  height: number
  createImage(): CanvasImageNode
  getContext(type: '2d'): PosterCanvasContext
  requestAnimationFrame?(callback: () => void): void
}

/**
 * 推广海报背景（多路径兜底链：按顺序逐个试，任一成功即用）。
 *
 * ⚠️ 2026-09-22 换新海报：**复用首页分享海报那张竖版整图切图**，不新增图片文件 ——
 *    原先主包余量只有约 0.25MB，再塞一张底图会把主包顶到 ~1.92MB（上限 2MB），
 *    因此这里直接引用 `components/home/HomeSharePoster.vue` 的 `POSTER_BACKGROUND` 同一份素材，
 *    并删除了旧的浅色装饰底图（`static/bg/promotion-code-poster` 那 15KB 的旧文件）。
 *
 * ⚠️ 2026-10-08 CDN 迁移：该素材已随 `static` 下的 `design-cuts/` 目录整体外挂到 CDN，**包内不再留副本**
 *    ⇒ 原来那三条 `../static/...` / `../../static/...` / `/static/...` 候选**全部会 404**，
 *    收敛为唯一仍可解析的 CDN 绝对 URL（「按顺序逐个试」的行为保持不变）。
 *    URL 形式**已实测锁定**：`fengling/2026-09-17-jinhuayouli/mini-static/` 这段长前缀是**必需的**
 *    —— CDN 回源不会剥掉它，少了它直接 404，不要再"简化"。
 *
 * ⚠️⚠️ **代码之外的部署依赖（微信控制台，改代码解决不了）**：
 *    `uni.getImageInfo()` 底层走 `wx.downloadFile` 的域名校验链路 ⇒ **必须**在小程序后台
 *    「开发管理 → 服务器域名 → downloadFile 合法域名」里加上 `https://jinhuayou.com`，
 *    否则拿网络 URL 生成海报会**直接失败**。
 *    （注：纯 `<image src="https://...">` 的**展示**不受该白名单限制、只需 https —— 两者别混淆。）
 */
const PROMOTION_BACKGROUND_PATHS = [
  'https://jinhuayou.com/fengling/2026-09-17-jinhuayouli/mini-static/design-cuts/figma-share/poster-portrait-background.jpg',
] as const

/**
 * 海报画布尺寸 = 背景切图**原始像素**（`分享海报/share 2.png` → 1000×1600，比例 0.625）。
 * 旧实现按 1242×2400（比例 0.5175）绘制，若沿用会把新图纵向拉伸变形，故同步改为 1000×1600，
 * 与 `components/home/HomeSharePoster.vue` 的 POSTER_WIDTH / POSTER_HEIGHT 完全一致。
 */
const POSTER_WIDTH = 1000
const POSTER_HEIGHT = 1600

/**
 * 海报圆角半径（画布坐标，单位 = 背景切图原始像素）。
 *
 * ⚠️ 2026-09-29 用户要求「商品详情页的分享海报要圆角」。
 *    ⚠️ 圆角**必须在 canvas 绘制阶段裁剪**：CSS 的 `border-radius` 只影响**屏幕预览**，
 *    `canvasToTempFilePath` 导出的图片**不会**带圆角 ⇒ 用户保存到相册看到的仍是直角。
 *    预览侧 `.promotion-code-sheet` 的 `border-radius: 22.4rpx` 与这里对应（40 × 0.56 ≈ 22.4）。
 */
const POSTER_RADIUS = 40

/**
 * 把 canvas 当前路径裁成圆角矩形 —— 调用之后，所有绘制内容都会被裁到这个区域内。
 *
 * ⚠️ 调用方**必须自己配对** `save()` / `restore()`，否则裁剪会一直生效、影响后续绘制。
 * ⚠️ 半径做了**上限保护**（不超过短边一半）：否则相邻的弧会互相穿插、四角反而出现尖角。
 * ⚠️ 用标准 `arcTo` 画四角（小程序 Canvas 2D 支持），比四段 `arc` 更简洁、且四角不留接缝。
 */
function clipRoundedRect(
  context: PosterCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
  context.clip()
}

/**
 * 二维码落位（画布坐标，单位 = 背景切图原始像素），与 `HomeSharePoster.vue` 严格一致。
 *
 * 量测依据（2026-09-22，对海报底图原图实测）：
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
  // ⚠️ 圆角裁剪（2026-09-29 用户要求「分享海报要圆角」）：
  //    CSS 的 border-radius 只影响**屏幕预览**，`canvasToTempFilePath` 导出的图片**不会**带圆角
  //    ⇒ 必须先把画布裁成圆角矩形，之后画上去的内容四角自然被裁掉，导出的图才真的是圆角。
  //    ⚠️ 顺序不能变：`save()` → `clip()` → `drawImage()` → `restore()`；
  //       且 `clearRect` 要留在 `clip` **之前**（它清的是整块画布）。
  context.save()
  clipRoundedRect(context, 0, 0, canvasWidth, canvasHeight, POSTER_RADIUS)
  context.drawImage(backgroundImage, 0, 0, canvasWidth, canvasHeight)
  context.drawImage(codeImage, QR_X, QR_Y, QR_SIZE, QR_SIZE)
  context.restore()
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
    // ⚠️ 不要把失败原因一律吞成「保存失败」（2026-09-28 用户反馈"我的页保存到手机和发送给好友都失败"，
    // 但界面只给一句"保存失败，请重试"，无从定位）。导出链路是「取画布 → 加载图片 → 写相册」，
    // 真实原因各不相同；这里区分展示，并打 console 便于真机排查。
    const message = error instanceof Error ? error.message : ''
    console.warn('[PromotionCodePoster] saveToPhone failed:', message)
    let title = '保存失败，请重试'
    if (message.includes('auth deny') || message.includes('auth denied')) title = '请允许访问相册后重试'
    else if (message.includes('图片加载失败') || message.includes('canvas image')) title = '海报素材加载失败，请检查网络后重试'
    else if (message.includes('海报画布')) title = '海报生成失败，请重试'
    else if (message.includes('不支持')) title = message
    uni.showToast({ title, icon: 'none' })
  } finally {
    actionLoading.value = false
  }
}

/**
 * ⚠️ 2026-09-28 用户决定：**本入口已从界面移除**（见模板注释），此函数保留但不再被调用。
 *
 * 移除原因：它走 `wx.showShareImageMenu`（分享**图片**），微信会在图片下方自动附一个**小程序链接**，
 * 而该链接取的是**当前页面的 path + query**、我们无法自定义 ⇒ 点链接进来**不带 `promoterId`、绑定不了推广关系**。
 * 与其留一个"看着能分享、实际绑不上"的入口，不如让用户保存图片后在微信里自行发送。
 */
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
      // ⚠️ 必须透出 errMsg：微信侧失败原因（版本不支持 / 路径无效 / 图片不可分享）是定位问题的唯一线索
      fail: (err: { errMsg?: string }) => {
        console.warn('[PromotionCodePoster] showShareImageMenu fail:', err?.errMsg)
        uni.showToast({ title: '发送失败，请重试', icon: 'none' })
      },
    })
  } catch (error) {
    // 这里能到，说明是**导出图片**失败（还没走到微信分享），而非"发送"失败 —— 提示要区分开
    const message = error instanceof Error ? error.message : ''
    console.warn('[PromotionCodePoster] share poster export failed:', message)
    uni.showToast({ title: message.includes('图片加载失败') ? '海报素材加载失败，请检查网络后重试' : '图片生成失败，请重试', icon: 'none' })
  } finally {
    actionLoading.value = false
  }
}
</script>

<template>
  <view v-show="modelValue" class="promotion-code-mask" :style="maskStyle" @click="close">
    <view class="promotion-code-dialog" @click.stop>
      <view class="promotion-code-sheet">
        <image class="promotion-code-bg" src="https://jinhuayou.com/fengling/2026-09-17-jinhuayouli/mini-static/design-cuts/figma-share/poster-portrait-background.jpg" mode="aspectFit" />
        <text class="promotion-code-close" @click="close">×</text>
        <view v-show="loading" class="promotion-code-loading">推广码生成中...</view>
        <image v-show="!loading && codeUrl" class="promotion-code-image" :src="codeUrl" mode="aspectFit" />
      </view>
      <view v-show="!loading && codeUrl" class="poster-actions">
        <button class="poster-action poster-save" :disabled="actionLoading" @click="saveToPhone">保存到手机</button>
      </view>
      <!-- 2026-09-28 用户决定：**去掉「发送给好友」**。原因：它走 `showShareImageMenu`（分享图片），
           微信自动附带的小程序链接取「当前页 path+query」，点链接进来不带 promoterId ⇒ 绑定不了关系。
           ⇒ 改为「保存到本地，让用户自己在微信里发送」，故此处只留保存按钮 + 一行引导。 -->
      <text v-show="!loading && codeUrl" style="margin-top: 12rpx; color: #86909c; font-size: 24rpx">保存后可在微信里直接发送给好友</text>
      <canvas type="2d" id="promotion-code-poster-canvas" class="poster-canvas" />
    </view>
  </view>
</template>

<style>
.promotion-code-mask { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; overflow-y: auto; padding: 20rpx; box-sizing: border-box; background: rgba(0, 0, 0, .62); }
.promotion-code-dialog { display: flex; flex-shrink: 0; flex-direction: column; align-items: center; }
/* ⚠️ 2026-09-29：加圆角（用户要求「分享海报要圆角」）。
   半径与 canvas 导出的 POSTER_RADIUS 对应：canvas 1000px 宽、这里预览 560rpx 宽
   ⇒ 换算系数 0.56（本文件二维码落点用的也是这个系数）⇒ 40 × 0.56 ≈ 22.4rpx。
   ⚠️ 必须配 `overflow: hidden` 才能真正裁掉四角（`border-radius` 本身不裁子元素）。 */
.promotion-code-sheet { position: relative; width: 560rpx; height: 896rpx; padding: 0; box-sizing: border-box; background: transparent; border-radius: 22.4rpx; overflow: hidden; }
.promotion-code-bg { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; }
/* 关闭按钮：换新海报后此处回归修复 —— 旧底图是绿色调（close 区均值 RGB≈115,186,128，白字可见），
   新切图右上角是米白照片区（均值 RGB≈244,242,232），纯白 × 几乎不可见，
   故加一层半透明深色圆底保证对比度（形态与首页分享海报的白色 close 图标区分开：那个在海报外）。 */
/* ⚠️ 2026-09-29：位置由 `top: 20rpx; right: 24rpx` 调整为 `28rpx / 32rpx` ——
   因为 `.promotion-code-sheet` 新加了 `border-radius: 22.4rpx` + `overflow: hidden`，
   原位置（top 20 < 圆角半径 22.4）会让按钮**顶部被圆角裁掉一小块**。挪开后四角都不会碰到裁剪区。 */
.promotion-code-close { position: absolute; top: 28rpx; right: 32rpx; z-index: 3; display: inline-block; width: 52rpx; height: 52rpx; border-radius: 50%; color: #fff; font-size: 40rpx; font-weight: 300; line-height: 50rpx; text-align: center; background: rgba(0, 0, 0, .38); }
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
