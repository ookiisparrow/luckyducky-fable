// 播放器纯逻辑（黄金 learning-content §六：分段导航跨课时/跳过不可播课时/端点置灰 +
// 播放地址缓存 TTL/空不缓存/跨课隔离/在途去重/定向失效）（守卫 rw-mp-player-golden）。
// 工厂式依赖注入（fetcher/now）——缓存命中/过期/去重最易在边界出错，纯函数化单测钉死（承接旧线范式）。

export interface SegmentPub {
  id: string
  name?: string
  dur?: number
  hasVideo: boolean
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

export type UrlFetcher = (courseId: string, segmentId: string) => Promise<string>

/** 播放地址缓存（黄金 §六）：TTL 内命中不重取（默认 25min·远小于服务端临时 URL 过期）；
 *  空结果不缓存（素材未剪/未授权下次仍重试）；键含课程标识跨课隔离；在途去重；可定向失效。 */
export function createPlaybackCache(o: { fetcher: UrlFetcher; now?: () => number; ttlMs?: number }) {
  const now = o.now || (() => Date.now())
  const ttlMs = o.ttlMs ?? 25 * 60 * 1000
  const cache = new Map<string, { url: string; at: number }>()
  const inflight = new Map<string, Promise<string>>()
  const keyOf = (c: string, s: string) => c + '||' + s

  async function get(courseId: string, segmentId: string): Promise<string> {
    if (!courseId || !segmentId) return '' // 空段不取址
    const key = keyOf(courseId, segmentId)
    const hit = cache.get(key)
    if (hit && now() - hit.at < ttlMs) return hit.url
    const going = inflight.get(key)
    if (going) return going // 在途去重：并发取同段只真取一次
    const p = (async () => {
      try {
        const url = String((await o.fetcher(courseId, segmentId)) || '')
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
    /** 预热：已有新鲜缓存时空操作；空段不取址不崩。 */
    async prefetch(courseId: string, segmentId: string): Promise<void> {
      if (!courseId || !segmentId) return
      const hit = cache.get(keyOf(courseId, segmentId))
      if (hit && now() - hit.at < ttlMs) return
      await get(courseId, segmentId).catch(() => undefined)
    },
    /** 定向失效：只清本（课,段），不误伤别课同名段。 */
    invalidate(courseId: string, segmentId: string): void {
      cache.delete(keyOf(courseId, segmentId))
    },
  }
}
