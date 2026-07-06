// 学习域映射（纯函数·黄金 learning-content §一激活三态 + §九内容回退）（守卫 rw-mp-learning-golden）。
import { dateTime } from './mapOrders'

/** 激活结果四态：activated 新激活（恭喜屏）/ mine 本人已进课（欢迎回来屏）/ taken 他人码（已被使用屏）/ invalid 废码。 */
export type ActivationKind = 'activated' | 'mine' | 'taken' | 'invalid'

export interface ActivationView {
  kind: ActivationKind
  courseId: string
}

export function activationView(r: unknown): ActivationView {
  const res = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  const courseId = String(res.courseId || '')
  if (res.ok === true && (res.state === 'activated' || res.state === 'mine')) return { kind: res.state, courseId }
  if (res.ok === false && String(res.error || '') === 'CODE_TAKEN') return { kind: 'taken', courseId } // 带 courseId·按课取图
  return { kind: 'invalid', courseId: '' } // INVALID_CODE/未知错误一律废码态（fail-closed 不冒充激活）
}

/** 激活屏背景回退链（黄金 §九：配置缺哪级回退哪级·不裂图）：
 *  按课程图（welcome/welcomeBack/taken）→ 全局 activationBg → 空串（模板落纯色底）。 */
export function bgFor(home: unknown, courseId: string, kind: ActivationKind): string {
  const h = (home && typeof home === 'object' ? home : {}) as Record<string, any>
  const slot = kind === 'mine' ? 'welcomeBack' : kind === 'taken' ? 'taken' : 'welcome'
  const byCourse = h.activationBgByCourse && typeof h.activationBgByCourse === 'object' ? h.activationBgByCourse[courseId] : null
  const hit = byCourse && typeof byCourse === 'object' ? byCourse[slot] : ''
  return String(hit || h.activationBg || '')
}

export interface MyCourseVM {
  courseId: string
  title: string
  enteredAtLabel: string
  doneCount: number // 已看完段数（done 命中且属本课的段·交集）
  totalSegments: number // 本课总段数（跨章跨课时累加）
  percent: number // 学习进度百分比（0–100·四舍五入·不除零）
}

/** 收集一门课的全部段 id（跨 chapters→lessons→segments·脏结构安全）。 */
function segmentIdsOf(course: unknown): Set<string> {
  const ids = new Set<string>()
  const c = (course && typeof course === 'object' ? course : {}) as Record<string, any>
  for (const ch of Array.isArray(c.chapters) ? c.chapters : []) {
    for (const l of Array.isArray(ch?.lessons) ? ch.lessons : []) {
      for (const sg of Array.isArray(l?.segments) ? l.segments : []) {
        if (sg && sg.id) ids.add(String(sg.id))
      }
    }
  }
  return ids
}

/**
 * 我的课程 join 课程标题 + 学习进度（无题回 courseId 不崩·脏行剔除）。
 * 进度=段粒度（done 键=segmentId·trackEvent 折叠·与后台 customer360 provider 同口径）：
 * 分母=本课总段数、分子=done 命中且仍属本课的段（**取交集**·防已删/改名段的 stale done 键顶爆分母）。
 * progress 缺省=空（无进度文档=0 进度·不崩）。
 */
export function mapMyCourses(mine: unknown, courses: unknown, progress?: unknown): MyCourseVM[] {
  if (!Array.isArray(mine)) return []
  const courseById = new Map<string, Record<string, any>>()
  const titleOf = new Map<string, string>()
  if (Array.isArray(courses)) {
    for (const c of courses as Record<string, any>[]) {
      if (c && c.id) {
        courseById.set(String(c.id), c)
        titleOf.set(String(c.id), String(c.title || ''))
      }
    }
  }
  // 每课已看完段键集合（done map 键=segmentId·仅取值为真的键）
  const doneByCourse = new Map<string, Set<string>>()
  if (Array.isArray(progress)) {
    for (const p of progress as Record<string, any>[]) {
      const cid = String((p && p.courseId) || '')
      if (!cid) continue
      const done = p && p.done && typeof p.done === 'object' ? (p.done as Record<string, any>) : {}
      const keys = new Set<string>()
      for (const k of Object.keys(done)) if (done[k]) keys.add(k)
      doneByCourse.set(cid, keys)
    }
  }
  const out: MyCourseVM[] = []
  for (const m of mine as Record<string, any>[]) {
    const courseId = String((m && m.courseId) || '')
    if (!courseId) continue
    const segIds = segmentIdsOf(courseById.get(courseId))
    const totalSegments = segIds.size
    let doneCount = 0
    for (const k of doneByCourse.get(courseId) || []) if (segIds.has(k)) doneCount++ // 交集·防 stale 顶爆
    const percent = totalSegments ? Math.round((doneCount / totalSegments) * 100) : 0
    out.push({ courseId, title: titleOf.get(courseId) || courseId, enteredAtLabel: dateTime(m.enteredAt), doneCount, totalSegments, percent })
  }
  return out
}
