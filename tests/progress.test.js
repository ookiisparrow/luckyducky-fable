import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProgressStore } from '@/store/progress.js'
import { track } from '@/utils/track.js'
import { ALL_LESSONS, SAMPLE_PROGRESS } from '@/data/course.js'

const L1 = ALL_LESSONS.find((l) => l.id === 'l1')
const L2 = ALL_LESSONS.find((l) => l.id === 'l2')
const segIds = L1.segments.map((s) => s.id)

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  delete globalThis.wx
})

describe('utils/track（埋点出口）', () => {
  it('无 wx（H5 / 测试环境）：空操作不抛错', () => {
    expect(() => track('segment_done', { targetId: 'x' })).not.toThrow()
    expect(() => track('')).not.toThrow()
  })

  it('有 wx：fire-and-forget 上报 trackEvent，字段原样收口', async () => {
    const calls = []
    globalThis.wx = {
      cloud: {
        callFunction: async (p) => {
          calls.push(p)
          return { result: { ok: true } }
        },
      },
    }
    track('segment_done', { page: 'player', targetId: 'l1-s1', meta: { courseId: 'c' } })
    await new Promise((r) => setTimeout(r, 0))
    expect(calls[0].name).toBe('trackEvent')
    expect(calls[0].data).toEqual({
      type: 'segment_done',
      page: 'player',
      targetId: 'l1-s1',
      meta: { courseId: 'c' },
    })
  })
})

describe('progress store（云端 segment 粒度 → 页面 lesson 级形状）', () => {
  const mockCloud = (list) => {
    globalThis.wx = {
      cloud: { callFunction: async () => ({ result: { ok: true, list } }) },
    }
  }

  it('无云（H5 / 未登录）：lesson 级回退样例，lastWatch 为 null', () => {
    const s = useProgressStore()
    expect(s.ofLesson('course-duck', L1)).toEqual(SAMPLE_PROGRESS.l1)
    expect(s.lastWatch).toBe(null)
  })

  it('云端有数据但该课无记录：{}（不再回退样例，新用户无进度是事实）', async () => {
    mockCloud([])
    const s = useProgressStore()
    await s.load()
    expect(s.remote).toBe(true)
    expect(s.ofLesson('course-duck', L1)).toEqual({})
  })

  it('全部段看完 → done:true；部分段 → watched 比例', async () => {
    const doneAll = {}
    segIds.forEach((id) => {
      doneAll[id] = true
    })
    mockCloud([{ courseId: 'course-duck', done: doneAll, last: {}, updatedAt: 1 }])
    const s = useProgressStore()
    await s.load()
    expect(s.ofLesson('course-duck', L1)).toEqual({ done: true })

    const doneTwo = {}
    segIds.slice(0, 2).forEach((id) => {
      doneTwo[id] = true
    })
    s.byCourse['course-duck'] = { done: doneTwo, last: {}, updatedAt: 1 }
    expect(s.ofLesson('course-duck', L1)).toEqual({ watched: 2 / segIds.length })
  })

  it('整段没看完但「最后看到」停在这节 → 按 at/dur 给进行中；别的节 → {}', async () => {
    mockCloud([
      {
        courseId: 'course-duck',
        done: {},
        last: { lessonId: 'l1', segmentId: 'l1-s1', at: 60, dur: 120 },
        updatedAt: 1,
      },
    ])
    const s = useProgressStore()
    await s.load()
    expect(s.ofLesson('course-duck', L1)).toEqual({ watched: 0.5 })
    expect(s.ofLesson('course-duck', L2)).toEqual({})
  })

  it('lastWatch 取最近更新那门课的观看点（喂「我」页继续学习卡）', async () => {
    mockCloud([
      { courseId: 'A', done: {}, last: { lessonId: 'l1', segmentId: 'l1-s1', at: 1, dur: 9 }, updatedAt: 100 },
      { courseId: 'B', done: {}, last: { lessonId: 'l2', segmentId: 'l2-s1', at: 2, dur: 9 }, updatedAt: 200 },
    ])
    const s = useProgressStore()
    await s.load()
    expect(s.lastWatch.courseId).toBe('B')
    expect(s.lastWatch.lessonId).toBe('l2')
  })
})
