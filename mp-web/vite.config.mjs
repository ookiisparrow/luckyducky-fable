// 小程序网页预览（只读复刻·样例数据）：直接复用 rewrite/mp 的 wxss 与像素画纯函数，不连云、不进生产构建。
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const here = fileURLToPath(new URL('.', import.meta.url))
const mp = fileURLToPath(new URL('../rewrite/mp', import.meta.url))

export default defineConfig({
  root: here,
  plugins: [vue()],
  resolve: { alias: { '@mp': mp } },
  server: {
    host: true,
    port: 3000,
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
})
