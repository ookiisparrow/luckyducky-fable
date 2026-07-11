// 播放器纯逻辑（黄金 learning-content §六：分段导航跨课时/跳过不可播课时/端点置灰 +
// 播放地址缓存 TTL/空不缓存/跨课隔离/在途去重/定向失效）（守卫 rw-mp-player-golden）。
// 工厂式依赖注入（fetcher/now）——缓存命中/过期/去重最易在边界出错，纯函数化单测钉死（承接旧线范式）。

export interface SegmentPub {
  id: string
  name?: string
  dur?: number
  hasVideo: boolean
  hasLandscape?: boolean // 是否有横屏成片（R40 投屏·云端未上线前恒缺席→前端宽松读 !!s.hasLandscape 安全降级）
  marks?: { at: number; name?: string }[] // 关键动作节点（后台 admin 标注，尚未投产·设计拍板⑤·前端宽松读）
}
export interface LessonPub {
  id: string
  name?: string
  dur?: number
  segments: SegmentPub[]
}
export interface ChapterPub {
  id: string
  title?: string
  lessons: LessonPub[]
}
export interface CoursePub {
  id: string
  title?: string
  chapters: ChapterPub[]
}

export interface FlatSegment {
  chapterTitle: string
  lessonId: string
  lessonName: string
  segmentId: string
  segName: string
  hasVideo: boolean
  hasLandscape: boolean // 透传为必备布尔字段（宽松读 !!s.hasLandscape，见 SegmentPub）
  marks: { at: number; name: string }[]
}

/** marks 清洗：非数组→[]；元素非对象/at 非有限数/at<0 剔除；at 取整、name 字符串化；按 at 升序输出。 */
function cleanMarks(marks: unknown): { at: number; name: string }[] {
  if (!Array.isArray(marks)) return []
  const out: { at: number; name: string }[] = []
  for (const m of marks) {
    if (!m || typeof m !== 'object') continue
    const at = Number((m as any).at)
    if (!Number.isFinite(at) || at < 0) continue
    out.push({ at: Math.floor(at), name: String((m as any).name || '') })
  }
  out.sort((a, b) => a.at - b.at)
  return out
}

/** 三层展平为有序段列表（结构脏档安全：缺层归空·不崩）。 */
export function flattenSegments(course: unknown): FlatSegment[] {
  const c = (course && typeof course === 'object' ? course : {}) as Record<string, any>
  const out: FlatSegment[] = []
  for (const ch of Array.isArray(c.chapters) ? c.chapters : []) {
    if (!ch) continue
    for (const l of Array.isArray(ch.lessons) ? ch.lessons : []) {
      if (!l || !l.id) continue
      for (const s of Array.isArray(l.segments) ? l.segments : []) {
        if (!s || !s.id) continue
        out.push({
          chapterTitle: String(ch.title || ''),
          lessonId: String(l.id),
          lessonName: String(l.name || ''),
          segmentId: String(s.id),
          segName: String(s.name || ''),
          hasVideo: !!s.hasVideo,
          hasLandscape: !!s.hasLandscape,
          marks: cleanMarks(s.marks),
        })
      }
    }
  }
  return out
}

/** 分段导航（黄金 §六）：±1 跨课时连续；跳过无视频段（半上线课时不困死控件）；
 *  全课端点/找不到当前段/步长 0 → null（按钮置灰·不乱跳）。 */
export function navSegment(course: unknown, currentSegId: string, step: number): FlatSegment | null {
  if (!currentSegId || !Number.isInteger(step) || step === 0) return null
  const flat = flattenSegments(course)
  const idx = flat.findIndex((s) => s.segmentId === currentSegId)
  if (idx < 0) return null
  const dir = step > 0 ? 1 : -1
  for (let i = idx + dir; i >= 0 && i < flat.length; i += dir) {
    if (flat[i].hasVideo) return flat[i]
  }
  return null
}

