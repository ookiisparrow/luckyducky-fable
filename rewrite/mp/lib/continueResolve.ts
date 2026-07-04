// 「继续学习」定位（纯函数·黄金 learning-content §四）（守卫 rw-mp-me-golden）：
// 按观看记录自己的课程定位——绝不回退默认课（防「进小程序显演示课」错乱）；
// 无记录但有已解锁课 → 最近解锁那门的第一课时；记录里课时已不在 → 退回该课第一课时；
// 无记录且无解锁课/课程查不到 → null（卡片走兜底，不假装有课）。
import type { CoursePub } from './player'

export interface ContinueTarget {
  courseId: string
  courseTitle: string
  lessonId: string
  lessonName: string
}

interface ProgressDoc {
  courseId?: string
  last?: { lessonId?: string; segmentId?: string }
  updatedAt?: number
}

function firstLesson(course: CoursePub): { id: string; name: string } | null {
  for (const ch of Array.isArray(course.chapters) ? course.chapters : []) {
    for (const l of ch && Array.isArray(ch.lessons) ? ch.lessons : []) {
      if (l && l.id) return { id: String(l.id), name: String(l.name || '') }
    }
  }
  return null
}

function lessonIn(course: CoursePub, lessonId: string): { id: string; name: string } | null {
  if (!lessonId) return null
  for (const ch of Array.isArray(course.chapters) ? course.chapters : []) {
    for (const l of ch && Array.isArray(ch.lessons) ? ch.lessons : []) {
      if (l && String(l.id) === lessonId) return { id: String(l.id), name: String(l.name || '') }
    }
  }
  return null
}

export function continueResolve(progress: unknown, myCourses: unknown, courses: unknown): ContinueTarget | null {
  const courseList = (Array.isArray(courses) ? courses : []) as CoursePub[]
  const courseOf = (id: string) => courseList.find((c) => c && String(c.id) === id) || null

  // ① 最近观看记录定位（按 updatedAt 取最近；courseId 查不到课就看下一条，不串课）
  const plist = ((Array.isArray(progress) ? progress : []) as ProgressDoc[])
    .filter((p) => p && p.courseId)
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
  for (const p of plist) {
    const course = courseOf(String(p.courseId))
    if (!course) continue // 课程查不到：不假装、看下一条
    const lesson = lessonIn(course, String((p.last && p.last.lessonId) || '')) || firstLesson(course) // 脏课时退回第一课时
    if (lesson) return { courseId: course.id, courseTitle: String(course.title || ''), lessonId: lesson.id, lessonName: lesson.name }
  }

  // ② 无记录 → 最近解锁课的第一课时（开始学，而非演示）
  const mine = ((Array.isArray(myCourses) ? myCourses : []) as Array<{ courseId?: string; enteredAt?: number }>)
    .filter((m) => m && m.courseId)
    .sort((a, b) => (Number(b.enteredAt) || 0) - (Number(a.enteredAt) || 0))
  for (const m of mine) {
    const course = courseOf(String(m.courseId))
    if (!course) continue
    const lesson = firstLesson(course)
    if (lesson) return { courseId: course.id, courseTitle: String(course.title || ''), lessonId: lesson.id, lessonName: lesson.name }
  }

  return null // 不假装有课
}
