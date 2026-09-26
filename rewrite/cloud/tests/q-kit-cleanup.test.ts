// 日清理：批量删失败 / 孤儿 GC 读失败不能折成「删了 0 条」静默过去（失败时集合或孤儿文件会无界增长）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as cleanupEvents } from '../src/functions/timers/cleanupEvents'
import { COLLECTIONS } from '@ldrw/shared'

const OLD = Date.now() - 91 * 24 * 3600 * 1000

beforeEach(() => {
  control.reset()
  control.setOpenId('')
})
afterEach(() => vi.restoreAllMocks())

function captureAlerts(): string[] {
  const lines: string[] = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    lines.push(String(a[0]))
  })
  return lines
}

describe('cleanupEvents 删失败要告警', () => {
  it('大白话：events 删炸→告警 + 落异常账本，回包该路标 null（不是 0），其余路照删', async () => {
    control.seed('events', [{ _id: 'e-old', createdAt: OLD }])
    control.seed('rateLimit', [{ _id: 'r-old', updatedAt: OLD }])
    control.setBeforeRemove(({ coll }: any) => {
      if (coll === 'events') throw new Error('boom')
    })
    const lines = captureAlerts()
    const r: any = await cleanupEvents()
    expect(r).toMatchObject({ ok: true, removed: null, rateLimit: 1 })
    const alerts = lines.filter((s) => s.includes('code=CLEANUP_REMOVE_FAIL'))
    expect(alerts.length).toBe(1)
    expect(alerts[0]).toContain('"coll":"events"')
    expect(control.dump(COLLECTIONS.anomalies).some((a: any) => a.code === 'CLEANUP_REMOVE_FAIL')).toBe(true)
  })

  it('大白话：集合还没建（从没写过）→真没有可删的，计 0、不告警', async () => {
    control.setBeforeRemove(({ coll }: any) => {
      if (coll === 'kfState') throw new Error('DATABASE_COLLECTION_NOT_EXIST: kfState')
    })
    const lines = captureAlerts()
    const r: any = await cleanupEvents()
    expect(r).toMatchObject({ ok: true, kfSeen: 0 })
    expect(lines.some((s) => s.includes('CLEANUP_REMOVE_FAIL'))).toBe(false)
  })

  it('大白话：courses 读炸→告警，videoGc 标 null（不是「删了 0 个」），孤儿视频堆积有人知道', async () => {
    control.setBeforeGet(({ coll }: any) => {
      if (coll === 'courses') throw new Error('boom')
    })
    const lines = captureAlerts()
    const r: any = await cleanupEvents()
    expect(r).toMatchObject({ ok: true, videoGc: null, imageGc: 0 })
    const alerts = lines.filter((s) => s.includes('code=CLEANUP_GC_READ_FAIL'))
    expect(alerts.length).toBe(1)
    expect(alerts[0]).toContain('"coll":"courses"')
  })

  it('大白话：productsDraft 还没建→没有待删图，计 0、不告警', async () => {
    control.setBeforeGet(({ coll }: any) => {
      if (coll === 'productsDraft') throw new Error('DATABASE_COLLECTION_NOT_EXIST: productsDraft')
    })
    const lines = captureAlerts()
    const r: any = await cleanupEvents()
    expect(r).toMatchObject({ ok: true, imageGc: 0 })
    expect(lines.some((s) => s.includes('CLEANUP_GC_READ_FAIL'))).toBe(false)
  })
})
