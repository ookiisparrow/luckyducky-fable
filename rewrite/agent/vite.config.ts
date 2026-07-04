import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 坐席台 v2（M3）：静态托管部署（/agent 路径·与旧台并行零断档）；endpoint 经 VITE_AGENT_API 注入。
export default defineConfig({
  plugins: [vue()],
  base: './',
})
