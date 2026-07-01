import { createRouter, createWebHashHistory } from 'vue-router'
import { isLoggedIn } from '@/api/agentApi.js'
import Login from '@/pages/Login.vue'
import Desk from '@/pages/Desk.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: Login },
    { path: '/', redirect: '/desk' },
    { path: '/desk', component: Desk }, // 外包坐席工作台（队列 + 会话窗口 + 360 侧栏 + 快捷回复）
  ],
})

router.beforeEach((to) => {
  if (to.path !== '/login' && !isLoggedIn()) return '/login'
  if (to.path === '/login' && isLoggedIn()) return '/desk'
  return true
})
