import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// uni-app 的入口：导出一个 createApp 工厂函数（不是直接 mount）。
// 这里顺手装上 Pinia（全局状态管理），为以后的「登录/账号、购物车」等状态预留。
export function createApp() {
  const app = createSSRApp(App)
  app.use(createPinia())
  return { app }
}
