import { describe, it, expect } from 'vitest'
import { COURSES, COURSE, ALL_LESSONS, SAMPLE_PROGRESS } from '@/data/course.js'
import { parseDur } from '@/utils/format.js'

// 课程三层结构契约（规格 v2 §三）：页面与云端种子都依赖这个形状，
// 改 data/course.js 时由本用例锁住不被破坏。
describe('course 三层课程数据契约', () => {
  it('COURSES：多课数组，课有 id/title/chapters', () => {
    expect(Array.isArray(COURSES)).toBe(true)
    expect(COURSES.length).toBeGreaterThan(0)
    for (const c of COURSES) {
      expect(c.id).toBeTruthy()
      expect(c.title).toBeTruthy()
      expect(Array.isArray(c.chapters)).toBe(true)
      expect(c.chapters.length).toBeGreaterThan(0)
    }
  })

  it('三层完整：chapter → lessons → segments，segment 字段齐全', () => {
    for (const course of COURSES) {
      for (const ch of course.chapters) {
        expect(ch.id).toBeTruthy()
        expect(ch.lessons.length).toBeGreaterThan(0)
        for (const l of ch.lessons) {
          expect(l.id).toBeTruthy()
          expect(l.name).toBeTruthy()
          expect(l.segments.length).toBeGreaterThan(0)
          for (const s of l.segments) {
            expect(s.id).toBeTruthy()
            expect(s.name).toBeTruthy()
            expect(parseDur(s.dur)).toBeGreaterThan(0)
            expect(s).toHaveProperty('videoFileId') // 占位期为 null，但字段必须在
            expect(typeof s.free).toBe('boolean')
          }
        }
      }
    }
  })

  it('segment 时长之和 = 课时时长（等分 + 余数并入最后一段）', () => {
    for (const l of ALL_LESSONS) {
      const sum = l.segments.reduce((acc, s) => acc + parseDur(s.dur), 0)
      expect(sum).toBe(parseDur(l.dur))
    }
  })

  it('id 全局唯一（lesson 与 segment 各自不重）', () => {
    const lids = ALL_LESSONS.map((l) => l.id)
    expect(new Set(lids).size).toBe(lids.length)
    const sids = ALL_LESSONS.flatMap((l) => l.segments.map((s) => s.id))
    expect(new Set(sids).size).toBe(sids.length)
  })

  it('ALL_LESSONS 拍平与 COURSE 一致，并带 chapter 归属', () => {
    const expectTotal = COURSE.chapters.reduce((n, c) => n + c.lessons.length, 0)
    expect(ALL_LESSONS.length).toBe(expectTotal)
    const chapterIds = new Set(COURSE.chapters.map((c) => c.id))
    for (const l of ALL_LESSONS) expect(chapterIds.has(l.chapter)).toBe(true)
  })

  it('进度是用户态：课程内容里不携带 done/watched，样例进度的 id 真实存在', () => {
    for (const l of ALL_LESSONS) {
      expect(l).not.toHaveProperty('done')
      expect(l).not.toHaveProperty('watched')
    }
    const lids = new Set(ALL_LESSONS.map((l) => l.id))
    for (const id of Object.keys(SAMPLE_PROGRESS)) expect(lids.has(id)).toBe(true)
  })
})
