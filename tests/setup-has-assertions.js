// 禁止空断言测试（闸门有效性审计 2026-09-01·T-KILL 复现：删光 expect 后 Vitest 仍绿）。
// 每个 it/test 至少触发一次 expect.*；否则本用例失败。
import { beforeEach, expect } from 'vitest'

beforeEach(() => {
  expect.hasAssertions()
})
