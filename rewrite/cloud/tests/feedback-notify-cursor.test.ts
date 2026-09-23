// feedbackNotify 游标：只代表「已经纳入通知的最后一条」的提交时间。
// 读失败、空页、单轮打满上限时，不得把 lastScanAt 写成当前时间——否则下轮会跳过从没提醒过的意见。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as feedbackNotify } from '../src/functions/timers/feedbackNotify'

const CURSOR = COLLECTIONS.feedbackNotifyCursor
const FB = COLLECTIONS.feedback

function cursorAt(): number | undefined {
  const state = control.dump(CURSOR).find((d: { _id?: string }) => d._id === 'state') as { lastScanAt?: number } | undefined
  return state && state.lastScanAt
}

beforeEach(() => {
  control.reset()
  control.setOpenId('')
})
afterEach(() => {
  control.setBeforeGet(null as never)
})

describe('feedbackNotify 游标不越过没处理的意见', () => {
  it('大白话：意见箱这一轮没读到（库挂了）——游标停在原地，不把现在标成已扫过', async () => {
    const mark = Date.now() - 30_000
    control.seed(CURSOR, [{ _id: 'state', lastScanAt: mark }])
    control.seed(FB, [{ _id: 'f1', category: 'bug', content: '还没被看到', createdAt: mark + 1000 }])
    control.setBeforeGet(async ({ coll }: { coll: string }) => {
      if (coll === FB) throw new Error('READ_FAIL')
    })
    const seen: string[] = []
    const orig = console.error
    console.error = (...a: unknown[]) => {
      seen.push(String(a[0]))
    }
    let r: any
    try {
      r = await feedbackNotify()
    } finally {
      console.error = orig
    }
    expect(r.ok).toBe(true)
    expect(r.cursorAdvanced).toBe(false)
    expect(r.newFeedback).toBe(0)
    expect(cursorAt()).toBe(mark)
    expect(seen.some((l) => l.includes('SCAN_FAILED'))).toBe(true)
    expect(seen.some((l) => l.includes('NEW_FEEDBACK'))).toBe(false)

    control.setBeforeGet(null as never)
    const again: any = await feedbackNotify()
    expect(again.newFeedback).toBe(1)
    expect(cursorAt()).toBe(mark + 1000)
  })

  it('大白话：这一轮一条新意见都没有——游标不动，空隙里刚写上的下轮还能被提醒', async () => {
    const mark = Date.now() - 30_000
    control.seed(CURSOR, [{ _id: 'state', lastScanAt: mark }])
    const r: any = await feedbackNotify()
    expect(r.newFeedback).toBe(0)
    expect(r.cursorAdvanced).toBe(false)
    expect(cursorAt()).toBe(mark)

    control.seed(FB, [{ _id: 'late', category: 'idea', content: '刚写上', createdAt: mark + 1000 }])
    const again: any = await feedbackNotify()
    expect(again.newFeedback).toBe(1)
    expect(again.cursorAdvanced).toBe(true)
    expect(cursorAt()).toBe(mark + 1000)
  })

  it('大白话：一轮扫满上限——游标只停在已通知的最后一条，后面的没被跳过', async () => {
    const base = Date.now() - 120_000
    control.seed(CURSOR, [{ _id: 'state', lastScanAt: base }])
    const docs = Array.from({ length: 101 }, (_, i) => ({
      _id: 'f' + i,
      category: 'bug',
      content: '条' + i,
      createdAt: base + (i + 1) * 1000,
    }))
    control.seed(FB, docs)
    const r: any = await feedbackNotify()
    expect(r.newFeedback).toBe(100)
    expect(r.capped).toBe(true)
    expect(r.cursorAdvanced).toBe(true)
    expect(cursorAt()).toBe(docs[99].createdAt)
    expect(cursorAt()!).toBeLessThan(docs[100].createdAt)

    const again: any = await feedbackNotify()
    expect(again.newFeedback).toBe(1)
    expect(again.capped).toBe(false)
    expect(cursorAt()).toBe(docs[100].createdAt)
  })

  it('大白话：没满上限且已经提醒——游标停在最后一条的提交时间，不是停在此刻；同一批下轮不再报', async () => {
    const t0 = Date.now() - 5_000
    const t1 = Date.now() - 4_000
    control.seed(FB, [
      { _id: 'a', category: 'bug', content: '甲', createdAt: t0 },
      { _id: 'b', category: 'idea', content: '乙', createdAt: t1 },
    ])
    const seen: string[] = []
    const orig = console.error
    console.error = (...a: unknown[]) => {
      seen.push(String(a[0]))
    }
    let r: any
    try {
      r = await feedbackNotify()
    } finally {
      console.error = orig
    }
    expect(r.newFeedback).toBe(2)
    expect(r.cursorAdvanced).toBe(true)
    expect(r.capped).toBe(false)
    expect(cursorAt()).toBe(t1)
    expect(seen.some((l) => l.includes('NEW_FEEDBACK'))).toBe(true)

    const again: any = await feedbackNotify()
    expect(again.newFeedback).toBe(0)
    expect(again.cursorAdvanced).toBe(false)
    expect(cursorAt()).toBe(t1)
  })

  it('大白话：顾客自己调这个定时器——直接跳过，游标不动', async () => {
    control.setOpenId('user')
    const mark = Date.now() - 30_000
    control.seed(CURSOR, [{ _id: 'state', lastScanAt: mark }])
    control.seed(FB, [{ _id: 'f1', category: 'bug', content: '不该被客户端扫', createdAt: mark + 1000 }])
    const r: any = await feedbackNotify()
    expect(r.skipped).toBe(true)
    expect(cursorAt()).toBe(mark)
  })
})
