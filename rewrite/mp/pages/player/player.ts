// 课程播放页（M2 批11·竖屏沉浸全屏重设计批新增一键投屏+帮助入口）：video + 分段列表 + 上/下一段 +
// 进度上报 + 首帧埋点。鉴权 fail-closed 在云端（getPlaybackUrl 须本人已进课）；素材未剪 url:null → 空态不裂
// 播放器；未授权 → 导流激活页。地址经 TTL 缓存（切段回看零重复取址）。
// 投屏双保险（真机走查后收敛，见 docs/待办与债.md）：主路径=原生 show-casting-button（官方文档未言明
// 依赖 controls，社区有 controls=false 下可用实例）；备路径=底条自绘投屏按钮，wx.createVideoContext 后
// 特性检测 typeof ctx.startCasting==='function'（基础库 2.32.0·仅 tap 回调内调用），不支持则提示微信版本过低。
import { getPlaybackUrl, trackEvent } from '../../api/learning'
import { flattenSegments, navSegment, createPlaybackCache, formatClock, clampSeek, type CoursePub, type FlatSegment } from '../../lib/player'
import { getCourseById } from '../../lib/courses'
import { openCustomerService } from '../../utils/customerService'

const TIME_UPDATE_THROTTLE_MS = 250

const cache = createPlaybackCache({
  fetcher: async (courseId, segmentId) => {
    const r = await getPlaybackUrl(courseId, segmentId)
    if (!r.ok && String(r.error || '') === 'NOT_ENTITLED') throw new Error('NOT_ENTITLED')
    return r.ok ? String(r.url || '') : ''
  },
})

