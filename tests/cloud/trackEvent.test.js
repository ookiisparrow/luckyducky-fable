import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/learning/trackEvent'

// trackEvent（learning 域）：events 流水 + progress 折叠（一次埋点两用，规格 §七）。
beforeEach(() => {
  control.reset()
  control.setOpenId('u1')
})

describe('trackEvent', () => {
  it('NO_OPENID / NO_TYPE / META_TOO_BIG', async () => {
    control.setOpenId('')
    expect((await main({ type: 'x' })).error).toBe('NO_OPENID')
    control.setOpenId('u1')
    expect((await main({})).error).toBe('NO_TYPE')
    expect((await main({ type: 'x', meta: { big: 'y'.repeat(1100) } })).error).toBe('META_TOO_BIG')
  })

  it('普通事件只写 events 流水，不折叠进度', async () => {
    await main({ type: 'view', page: 'home', targetId: 'prod-1' })
    expect(control.dump('events')).toHaveLength(1)
    expect(control.dump('progress')).toHaveLength(0)
  })

  it('segment_done 折叠进 progress（每用户每课一条；done 标记 + last 位置）', async () => {
    await main({
      type: 'segment_done',
      targetId: 'l1-s1',
      meta: { courseId: 'course-duck', lessonId: 'l1', at: 40, dur: 40 },
    })
    const p = control.dump('progress')
    expect(p).toHaveLength(1)
    expect(p[0].done['l1-s1']).toBe(true)
    expect(p[0].last.lessonId).toBe('l1')

    // 第二段折叠进同一条（不新建文档）
    await main({
      type: 'segment_done',
      targetId: 'l1-s2',
      meta: { courseId: 'course-duck', lessonId: 'l1', at: 80, dur: 40 },
    })
    const p2 = control.dump('progress')
    expect(p2).toHaveLength(1) // 仍一条
    expect(p2[0].done['l1-s1']).toBe(true)
    expect(p2[0].done['l1-s2']).toBe(true)
  })
})
