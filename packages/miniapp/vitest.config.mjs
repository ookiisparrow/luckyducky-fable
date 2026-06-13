import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// miniapp 项目测试：只测纯逻辑（store / persist / utils / api 回退），
// 不接 uni 的 vite 插件、不编译 .vue；uni 全局在 tests/setup.js mock。
// 被根 vitest.config.mjs 的 test.projects 引用，路径全部锚定本文件所在目录，
// 从仓根或本目录跑结果一致。
export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    name: 'miniapp',
    environment: 'node',
    globals: true,
    setupFiles: [resolve(import.meta.dirname, 'tests/setup.js')],
    include: [resolve(import.meta.dirname, 'tests/**/*.test.js')],
  },
})
