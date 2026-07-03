import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProgressStore } from '@/store/progress.js'
import { track } from '@/utils/track.js'
import { ALL_LESSONS } from '@/data/course.js'

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

  it('云未就绪（mp 端 fail-closed·测试=mp 路径 DEMO_FALLBACK=false）：不回退演示进度→空进度 + lastWatch null（审计 P2-5）', () => {
    const s = useProgressStore()
    // mp 端云为唯一源·失败不显演示「已学完/观看中」误导继续学习；H5/App 的演示回退是编译期分支、vitest 测不到
    expect(s.ofLesson('course-duck', L1)).toEqual({})
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

  it('整段没看完但「最后看到」停在这节 → 段内比例按段数折算成节级（深审 P3 口径：at/dur 是段内进度、不能当整节比例）；别的节 → {}', async () => {
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
    // 5 段中第 1 段看到一半 = 整节 0.5/5，不是 0.5（原口径把段内 50% 当节级 50% 虚高）
    expect(s.ofLesson('course-duck', L1)).toEqual({ watched: 0.5 / segIds.length })
    expect(s.ofLesson('course-duck', L2)).toEqual({})
  })

  it('已看完 n 段 + 停在第 n+1 段中途 → watched=(n+段内比例)/段数；停在已看完的段不重复计', async () => {
    const doneTwo = {}
    segIds.slice(0, 2).forEach((id) => {
      doneTwo[id] = true
    })
    mockCloud([
      {
        courseId: 'course-duck',
        done: doneTwo,
        last: { lessonId: 'l1', segmentId: segIds[2], at: 30, dur: 60 },
        updatedAt: 1,
      },
    ])
    const s = useProgressStore()
    await s.load()
    expect(s.ofLesson('course-duck', L1)).toEqual({ watched: (2 + 0.5) / segIds.length })
    // 「最后看到」停在已 done 的段 → 不加部分观看（防重复计入超过实际）
    s.byCourse['course-duck'] = {
      done: doneTwo,
      last: { lessonId: 'l1', segmentId: segIds[0], at: 30, dur: 60 },
      updatedAt: 1,
    }
    expect(s.ofLesson('course-duck', L1)).toEqual({ watched: 2 / segIds.length })
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
