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
  segmentId: string // 上次看到的段位（命中原课时才带·一路给播放器回到那一段）；退回首课时/无记录为空，播放器挑首个可播段
  resumeAt: number // 续播秒（0=不续秒·从头/挑段起播）：命中 last 段时透出 clampResumeAt(last.at,last.dur)，接通「续段又续秒」最后一公里（根因#15）
}

interface ProgressDoc {
  courseId?: string
  last?: { lessonId?: string; segmentId?: string; at?: number; dur?: number } // at/dur=上次播放位置/时长（秒·云端已存到秒·续播到秒消费）
  updatedAt?: number
}

/** 续播秒夹取（批3·数据已在库·接通最后一公里）：at<5→0（刚开头不值得续）；dur>0 且 at>dur-10→0
 *  （快看完不续·防续到片尾起播即 ended）；其余 Math.floor(at)。脏值（NaN/负）经 `||0` 归 0 后一律落 at<5 分支。
 *  单源（mapCatalog 命中 last 段分支复用·禁复制实现·病根#5）。 */
export function clampResumeAt(at: number, dur: number): number {
  const a = Number(at) || 0
  const d = Number(dur) || 0
  if (a < 5) return 0
  if (d > 0 && a > d - 10) return 0
  return Math.floor(a)
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
    const exact = lessonIn(course, String((p.last && p.last.lessonId) || ''))
    const lesson = exact || firstLesson(course) // 脏课时退回第一课时
    if (lesson) {
      // 命中原课时才带上次段位（回到那一段）；退回首课时时原段位也失效，置空让播放器挑首个可播段
      const segmentId = exact ? String((p.last && p.last.segmentId) || '') : ''
      // 命中原段才续秒（同段位口径）：退回首课时/无段位时 resumeAt=0，不把旧秒错落到别段（防续秒串段）
      const resumeAt = exact ? clampResumeAt(Number(p.last && p.last.at), Number(p.last && p.last.dur)) : 0
      return { courseId: course.id, courseTitle: String(course.title || ''), lessonId: lesson.id, lessonName: lesson.name, segmentId, resumeAt }
    }
  }

  // ② 无记录 → 最近解锁课的第一课时（开始学，而非演示）
  const mine = ((Array.isArray(myCourses) ? myCourses : []) as Array<{ courseId?: string; enteredAt?: number }>)
    .filter((m) => m && m.courseId)
    .sort((a, b) => (Number(b.enteredAt) || 0) - (Number(a.enteredAt) || 0))
  for (const m of mine) {
    const course = courseOf(String(m.courseId))
    if (!course) continue
    const lesson = firstLesson(course)
    if (lesson) return { courseId: course.id, courseTitle: String(course.title || ''), lessonId: lesson.id, lessonName: lesson.name, segmentId: '', resumeAt: 0 }
  }

  return null // 不假装有课
}
