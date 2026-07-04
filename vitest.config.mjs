import { defineConfig } from 'vitest/config'

// 一仓多包测试编排（vitest projects）：
//   miniapp —— packages/miniapp/vitest.config.mjs（@ 别名 + uni mock setup）
//   cloud   —— 仓根 tests/cloud/（云函数闸门测试，内存桩 wx-server-sdk 走根
//              node_modules 的 file: 依赖；已迁 packages/cloud）
//   admin   —— 仓根 tests/admin/（B8d 补基线；纯逻辑 cardSvg 等，node 环境无需 Vue）
//   agent   —— 仓根 tests/agent/（承面C 车道 B 坐席台前端纯逻辑：会话轮询增量合并，node 环境无需 Vue）
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
      {
        test: {
          name: 'admin',
          environment: 'node',
          globals: true,
          include: ['tests/admin/**/*.test.js'],
        },
      },
      {
        test: {
          name: 'scripts',
          environment: 'node',
          globals: true,
          include: ['tests/scripts/**/*.test.js'],
        },
      },
      {
        test: {
          name: 'agent',
          environment: 'node',
          globals: true,
          include: ['tests/agent/**/*.test.js'],
        },
      },
      {
        // 新线（rewrite/）测试——rw-line-in-gates 守卫要求新线包必须被测试闸扫到。
        // @ldrw/shared 走源码别名（免建 dist）；wx-server-sdk 经根 node_modules 命中内存桩。
        resolve: {
          alias: {
            '@ldrw/shared': new URL('./rewrite/shared/src/index.ts', import.meta.url).pathname,
          },
        },
        test: {
          name: 'rw',
          environment: 'node',
          globals: true,
          include: ['rewrite/*/tests/**/*.test.ts'],
        },
      },
    ],
  },
})
