// 锁住课程种子产物的形状：cloud ops/seedCourses 原样写库，多出/少掉字段都会进库。
import { describe, it, expect } from 'vitest'
import { SEED_COURSES } from '../src/seed/course'

const secs = (d: string) => {
  const [m, s] = d.split(':').map(Number)
  return m * 60 + s
}

describe('SEED_COURSES 产物形状', () => {
  it('章节只有 id/title/lessons，课时只有 id/name/dur/segments（键序也不变）', () => {
    const chapters = SEED_COURSES.flatMap((c) => c.chapters)
    expect(chapters.length).toBe(4)
    for (const ch of chapters) {
      expect(Object.keys(ch)).toEqual(['id', 'title', 'lessons'])
      for (const l of ch.lessons) {
        expect(Object.keys(l)).toEqual(['id', 'name', 'dur', 'segments'])
        expect(l.segments.map((s) => s.id)).toEqual([1, 2, 3, 4, 5].map((i) => `${l.id}-s${i}`))
        expect(l.segments.reduce((t, s) => t + secs(s.dur), 0)).toBe(secs(l.dur))
      }
    }
    expect(chapters[0].lessons[0]).toMatchObject({ id: 'l1', name: '认识你的钩织工具包', dur: '03:20' })
  })
})
