import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { throttleHit, throttleFail, throttleLocked } from '../../packages/cloud/src/kit/throttle'

// 频控计数并发正确性（根因#13 并发面 / 债 #21）。
// throttleHit/throttleFail 原为「get→算→update」读-改-写：突发并发同 key 会在首个 await
// 处全部读到同一旧值，各自 +1 写回 → 计数偏小 → 限额/锁定从缝里漏。
// 这是「行为级」守卫（非只验存在）：用 Promise.all 灌并发，断言「无丢更新」+「突发下仍按阈值
// 锁定」。非原子实现下必红，CAS 重试（乐观并发）修复后转绿。
beforeEach(() => control.reset())

describe('频控计数并发正确性（根因#13 · 债#21）', () => {
  it('throttleHit 突发并发不丢计数：10 并发 → 计数=10、恰好 max 个放行', async () => {
    const now = Date.now()
    control.seed('rateLimit', [{ _id: 'rl_burst', hits: 0, hitWindowStart: now }])
    const N = 10
    const max = 3
    const results = await Promise.all(
      Array.from({ length: N }, () => throttleHit('burst', { max, windowMs: 60000 }))
    )
    const allowed = results.filter((over) => over === false).length
    const stored = control.dump('rateLimit').find((d) => d._id === 'rl_burst')
    expect(stored.hits).toBe(N) // 无丢更新：N 次自增全部落地
    expect(allowed).toBe(max) // 恰好 max 个未超限放行，其余被拒
  })

  it('throttleFail 突发并发仍触发锁定：8 并发错误（max=5）→ 锁定生效（防爆破不漏）', async () => {
    const now = Date.now()
    control.seed('rateLimit', [{ _id: 'rl_bf', fails: 0, windowStart: now }])
    await Promise.all(
      Array.from({ length: 8 }, () => throttleFail('bf', { max: 5, windowMs: 60000, lockMs: 60000 }))
    )
    expect(await throttleLocked('bf')).toBeGreaterThan(0) // 并发爆破仍被锁定
  })
})
