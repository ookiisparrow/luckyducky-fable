// 黄金 kit-security §F：频控与锁定（防爆破·并发正确性·两系列独立）（守卫 rw-kit-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { throttleFail, throttleLocked, throttleReset, throttleHit, withRateLimit } from '../src/kit'

const OPTS = { max: 5, windowMs: 60_000, lockMs: 600_000 }

beforeEach(() => control.reset())

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
