import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// 一仓多包测试编排（vitest projects）——2026-07-23 瘦身拍板批后仅活线：
//   scripts —— 仓根 tests/scripts/（守卫/工具脚本自测）
//   rw      —— rewrite/*/tests/（新线全部包）
// 旧线（packages/ 五包）及其 tests/{cloud,admin,agent} 已随旧线删除（回滚基线在 next 仓）。
export default defineConfig({
  test: {
    // 覆盖率度量（B8·纯度量不设阈值）：先看基线数字，不拍脑袋定一个阈值然后
    // 机器拦低于它的 PR——阈值该不该定、定多少，是看到基线后的产品/质量决策，
    // 不是本批该越俎代庖的判断；度量工具本身也不是「该恒成立的不变量」（覆盖率
    // 数字会随代码量自然波动），故刻意不立守卫、不进 npm run check，只留
    // `npm run coverage` 供按需实跑。vitest projects 模式下 coverage 只认根级
    // 配置，不要往任何子 project 里加（会被忽略）。
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    projects: [
      {
        test: {
          name: 'scripts',
          environment: 'node',
          globals: true,
          include: ['tests/scripts/**/*.test.js'],
        },
      },
      {
        // 新线（rewrite/）测试——rw-line-in-gates 守卫要求新线包必须被测试闸扫到。
        // @ldrw/shared 走源码别名（免建 dist）；wx-server-sdk 经根 node_modules 命中内存桩。
        // plugins:[vue()]（B9）：只编译 .vue 文件的 transform，不影响其余 .ts/.js 测试文件——给
        // admin 渲染测试（挂载真实 .vue 组件）提供 SFC 编译支持。environment 仍默认 'node'（纯逻辑
        // 测试快），渲染测试改在各测试文件顶部单独加 `// @vitest-environment happy-dom` 文档块注释
        // 切换（vitest 内置 per-file environment 覆盖，无需装 vitest-environment-happy-dom 包，只需
        // happy-dom 本身在场）。
        resolve: {
          alias: {
            '@ldrw/shared': new URL('./rewrite/shared/src/index.ts', import.meta.url).pathname,
          },
        },
        plugins: [vue()],
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
