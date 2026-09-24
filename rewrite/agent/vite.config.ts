import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 坐席台：静态托管部署（/agent 路径）；endpoint 经 VITE_AGENT_API 注入。
// base 用绝对路径 /agent/（对照 admin 2026-08-18：原相对路径 './' 在访问 /agent（无尾斜杠）时
// 被解析到网站根目录 → 加载根目录旧 assets 白屏）。绝对路径任何访问方式都正确。
export default defineConfig({
  plugins: [vue()],
  base: '/agent/',
})
