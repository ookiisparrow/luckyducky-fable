// 学习域映射（纯函数·激活 + 内容回退）。
import { dateTime } from './mapOrders'
import { clampResumeAt } from './continueResolve' // 续播秒夹取单源（命中 last 段分支复用·禁复制实现·病根#5）

/** 激活结果五态：activated 新激活（恭喜屏）/ mine 本人已进课（欢迎回来屏）/ taken 他人码（已被使用屏）/
 *  invalid 废码 / error 没兑成但码可能是好的（按 reason 分文案、可重试·fail-closed 不冒充激活）。 */
export type ActivationKind = 'activated' | 'mine' | 'taken' | 'invalid' | 'error'
export type ActivationErrReason = 'network' | 'throttled' | 'busy'

export interface ActivationView {
  kind: ActivationKind
  courseId: string
  reason?: ActivationErrReason
}

// 非废码失败说「码不对」会让持真码的人清码重输、甚至以为买到假卡；只有 INVALID_CODE/未知码才归废码。
// NOT_ACTIVATED＝云端激活没写进库，重扫即幂等自愈，对用户就是「服务繁忙再试」。
// 云端码手抄自 shared ERR（mp 进不了 @ldrw/shared），云端改名时 tests/q-mp-err-codes-synced 会红。
export const ERR_REASON: Record<string, ActivationErrReason> = {
  CALL_FAIL: 'network',
  BAD_RESULT: 'network',
  CALL_TIMEOUT: 'network',
  RATE_LIMITED: 'throttled',
  INTERNAL: 'busy',
  NOT_ACTIVATED: 'busy',
}

export const ACTIVATION_ERR_COPY: Record<ActivationErrReason, { eyebrow: string; display: string; lead: string }> = {
  network: { eyebrow: 'NETWORK · 网络开小差', display: '网络不好', lead: '你的激活码可能没问题，只是刚才没连上服务器——稍等片刻，再试一次就好。' },
  throttled: { eyebrow: 'SLOW DOWN · 操作太频繁', display: '操作太频繁了', lead: '刚才试得有点多，歇一分钟再试一次就好，激活码不用重输。' },
  busy: { eyebrow: 'BUSY · 服务繁忙', display: '服务繁忙', lead: '服务器这会儿有点忙，你的激活码可能没问题——稍后再试一次。' },
}

export function activationView(r: unknown): ActivationView {
  const res = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  const courseId = String(res.courseId || '')
  if (res.ok === true && (res.state === 'activated' || res.state === 'mine')) return { kind: res.state, courseId }
  const err = String(res.error || '')
  if (res.ok === false && err === 'CODE_TAKEN') return { kind: 'taken', courseId } // 带 courseId·按课取图
  const reason = res.ok === false && Object.prototype.hasOwnProperty.call(ERR_REASON, err) ? ERR_REASON[err] : undefined
  if (reason) return { kind: 'error', courseId: '', reason }
  return { kind: 'invalid', courseId: '' } // INVALID_CODE/未知错误一律废码态（fail-closed 不冒充激活）
}

/** 激活屏背景回退链（配置缺哪级回退哪级·不裂图）：
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
  percent: number // 学习进度百分比（见 progressPercent：0% 只表示真没学、100% 只表示真学完·中间夹 [1,99]）
  progressUnknown: boolean // 进度**没读到**（调用方传 null）：与「真的一段没学」区分——界面须显示「进度暂时读不到」而非 0%（根因#14）
}

// 学习进度百分比（手落副本·canonical 单源 rewrite/shared/src/learning.ts 的 progressPercent；
// mp 包进不了 @ldrw/shared——微信开发者工具编译不出仓外引用，同 lib/checkoutConst.ts / mapOrders.ts 头注；
// 两侧一致由守卫 rw-mp-copies-synced 逐规则焊死）。
// **0% 只表示真没学、100% 只表示真学完**，中间态夹到 [1,99]：
// 裸写 Math.round 会在边界撒谎——1/250 显示 0%（学了却像没学）、199/200 显示 100%（没学完却像结课）。
function progressPercent(done: number, total: number): number {
  const d = Number(done)
  const t = Number(total)
  if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0 || d <= 0) return 0
  if (d >= t) return 100
  const raw = Math.round((d / t) * 100)
  return Math.min(99, Math.max(1, raw))
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
  // 进度**读失败**用显式 null 表达（根因#14）：调用方在 getMyProgress 失败时若
  // 回退空数组，与「真的一段没学过」不可区分 → 课卡照样渲染「已学 0/80 · 0%」，学了一半的用户
  // 会以为学习记录丢了。null=没读到（界面另给未知态），[]/undefined=真的没进度（0% 是实话）。
  const progressUnknown = progress === null
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
    const percent = progressPercent(doneCount, totalSegments)
    out.push({ courseId, title: titleOf.get(courseId) || courseId, enteredAtLabel: dateTime(m.enteredAt), doneCount, totalSegments, percent, progressUnknown })
  }
  return out
}

export interface CatalogLessonVM {
  lessonId: string
  name: string
  status: 'done' | 'current' | 'todo'
  firstPlayableSegId: string // 点行起播段 id：current 课时=续播段（续播段须 hasVideo，否则回退课时内首个 hasVideo 段）；其余=课时内首个 hasVideo 段；无可播=''
  segs: ('done' | 'current' | 'todo')[] // 逐段细条（v6 Lite 目录）：current 课时的起播段＝current；看过（进度 done）＝done；其余 todo
}
export interface CatalogChapterVM {
  title: string
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
  segments: CatalogSeg[]
}

/** dur 口径（决策§31）：段 dur 库内是 'm:ss' 字符串（admin readDuration/VOD 转码回填同款），
 *  直接 Number('5:00')→NaN→0 会把结业页视频时长算成 0。兼容三种历史写法：数字秒、纯数字串、'm:ss'。 */
