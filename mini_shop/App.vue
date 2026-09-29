<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app'
import { bindStoredPromotionIfLoggedIn, capturePromotionContext } from '@/utils/promotion'

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
