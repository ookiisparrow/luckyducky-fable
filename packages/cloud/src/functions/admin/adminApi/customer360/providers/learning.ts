import type { CustomerPanelProvider } from '../types'

// 学习位置板块（B2.1·后台360工作站·铁律三 provider 模式）：坐席查某客人每门课学到哪——章/节/段/完成度
// 人话化，精准指导钩织学习求助。数据＝progress（trackEvent 折叠的「每用户每课一条」·last 末位置 + done
// 段完成集）join courses（取章标题/节名/段名）。
//
// bounded（防大客户 360 拖垮·capacity·根因#7）：progress 本人每课一条、远不及上界，courses 数门、显式上界——
// 两读均带 .limit()，不裸 .get()（CloudBase 默认 100 静默截断）。与 getMyProgress（C 端返本人原始 progress）
// 是同 progress 集合不同形状（这里 join 课程结构人话化给坐席），单源同一集合、不抽公共件（Rule of Three 未到·CLAUDE §7）。
const PROGRESS_LIMIT = 200
const COURSE_LIMIT = 100

// 在课程三层结构（chapter→lesson→segment）里按 lessonId/segmentId 定位人话名；找不到回退空串（不崩）。
function locate(course: any, lessonId: string, segmentId: string) {
  for (const ch of (course && course.chapters) || []) {
    for (const ls of ch.lessons || []) {
      if (ls.id === lessonId) {
        const seg = (ls.segments || []).find((s: any) => s.id === segmentId)
        return { chapterTitle: ch.title || '', lessonName: ls.name || '', segmentName: (seg && seg.name) || '' }
      }
    }
  }
  return { chapterTitle: '', lessonName: '', segmentName: '' }
}

// 一门课总段数（完成度分母）
function totalSegments(course: any): number {
  let n = 0
  for (const ch of (course && course.chapters) || [])
    for (const ls of ch.lessons || []) n += (ls.segments || []).length
  return n
}

export const learningProvider: CustomerPanelProvider = {
  key: 'learning',
  label: '学习位置',
  enabled: true,
  order: 30,
  async fetch(db: any, openid: string) {
    const pr = await db
      .collection('progress')
      .where({ _openid: openid })
      .limit(PROGRESS_LIMIT)
      .get()
      .catch(() => ({ data: [] }))
    const progress: any[] = (pr && pr.data) || []
    if (!progress.length) return { count: 0, capped: false, positions: [] }
    // join courses（数门·全量 bounded·建 id→course 映射）
    const cr = await db.collection('courses').limit(COURSE_LIMIT).get().catch(() => ({ data: [] }))
    const courseById: Record<string, any> = {}
    for (const c of (cr && cr.data) || []) courseById[c.id || c._id] = c
    const positions = progress.map((p: any) => {
      const course = courseById[p.courseId] || null
      const last = p.last || {}
      const where = locate(course, last.lessonId, last.segmentId)
      const total = course ? totalSegments(course) : 0
      const doneCount = p.done ? Object.values(p.done).filter(Boolean).length : 0
      return {
        courseId: p.courseId,
        courseTitle: (course && course.title) || p.courseId,
        chapterTitle: where.chapterTitle,
        lessonName: where.lessonName,
        segmentName: where.segmentName,
        atSec: Number(last.at) || 0,
        doneCount,
        totalSegments: total,
        percent: total ? Math.round((doneCount / total) * 100) : 0, // structure-ok 完成度百分比·非金额元分换算
        updatedAt: p.updatedAt || p.createdAt || null,
      }
    })
    return { count: positions.length, capped: progress.length >= PROGRESS_LIMIT, positions }
  },
}
