// 黄金 kit-security §F：频控与锁定（防爆破·并发正确性·两系列独立）（守卫 rw-kit-golden）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { throttleFail, throttleLocked, throttleReset, throttleHit, withRateLimit, getDb } from '../src/kit'

const OPTS = { max: 5, windowMs: 60_000, lockMs: 600_000 }

beforeEach(() => control.reset())
afterEach(() => vi.restoreAllMocks())

// 计数探针（批C·限频热路径先红）：spy 挂在共享原型上（Query/DocRef 每次 new 实例但方法在
// prototype 上，spyOn 一次即拦所有后续调用）——用来数「同窗未超限」这条热路径实际发了几次库操作。
// getSpy 数 doc(id).get()（DocRef.prototype.get）；updateSpy 数 where(cond).update()（Query.prototype.update，
// 与 doc(id).update() 不同原型，不会误数 throttleReset 等走 doc().update 的调用）。
function spyDbCalls() {
  const db = getDb()
  const docProto = Object.getPrototypeOf(db.collection('__probe__').doc('x'))
  const queryProto = Object.getPrototypeOf(db.collection('__probe__'))
  return { getSpy: vi.spyOn(docProto, 'get'), updateSpy: vi.spyOn(queryProto, 'update') }
}

describe('失败计数与锁定（黄金 F）', () => {
  it('大白话：连续 N 次失败后锁定——锁定窗口内即便口令正确（调用方查锁）也拒', async () => {
    for (let i = 0; i < 5; i++) await throttleFail('ip:1.2.3.4', OPTS)
    expect(await throttleLocked('ip:1.2.3.4')).toBeGreaterThan(0)
  })

  it('大白话：一次成功清零失败计数（窗口重置），此前的失败不再累计', async () => {
    for (let i = 0; i < 4; i++) await throttleFail('ip:1.2.3.4', OPTS)
    await throttleReset('ip:1.2.3.4')
    await throttleFail('ip:1.2.3.4', OPTS) // 清零后第 1 次，未达阈
    expect(await throttleLocked('ip:1.2.3.4')).toBe(0)
  })

  it('大白话：频控按 key 隔离——一个 IP 被锁不影响另一个', async () => {
    for (let i = 0; i < 5; i++) await throttleFail('ip:A', OPTS)
    expect(await throttleLocked('ip:A')).toBeGreaterThan(0)
    expect(await throttleLocked('ip:B')).toBe(0)
  })

  it('大白话：突发并发的失败尝试仍触发锁定（爆破不能靠并发钻缝）', async () => {
    await Promise.all(Array.from({ length: 8 }, () => throttleFail('ip:burst', OPTS)))
    expect(await throttleLocked('ip:burst')).toBeGreaterThan(0)
  })
})

describe('调用频控（黄金 F）', () => {
  it('大白话：窗口内超过 max 次即判超限', async () => {
    const o = { max: 3, windowMs: 60_000 }
    expect(await throttleHit('k', o)).toBe(false)
    expect(await throttleHit('k', o)).toBe(false)
    expect(await throttleHit('k', o)).toBe(false)
    expect(await throttleHit('k', o)).toBe(true) // 第 4 次超限
  })

  it('大白话：突发并发计数不丢更新——N 个并发恰好放行 max 个、其余全拒', async () => {
    const o = { max: 10, windowMs: 60_000 }
    const results = await Promise.all(Array.from({ length: 20 }, () => throttleHit('burst', o)))
    expect(results.filter((over) => !over).length).toBe(10)
    expect(results.filter((over) => over).length).toBe(10)
  })

  it('大白话：限频计数与锁定计数共用一条记录也彼此独立——任一系列缺窗口字段时按首次初始化、不踩坏另一系列', async () => {
    const o = { max: 3, windowMs: 60_000 }
    await throttleHit('mix', o) // 先建 hits 系列
    await throttleFail('mix', OPTS) // fails 系列首写：窗口字段缺失也须正确初始化
    await throttleFail('mix', OPTS)
    expect(await throttleLocked('mix')).toBe(0) // 2 次未达阈——没被 hits 系列污染成误锁
    expect(await throttleHit('mix', o)).toBe(false) // hits=2，未超 3——没被 fails 系列清掉
  })
})

describe('限频热路径库调用次数（批C·盲发条件更新——先红，锁定行为等价）', () => {
  it('大白话：同窗口内非首次调用（未超限）应 1 次库操作打完——盲发条件更新命中即放行，不再多一次读', async () => {
    const o = { max: 5, windowMs: 60_000 }
    await throttleHit('fastpath', o) // 首次：建档（现状路径，不计入本次断言）
    const { getSpy, updateSpy } = spyDbCalls()
    const over = await throttleHit('fastpath', o) // 同窗第二次：目标实现应盲发 1 次条件更新直接命中
    expect(over).toBe(false)
    expect(updateSpy).toHaveBeenCalledTimes(1) // 目标：恰 1 次条件更新
    expect(getSpy).not.toHaveBeenCalled() // 目标：热路径不读；当前实现会先 get 一次 → 本行现在应为红
  })

  it('大白话：命中上限后——盲发条件更新条件不满足（已到上限）→ 回落读+判定路径，仍正确拒绝', async () => {
    const o = { max: 2, windowMs: 60_000 }
    expect(await throttleHit('overlimit', o)).toBe(false) // 第 1 次
    expect(await throttleHit('overlimit', o)).toBe(false) // 第 2 次 == max，未超
    expect(await throttleHit('overlimit', o)).toBe(true) // 第 3 次 > max，盲发不中 → 回落判定超限、正确拒绝
  })

  it('大白话：换窗（窗口过期）与首写——与现状行为一致：新窗口重新计数、旧计数不残留', async () => {
    vi.useFakeTimers()
    try {
      const o = { max: 2, windowMs: 1000 }
      vi.setSystemTime(0)
      expect(await throttleHit('window-switch', o)).toBe(false) // 首写：count=1
      vi.setSystemTime(2000) // 超过 windowMs=1000，换窗
      expect(await throttleHit('window-switch', o)).toBe(false) // 新窗口第 1 次，未超限（旧窗计数不残留）
      vi.setSystemTime(2100)
      expect(await throttleHit('window-switch', o)).toBe(false) // 新窗口第 2 次 == max
      vi.setSystemTime(2200)
      expect(await throttleHit('window-switch', o)).toBe(true) // 新窗口第 3 次 > max，超限
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('withRateLimit（用户端写函数限频·黄金 F）', () => {
  it('大白话：按用户身份限频——超阈拒且 handler 不执行；用户间互不影响', async () => {
    const o = { max: 2, windowMs: 60_000 }
    let ran = 0
    const handler = withRateLimit('trackEvent', o, async () => {
      ran++
      return { ok: true }
    })
    const ctxA = { db: null, OPENID: 'oA', event: {} }
    const ctxB = { db: null, OPENID: 'oB', event: {} }
    expect((await handler(ctxA)).ok).toBe(true)
    expect((await handler(ctxA)).ok).toBe(true)
    const r3 = await handler(ctxA)
    expect(r3).toEqual({ ok: false, error: 'RATE_LIMITED' })
    expect(ran).toBe(2)
    expect((await handler(ctxB)).ok).toBe(true) // 隔离：B 不受 A 影响
  })
})
