// guard-coverage 体检闸——框架完整性的机器闭环（元模式 A4）。
// 账本每条病根都须有守卫或 CLAUDE 靠人锚；本测试锁「当前零缺口」。
// 反向自检：删某病根的守卫 roots 或其 CLAUDE 靠人锚 → run() 非空 → 本测试红。
import { describe, it, expect } from 'vitest'
import { repoChecks } from '../../scripts/check-structure.mjs'

describe('guard-coverage 体检闸', () => {
  const cov = repoChecks.find((c) => c.id === 'guard-coverage')

  it('注册表里存在 guard-coverage（元守卫在岗）', () => {
    expect(cov, 'check-structure 缺 guard-coverage repoCheck').toBeTruthy()
  })

  it('当前零覆盖率缺口（每条病根都有守卫或靠人豁免）', () => {
    const violations = cov.run()
    expect(violations, `覆盖率缺口：\n${violations.join('\n')}`).toEqual([])
  })
})
