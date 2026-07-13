// 学习域映射（纯函数·黄金 learning-content §一激活三态 + §九内容回退）（守卫 rw-mp-learning-golden）。
import { dateTime } from './mapOrders'

/** 激活结果五态：activated 新激活（恭喜屏）/ mine 本人已进课（欢迎回来屏）/ taken 他人码（已被使用屏）/
 *  invalid 废码 / error 网络失败（深审20260712 P3：CALL_FAIL/BAD_RESULT≠废码——扫真码遇网络抖动不误告
 *  「激活码不对」，给「再试一次」；fail-closed 方向不变，仍不授权不冒充激活）。 */
export type ActivationKind = 'activated' | 'mine' | 'taken' | 'invalid' | 'error'

export interface ActivationView {
  kind: ActivationKind
  courseId: string
}

export function activationView(r: unknown): ActivationView {
  const res = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  const courseId = String(res.courseId || '')
  if (res.ok === true && (res.state === 'activated' || res.state === 'mine')) return { kind: res.state, courseId }
  const err = String(res.error || '')
  if (res.ok === false && err === 'CODE_TAKEN') return { kind: 'taken', courseId } // 带 courseId·按课取图
  if (res.ok === false && (err === 'CALL_FAIL' || err === 'BAD_RESULT')) return { kind: 'error', courseId: '' } // 网络/回包失败≠废码：文案分治可重试，仍 fail-closed 不冒充激活
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

export interface CatalogLessonVM {
  lessonId: string
  no: string // 跨章连续 1-based padStart(2,'0')（与 lessonStrip.lessonNo 同口径）
  name: string
  segCount: number
  minutes: number // Math.round(sum(seg.dur||0)/60)；无 dur 数据 = 0（页面隐藏时长）
  status: 'done' | 'current' | 'todo'
  lastLabel: string // 仅 current 且 last.segmentId 在本课时内：'上次学到 段落 N'（N=段 1-based 序）；否则 ''
  firstPlayableSegId: string // 点行起播段 id：current 课时=续播段（续播段须 hasVideo，否则回退课时内首个 hasVideo 段）；其余=课时内首个 hasVideo 段；无可播=''
}
export interface CatalogChapterVM {
  title: string
  lessonCount: number
  lessons: CatalogLessonVM[]
}

interface CatalogSeg {
  id: string
  hasVideo: boolean
  dur: number
}
interface CatalogLessonRaw {
  lessonId: string
  lessonName: string
  no: string
  segments: CatalogSeg[]
}

/**
 * 目录页数据源（C1·教学播放重设计批A·2026-07-11 预审裁决消歧优先级）：
 * 课时状态判定优先级——① 全课全 done（每个段数>0 的课时都 done 且至少有一个课时）→ 全部 done、无 current（覆盖一切）；
 * ② 否则 last.lessonId 命中的课时标 current（即使自身已 done——回看中）；③ 否则首个非 done 且含 hasVideo 段的课时标 current；
 * 其余课时按「done=段数>0 且全部段 ∈ done 集合」/ todo 判。continueTarget 与 current 解耦独立判定（见下）。
 * firstPlayableSegId / continueTarget 的「last 命中」分支须额外校验命中段 hasVideo（progress 记录可能滞后于
 * admin 撤下/替换视频的编辑），不可播则视同未命中、落入课时内/全课首个 hasVideo 段兜底——对外承诺「非空即可播放」不因此松动。
 * 脏结构安全同 segmentIdsOf 风格。
 */
export function mapCatalog(
  course: unknown,
  progressList: unknown,
  courseId: string
): { chapters: CatalogChapterVM[]; continueTarget: { segmentId: string; lessonId: string; lessonName: string } | null } {
  const c = (course && typeof course === 'object' ? course : {}) as Record<string, any>
  const lessons: CatalogLessonRaw[] = []
  const chapterGroups: { title: string; lessonIdxs: number[] }[] = []
  let no = 0
  for (const ch of Array.isArray(c.chapters) ? c.chapters : []) {
    if (!ch) continue
    const idxs: number[] = []
    for (const l of Array.isArray(ch.lessons) ? ch.lessons : []) {
      if (!l || !l.id) continue
      no++
      const segments: CatalogSeg[] = (Array.isArray(l.segments) ? l.segments : [])
        .filter((s: any) => s && s.id)
        .map((s: any) => ({ id: String(s.id), hasVideo: !!s.hasVideo, dur: Number(s.dur) || 0 }))
      idxs.push(lessons.length)
      lessons.push({ lessonId: String(l.id), lessonName: String(l.name || ''), no: String(no).padStart(2, '0'), segments })
    }
    chapterGroups.push({ title: String(ch.title || ''), lessonIdxs: idxs })
  }

  // 命中进度条目：courseId 匹配 + 多条取 updatedAt 最大者
  let prog: Record<string, any> | null = null
  if (Array.isArray(progressList)) {
    for (const p of progressList as Record<string, any>[]) {
      if (!p || String(p.courseId || '') !== courseId) continue
      if (!prog || Number(p.updatedAt || 0) > Number(prog.updatedAt || 0)) prog = p
    }
  }
  const allSegIds = new Set<string>()
  for (const l of lessons) for (const s of l.segments) allSegIds.add(s.id)
  const doneSet = new Set<string>()
  if (prog && prog.done && typeof prog.done === 'object') {
    for (const k of Object.keys(prog.done)) if (prog.done[k] && allSegIds.has(k)) doneSet.add(k) // 交集·防 stale 顶爆
  }
  const last = prog && prog.last && typeof prog.last === 'object' ? (prog.last as Record<string, any>) : null

  const lessonDone = (l: CatalogLessonRaw) => l.segments.length > 0 && l.segments.every((s) => doneSet.has(s.id))
  const firstHasVideo = (l: CatalogLessonRaw) => l.segments.find((s) => s.hasVideo) || null

  const substantive = lessons.filter((l) => l.segments.length > 0)
  const allDone = substantive.length > 0 && substantive.every(lessonDone)

  const lastLessonIdx = last && last.lessonId ? lessons.findIndex((l) => l.lessonId === String(last.lessonId)) : -1
  let currentIdx = -1
  if (!allDone) {
    currentIdx = lastLessonIdx >= 0 ? lastLessonIdx : lessons.findIndex((l) => !lessonDone(l) && l.segments.some((s) => s.hasVideo))
  }

  const lessonVMs: CatalogLessonVM[] = lessons.map((l, i) => {
    const isCurrent = i === currentIdx
    const status: CatalogLessonVM['status'] = allDone ? 'done' : isCurrent ? 'current' : lessonDone(l) ? 'done' : 'todo'

    let lastLabel = ''
    let firstPlayableSegId = ''
    if (isCurrent && i === lastLessonIdx && last && last.segmentId) {
      const segIdx = l.segments.findIndex((s) => s.id === String(last.segmentId))
      if (segIdx >= 0) {
        lastLabel = `上次学到 段落 ${segIdx + 1}` // 上次学到哪段是历史事实，与该段现在是否仍可播无关
        if (l.segments[segIdx].hasVideo) firstPlayableSegId = l.segments[segIdx].id // 续播段须可播，否则落入下方兜底
      }
    }
    if (!firstPlayableSegId) {
      const fv = firstHasVideo(l)
      firstPlayableSegId = fv ? fv.id : ''
    }

    const minutes = Math.round(l.segments.reduce((sum, s) => sum + s.dur, 0) / 60)
    return { lessonId: l.lessonId, no: l.no, name: l.lessonName, segCount: l.segments.length, minutes, status, lastLabel, firstPlayableSegId }
  })

  const chapters: CatalogChapterVM[] = chapterGroups.map((g) => ({
    title: g.title,
    lessonCount: g.lessonIdxs.length,
    lessons: g.lessonIdxs.map((i) => lessonVMs[i]),
  }))

  // continueTarget：与 current 解耦——last 命中（课时+段都在本课、且该段仍 hasVideo）优先（全完成态重温也回上次位置）；
  // last 命中段已不可播（如 admin 撤下视频）→ 视同未命中，落入下方兜底；
  // 否则 current 课时首个可播段；否则全课首个可播段；全课无可播段 → null。
  let continueTarget: { segmentId: string; lessonId: string; lessonName: string } | null = null
  if (lastLessonIdx >= 0 && last && last.segmentId) {
    const l = lessons[lastLessonIdx]
    const segHit = l.segments.find((s) => s.id === String(last.segmentId))
    if (segHit && segHit.hasVideo) continueTarget = { segmentId: segHit.id, lessonId: l.lessonId, lessonName: l.lessonName }
  }
  if (!continueTarget && currentIdx >= 0) {
    const l = lessons[currentIdx]
    const fv = firstHasVideo(l)
    if (fv) continueTarget = { segmentId: fv.id, lessonId: l.lessonId, lessonName: l.lessonName }
  }
  if (!continueTarget) {
    for (const l of lessons) {
      const fv = firstHasVideo(l)
      if (fv) {
        continueTarget = { segmentId: fv.id, lessonId: l.lessonId, lessonName: l.lessonName }
        break
      }
    }
  }

  return { chapters, continueTarget }
}

// 播放页求助面板·帮助视频（P3b·播放器重设计战役批D）：云端 getHelpVideos 返回两级主题→小段
// （rewrite/cloud/src/functions/app/actions/reviews.ts，本批零改动）。清洗脏结构：非数组归空、
// id/title/sub/desc/dur String 化（dur 原样字符串，不重新格式化）、url 非串归 null（短时地址过期/未剪辑）；
// 无 title 且无 segments 的主题剔除（脏档不占一个空分组位）。
export interface HelpVideoSegVM {
  id: string
  name: string
  dur: string
  url: string | null
}
export interface HelpTopicVM {
  id: string
  title: string
  sub: string
  desc: string
  segments: HelpVideoSegVM[]
}

export function mapHelpVideos(r: unknown): HelpTopicVM[] {
  const res = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  const items = Array.isArray(res.items) ? res.items : []
  const out: HelpTopicVM[] = []
  for (const raw of items) {
    const it = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
    const rawSegs = Array.isArray(it.segments) ? it.segments : []
    const segments: HelpVideoSegVM[] = rawSegs.map((sgRaw: unknown) => {
      const sg = (sgRaw && typeof sgRaw === 'object' ? sgRaw : {}) as Record<string, any>
      return {
        id: String(sg.id || ''),
        name: String(sg.name || ''),
        dur: String(sg.dur || ''),
        url: typeof sg.url === 'string' && sg.url ? sg.url : null,
      }
    })
    const title = String(it.title || '')
    if (!title && segments.length === 0) continue // 无题无段的脏主题剔除
    out.push({ id: String(it.id || ''), title, sub: String(it.sub || ''), desc: String(it.desc || ''), segments })
  }
  return out
}

// 播放页求助面板·常见问题（R37b·KB 精选 FAQ 公开读接线·播放器重设计战役批B8）：云端 getPublicFaq
// 只回 admin 勾选「精选」的 kb 条目（本批零改动·rewrite/cloud/src/functions/app/actions/faq.ts），
// 字段瘦身 {key,title,content}（title←question/content←answer）。清洗脏结构同 mapHelpVideos 先例
// （null 防御）：非数组归空、字段 String 化、无标题剔除（脏档不占位）。空/失败仍由 player.ts 落诚实空态。
export interface FaqItemVM {
  key: string
  title: string
  content: string
}

export function mapPublicFaq(r: unknown): FaqItemVM[] {
  const res = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  const items = Array.isArray(res.items) ? res.items : []
  const out: FaqItemVM[] = []
  for (const raw of items) {
    const it = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
    const title = String(it.title || '')
    if (!title) continue // 无标题的脏条目剔除（同 mapHelpVideos 剔脏档口径）
    out.push({ key: String(it.key || ''), title, content: String(it.content || '') })
  }
  return out
}
