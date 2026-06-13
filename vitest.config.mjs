import { defineConfig } from 'vitest/config'

// 一仓多包测试编排（vitest projects）：
//   miniapp —— packages/miniapp/vitest.config.mjs（@ 别名 + uni mock setup）
//   cloud   —— 仓根 tests/cloud/（云函数闸门测试，内存桩 wx-server-sdk 走根
//              node_modules 的 file: 依赖；cloudfunctions/ 暂在仓根，B1 迁 packages/cloud）
//   admin   —— B7 批次补基线后加入
export default defineConfig({
  test: {
    projects: [
      'packages/miniapp/vitest.config.mjs',
      {
        test: {
          name: 'cloud',
          environment: 'node',
          globals: true,
          include: ['tests/cloud/**/*.test.js'],
        },
      },
    ],
  },
})
