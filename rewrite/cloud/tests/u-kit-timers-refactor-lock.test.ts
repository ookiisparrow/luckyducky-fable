// 行为锁：cleanupEvents 单路删失败隔离、throttle 首写建档（缺集合再建）、secureConfig 无 env 映射的字段不回退。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { getDb, throttleHit, throttleFail, getSecureConfig, getSecureConfigFields } from '../src/kit'
import { main as cleanupEvents } from '../src/functions/timers/cleanupEvents'
import { COLLECTIONS } from '@ldrw/shared'

beforeEach(() => {
  control.reset()
  vi.restoreAllMocks()
})

describe('cleanupEvents 单路删失败不连累其余', () => {
  it('大白话：events 删炸→该路标 null（失败≠删了 0 条），rateLimit/kfSeen 照删照计', async () => {
    control.setOpenId('')
    const OLD = Date.now() - 91 * 24 * 3600 * 1000
    control.seed('events', [{ _id: 'e-old', createdAt: OLD }])
    control.seed('rateLimit', [{ _id: 'r-old', updatedAt: OLD }])
    control.seed('kfState', [{ _id: 'seen:m-old', at: OLD }])
    control.setBeforeRemove(({ coll }: any) => {
      if (coll === 'events') throw new Error('boom')
    })
    const r: any = await cleanupEvents()
    expect(r).toMatchObject({ ok: true, removed: null, rateLimit: 1, kfSeen: 1, videoGc: 0, imageGc: 0 })
    expect(control.dump('events').length).toBe(1)
  })
})

describe('throttle 首写建档', () => {
  it('大白话：rateLimit 集合没建→首次调用照样建档计数（先 add、缺集合再建再写）', async () => {
    control.markUncreated(COLLECTIONS.rateLimit)
    expect(await throttleHit('k1', { max: 5, windowMs: 60_000 })).toBe(false)
    await throttleFail('k2', { max: 3, windowMs: 60_000, lockMs: 1000 })
    const recs = control.dump(COLLECTIONS.rateLimit)
    expect(recs.find((r: any) => r._id === 'rl_k1')).toMatchObject({ hits: 1 })
    expect(recs.find((r: any) => r._id === 'rl_k2')).toMatchObject({ fails: 1 })
  })

  it('大白话：集合已在→首写不再白调 createCollection', async () => {
    const spy = vi.spyOn(getDb(), 'createCollection')
    expect(await throttleHit('k1', { max: 5, windowMs: 60_000 })).toBe(false)
    expect(control.dump(COLLECTIONS.rateLimit)[0]).toMatchObject({ _id: 'rl_k1', hits: 1 })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('secureConfig 无 env 映射的字段不回退', () => {
  it('大白话：vod 字段没有环境变量史→库里空就是空，不会误读名叫 undefined 的环境变量', async () => {
    process.env['undefined'] = 'leak'
    try {
      expect(await getSecureConfigFields(getDb(), 'vod', ['playKey'])).toEqual({ playKey: '' })
      expect(await getSecureConfig(getDb(), 'vod', 'playKey')).toBe('')
    } finally {
      delete process.env['undefined']
    }
  })
})
