import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { persistPlugin } from './store/persist.js'

// uni-app 的入口：导出一个 createApp 工厂函数（不是直接 mount）。
// 这里装上 Pinia（全局状态管理）+ 持久化插件（购物车/地址/资料 跨刷新与冷启动不丢）。
export function createApp() {
  const app = createSSRApp(App)
  const pinia = createPinia()
  pinia.use(persistPlugin)
  app.use(pinia)
  return { app }
}
