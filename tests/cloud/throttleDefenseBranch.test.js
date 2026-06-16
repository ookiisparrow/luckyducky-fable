import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { throttleHit, throttleFail } from '../../packages/cloud/src/kit/throttle'

// throttle 防御分支覆盖（债#33 / 质量回顾发现⑥ · 根因#8：防御逻辑存在却未被测逼出）。
// bumpWindowed 在「记录已存在、但本系列窗口字段缺失」时，CAS 前置条件用 _.exists(false)
// （而非拿一个 undefined 旧值去比较）——确保「另一系列先建过同 key 记录」时本系列仍能正确
// 首次初始化、不丢更新、不误判窗内、不踩另一系列字段。
//
// 当前用法 throttleHit / throttleFail 用不同 key（fn:* vs adminApi key）不混用，故该分支不可达；
// 本测试构造混用场景（同 key 先建一系列记录、再调另一系列）显式覆盖它——保留防御而非删除。
// 反向自检：把 throttle.ts 的 `_.exists(false)` 改成 `_.exists(true)` → 两测试均红（CAS 条件
// 永不匹配缺失字段 → updated=0 重试耗尽 → 记录不被写）→ 还原绿，证测试真咬这个分支。
beforeEach(() => control.reset())

describe('throttle 防御分支：记录存在但本系列窗口字段缺失（债#33）', () => {
  it('throttleFail 落在只有 hit 字段的记录上 → exists(false) 首设 fails/windowStart、不踩 hits', async () => {
    const now = Date.now()
    // 记录已由 hit 系列建（hits/hitWindowStart），无 fail 系列的 windowStart
    control.seed('rateLimit', [{ _id: 'rl_mixed', hits: 2, hitWindowStart: now }])
    await throttleFail('mixed', { max: 5, windowMs: 60000, lockMs: 60000 })
    const stored = control.dump('rateLimit').find((d) => d._id === 'rl_mixed')
    expect(stored.fails).toBe(1) // 首次失败计数落地（窗口字段缺失 → 按首次初始化）
    expect(typeof stored.windowStart).toBe('number') // 本系列窗口字段被首设
    expect(stored.hits).toBe(2) // 另一系列字段不被踩
  })

  it('throttleHit 落在只有 fail 字段的记录上 → exists(false) 首设 hits/hitWindowStart、不踩 fails', async () => {
    const now = Date.now()
    // 记录已由 fail 系列建（fails/windowStart），无 hit 系列的 hitWindowStart
    control.seed('rateLimit', [{ _id: 'rl_mixed2', fails: 3, windowStart: now }])
    const over = await throttleHit('mixed2', { max: 5, windowMs: 60000 })
    const stored = control.dump('rateLimit').find((d) => d._id === 'rl_mixed2')
    expect(over).toBe(false) // 首次调用未超限
    expect(stored.hits).toBe(1) // 首次计数落地
    expect(typeof stored.hitWindowStart).toBe('number') // 本系列窗口字段被首设
    expect(stored.fails).toBe(3) // 另一系列字段不被踩
  })
})
