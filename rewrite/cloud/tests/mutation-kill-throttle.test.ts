// 变异分诊：kit/throttle.ts 存活变异的杀手测试（窗口边界、两系列共用一条记录、换窗并发、锁定告警、清零只在有残留时写）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { throttleFail, throttleLocked, throttleReset, throttleHit, getDb } from '../src/kit'

const OPTS = { max: 3, windowMs: 60_000, lockMs: 600_000 }
let lines: string[] = []

beforeEach(() => {
  control.reset()
  lines = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(String(a[0])))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('失败计数', () => {
  it('同一 key 先有调用计数、后记失败：失败照常累计，到上限就锁', async () => {
    await throttleHit('mix', { max: 10, windowMs: 60_000 })
    for (let i = 0; i < OPTS.max; i++) await throttleFail('mix', OPTS)
    expect(await throttleLocked('mix')).toBeGreaterThan(0)
  })

  it('窗口边界：距窗口起点恰好 windowMs 时已算新窗口，旧失败不累计', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    await throttleFail('edge', { ...OPTS, max: 2 })
    vi.setSystemTime(1_000_000 + OPTS.windowMs)
    await throttleFail('edge', { ...OPTS, max: 2 })
    expect(await throttleLocked('edge')).toBe(0)
  })

  it('换窗时并发方已先开了新窗口：本次失败叠加上去，不把对方那次覆盖掉', async () => {
    control.seed(COLLECTIONS.rateLimit, [{ _id: 'rl_race', fails: 5, windowStart: 1 }])
    let raced = false
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll !== COLLECTIONS.rateLimit || raced) return
      raced = true
      await getDb().collection(COLLECTIONS.rateLimit).doc('rl_race').update({ data: { fails: 1, windowStart: Date.now() } })
    })
    await throttleFail('race', { ...OPTS, max: 2 })
    expect(await throttleLocked('race')).toBeGreaterThan(0)
  })
})

describe('调用计数', () => {
  // 空字段名在桩里能写，真库会拒写，频控就悄悄失效（CAS 耗尽后放行）
  it('计数与窗口起点落在 hits / hitWindowStart 两个字段', async () => {
    await throttleHit('fn:x:o1', { max: 5, windowMs: 60_000 })
    const [rec] = control.dump(COLLECTIONS.rateLimit)
    expect(rec.hits).toBe(1)
    expect(typeof rec.hitWindowStart).toBe('number')
  })
})

describe('告警行', () => {
  it('第 max 次失败才发一条 LOCKOUT，之前不发；行内容逐字固定', async () => {
    await throttleFail('ip:9', OPTS)
    await throttleFail('ip:9', OPTS)
    expect(lines).toEqual([])
    await throttleFail('ip:9', OPTS)
    expect(lines).toEqual(['[LD_ALERT] sev=security fn=throttle code=LOCKOUT ctx={"key":"ip:9","lockMs":600000}'])
  })

  it('计数写不进去（CAS 耗尽）：只发 CAS_EXHAUSTED（安全级别），不发 LOCKOUT', async () => {
    control.seed(COLLECTIONS.rateLimit, [{ _id: 'rl_ip:9', fails: 0, windowStart: Date.now() }])
    let tries = 0
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll !== COLLECTIONS.rateLimit) return
      tries++
      throw new Error('write conflict')
    })
    await throttleFail('ip:9', { ...OPTS, max: 1 })
    expect(tries).toBe(20)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[LD_ALERT\] sev=security fn=throttle code=CAS_EXHAUSTED ctx=\{"scope":"ip","keyHash":"[0-9a-f]{8}"\}$/)
  })
})

describe('throttleReset 只在有残留时写', () => {
  const countWrites = () => {
    let n = 0
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === COLLECTIONS.rateLimit) n++
    })
    return () => n
  }

  it('没有失败也没锁：不写库', async () => {
    control.seed(COLLECTIONS.rateLimit, [{ _id: 'rl_clean', fails: 0, lockedUntil: 0, hits: 2 }])
    const writes = countWrites()
    await throttleReset('clean')
    expect(writes()).toBe(0)
  })

  it('只剩锁定（失败已清零）：照样解锁', async () => {
    control.seed(COLLECTIONS.rateLimit, [{ _id: 'rl_locked', fails: 0, lockedUntil: Date.now() + 60_000 }])
    const writes = countWrites()
    await throttleReset('locked')
    expect(writes()).toBe(1)
    expect(await throttleLocked('locked')).toBe(0)
  })

  it('只有失败计数：写一次清零', async () => {
    control.seed(COLLECTIONS.rateLimit, [{ _id: 'rl_fails', fails: 2 }])
    const writes = countWrites()
    await throttleReset('fails')
    expect(writes()).toBe(1)
  })
})
