import { defineConfig } from 'vitest/config'

// 变异测试专用 vitest 编排（对抗性检验·第三方系统 StrykerJS 用）。
// 为什么不用根 vitest.config.mjs：projects 多包模式对 @stryker-mutator/vitest-runner
// 是额外变量，且变异试点范围（shared + cloud/kit·钱链核心）只需 shared/cloud 两包的
// 测试作杀手；admin/agent 渲染测试（vue 插件+happy-dom）对该范围零覆盖、只拖慢每轮。
// 范围扩到 admin 时再把对应 include/插件搬进来。
export default defineConfig({
  resolve: {
    alias: {
      '@ldrw/shared': new URL('./rewrite/shared/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['rewrite/shared/tests/**/*.test.ts', 'rewrite/cloud/tests/**/*.test.ts'],
  },
})
