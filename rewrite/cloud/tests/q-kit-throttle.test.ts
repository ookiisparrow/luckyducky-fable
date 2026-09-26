// 频控 CAS 重试耗尽告警：日志 ctx 不得带 openid（频控 key 里含 openid）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { withRateLimit } from '../src/kit'
import { COLLECTIONS } from '@ldrw/shared'

const OPENID = 'oSECRET-openid-9f3a'

beforeEach(() => control.reset())
afterEach(() => vi.restoreAllMocks())

describe('CAS_EXHAUSTED 告警不泄 openid', () => {
  it('大白话：同 key 高并发把 CAS 重试打光→照常告警，但日志里找不到 openid，只有动作名和短哈希', async () => {
    control.seed(COLLECTIONS.rateLimit, [{ _id: 'rl_fn:createOrder:' + OPENID, hits: 0, hitWindowStart: Date.now() }])
    control.setBeforeUpdate(({ coll }: any) => {
      if (coll === COLLECTIONS.rateLimit) throw new Error('write conflict') // 每次条件更新都失败→重试耗尽
    })
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      lines.push(String(a[0]))
    })
    const r = await withRateLimit('createOrder', { max: 5, windowMs: 60_000 }, async () => ({ ok: true }))({
      db: null,
      OPENID,
      event: {},
    } as any)
    expect(r).toEqual({ ok: true }) // best-effort：频控库故障不阻断主流程
    const cas = lines.filter((s) => s.includes('code=CAS_EXHAUSTED'))
    expect(cas.length).toBe(1)
    expect(cas[0]).toContain('fn:createOrder')
    expect(cas[0]).toMatch(/"keyHash":"[0-9a-f]{8}"/)
    expect(lines.join('\n')).not.toContain(OPENID)
  })
})
