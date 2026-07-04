import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 管理控制台 v2（M3）：静态托管部署（同旧 admin 路数·/admin 路径）；endpoint 经 VITE_ADMIN_API 注入。
export default defineConfig({
  plugins: [vue()],
  base: './',
})
