/**
 * 课程数据 · 三层结构（规格 v2 §三）。canonical 种子在 @luckyducky/shared（单一来源，根因账本 #5），
 * 本文件只把它派生成页面/契约测试用的便捷视图 + 用户态样例进度。cloud seedCourses 与本文件同源，
 * 改课程内容只改 shared 一处。页面已改经 store/courses.js 取数，不直接 import 这里。
 */
import { SEED_COURSES } from '@luckyducky/shared'

// 多课数组（内容身份；id 与云端 _id 一致）
export const COURSES = SEED_COURSES

// 单课快捷导出（契约测试用）
export const COURSE = COURSES[0]

// 拍平成一维课时表，并补 chapter 归属（契约测试用；页面用 store 的 allLessons）
export const ALL_LESSONS = COURSE.chapters.flatMap((c) =>
  c.lessons.map((l) => ({ ...l, chapter: c.id }))
)

// 用户学习进度 · 样例（用户态，不属于课程内容，云端不存这份）
// done = 已学完；watched = 0~1 观看进度
export const SAMPLE_PROGRESS = {
  l1: { done: true },
  l2: { done: true },
  l3: { watched: 0.42 },
}
