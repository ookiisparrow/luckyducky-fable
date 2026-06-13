import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { persistPlugin } from './store/persist.js'
import logger from './utils/logger.js'

// uni-app 的入口：导出一个 createApp 工厂函数（不是直接 mount）。
// 这里装上 Pinia（全局状态管理）+ 持久化插件（购物车/地址/资料 跨刷新与冷启动不丢）。
export function createApp() {
  const app = createSSRApp(App)
  // Vue 组件渲染 / 生命周期内的错误兜底（与 App.vue 的 uni.onError 互补，覆盖面不同）
  app.config.errorHandler = (err, _instance, info) => logger.error('vue', err, info)
  const pinia = createPinia()
  pinia.use(persistPlugin)
  app.use(pinia)
  return { app }
}
