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
/* 全局页面基础样式。 */
page {
  background: #f6f8fc;
  color: #172033;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
}
</style>
