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
}

/** 我的课程 join 课程标题（无题回 courseId 不崩·脏行剔除）。 */
export function mapMyCourses(mine: unknown, courses: unknown): MyCourseVM[] {
  if (!Array.isArray(mine)) return []
  const titleOf = new Map<string, string>()
  if (Array.isArray(courses)) {
    for (const c of courses as Record<string, any>[]) {
      if (c && c.id) titleOf.set(String(c.id), String(c.title || ''))
    }
  }
  const out: MyCourseVM[] = []
  for (const m of mine as Record<string, any>[]) {
    const courseId = String((m && m.courseId) || '')
    if (!courseId) continue
    out.push({ courseId, title: titleOf.get(courseId) || courseId, enteredAtLabel: dateTime(m.enteredAt) })
  }
  return out
}