function parseDurSec(v: unknown): number {
  if (typeof v === 'number') return v > 0 ? v : 0
  const s = String(v || '').trim()
  const m = s.match(/^(\d+):([0-5]?\d)$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  return Number(s) > 0 ? Number(s) : 0
}

/** 课程树摊平成课时列表 + 章分组（章里存课时下标）；无 id 课时跳过。 */
function flattenCatalog(course: unknown): { lessons: CatalogLessonRaw[]; chapterGroups: { title: string; lessonIdxs: number[] }[] } {
  const c = (course && typeof course === 'object' ? course : {}) as Record<string, any>
  const lessons: CatalogLessonRaw[] = []
  const chapterGroups: { title: string; lessonIdxs: number[] }[] = []
  for (const ch of Array.isArray(c.chapters) ? c.chapters : []) {
    if (!ch) continue
    const idxs: number[] = []
    for (const l of Array.isArray(ch.lessons) ? ch.lessons : []) {
      if (!l || !l.id) continue
      const segments: CatalogSeg[] = (Array.isArray(l.segments) ? l.segments : [])
        .filter((s: any) => s && s.id)
        .map((s: any) => ({ id: String(s.id), hasVideo: !!s.hasVideo, dur: parseDurSec(s.dur) }))
      idxs.push(lessons.length)
      lessons.push({ lessonId: String(l.id), lessonName: String(l.name || ''), segments })
    }
    chapterGroups.push({ title: String(ch.title || ''), lessonIdxs: idxs })
  }
  return { lessons, chapterGroups }
}

/** 命中进度条目：courseId 匹配 + 多条取 updatedAt 最大者。 */
function latestProgress(progressList: unknown, courseId: string): Record<string, any> | null {
  let prog: Record<string, any> | null = null
  if (Array.isArray(progressList)) {
    for (const p of progressList as Record<string, any>[]) {
      if (!p || String(p.courseId || '') !== courseId) continue
      if (!prog || Number(p.updatedAt || 0) > Number(prog.updatedAt || 0)) prog = p
    }
  }
  return prog
}

/**
 * 目录页数据源：
 * 课时状态判定优先级——① 全课全 done（每个段数>0 的课时都 done 且至少有一个课时）→ 全部 done、无 current（覆盖一切）；
 * ② 否则 last.lessonId 命中的课时标 current（即使自身已 done——回看中）；③ 否则首个非 done 且含 hasVideo 段的课时标 current；
 * 其余课时按「done=段数>0 且全部段 ∈ done 集合」/ todo 判。continueTarget 与 current 解耦独立判定（见下）。
 * firstPlayableSegId / continueTarget 的「last 命中」分支须额外校验命中段 hasVideo（progress 记录可能滞后于
 * admin 撤下/替换视频的编辑），不可播则视同未命中、落入课时内/全课首个 hasVideo 段兜底——对外承诺「非空即可播放」不因此松动。
 * 脏结构安全同 segmentIdsOf 风格。
 */
/** 结业页（v5 C10）：课程名、学完几节（只数有内容的课时）、视频总时长（取整分钟·无时长数据不显示）。 */
export function mapFinish(course: unknown): { name: string; lessonsLabel: string; durLabel: string } {
  const { lessons } = flattenCatalog(course)
  const real = lessons.filter((l) => l.segments.length > 0)
  const sec = real.reduce((sum, l) => sum + l.segments.reduce((s, seg) => s + seg.dur, 0), 0)
  const c = course && typeof course === 'object' ? (course as Record<string, unknown>) : {}
  return { name: String(c.title || ''), lessonsLabel: `${real.length} 节`, durLabel: sec > 0 ? `${Math.round(sec / 60)} 分钟` : '' }
}

export function mapCatalog(
  course: unknown,
  progressList: unknown,
  courseId: string
): { chapters: CatalogChapterVM[]; continueTarget: { segmentId: string; lessonId: string; lessonName: string; resumeAt: number } | null } {
  const { lessons, chapterGroups } = flattenCatalog(course)
  const prog = latestProgress(progressList, courseId)
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

    let firstPlayableSegId = ''
    if (isCurrent && i === lastLessonIdx && last && last.segmentId) {
      const hit = l.segments.find((s) => s.id === String(last.segmentId))
      if (hit && hit.hasVideo) firstPlayableSegId = hit.id // 续播段须可播，否则落入下方兜底
    }
    if (!firstPlayableSegId) {
      const fv = firstHasVideo(l)
      firstPlayableSegId = fv ? fv.id : ''
    }

    const segs: CatalogLessonVM['segs'] = l.segments.map((s) => (isCurrent && s.id === firstPlayableSegId ? 'current' : doneSet.has(s.id) ? 'done' : 'todo'))
    return { lessonId: l.lessonId, name: l.lessonName, status, firstPlayableSegId, segs }
  })

  const chapters: CatalogChapterVM[] = chapterGroups.map((g) => ({
    title: g.title,
    lessons: g.lessonIdxs.map((i) => lessonVMs[i]),
  }))

  // continueTarget：与 current 解耦——last 命中（课时+段都在本课、且该段仍 hasVideo）优先（全完成态重温也回上次位置）；
  // last 命中段已不可播（如 admin 撤下视频）→ 视同未命中，落入下方兜底；
  // 否则 current 课时首个可播段；否则全课首个可播段；全课无可播段 → null。
  // resumeAt（续播秒·续段又续秒最后一公里·根因#15）：仅命中 last 段分支透出 clampResumeAt(last.at,last.dur)
  // （与 continueResolve 同口径·单源复用禁复制实现·病根#5）；兜底两分支（current 首段/全课首段）无 last 位置基准，resumeAt:0。
  let continueTarget: { segmentId: string; lessonId: string; lessonName: string; resumeAt: number } | null = null
  if (lastLessonIdx >= 0 && last && last.segmentId) {
    const l = lessons[lastLessonIdx]
    const segHit = l.segments.find((s) => s.id === String(last.segmentId))
    if (segHit && segHit.hasVideo) continueTarget = { segmentId: segHit.id, lessonId: l.lessonId, lessonName: l.lessonName, resumeAt: clampResumeAt(last.at, last.dur) }
  }
  if (!continueTarget && currentIdx >= 0) {
    const l = lessons[currentIdx]
    const fv = firstHasVideo(l)
    if (fv) continueTarget = { segmentId: fv.id, lessonId: l.lessonId, lessonName: l.lessonName, resumeAt: 0 }
  }
  if (!continueTarget) {
    for (const l of lessons) {
      const fv = firstHasVideo(l)
      if (fv) {
        continueTarget = { segmentId: fv.id, lessonId: l.lessonId, lessonName: l.lessonName, resumeAt: 0 }
        break
      }
    }
  }

  return { chapters, continueTarget }
}

// 播放页求助面板·帮助视频：云端 getHelpVideos 返回两级主题→小段
// （rewrite/cloud/src/functions/app/actions/reviews.ts）。清洗脏结构：非数组归空、
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

// 播放页求助面板·常见问题（R37·KB 精选 FAQ 公开读）：云端 getPublicFaq
// 只回 admin 勾选「精选」的 kb 条目，字段瘦身 {key,title,content}（title←question/content←answer）。
// 清洗脏结构同 mapHelpVideos 先例（null 防御）：非数组归空、字段 String 化、无标题剔除（脏档不占位）。
// ok:false（库挂/超时）回 null，不把空 items 装成「没有 FAQ」；真没有才回 []（根因#14）。
export interface FaqItemVM {
  key: string
  title: string
  content: string
}

export function mapPublicFaq(r: unknown): FaqItemVM[] | null {
  const res = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  if (res.ok === false) return null
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