/** 秒→"m:ss" 时钟文案（竖屏沉浸播放页进度条）：负数/非数字归 0，不裂显示。 */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(Number(totalSec) || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

/** seek 目标秒数夹取到 [0, durSec]（拖动条松手/边界脏值不越界跳出可播范围）。 */
export function clampSeek(value: number, durSec: number): number {
  const v = Math.floor(Number(value) || 0)
  const max = Math.max(0, Math.floor(Number(durSec) || 0))
  if (v < 0) return 0
  if (max > 0 && v > max) return max
  return v
}

export type PlaybackMode = 'portrait' | 'landscape'
export type UrlFetcher = (courseId: string, segmentId: string, mode: PlaybackMode) => Promise<string>

/** 播放地址缓存（黄金 §六 + R40 投屏批2 扩 mode 维）：TTL 内命中不重取（默认 25min·远小于服务端临时
 *  URL 过期）；空结果不缓存（素材未剪/未授权下次仍重试）；键含课程标识跨课隔离；在途去重；可定向失效。
 *  mode 维（portrait/landscape）各自独立缓存互不污染——投屏换源/退回本机学习模式各取各的地址。 */
export function createPlaybackCache(o: { fetcher: UrlFetcher; now?: () => number; ttlMs?: number }) {
  const now = o.now || (() => Date.now())
  const ttlMs = o.ttlMs ?? 25 * 60 * 1000
  const cache = new Map<string, { url: string; at: number }>()
  const inflight = new Map<string, Promise<string>>()
  const keyOf = (c: string, s: string, mode: PlaybackMode) => c + '||' + s + '||' + mode

  async function get(courseId: string, segmentId: string, mode: PlaybackMode = 'portrait'): Promise<string> {
    if (!courseId || !segmentId) return '' // 空段不取址
    const key = keyOf(courseId, segmentId, mode)
    const hit = cache.get(key)
    if (hit && now() - hit.at < ttlMs) return hit.url
    const going = inflight.get(key)
    if (going) return going // 在途去重：并发取同段同 mode 只真取一次
    const p = (async () => {
      try {
        const url = String((await o.fetcher(courseId, segmentId, mode)) || '')
        if (url) cache.set(key, { url, at: now() }) // 空不缓存·下次重试
        return url
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, p)
    return p
  }

  return {
    get,
    /** 预热：已有新鲜缓存时空操作；空段不取址不崩。（预热恒 portrait——投屏换源走 swapSource 单独 get） */
    async prefetch(courseId: string, segmentId: string): Promise<void> {
      if (!courseId || !segmentId) return
      const hit = cache.get(keyOf(courseId, segmentId, 'portrait'))
      if (hit && now() - hit.at < ttlMs) return
      await get(courseId, segmentId).catch(() => undefined)
    },
    /** 定向失效：一次删 portrait+landscape 两个键（调用点签名不变），只清本（课,段），不误伤别课同名段。 */
    invalidate(courseId: string, segmentId: string): void {
      cache.delete(keyOf(courseId, segmentId, 'portrait'))
      cache.delete(keyOf(courseId, segmentId, 'landscape'))
    },
  }
}

/** 投屏播放模式判定（R40·纯函数）：只有「想要横屏」且该段确有横屏成片才返回 'landscape'，
 *  否则一律 'portrait'——云端 hasLandscape 未上线前恒 undefined，安全降级为一直请求竖屏。 */
export function playbackModeFor(seg: { hasLandscape?: boolean } | null, wantLandscape: boolean): PlaybackMode {
  return wantLandscape && !!(seg && seg.hasLandscape) ? 'landscape' : 'portrait'
}

export interface LessonStrip {
  chapterTitle: string
  lessonName: string
  lessonNo: string // 课时跨章连续序号，1-based，padStart(2,'0')，如 '04'
  segIndex: number // 当前段在本课时内的 1-based 序
  segTotal: number // 本课时段数
  cells: ('done' | 'cur' | 'todo')[] // 长度 = segTotal
}

/** 课时内分段条映射（P1/P4 segstrip 数据源）：在 course 中定位 currentSegId 所在课时，
 *  按位置序给出播放中/播完两态的分段格状态（播放页无 progress 数据，这是诚实近似）。
 *  播放中（completed 缺省/false）：当前段之前 done、当前段 cur、之后 todo。
 *  播完态（completed===true）：当前段也转 done、紧随其后一段（若有）转 cur，其余不变（承播放中基线）——
 *  规格原文「其余 'todo'」字面有两种读法（之前段维持 done vs 全部非当前/非下一段强制 todo）；
 *  已按设计靶 播放器重设计.html 核实消歧（P1 board「done done cur . . . . .」→ P4 board 同一课时
 *  「done done done cur . . . .」，之前已完成段在播完态后仍是 done、未被打回 todo），确认取「之前段维持 done」读法。
 *  找不到当前段所在课时 → null；脏结构安全（缺层归空、字段 String 化）。 */
export function lessonStrip(course: unknown, currentSegId: string, completed?: boolean): LessonStrip | null {
  const c = (course && typeof course === 'object' ? course : {}) as Record<string, any>
  let lessonNo = 0
  for (const ch of Array.isArray(c.chapters) ? c.chapters : []) {
    if (!ch) continue
    for (const l of Array.isArray(ch.lessons) ? ch.lessons : []) {
      if (!l || !l.id) continue
      lessonNo++
      const segs = (Array.isArray(l.segments) ? l.segments : []).filter((s: any) => s && s.id)
      const idx = segs.findIndex((s: any) => String(s.id) === currentSegId)
      if (idx < 0) continue
      const cells: ('done' | 'cur' | 'todo')[] = segs.map((_: any, i: number) => {
        if (i < idx) return 'done' // 之前：播放中/播完两态均已看完
        if (i === idx) return completed === true ? 'done' : 'cur' // 当前：播完态转 done
        if (completed === true && i === idx + 1) return 'cur' // 紧随其后一段：播完态高亮下一段
        return 'todo'
      })
      return {
        chapterTitle: String(ch.title || ''),
        lessonName: String(l.name || ''),
        lessonNo: String(lessonNo).padStart(2, '0'),
        segIndex: idx + 1,
        segTotal: segs.length,
        cells,
      }
    }
  }
  return null
}

/** 磁吸判定（P2 拖动·纯函数）：窗口内取距离最近的关键动作节点，等距取 at 较小者；
 *  marks 非数组/空、窗口内无候选、windowSec 非正数 → null。 */
export function nearestMark(
  sec: number,
  marks: { at: number; name: string }[],
  windowSec: number
): { at: number; name: string } | null {
  if (!Array.isArray(marks) || marks.length === 0) return null
  if (!(windowSec > 0)) return null
  let best: { at: number; name: string } | null = null
  let bestDist = Infinity
  for (const m of marks) {
    const dist = Math.abs(m.at - sec)
    if (dist > windowSec) continue
    if (dist < bestDist || (dist === bestDist && best !== null && m.at < best.at)) {
      best = m
      bestDist = dist
    }
  }
  return best
}
