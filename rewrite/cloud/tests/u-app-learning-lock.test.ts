// 锁现行为：getCourses 按 ids 取课的顺序/去缺档、getPlaybackUrl 跨章节找段、trackEvent 读失败时的折叠口径。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

const seg = (id: string, videoFileId = '') => ({ id, name: id, dur: '1:00', videoFileId })
const course = (id: string, chapters: any[]) => ({ _id: id, id, title: id, sort: 1, chapters })

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
})

describe('getCourses 带 ids', () => {
  it('按请求顺序回、缺档跳过', async () => {
    control.seed('courses', [course('c1', []), course('c2', []), course('c3', [])])
    const r = await call('getCourses', { ids: ['c3', 'ghost', 'c1'] })
    expect(r).toEqual({ ok: true, list: [
      { id: 'c3', title: 'c3', chapters: [] },
      { id: 'c1', title: 'c1', chapters: [] },
    ] })
    expect(await call('getCourses', { ids: [] })).toEqual({ ok: true, list: [] })
  })
})

describe('getPlaybackUrl 找段', () => {
  it('跨章、跨节命中后面的段；首个同名段优先', async () => {
    control.seed('courses', [
      course('c1', [
        { id: 'ch1', lessons: [{ id: 'l1', segments: [seg('s1')] }, { id: 'l2' }] },
        {
          id: 'ch2',
          lessons: [
            { id: 'l3', segments: [seg('s9', 'cloud://v/first.mp4')] },
            { id: 'l4', segments: [seg('s9', 'cloud://v/second.mp4')] },
          ],
        },
      ]),
    ])
    control.seed('activations', [{ _id: 'A1', _openid: 'oME', courseId: 'c1', enteredAt: 1 }])
    expect((await call('getPlaybackUrl', { courseId: 'c1', segmentId: 's9' })).url).toBe('https://tmp/cloud://v/first.mp4')
    expect((await call('getPlaybackUrl', { courseId: 'c1', segmentId: 's1' })).url).toBe(null)
    expect((await call('getPlaybackUrl', { courseId: 'c1', segmentId: 'nope' })).error).toBe('NO_SEGMENT')
  })
})

describe('trackEvent 进度折叠读失败', () => {
  const done = () => call('trackEvent', { type: 'segment_done', targetId: 's1', meta: { courseId: 'c1', lessonId: 'l1' } })
  // 只让 where 查询失败（doc(id).get 放行）：Query.get 钩子收不到 id
  const failOn = (target: string) =>
    control.setBeforeGet(({ coll, id }: any) => {
      if (coll === target && !id) throw new Error('MOCK_DB_FAIL')
    })

  it('鉴权读失败：不折叠、流水照记、回 ok', async () => {
    control.seed('activations', [{ _id: 'A1', _openid: 'oME', courseId: 'c1', enteredAt: 1 }])
    failOn('activations')
    expect(await done()).toEqual({ ok: true })
    expect(control.dump('progress')).toEqual([])
    expect(control.dump('events')).toHaveLength(1)
  })

  it('进度查询失败：落到确定性进度档（已有同档则并入）', async () => {
    control.seed('activations', [{ _id: 'A1', _openid: 'oME', courseId: 'c1', enteredAt: 1 }])
    control.seed('progress', [{ _id: 'oME__c1', _openid: 'oME', courseId: 'c1', done: { s0: true }, createdAt: 1 }])
    failOn('progress')
    expect(await done()).toEqual({ ok: true })
    const rows = control.dump('progress')
    expect(rows).toHaveLength(1)
    expect(rows[0].done).toEqual({ s0: true, s1: true })
    expect(rows[0].last.segmentId).toBe('s1')
  })
})
