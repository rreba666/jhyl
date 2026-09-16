import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 待办铃铛「点击信号」。
 *
 * 为什么需要：待办项跳的是 `route`（如 `/orders?statuses=1&pickupType=0`）。
 * - **同一模块内**点不同待办（待发货 ↔ 自提待核销 ↔ 微信上报失败）时**路径相同、只有 query 变**，
 *   页面组件不重新挂载，各页面已通过 `watch(route.query)` 解决；
 * - 但**重复点同一个待办**（例如手动改了筛选后又想回到「待处理」）时，
 *   目标路由与当前路由完全一致 → vue-router 不会重新导航，页面也不会重跑筛选。
 *
 * 因此：铃铛每次点击都让 `clickTick` 自增一次，目标页监听该计数重新套用 URL 筛选并刷新列表。
 */
export const useTodoStore = defineStore('todo', () => {
  /** 点击计数（每次点击铃铛项自增）。 */
  const clickTick = ref(0)

  /** 广播一次"待办被点击"（由 AdminLayout 调用）。 */
  function notifyClick(): void {
    clickTick.value += 1
  }

  return { clickTick, notifyClick }
})
