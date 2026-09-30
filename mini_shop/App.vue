<script setup lang="ts">
import { onError, onLaunch, onShow } from '@dcloudio/uni-app'
import { bindStoredPromotionIfLoggedIn, capturePromotionContext } from '@/utils/promotion'

/**
 * ⚠️ 2026-09-30 临时诊断：支付完成后出现
 * `Cannot read properties of undefined (reading 'index')` 并**卡在确认订单页**。
 *
 * 已完成的静态排查（结论：**不在业务源码里**）：
 *   1. 全量搜过 `mini_shop` 源码，**没有任何 `X.index` 形式的属性访问** ——
 *      `index` 只作为 `map((item, index))` 的回调参数、`findIndex`、`z-index` 等出现；
 *   2. 编译产物（`unpackage/dist/build/mp-weixin`）里共 **695 处** `X.index`，
 *      **全部是 `uni.xxx` 的编译形态**（`uni` → `vendor.index`）⇒ 报错来自
 *      **框架/基础库层面**，或某个**在极早时机**取 `uni` 对象的地方；
 *   3. `payment.vue` 的支付流程、`onShow` / `onMounted` / `refreshDeliveryQuote`
 *      **均有 try/catch**，不会把异常抛到全局。
 *
 * ⇒ 因此挂一个**全局错误钩子**，把**完整堆栈**打到控制台、**落到本地缓存**（真机没有控制台时
 *   可事后取回），并在诊断期直接弹窗显示 —— 便于复现时一眼拿到出错位置。
 * ⚠️ 它**只记录、不改变任何行为**；定位完成后应把本段整体删除。
 */
onError((error) => {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? (error.stack || '(无 stack)') : '(非 Error 对象)'
  const route = (() => {
    try {
      const pages = getCurrentPages()
      return pages[pages.length - 1]?.route || ''
    } catch { return '' }
  })()
  console.error('[app-error]', message, '\n', stack)
  try {
    uni.setStorageSync('__last_app_error__', { message, stack, route, at: new Date().toISOString() })
  } catch { /* 记录失败不影响主流程 */ }
  // ⚠️ 诊断期直接弹窗：真机上不方便连控制台，弹出来即可截图/复制给开发。
  try {
    uni.showModal({
      title: '运行时错误（诊断）',
      content: `${message}\n\n页面：${route}\n\n${stack}`.slice(0, 900),
      showCancel: false,
      confirmText: '知道了',
    })
  } catch { /* 弹窗失败也不影响 */ }
})

let redirectingToHome = false

/** 启动时清理开发工具残留的登录页，游客也必须先进入公开首页。 */
function ensureHomeEntry(): void {
  if (redirectingToHome) return
  const pages = getCurrentPages()
  const currentRoute = pages[pages.length - 1]?.route
  if (currentRoute !== 'pages/login/login') return

  redirectingToHome = true
  uni.reLaunch({
    url: '/pages/index/index',
    complete: () => { redirectingToHome = false },
  })
}

/** 应用启动时检查启动页，避免游客被开发工具残留状态带入登录页。 */
onLaunch((options) => {
  capturePromotionContext(options as Record<string, unknown>)
  void bindStoredPromotionIfLoggedIn()
  // ⚠️ 这里**故意不**调用 hideTabBar：`hideTabBar` 是**全局状态**，一旦在此隐藏，
  // 用户从分享/扫码**直达其它 tabBar 页**（购物车/分类/个人页）时会看不到底部导航，
  // 而那些页面并不会恢复它。开屏只在首页出现 ⇒ 由首页自己负责隐藏与恢复。
  // onLaunch 早于页面创建，延迟一次让页面栈完成初始化后再兜底。
  setTimeout(ensureHomeEntry, 0)
})

/** 小程序从后台回到前台时再次捕获分享或扫码参数。 */
onShow((options) => {
  capturePromotionContext(options as Record<string, unknown>)
  void bindStoredPromotionIfLoggedIn()
})
</script>

<style>
/* 骑手端图标字体（iconfont 项目 5230143，ttf 已转 base64 内联；小程序 wxss 不能引远程字体） */
@import "./styles/rider-iconfont.wxss";
/* 通用交互动效（点击反馈 / 进场淡入上移 / 骨架呼吸；尊重系统"减弱动态效果"）
   ⚠️ 弹性滚动**不在这里** —— 那是 `scroll-view` 的 `enhanced` + `bounces` 属性，不是 CSS。 */
@import "./styles/motion.wxss";

/* 全局页面基础样式。 */
page {
  background: #f6f8fc;
  color: #172033;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  /* 全局禁止横向滚动（2026-09-22 iOS 反馈「可以左右滑动」）：
     任何元素只要超出屏宽一点，WebKit 就允许整体横向拖拽；
     页面级横向滚动在小程序里没有正当用途，统一裁掉兜底。 */
  overflow-x: hidden;
}
</style>
