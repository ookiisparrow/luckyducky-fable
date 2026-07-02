import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: '/admin/', // 绝对基址：部署路径固定 /admin——相对 './' 在无尾斜杠访问（/admin 不带/）时资源解析到根 404 → 整页空白（同 agent·2026-07-02）
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
