import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// 只测纯逻辑（store 的 actions/getters、persist、utils）——不接 uni-app 的 vite 插件、
// 不编译 .vue，避免引入小程序构建的复杂度。uni 全局在 tests/setup.js 里 mock。
// 用 .mjs 扩展名：本项目是 CommonJS，而 vitest config 是 ESM，.mjs 才能正确加载。
export default defineConfig({
  resolve: {
    // 让源码里的 '@/...' 别名在测试中也能解析（cwd 为项目根，npm run test 从这里跑）
    alias: { '@': resolve(process.cwd(), 'src') },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
  },
})
