// 课程播放页（M2 批11）：video + 分段列表 + 上/下一段 + 进度上报 + 首帧埋点。
// 鉴权 fail-closed 在云端（getPlaybackUrl 须本人已进课）；素材未剪 url:null → 空态不裂播放器；
// 未授权 → 导流激活页。地址经 TTL 缓存（切段回看零重复取址）。
import { getCourses, getPlaybackUrl, trackEvent } from '../../api/learning'
import { flattenSegments, navSegment, createPlaybackCache, type CoursePub, type FlatSegment } from '../../lib/player'

const cache = createPlaybackCache({
  fetcher: async (courseId, segmentId) => {
    const r = await getPlaybackUrl(courseId, segmentId)
    if (!r.ok && String(r.error || '') === 'NOT_ENTITLED') throw new Error('NOT_ENTITLED')
    return r.ok ? String(r.url || '') : ''
  },
})

Page({
  data: {
    title: '',
    segments: [] as FlatSegment[],
    current: null as FlatSegment | null,
    src: '',
    canPrev: false,
    canNext: false,
    state: 'loading' as 'loading' | 'playing' | 'empty' | 'denied' | 'missing' | 'error',
    listOpen: false,
  },
  courseId: '',
  course: null as CoursePub | null,
  srcSetAt: 0,
  firstFrameScene: 'enter' as 'enter' | 'seg' | 'retry',
  firstFrameReported: false,
  playToken: 0, // 切段请求令牌（防乱序回包覆盖·守卫 rw-mp-player-stale-guarded）
  errSeg: '', // 上次因视频加载失败重试过的段
  errRetried: false, // 该段是否已重试过一次（防不可恢复媒体无限重取死循环）

  async onLoad(query: Record<string, string | undefined>) {
    this.courseId = String(query.courseId || '')
    const r = await getCourses()
    const course = r.ok && Array.isArray(r.list) ? ((r.list as CoursePub[]).find((c) => c.id === this.courseId) || null) : null
    if (!course) {
      this.setData({ state: 'missing' })
      return
    }
    this.course = course
    const segments = flattenSegments(course)
    this.setData({ title: String(course.title || ''), segments })
    const want = String(query.segmentId || '')
    const start = segments.find((s) => s.segmentId === want && s.hasVideo) || segments.find((s) => s.hasVideo) || null
    if (!start) {
      this.setData({ state: 'empty' }) // 全课无可播段（半上线）
      return
    }
    await this.playSegment(start, 'enter')
  },

  async playSegment(seg: FlatSegment, scene: 'enter' | 'seg' | 'retry') {
    if (scene !== 'retry') {
      this.errSeg = '' // 换段（非重试）重置视频加载失败重试计数
      this.errRetried = false
    }
    const token = ++this.playToken // 本次切段令牌·await 后复核，防慢回旧段覆盖新段
    this.firstFrameScene = scene
    this.firstFrameReported = false
    this.setData({ state: 'loading', current: seg, listOpen: false })
    let url = ''
    try {
      url = await cache.get(this.courseId, seg.segmentId)
    } catch {
      if (token !== this.playToken) return // 已被更晚的切段接管·本次作废
      this.setData({ state: 'denied' }) // 未进课：导流激活
      return
    }
    if (token !== this.playToken) return // 乱序回包：更晚的 playSegment 已接管·丢弃本次结果（不覆盖新段）
    if (!url) {
      this.setData({ state: 'empty', src: '', canPrev: !!navSegment(this.course, seg.segmentId, -1), canNext: !!navSegment(this.course, seg.segmentId, 1) })
      return
    }
    this.srcSetAt = Date.now()
    this.setData({
      state: 'playing',
      src: url,
      canPrev: !!navSegment(this.course, seg.segmentId, -1),
      canNext: !!navSegment(this.course, seg.segmentId, 1),
    })
  },

  onFirstPlay() {
    if (this.firstFrameReported || !this.data.current) return
    this.firstFrameReported = true
    // 首帧耗时埋点（承接旧线 bug W 修复产物：enter/seg/retry 三场景）
    trackEvent('first_frame', 'player', this.data.current.segmentId, {
      courseId: this.courseId,
      scene: this.firstFrameScene,
      ms: Date.now() - this.srcSetAt,
    })
  },

  onEnded() {
    const cur = this.data.current
    if (!cur) return
    trackEvent('segment_done', 'player', cur.segmentId, { courseId: this.courseId, lessonId: cur.lessonId, segmentId: cur.segmentId })
    const next = navSegment(this.course, cur.segmentId, 1)
    if (next) void this.playSegment(next, 'seg')
  },

  onVideoError() {
    const cur = this.data.current
    if (!cur) return
    // 地址可能过期（可恢复）→ 失效后重取一次；但同段重试后仍失败＝媒体本身坏/机型不支持（不可恢复），
    // 不再无限重取（否则每轮一次 getPlaybackUrl 死循环），落播放失败态让用户换段/稍后再试。
    if (this.errSeg === cur.segmentId && this.errRetried) {
      this.setData({ state: 'error' })
      return
    }
    this.errSeg = cur.segmentId
    this.errRetried = true
    cache.invalidate(this.courseId, cur.segmentId)
    void this.playSegment(cur, 'retry')
  },

  onPrev() {
    const cur = this.data.current
    const prev = cur && navSegment(this.course, cur.segmentId, -1)
    if (prev) void this.playSegment(prev, 'seg')
  },
  onNext() {
    const cur = this.data.current
    const next = cur && navSegment(this.course, cur.segmentId, 1)
    if (next) void this.playSegment(next, 'seg')
  },
  onPickSegment(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id)
    const seg = this.data.segments.find((s) => s.segmentId === id)
    if (seg && seg.hasVideo) void this.playSegment(seg, 'seg')
    else wx.showToast({ title: '这段视频还在整理中', icon: 'none' })
  },
  onToggleList() {
    this.setData({ listOpen: !this.data.listOpen })
  },
  onGoActivate() {
    wx.redirectTo({ url: '/pages/welcome/welcome' })
  },
  onHide() {
    const cur = this.data.current
    if (cur && this.data.state === 'playing') {
      trackEvent('watch_at', 'player', cur.segmentId, { courseId: this.courseId, lessonId: cur.lessonId, segmentId: cur.segmentId })
    }
  },
})
