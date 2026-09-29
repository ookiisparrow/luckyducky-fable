// 锁 mapCatalog / continueResolve 在现有用例没走到的分支上的输出（降复杂度拆函数前后必须逐字一致）。
import { describe, it, expect } from 'vitest'
import { mapCatalog } from '../lib/mapLearning'
import { continueResolve } from '../lib/continueResolve'

describe('mapCatalog 未覆盖分支锁定', () => {
  const COURSE = {
    chapters: [
      null,
      {
        lessons: [
          { name: '无 id 课时被跳过且不占编号', segments: [{ id: 'sx', hasVideo: true }] },
          { id: 'l1', segments: [{ id: 's1', hasVideo: false, dur: '0:30' }, { hasVideo: true }] },
        ],
      },
      { title: '第二章', lessons: [{ id: 'l2', name: '收针', segments: [{ id: 's2', hasVideo: true, dur: '90' }, { id: 's3', hasVideo: true, dur: -5 }] }] },
    ],
  }

  it('多条进度只取本课 updatedAt 最大者；别课、空行、旧条目都不参与', () => {
    const r = mapCatalog(
      COURSE,
      [
        null,
        { courseId: 'other', last: { lessonId: 'l1', segmentId: 's1' }, updatedAt: 999 },
        { courseId: 'c1', done: { s1: true }, last: { lessonId: 'l1', segmentId: 's1' }, updatedAt: 50 },
        { courseId: 'c1', done: { s2: true }, last: { lessonId: 'l2', segmentId: 's3', at: 30, dur: 100 }, updatedAt: 100 },
        { courseId: 'c1', done: {}, last: { lessonId: 'l1' }, updatedAt: 80 },
      ],
      'c1'
    )
    expect(r).toEqual({
      chapters: [
        { title: '', lessonCount: 1, lessons: [
          { lessonId: 'l1', no: '01', name: '', segCount: 1, minutes: 1, status: 'todo', lastLabel: '', firstPlayableSegId: '' },
        ] },
        { title: '第二章', lessonCount: 1, lessons: [
          { lessonId: 'l2', no: '02', name: '收针', segCount: 2, minutes: 2, status: 'current', lastLabel: '上次学到 段落 2', firstPlayableSegId: 's3' },
        ] },
      ],
      continueTarget: { segmentId: 's3', lessonId: 'l2', lessonName: '收针', resumeAt: 30 },
      resumeLabel: '继续第 2 课 · 段落 2',
    })
  })

  it('全完成且无 last → 无 current，续播落全课首个可播段（跳过无视频课时）', () => {
    const r = mapCatalog(COURSE, [{ courseId: 'c1', done: { s1: true, s2: true, s3: true }, updatedAt: 1 }], 'c1')
    expect(r.chapters.flatMap((c) => c.lessons.map((l) => l.status))).toEqual(['done', 'done'])
    expect(r.continueTarget).toEqual({ segmentId: 's2', lessonId: 'l2', lessonName: '收针', resumeAt: 0 })
  })

  it('全课无可播段 → continueTarget 为 null', () => {
    const dead = { chapters: [{ lessons: [{ id: 'z', segments: [{ id: 'y', hasVideo: false }] }] }] }
    expect(mapCatalog(dead, [], 'c1').continueTarget).toBeNull()
  })
})

describe('continueResolve 未覆盖分支锁定', () => {
  const COURSES = [
    { id: 'empty', title: '空课', chapters: [{ lessons: [] }] },
    { id: 'c1', title: '小棉鸭', chapters: [{ lessons: [{ id: 'l1', name: '起针', segments: [{ id: 's1', hasVideo: true }] }] }] },
  ]

  it('最近记录的课一个课时都没有 → 看下一条记录', () => {
    const r = continueResolve(
      [
        { courseId: 'empty', last: { lessonId: 'x', segmentId: 'y' }, updatedAt: 9 },
        { courseId: 'c1', last: { lessonId: 'l1', segmentId: 's1', at: 20, dur: 100 }, updatedAt: 1 },
      ],
      [],
      COURSES
    )
    expect(r).toEqual({ courseId: 'c1', courseTitle: '小棉鸭', lessonId: 'l1', lessonName: '起针', segmentId: 's1', resumeAt: 20 })
  })

  it('命中课时但记录没带段位 → 段位留空、不续秒（不能退到首个可播段）', () => {
    const r = continueResolve([{ courseId: 'c1', last: { lessonId: 'l1', at: 50, dur: 100 }, updatedAt: 1 }], [], COURSES)
    expect(r).toEqual({ courseId: 'c1', courseTitle: '小棉鸭', lessonId: 'l1', lessonName: '起针', segmentId: '', resumeAt: 0 })
  })

  it('记录全无效、解锁课也是空课 → 跳过空课取下一门', () => {
    const r = continueResolve([{ courseId: 'empty', updatedAt: 1 }], [{ courseId: 'empty', enteredAt: 9 }, { courseId: 'c1', enteredAt: 1 }], COURSES)
    expect(r).toEqual({ courseId: 'c1', courseTitle: '小棉鸭', lessonId: 'l1', lessonName: '起针', segmentId: '', resumeAt: 0 })
  })
})
