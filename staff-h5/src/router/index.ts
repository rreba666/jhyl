import { createRouter, createWebHistory } from 'vue-router'

// 店员核销 H5 路由：默认落地到核销页，扫码链接形如 /pickup?c=自提码。
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/pickup' },
    { path: '/pickup', name: 'Pickup', component: () => import('@/views/pickup.vue') },
  ],
})

export default router