Page({
  data: {
    statusBarHeight: 0,
    title: '',
    segments: [] as FlatSegment[],
    current: null as FlatSegment | null,
    src: '',
    canPrev: false,
    canNext: false,
    state: 'loading' as 'loading' | 'playing' | 'empty' | 'denied' | 'missing' | 'error',
    listOpen: false,
    paused: false, // 真实播放/暂停态·只认 bind:play/bind:pause 回报，不在 tap 里直接翻转当真相
    curSec: 0,
    durSec: 0,
    curClock: '0:00',
    durClock: '0:00',
    seeking: false, // 拖动进度条中：阻断 timeupdate 覆盖显示值
  },
  courseId: '',
  course: null as CoursePub | null,
  srcSetAt: 0,
  firstFrameScene: 'enter' as 'enter' | 'seg' | 'retry',
  firstFrameReported: false,
  playToken: 0, // 切段请求令牌（防乱序回包覆盖·守卫 rw-mp-player-stale-guarded）
  errSeg: '', // 上次因视频加载失败重试过的段
  errRetried: false, // 该段是否已重试过一次（防不可恢复媒体无限重取死循环）
  watchReported: false, // 本段 watch_at 是否已上报（一次性·防 onHide+onUnload 双报）
  lastTimeUpdateAt: 0, // bindtimeupdate 节流时间戳（250ms·减频 setData）
  _at: 0, // 最近一次 timeupdate 的播放位置（秒·每次事件都更新·不受 setData 节流影响）——watch_at/segment_done 埋点用
  _dur: 0, // 最近一次 timeupdate 的总时长（秒·同上）

  async onLoad(query: Record<string, string | undefined>) {
    const info = wx.getWindowInfo()
    this.setData({ statusBarHeight: info.statusBarHeight })
    this.courseId = String(query.courseId || '')
    // 来源页（me/my-courses）已把课程目录热进 lib/courses 缓存→这里零云调用；深链冷启动（分享链直进播放页）
    // 缓存未热→内部兜底重拉一次目录，行为不回退，只是不再每次都重拉（根因账本#15）。
    const course = (await getCourseById(this.courseId)) as CoursePub | null
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
    this.watchReported = false // 新段（含重试重入）＝新观看单元·允许再上报一次 watch_at
    const token = ++this.playToken // 本次切段令牌·await 后复核，防慢回旧段覆盖新段
    this.firstFrameScene = scene
    this.firstFrameReported = false
    this.lastTimeUpdateAt = 0
    // 旧段的播放位置/时长一并清零：换段起点到新段首个 timeupdate 之间有真实空窗（url 落定即 state='playing'，
    // 早于视频真正开播）；若此时触发 onHide/onUnload，reportWatchAt 会把这两个字段当真相上报——不清零会把上一段
    // 的 at/dur 错记到新段 segmentId 头上（P2 bug sweep R2 复查）。
    this._at = 0
    this._dur = 0
    // src 清空：换段加载态回到「正在加载首帧」骨架，且卸载上一段/坏地址的 <video>——否则旧视频在新段标签下继续播放、
    // 骨架永不显，且坏 src 重挂到新段会瞬时 bind:error 白吃掉新段的一次重试预算（审计②）。
    // 进度/暂停态一并归零：新段是新的播放单元，旧段的进度条/暂停指示不该带过来。
    this.setData({ state: 'loading', current: seg, src: '', listOpen: false, paused: false, curSec: 0, durSec: 0, curClock: '0:00', durClock: '0:00', seeking: false })
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

  // video 播放/暂停回报（真相源·不在 onTapVideo 里直接翻转 data.paused）。
  onVideoPlay() {
    this.onFirstPlay()
    this.setData({ paused: false })
  },
  onVideoPause() {
    this.setData({ paused: true })
  },

  onEnded() {
    const cur = this.data.current
    if (!cur) return
    trackEvent('segment_done', 'player', cur.segmentId, { courseId: this.courseId, lessonId: cur.lessonId, segmentId: cur.segmentId, at: this._at, dur: this._dur })
    const next = navSegment(this.course, cur.segmentId, 1)
    if (next) void this.playSegment(next, 'seg')
  },

  // error 态手动重试（P3·bug sweep R1 #7）：复用现有段加载方法，重置重试计数放行 onVideoError 再给一次自动重试预算。
  onRetryError() {
    const cur = this.data.current
    if (!cur) return
    this.errSeg = ''
    this.errRetried = false
    cache.invalidate(this.courseId, cur.segmentId)
    void this.playSegment(cur, 'retry')
  },

  onVideoError() {
    // 只认「正在播放」态的错误：换段时先 setData(state:'loading', src:'')，此刻 <video> 正异步卸载，
    // 刚被替换的旧视频可能补发一个 bind:error——若不拦，会被错记到新段头上、白吃掉新段的一次重试预算（第3轮审计）。
    // 新段真出错时 state 已是 'playing'（url 落定后才设），故按 state 判身份即可，无需给 video 挂 token。
    if (this.data.state !== 'playing') return
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

  // 全屏单击播放/暂停：只调用视频上下文 play()/pause()，真实态由 bind:play/bind:pause 回报（不臆断本地态）。
  onTapVideo() {
    if (this.data.state !== 'playing' || !this.data.src) return
    const ctx = wx.createVideoContext('lp-video', this)
    if (this.data.paused) ctx.play()
    else ctx.pause()
  },

  // 进度上报（250ms 节流·seeking 时不覆盖显示值·秒取整减频 setData）。
  onTimeUpdate(e: WechatMiniprogram.CustomEvent<{ currentTime: number; duration: number }>) {
    // 每次事件都更新（不 setData·不节流）：watch_at/segment_done 埋点要最新播放位置，UI 节流不该拖累它（P2·bug sweep R1 #14）。
    this._at = Math.floor(e.detail.currentTime || 0)
    this._dur = Math.floor(e.detail.duration || 0)
    if (this.data.seeking) return
    const now = Date.now()
    if (now - this.lastTimeUpdateAt < TIME_UPDATE_THROTTLE_MS) return
    this.lastTimeUpdateAt = now
    const curSec = Math.floor(e.detail.currentTime || 0)
    const durSec = Math.floor(e.detail.duration || 0)
    if (curSec === this.data.curSec && durSec === this.data.durSec) return
    this.setData({ curSec, durSec, curClock: formatClock(curSec), durClock: formatClock(durSec) })
  },
  // 拖动中：只更新显示值（阻断 timeupdate 覆盖），不 seek。
  onSliderChanging(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
    const curSec = clampSeek(e.detail.value, this.data.durSec)
    this.setData({ seeking: true, curSec, curClock: formatClock(curSec) })
  },
  // 松手：真正 seek（单位秒·video seek 接口以秒计）。
  onSliderChange(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
    const curSec = clampSeek(e.detail.value, this.data.durSec)
    const ctx = wx.createVideoContext('lp-video', this)
    ctx.seek(curSec)
    this.setData({ seeking: false, curSec, curClock: formatClock(curSec) })
  },

  // 一键投屏——主路径 show-casting-button 已在 wxml 开启；本函数是底条自绘备路径。
  onCast() {
    if (this.data.state !== 'playing' || !this.data.src) return
    const ctx = wx.createVideoContext('lp-video', this) as unknown as { startCasting?: (opt: { success?: () => void; fail?: () => void }) => void }
    // 特性检测（miniprogram-api-typings 未收录 startCasting·基础库 2.32.0 起才有）：
    // 低版本微信不支持时直接调用会抛错崩交互，先探测再调用。
    if (typeof ctx.startCasting !== 'function') {
      wx.showToast({ title: '当前微信版本过低，暂不支持投屏，请更新微信后重试', icon: 'none' })
      return
    }
    ctx.startCasting({
      fail: () => {
        wx.showToast({ title: '投屏失败，请确认电视与手机同一 Wi-Fi', icon: 'none' })
      },
    })
  },
  // 用户在系统投屏选择框选中设备：真实连接结果以 bindcastingstatechange 为准，这里不下结论——
  // 但选中动作本身（不依赖 detail 形状）值得一个中性即时反馈，否则用户点了没反应会以为没生效。
  onCastingUserSelect() {
    wx.showToast({ title: '正在连接投屏设备…', icon: 'none' })
  },
  // 投屏状态变化：real device 上 detail 形状待真机校验（见 docs/待办与债.md），
  // 保守只在明确看到「连接成功」关键词时才提示，避免误报。
  onCastingStateChange(e: WechatMiniprogram.CustomEvent<{ state?: string }>) {
    const state = String((e.detail && e.detail.state) || '').toLowerCase()
    if (state.includes('connect') || state.includes('project')) {
      wx.showToast({ title: '已连接电视', icon: 'none' })
    }
  },
  onCastingInterrupt() {
    wx.showToast({ title: '投屏已断开', icon: 'none' })
  },

  // 帮助＝客服入口（占常规播放键位·取代播放键，设计定案）。
  onHelp() {
    openCustomerService()
  },

  onBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/home/home' }) // 深链直接进入播放页（无上级页可退）时兜底回首页
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
  // 目录抽屉遮罩/抽屉本体 catchtouchmove 挂点（锁背景滚动·同 privacy-sheet 组件既有写法）：空实现即可，
  // catch: 前缀本身负责挡冒泡，这里只需存在同名方法供小程序事件系统解析，避免 handler 缺失告警。
  noop() {},
  onGoActivate() {
    wx.redirectTo({ url: '/pages/welcome/welcome' })
  },
  // 观看位置上报：onHide（前进导航离页）+ onUnload（系统返回销毁·最常见的离开方式）都触发，
  // 一次性 watchReported 防同段双报（原只挂 onHide→返回退出静默丢失 watch_at·根因#14 可观测）。
  reportWatchAt() {
    const cur = this.data.current
    if (!cur || this.data.state !== 'playing' || this.watchReported) return
    this.watchReported = true
    trackEvent('watch_at', 'player', cur.segmentId, { courseId: this.courseId, lessonId: cur.lessonId, segmentId: cur.segmentId, at: this._at, dur: this._dur })
  },
  // 回前台复位（P2·bug sweep Round2 item4）：onHide 报过一次 watch_at 后若用户返回前台继续看同段，
  // 之前 onHide/onUnload 双报防护会拦住后续再报——回台视同「新观看单元」（与 playSegment 换段同语义）复位一次；
  // reportWatchAt 仍只在 state==='playing' 时真报，此处多复位几次（如首次 onLoad 紧随的 onShow）也是无害 no-op。
  onShow() {
    if (this.data.current) this.watchReported = false
  },
  onHide() {
    this.reportWatchAt()
  },
  onUnload() {
    this.reportWatchAt()
  },
})
