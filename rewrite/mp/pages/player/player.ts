// 课程播放页（M2 批11·竖屏沉浸全屏重设计批新增一键投屏+帮助入口）：video + 分段列表 + 上/下一段 +
// 进度上报 + 首帧埋点。鉴权 fail-closed 在云端（getPlaybackUrl 须本人已进课）；素材未剪 url:null → 空态不裂
// 播放器；未授权 → 导流激活页。地址经 TTL 缓存（切段回看零重复取址）。
// 投屏双保险（真机走查后收敛，见 docs/待办与债.md）：主路径=原生 show-casting-button（官方文档未言明
// 依赖 controls，社区有 controls=false 下可用实例）；备路径=底条自绘投屏按钮，wx.createVideoContext 后
// 特性检测 typeof ctx.startCasting==='function'（基础库 2.32.0·仅 tap 回调内调用），不支持则提示微信版本过低。
// 投屏＝单段一次性投放（批7 平台裁决·R40 降级改写·证据链在重构日志批7 条）：DLNA 是把地址推给电视、电视
// 自拉流，小程序对电视端无控制无感知——换内容无接口（4 个投屏方法均无 src 参）、电视播完无回报事件
// （ended/castinginterrupt 不触发）、投屏 API 仅限 tap 回调内调用。故：换 src 必回本机（电视不跟随）、
// 自动连播不可实现（castAutoNext 已退役）、断连检测只能靠「本机重新开播」兜底（reclaimFromCasting）。
// 自绘 seek 条（播放器重设计战役批C，取代原生 <slider>）：两段式语义——拖动中只改显示（onSeekStart/
// onSeekMove），松手才真 seek（onSeekEnd）；关键动作节点磁吸（nearestMark）+ 拖动阻尼震感配方照抄
// pages/flip-demo 已验真机参考实现（lib/haptics 单源 shouldTick/VIBE_GAP_MS/DRAG_TICK_GAP_MS）。
// 拖动浮层原设计有雪碧图缩略图窗（R36 后端未建），诚实降级为时间浮窗 + 命中节点时的鸭黄气泡。
import { getPlaybackUrl, trackEvent, getHelpVideos } from '../../api/learning'
import {
  flattenSegments,
  navSegment,
  createPlaybackCache,
  formatClock,
  clampSeek,
  lessonStrip,
  nearestMark,
  playbackModeFor,
  rotateSwapPlan,
  castReclaimDue,
  type CoursePub,
  type FlatSegment,
  type LessonStrip,
  type PlaybackMode,
} from '../../lib/player'
import { getCourseById } from '../../lib/courses'
import { openCustomerService } from '../../utils/customerService'
import { shouldTick, VIBE_GAP_MS, DRAG_TICK_GAP_MS } from '../../lib/haptics'
import { mapHelpVideos, type HelpTopicVM } from '../../lib/mapLearning'

const TIME_UPDATE_THROTTLE_MS = 250
// 磁吸窗口（秒）：拖动秒数落在关键动作节点前后 3 秒内即吸附（批C 规格默认值·真机手感待调参 flag）。
const MARK_SNAP_SEC = 3
// 拖动预览浮层防出屏边距（rpx）：规格原定 CSS clamp(64rpx, ..., calc(100% - 64rpx)) 夹取，改在 JS 侧算好
// 像素值再传 px 内联样式——WXSS clamp() 是本仓首次出现的用法（无既有先例，真机支持度未经验证，CLAUDE.md
// §4 对同类兼容性存疑的 CSS 函数已有专门规避先例 backdrop-filter/color-mix()），JS 算值零风险等价替代。
const PREVIEW_EDGE_RPX = 64
// 返回二次确认窗口（ms·P5 设计拍板②·批5 升级覆盖手势）：每次返回都出现确认提示，非仅首次；WebView 页
// 无 onBackPress，侧滑/系统返回经 page-container 垫层拦入同一条 onBack 决策链（onGuardLeave·垫层法真机复验中），
// 自绘返回箭头直接调 onBack——两条返回路径共用本窗口判定。
const BACK_CONFIRM_MS = 2500
// 首次成功退出加桌引导 storage key（storage key 收敛·CLAUDE §7）：仅展示一次（P5b 设计拍板④）。
const DESK_GUIDE_KEY = 'ld_player_desk_guide_shown'
// 投屏顶栏首次气泡 storage key（storage key 收敛·CLAUDE §7）：仅展示一次（T1 终态·批2 投屏落地批）。
const CAST_TIP_KEY = 'ld_player_cast_tip_shown'

// segcap 文案三态（P4·播放器重设计战役批B §2c）：播放中报「段落 x/y」；播完且课时内有下一段报「x 完成·接下来 x+1」；
// 播完且课时末段——查 navSegment 是否有跨课时下一段，有则报下一课时名，无则「本课程已全部学完」。
// 放纯函数（非方法）：与 strip 一起在多个 setData 点重算，避免同一逻辑在 playSegment/onEnded/onReplay/onVideoPlay 四处各自重写。
function buildCapText(strip: LessonStrip | null, segDone: boolean, course: CoursePub | null, segId: string): string {
  if (!strip) return ''
  if (!segDone) return `段落 ${strip.segIndex} / ${strip.segTotal}`
  if (strip.segIndex < strip.segTotal) return `段落 ${strip.segIndex} 完成 · 接下来 段落 ${strip.segIndex + 1}`
  const next = navSegment(course, segId, 1)
  return next ? `本课时完成 · 接下来 ${next.lessonName}` : '本课程已全部学完'
}

const cache = createPlaybackCache({
  fetcher: async (courseId, segmentId, mode) => {
    const r = await getPlaybackUrl(courseId, segmentId, mode)
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
    paused: false, // 真实播放/暂停态·只认 bind:play/bind:pause 回报，不在 tap 里直接翻转当真相
    curSec: 0,
    durSec: 0,
    curClock: '0:00',
    durClock: '0:00',
    seeking: false, // 拖动进度条中：阻断 timeupdate 覆盖显示值
    segDone: false, // 段落播完（P4）：不再自动切下一段，停在完成态给用户看通栏重播/自己切段
    strip: null as LessonStrip | null, // 顶条两行标题 + 分段进度条浮层数据源（批A lib/player lessonStrip）
    capText: '', // segstrip 左侧文案（三态，见 buildCapText）
    hintDismissed: false, // 单击提示条是否已被首次 tap 关闭（页面实例级·不持久化·无定时器）
    seekPct: 0, // 自绘 seek 条填充百分比（0–100·onTimeUpdate/onSeekMove/onSeekEnd 三处维护）
    snapName: '', // 拖动磁吸命中的关键动作节点名（seeking 时气泡文案，未命中为空串）
    markVMs: [] as { at: number; pct: number; name: string }[], // 关键动作节点位图（onTimeUpdate 首次拿到非零 durSec 时算一次，durSec 已有值后不重算）
    previewLeft: 0, // 拖动预览浮层 left 像素值（JS 算好夹取值·px 单位·见 updateSeekDisplay，避免 WXSS clamp() 兼容性风险）
    helpPanel: '' as '' | 'menu' | 'videos' | 'faq', // 求助面板状态机（P3·播放器重设计战役批D）：''=关闭·不阻断主视频播放
    helpVideosState: 'loading' as 'loading' | 'ok' | 'empty', // 帮助视频子层拉取态（每次进入 videos 层重拉·短时 URL 过期特性）
    helpTopics: [] as HelpTopicVM[], // 帮助视频主题分组 VM（mapHelpVideos 产出）
    helpSrc: '', // 内嵌播放（P3b-play）地址：非空=切到播放视图；关面板/返回列表/退出播放视图清空
    helpSegName: '', // 内嵌播放视图顶部标题（=命中小段 name）
    deskGuide: false, // 首次成功退出加桌引导弹窗可见态（P5b·仅展示一次）
    deskGuideIOS: false, // 加桌引导分端文案（true=iOS「添加到我的小程序」·false=其余平台「添加到桌面」）
    casting: '' as '' | 'connecting' | 'connected', // 投屏态开关（T1·R40 批7 单段投放）：''=本机学习模式·connecting=拉起设备框等待选中·connected=投屏共存态（底栏共存条+原生控件）
    castDevice: '', // 投屏设备名（detail 拿不到就空串，UI 兜底文案「电视」）
    castTip: false, // 顶栏投屏钮首次气泡（T1·仅展示一次，见 CAST_TIP_KEY）
    landscape: false, // 手机横屏播放（R41·批3）：pageOrientation:auto 下 onResize 按窗口宽高比翻转，驱动 .land 覆写族
    castPadRight: 0, // 顶栏右内边距（px·批5 真机走查修）：胶囊矩形动态算（CLAUDE §4 胶囊避让不硬编码）——静态留白在真机被胶囊压住投屏钮
    overlayTop: 0, // 顶部浮层（segstrip/单击提示）锚点（px·批5）：锚顶栏实测底边——顶栏高度随状态栏/标题两行浮动，静态 rpx 锚真机必压状态栏
    backGuard: false, // 侧滑返回垫层（P5 升级·批5）：page-container 在导航栈垫一层，手势/系统返回先消耗它（onGuardLeave）而非直接退页
  },
  courseId: '',
  course: null as CoursePub | null,
  srcSetAt: 0,
  _resumeAt: 0, // 换源续位秒（swapSource 写入·onVideoPlay 消费后归零，见方案A 时间轴对齐假设）
  windowWidthPx: 0, // rpx→px 换算基准（onLoad 存·750rpx = windowWidthPx px）
  firstFrameScene: 'enter' as 'enter' | 'seg' | 'retry',
  firstFrameReported: false,
  playToken: 0, // 切段请求令牌（防乱序回包覆盖·守卫 rw-mp-player-stale-guarded）
  helpVideosToken: 0, // 帮助视频子层请求令牌（防乱序回包覆盖·同 playToken 惯用法·评审 finding 复核 2026-07-11
  // 批D 补丁：粗粒度 helpPanel==='videos' 判定无法区分「快速退出再进入」产生的新旧两次请求，慢的旧请求
  // 若晚于新请求回包，会用旧数据把刚渲染好的新列表覆盖回去——必须用自增代次精确丢弃过期回包）。
  errSeg: '', // 上次因视频加载失败重试过的段
  errRetried: false, // 该段是否已重试过一次（防不可恢复媒体无限重取死循环）
  watchReported: false, // 本段 watch_at 是否已上报（一次性·防 onHide+onUnload 双报）
  lastTimeUpdateAt: 0, // bindtimeupdate 节流时间戳（250ms·减频 setData）
  _at: 0, // 最近一次 timeupdate 的播放位置（秒·每次事件都更新·不受 setData 节流影响）——watch_at/segment_done 埋点用
  _dur: 0, // 最近一次 timeupdate 的总时长（秒·同上）
  _seekRect: null as { left: number; width: number } | null, // 自绘 seek 条量轨缓存（首次播放成功后量一次·换段不重量，见 playSegment）
  _seekPrevSec: 0, // 拖动逐秒轻嗒判重锚点（onSeekStart 时置为当前 curSec）
  _lastSnapAt: -1, // 拖动进节点重嗒判重（onSeekStart 时重置为 -1·新命中/换节点才震）
  lastTick: 0, // 拖动阻尼「嗒」时间戳（配方单源 lib/haptics·照抄 pages/flip-demo）
  lastVibe: 0, // 事件震（vibe()）时间戳（同上·两类震共用时间地板防叠震）
  _backAt: 0, // 返回二次确认判定锚点（P5·BACK_CONFIRM_MS 窗口内二次按返回才真退，见 onBack）
  _castConnectedAt: 0, // 投屏 connected 置位时间戳（批7·castReclaimDue 时间窗锚点）：投屏建立瞬间本机可能补发 play 抖动，满窗后的本机 play 才认「播放已回手机」
  _guardTimer: 0, // 返回垫层重装定时器 id（onGuardLeave 落 false 后延时拉回 true·onUnload 必 clearTimeout）
  _guardExiting: false, // 真退中标志：exitPlayer 置位后重装定时器不得再拉起垫层（否则 navigateBack 被自己的垫层吃掉）

  async onLoad(query: Record<string, string | undefined>) {
    const info = wx.getWindowInfo()
    this.windowWidthPx = info.windowWidth || 0 // rpx→px 换算基准（750rpx = 本机 windowWidth px），供拖动预览浮层防出屏边距用
    // 入口态横屏对齐（评审 finding 复核，P2）：手机进页面那一刻若已physical横置（分享链外部唤起/上一页
    // 已横置未转回等），onResize 只在「已在页面上再次旋转」时触发——不补这一手，landscape 会带着 false
    // 假设撑到下一次真实旋转，.land 覆写族与后续 playSegment 的取址 mode 都会算错。此处与 onResize 用
    // 同一套宽高比判据，随首次 setData 一并落地（早于下方 playSegment 调用，故首次取址即已对齐）。
    const landscape = (info.windowWidth || 0) > (info.windowHeight || 0)
    // overlayTop 先落保守兜底（状态栏+58px≈顶栏两行标题高度），applyChromeMetrics 实测顶栏底边后精化——
    // 不落兜底则首帧 segstrip/单击提示仍压状态栏一闪（批5 真机走查修）。
    this.setData({ statusBarHeight: info.statusBarHeight, landscape, overlayTop: (info.statusBarHeight || 0) + 58 })
    this.applyChromeMetrics(info.windowWidth || 0)
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
    // 投屏顶栏首次气泡（T1）：storage 读失败视同已展示（fail-open，抄 DESK_GUIDE_KEY 三 try/catch 手法）——
    // 宁可少弹一次不可反复打扰。
    let castTipShown = true
    try {
      castTipShown = !!wx.getStorageSync(CAST_TIP_KEY)
    } catch {
      castTipShown = true
    }
    if (!castTipShown) {
      this.setData({ castTip: true })
      try {
        wx.setStorageSync(CAST_TIP_KEY, 1)
      } catch {
        // 存不上只影响下次是否重复弹，不影响本次展示
      }
    }
    await this.playSegment(start, 'enter')
  },

  // 侧滑返回垫层武装（P5 升级·批5）：page-container 需页面就绪后再 show（onLoad 同步 setData 有平台时序坑）。
  // 一律武装（含 missing/denied 等态）——返回行为全页统一走 onBack 决策链，不按状态分叉出第二套。
  onReady() {
    this.setData({ backGuard: true })
  },

  // 手机横屏播放（R41·批3）：pageOrientation:auto 下页面尺寸变化回调（基础库 2.4.0）。旋转是本批灵魂
  // 触发点——_seekRect 必须失效重测：旋转后 seek 条几何全变（横屏布局 .lp-seek 的 left/width 与竖屏
  // 完全不同），不清缓存则拖动定位全错（secAt 用旧 rect 算出的秒数落在错误位置）。windowWidthPx 同步
  // 刷新——previewLeftPx 的 rpx→px 换算基准随窗口宽度变，横屏下若不更新会用竖屏宽度换算防出屏边距。
  onResize(res: WechatMiniprogram.Page.IResizeOption) {
    const sz = res && res.size
    if (!sz) return
    const landscape = sz.windowWidth > sz.windowHeight
    this.windowWidthPx = sz.windowWidth || this.windowWidthPx
    if (landscape === this.data.landscape) return
    this._seekRect = null
    this.setData({ landscape }, () => this.measureSeekRect())
    this.applyChromeMetrics(sz.windowWidth || this.windowWidthPx) // 旋转后胶囊矩形/顶栏高度全变，避让与浮层锚点随之重算（批5）
    // 换源方案（casting connected 时电视持有源，旋转手机不换源；swapSource 对同 url 自动 no-op，故回
    // 竖屏时无横屏源的段不产生动作，见 rotateSwapPlan）。
    const plan = rotateSwapPlan(this.data.current, landscape, this.data.casting === 'connected')
    if (plan) void this.swapSource(plan)
  },

  async playSegment(seg: FlatSegment, scene: 'enter' | 'seg' | 'retry') {
    if (scene !== 'retry') {
      this.errSeg = '' // 换段（非重试）重置视频加载失败重试计数
      this.errRetried = false
    }
    this.watchReported = false // 新段（含重试重入）＝新观看单元·允许再上报一次 watch_at
    const token = ++this.playToken // 本次切段令牌·await 后复核，防慢回旧段覆盖新段
    this._resumeAt = 0 // 换段作废未消费的续位秒（防跨段泄漏 P1）：否则新段首个 onVideoPlay 会把旧段的
    // 续位秒 seek 进新段——换源已 setData 新 src 但 play 事件未发时用户切段即触发。
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
    // segDone/strip/capText 一并重算（completed=false）：新段是新的播放单元，旧段的播完通栏不该带过来（P4）。
    // seekPct/markVMs/snapName 一并归零：自绘 seek 条填充/节点位图/磁吸气泡都属旧段，不带过来（批C）。
    const strip = lessonStrip(this.course, seg.segmentId, false)
    this.setData({
      state: 'loading',
      current: seg,
      src: '',
      paused: false,
      curSec: 0,
      durSec: 0,
      curClock: '0:00',
      durClock: '0:00',
      seeking: false,
      segDone: false,
      strip,
      capText: buildCapText(strip, false, this.course, seg.segmentId),
      seekPct: 0,
      markVMs: [],
      snapName: '',
      previewLeft: 0,
    })
    let url = ''
    try {
      // 模式感知取址（R41 手机横屏）：手机已横屏用横屏源（无横屏成片的段自然降级回 portrait，见
      // playbackModeFor）。批7 起判据不再含 casting——投屏＝单段一次性投放，切段永远发生在退出投屏之后
      // （onPrev/onNext 先经 endCastingForSwitch 收口），投屏专属的横屏源由 onCast 拉起前置换（swapSource），
      // 本方法无需再感知投屏态。
      const mode = playbackModeFor(seg, this.data.landscape)
      url = await cache.get(this.courseId, seg.segmentId, mode)
      // 取址期间可能漂移：手机转回竖屏——补一次复核，只在「手机已不再横屏」时才真回退取竖屏源。
      if (mode === 'landscape' && !this.data.landscape) {
        url = await cache.get(this.courseId, seg.segmentId, 'portrait')
      }
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
    this.setData(
      {
        state: 'playing',
        src: url,
        canPrev: !!navSegment(this.course, seg.segmentId, -1),
        canNext: !!navSegment(this.course, seg.segmentId, 1),
      },
      () => {
        // 首次量取 seek 条布局；换段重入该回调时已有值即跳过——底条布局不随段变化，无需重量。
        if (!this._seekRect) this.measureSeekRect()
      }
    )
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
    // 投屏回本机兜底（批7·守卫 rw-mp-player-immersive-casting）：投屏中本机不播，本机重新开播＝投屏已
    // 不在（原生控件退出/电视关机断连/任何未知路径）——平台断连事件不可靠（castinginterrupt 播完不触发），
    // 这是唯一兜底信号；castReclaimDue 时间窗挡投屏建立瞬间的事件抖动。
    if (castReclaimDue(this.data.casting, this._castConnectedAt, Date.now())) this.reclaimFromCasting()
    this.onFirstPlay()
    this.setData({ paused: false })
    // 用户经系统手势/重播外路径恢复播放时，完成态不该残留（P4）：常规路径已由 onReplay/playSegment 复位，
    // 这里兜底任何其他恢复播放的入口（如原生投屏面板暂停后又本机继续播）。
    if (this.data.segDone) this.exitSegDone()
    // 换源续位（R40 swapSource 单出口）：续位按方案A 横竖时间轴对齐假设（同一秒数跨版本等义·待用户拍板，
    // 见 docs/待办与债.md）——换源后新 src 首次真正开播时把播放位置续到换源前的秒数，不从头重看。
    if (this._resumeAt > 0) {
      const s = this._resumeAt
      this._resumeAt = 0
      wx.createVideoContext('lp-video', this).seek(s)
    }
  },

  // 退出播完完成态（P4）单出口：恢复播放的三条路径（onVideoPlay 兜底/onReplay/onSeekEnd）共用——
  // 重算 strip/capText（completed=false）+ 复位 segDone；extra 并入同一次 setData（onSeekEnd 要一并收口拖动态）。
  exitSegDone(extra: Partial<{ seeking: boolean; snapName: string }> = {}) {
    const cur = this.data.current
    const strip = cur ? lessonStrip(this.course, cur.segmentId, false) : null
    this.setData({ ...extra, segDone: false, strip, capText: buildCapText(strip, false, this.course, cur ? cur.segmentId : '') })
  },
  onVideoPause() {
    this.setData({ paused: true })
  },

  // 段落播完（P4·设计拍板 2026-07-11）：不再自动切下一段——停在完成态，通栏「重播本段」+ segstrip
  // 文案三态（见 buildCapText）由用户自己选重播/上一段/下一段（守卫 rw-mp-player-no-autonext）。
  // 投屏连续播分叉已退役（批7）：电视播完无任何回报事件（本机 ended 不触发·平台感知盲区），投屏中本机
  // 也不在播——本回调在投屏期间实际不会响，无需分叉；全局统一停完成态。
  onEnded() {
    const cur = this.data.current
    if (!cur) return
    trackEvent('segment_done', 'player', cur.segmentId, { courseId: this.courseId, lessonId: cur.lessonId, segmentId: cur.segmentId, at: this._at, dur: this._dur })
    const strip = lessonStrip(this.course, cur.segmentId, true)
    this.setData({ segDone: true, paused: true, strip, capText: buildCapText(strip, true, this.course, cur.segmentId) })
  },

  // 通栏重播（P4 新增）：从头重来一遍，退出完成态。
  onReplay() {
    const cur = this.data.current
    if (!cur) return
    const ctx = wx.createVideoContext('lp-video', this)
    ctx.seek(0)
    ctx.play()
    this.exitSegDone()
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
  // 首次 tap 永久关闭单击提示条（页面实例级 data.hintDismissed·不持久化·无定时器）。
  onTapVideo() {
    if (this.data.state !== 'playing' || !this.data.src) return
    if (!this.data.hintDismissed) this.setData({ hintDismissed: true })
    const ctx = wx.createVideoContext('lp-video', this)
    if (this.data.paused) ctx.play()
    else ctx.pause()
  },

  // 进度上报（250ms 节流·seeking 时不覆盖显示值·秒取整减频 setData）；同步补自绘 seek 条填充百分比 seekPct；
  // 首次拿到非零 durSec 时顺带算一次关键动作节点位图 markVMs（durSec 已有值后不重算——布局不随后续 timeupdate 变）。
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
    const seekPct = durSec ? Math.min(100, Math.round((curSec / durSec) * 10000) / 100) : 0
    const patch: Record<string, unknown> = { curSec, durSec, curClock: formatClock(curSec), durClock: formatClock(durSec), seekPct }
    if (durSec && !this.data.durSec) {
      const cur = this.data.current
      const marks = cur ? cur.marks : []
      patch.markVMs = marks
        .filter((m) => m.at <= durSec)
        .map((m) => ({ at: m.at, pct: Math.min(100, Math.round((m.at / durSec) * 10000) / 100), name: m.name }))
    }
    this.setData(patch)
  },

  // 自绘 seek 条量轨：首次播放成功后量一次（playSegment 的 state:'playing' 回调守卫 !_seekRect），换段不重量。
  // width>0 才落缓存：若这次 setData 回调触发时 .lp-seek 尚未真正上屏（布局未提交的已知小程序时序坑），
  // boundingClientRect 会回一个非空但 width:0 的节点——写入 _seekRect 会被 onSeekStart 的 !this._seekRect
  // 守卫误判为「已测过」、永不再触发重测，secAt() 从此恒因 !rect.width 返回 0（整条自绘 seek 交互失效）。
  measureSeekRect() {
    wx.createSelectorQuery()
      .in(this)
      .select('.lp-seek')
      .boundingClientRect()
      .exec((res: { left: number; width: number }[]) => {
        const r = res && res[0]
        if (r && r.width > 0) this._seekRect = { left: r.left, width: r.width }
      })
  },
  // 顶栏胶囊避让 + 顶部浮层锚点（批5 真机走查修·根因#8「构建过≠真机能用」实锤：真机胶囊压住投屏钮、
  // segstrip/单击提示压状态栏）：胶囊矩形与顶栏实测底边动态算（CLAUDE §4 胶囊避让用动态算、不硬编码）。
  applyChromeMetrics(windowWidth: number) {
    let castPadRight = 100 // 取不到胶囊矩形（个别机型/横屏下 API 异常）时的保守留白
    try {
      const menu = wx.getMenuButtonBoundingClientRect()
      if (menu && menu.left > 0 && windowWidth > 0) castPadRight = Math.max(0, windowWidth - menu.left) + 8
    } catch {
      // 保守留白已就位
    }
    this.setData({ castPadRight }, () => this.measureTopbar())
  },
  // 顶部浮层锚点＝顶栏实测底边 + 6px：量不到（rect 缺席/高度 0 的已知时序坑）保留兜底值不覆盖。
  measureTopbar() {
    wx.createSelectorQuery()
      .in(this)
      .select('.lp-topbar')
      .boundingClientRect()
      .exec((res: { bottom: number }[]) => {
        const r = res && res[0]
        if (r && r.bottom > 0) this.setData({ overlayTop: Math.round(r.bottom) + 6 })
      })
  },
  // 拖动预览浮层 left 像素值（seekPct→px·夹在 [PREVIEW_EDGE_RPX, 轨道宽-PREVIEW_EDGE_RPX] 内防出屏）：
  // 用测得的 _seekRect.width（px，与 boundingClientRect 同坐标系）算原始落点，再用 windowWidthPx 把
  // PREVIEW_EDGE_RPX 换算成同一 px 坐标系夹取——JS 定值替代 WXSS clamp()（见 PREVIEW_EDGE_RPX 注）。
  // 轨道过窄（宽度不足两倍边距，理论上不会发生·seek 条横跨屏宽）时不夹取，退化为居中挂在落点上。
  previewLeftPx(seekPct: number): number {
    const trackWidth = this._seekRect ? this._seekRect.width : 0
    if (!trackWidth) return 0
    const raw = (seekPct / 100) * trackWidth
    const edgePx = (PREVIEW_EDGE_RPX / 750) * (this.windowWidthPx || 0)
    if (trackWidth <= edgePx * 2) return raw
    return Math.min(Math.max(raw, edgePx), trackWidth - edgePx)
  },
  // 拖动秒定位（clientX→秒）：量轨未就绪/durSec=0 返回 0（不除零），clampSeek 兜越界。
  secAt(clientX: number): number {
    const rect = this._seekRect
    const durSec = this.data.durSec
    if (!rect || !rect.width || !durSec) return 0
    const raw = Math.round(((clientX - rect.left) / rect.width) * durSec)
    return clampSeek(raw, durSec)
  },
  // 拖动显示态共享更新（onSeekStart 落点/onSeekMove 逐帧共用一份实现，勿复制两份——病根#5）：
  // 磁吸命中关键动作节点则显示秒钉在节点上；震感配方（用户真机拍板定版，照抄 pages/flip-demo onJogMove
  // 结构）——逐秒轻嗒（shouldTick·40ms 钳制快扫跳齿）+ 进节点重嗒（vibe('medium')·≥80ms 节流，两类震
  // 共用 lastTick/lastVibe 时间地板防叠震）。本方法与 onSeekMove 均绝不调用 .seek(——两段式语义。
  updateSeekDisplay(clientX: number) {
    const raw = this.secAt(clientX)
    const durSec = this.data.durSec
    const cur = this.data.current
    // marks 未按 durSec 过滤（与 onTimeUpdate 的 markVMs 不同源）：磁吸命中的 mark.at 可能落在 (durSec, durSec+窗口]
    // 之外（如标注时长与实际编码时长有出入），命中后必须再经 clampSeek 兜一次，不能让磁吸结果绕过边界钳制
    // （不在 marks 源头过滤——放最终落点收口更省一次遍历，效果等价）。
    const marks = cur ? cur.marks : []
    const hit = nearestMark(raw, marks, MARK_SNAP_SEC)
    const sec = clampSeek(hit ? hit.at : raw, durSec)
    const seekPct = durSec ? Math.min(100, Math.round((sec / durSec) * 10000) / 100) : 0
    this.setData({ curSec: sec, curClock: formatClock(sec), seekPct, snapName: hit ? hit.name : '', previewLeft: this.previewLeftPx(seekPct) })
    const now = Date.now()
    if (shouldTick(this._seekPrevSec, sec, now - Math.max(this.lastTick, this.lastVibe), DRAG_TICK_GAP_MS)) {
      this.lastTick = now
      this._seekPrevSec = sec
      wx.vibrateShort({ type: 'light' })
    }
    if (hit && hit.at !== this._lastSnapAt) {
      this._lastSnapAt = hit.at
      this.vibe('medium')
    }
  },
  // 拖动起点：量轨未就绪先补量、本次不响应（同 pages/flip-demo !maxJ 先例）；segDone 完成态下 state 仍是
  // 'playing'（onEnded 不改 state·现场核实），天然放行——完成态下用户仍可拖 seek 条回看（见 onSeekEnd）。
  onSeekStart(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.durSec || this.data.state !== 'playing') return
    if (!this._seekRect) {
      this.measureSeekRect()
      return
    }
    this._seekPrevSec = this.data.curSec
    this._lastSnapAt = -1
    this.setData({ seeking: true })
    this.updateSeekDisplay(e.touches[0].clientX)
  },
  // 拖动中：两段式语义——只改显示，绝不 seek（真 seek 会被 timeupdate/卡顿顶回去，两段式即破坏）。
  onSeekMove(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.seeking) return
    this.updateSeekDisplay(e.touches[0].clientX)
  },
  // 松手：真正 seek 到显示秒；完成态下拖动＝用户想回看，恢复播放并退出完成遮罩（同 onReplay 语义，
  // completed=false——不留播完遮罩挡住刚拖到的画面）。
  onSeekEnd() {
    if (!this.data.seeking) return
    const ctx = wx.createVideoContext('lp-video', this)
    ctx.seek(this.data.curSec)
    if (this.data.segDone) {
      ctx.play()
      this.exitSegDone({ seeking: false, snapName: '' })
      return
    }
    this.setData({ seeking: false, snapName: '' })
  },
  // 事件震（进节点重嗒）单出口：≥VIBE_GAP_MS 节流，与拖动阻尼「嗒」共用 lastVibe/lastTick 时间地板防叠震
  // （配方单源 lib/haptics·数值为用户真机拍板定版，照抄 pages/flip-demo 已验实现，改动需用户重新拍板）。
  vibe(type: 'light' | 'medium') {
    const now = Date.now()
    if (now - this.lastVibe < VIBE_GAP_MS) return
    this.lastVibe = now
    wx.vibrateShort({ type })
  },

  // 换源衔接单出口（R40·批3 横屏复用，勿写成投屏专用）：同一段内切清晰度版本——只换 src，不改 state/
  // marks/strip。await 取址期间可能已换段/已退出播放态，token 复核 + state 复核双保险，url 与现 src
  // 相同（云端降级回同源）也不重复 setData。
  async swapSource(mode: PlaybackMode) {
    const cur = this.data.current
    if (!cur || this.data.state !== 'playing') return
    const token = ++this.playToken
    const at = this._at
    let url = ''
    try {
      url = await cache.get(this.courseId, cur.segmentId, mode)
    } catch {
      return
    }
    if (token !== this.playToken || !url || url === this.data.src) return
    this._resumeAt = at
    this.setData({ src: url })
  },

  // 一键投屏（T1 顶栏钮·主路径 show-casting-button 已在 wxml 开启，本函数是自绘入口）：拉起系统选择器前
  // 先按 hasLandscape 换源到横屏（云端未上线/该段无横屏成片则 playbackModeFor 安全降级、不换源）。
  // 已知平台盲区（决策已定·不加投机守护）：用户在系统投屏选择器里直接取消——无任何回调/事件，本机会
  // 继续播放已换好的横屏源（contain 显示，方案A 时间轴对齐内容零损，可接受）；用户再点投屏钮或手动切段
  // 会自然恢复。平台约束记录（批7 查证·排查线索）：四个投屏方法官方均标「仅支持在 tap 事件回调内调用」，
  // 本方法 await swapSource（冷取址走网络）后才调 startCasting，可能已脱离 tap 同步上下文——真机现状能
  // 投上（缓存命中时 await 纯 microtask），若下轮真机出现「首次投屏（冷取址）设备框不弹」，第一嫌疑在此。
  async onCast() {
    if (this.data.state !== 'playing' || !this.data.src) return
    if (this.data.castTip) this.setData({ castTip: false })
    const ctx = wx.createVideoContext('lp-video', this) as unknown as { startCasting?: (opt: { success?: () => void; fail?: () => void }) => void }
    // 特性检测（miniprogram-api-typings 未收录 startCasting·基础库 2.32.0 起才有）：
    // 低版本微信不支持时直接调用会抛错崩交互，先探测再调用。
    if (typeof ctx.startCasting !== 'function') {
      wx.showToast({ title: '当前微信版本过低，暂不支持投屏，请更新微信后重试', icon: 'none' })
      return
    }
    const mode = playbackModeFor(this.data.current, true)
    if (mode === 'landscape' && this.data.src) await this.swapSource('landscape')
    if (this.data.state !== 'playing') return // await 期间可能已离开播放态（换段/出错/退出）
    ctx.startCasting({
      success: () => {
        this.setData({ casting: 'connecting' })
      },
      fail: () => {
        wx.showToast({ title: '投屏失败，请确认电视与手机同一 Wi-Fi', icon: 'none' })
        // 投屏没成不滞留投屏专属的横屏源：换回「非投屏态该有的模式」——不是无条件写死 portrait，手机
        // 此刻若本身仍物理横屏（R41），目标仍应是 landscape，playbackModeFor 按 this.data.landscape
        // 重新判定（该段确有横屏源才需要换，否则本就没换过，见 hasLandscape 门；评审 finding 复核，P2）。
        if (this.data.current && this.data.current.hasLandscape) void this.swapSource(playbackModeFor(this.data.current, this.data.landscape))
      },
    })
  },
  // 用户在系统投屏选择框选中设备（批6 真机修·根因#8）：这是「已开始投屏」最可靠的信号——直接判 connected，
  // 不再赌 castingstatechange 的 detail.state 字符串（真机首测证实：卡在 connecting，state 关键词对不上）。
  // 选中即接管：casting=connected 让底栏共存条立即生效（连续播已批7 退役——电视播完该段无回报事件，回手机
  // 接着看）；连接若随后失败，castinginterrupt/castingstatechange(fail) 会走 stopCastingCleanup 回退。
  onCastingUserSelect(e: WechatMiniprogram.CustomEvent<{ deviceName?: string; name?: string }>) {
    const detail = (e && e.detail) || {}
    const castDevice = String(detail.deviceName || detail.name || '')
    this.castTelemetry('select', '', detail) // detail 真实形状回传（可观测·真机校准判定用）
    // 承诺文案与平台现实对齐（批7）：电视播完该段不会自动接下一段（无回报事件·连播已裁决退役），如实说。
    wx.showToast({ title: '已投屏 · 电视播完这段后回手机接着看', icon: 'none' })
    this._castConnectedAt = Date.now() // 回本机兜底时间窗锚点（castReclaimDue·挡建立瞬间事件抖动）
    this.setData({ casting: 'connected', castDevice })
  },
  // 投屏状态变化（批6：connected 主信号已移到 onCastingUserSelect，本回调只兜断连 + 兜个别不发 userselect
  // 的机型）：官方文档 detail = { type, state: "success"/"fail" }（一次性结果事件、非状态机·批7 查证），
  // success 补入 connected 兜底关键词；disconnect/exit/connect/project 宽匹配保留（官方 type 字段取值
  // 未文档化，埋点 castTelemetry 继续回传真值收敛）。
  // 判序不能反：JS 字符串 'disconnect'/'disconnected' 本身含子串 'connect'（'dis'+'connect'），若先判
  // connect/project 会把断连事件误吞成「已连接」、断连清理分支永远死代码（评审 finding 复核）——
  // 断连/失败关键词必须先判，未命中再判连接关键词（兜底补 connected，不重复 toast·userselect 已提示）。
  onCastingStateChange(e: WechatMiniprogram.CustomEvent<{ state?: string }>) {
    const state = String((e.detail && e.detail.state) || '').toLowerCase()
    this.castTelemetry('state', state, (e && e.detail) || {}) // detail.state 真实取值回传（真机校准·可观测）
    if (state.includes('disconnect') || state.includes('exit') || state.includes('fail')) {
      this.stopCastingCleanup()
    } else if ((state.includes('success') || state.includes('connect') || state.includes('project')) && this.data.casting !== 'connected') {
      this._castConnectedAt = Date.now() // 与 userselect 同源置锚（兜底路径也要有时间窗，否则 castReclaimDue 恒 false 兜底失效）
      this.setData({ casting: 'connected' }) // 兜底：个别机型可能不发 castinguserselect，凭状态补齐 connected
    }
  },
  onCastingInterrupt(e?: WechatMiniprogram.CustomEvent<Record<string, unknown>>) {
    this.castTelemetry('interrupt', '', (e && e.detail) || {})
    // toast 过 casting 门（评审 P3）：真断连时若 reclaimFromCasting 已先兜底清态（本机先开播），平台迟到的
    // interrupt 不该再叠一条「已断开」——埋点照打（观测保留），提示只在投屏态还在时弹。
    if (this.data.casting) wx.showToast({ title: '投屏已断开', icon: 'none' })
    this.stopCastingCleanup()
  },
  // 投屏事件回传单出口（批5·根因#8）：castingstatechange/interrupt 的 detail 真实形状官方未文档化、
  // 代码只能保守子串判定——把真机看到的原始值经既有 trackEvent（events 集合）带回来，读到真值后收敛
  // 判定条件；fire-and-forget 不影响交互，低频事件不惧限频。
  castTelemetry(evt: string, state: string, detail: Record<string, unknown>) {
    const cur = this.data.current
    if (!cur) return
    trackEvent('cast_state', 'player', cur.segmentId, { evt, state, keys: Object.keys(detail).join(',') })
  },
  // 断连/退出投屏共用单出口：回本机学习模式（R38 复归·casting 已清）；换回目标不是无条件写死
  // portrait——手机此刻若本身仍物理横屏（R41），断投屏后仍应留在 landscape，playbackModeFor 按
  // this.data.landscape 重新判定（该段确有横屏源才需要换，无横屏源本就一直在 portrait、换回是 no-op
  // 但避免误取址；评审 finding 复核，P2）。
  stopCastingCleanup() {
    if (!this.data.casting) return
    this._castConnectedAt = 0 // 时间窗锚点一并清（下次投屏重新置锚·防旧锚让 castReclaimDue 立即真）
    this.setData({ casting: '', castDevice: '' })
    if (this.data.current && this.data.current.hasLandscape) void this.swapSource(playbackModeFor(this.data.current, this.data.landscape))
  },
  // 回本机兜底单出口（批7·onVideoPlay 挂载·守卫钉）：castReclaimDue 满窗命中＝投屏已不在（原生控件退出/
  // 电视关机断连/换源踢断等一切未知路径）而本机已重新开播——清态让 UI 跟上现实；埋点回传（可观测：真机
  // 若出现误杀「电视还在播却被回收」，events 里能看到 reclaim 频次校准时间窗）。
  reclaimFromCasting() {
    this.castTelemetry('reclaim', '', {})
    wx.showToast({ title: '投屏已结束 · 回手机继续播', icon: 'none' })
    this.stopCastingCleanup()
  },
  // 投屏态切段收口单出口（批7·onPrev/onNext 开头挂载·守卫钉）：DLNA 换 src 电视不跟随（无换内容接口），
  // 切段的真实结果就是回手机播新段——先退投屏（tap 同步链内调 exitCasting，满足「仅 tap 回调内调用」平台
  // 约束）+ 清态 + 如实提示，让 UI 与行为一致；非投屏态零动作。
  endCastingForSwitch() {
    if (!this.data.casting) return
    this.castTelemetry('switch-exit', '', {})
    const ctx = wx.createVideoContext('lp-video', this) as unknown as { exitCasting?: () => void }
    if (typeof ctx.exitCasting === 'function') {
      try {
        ctx.exitCasting()
      } catch {
        // 投屏可能早已断开（换源踢断/电视关机），此时退出调用失败无碍——本地清态才是目的
      }
    }
    wx.showToast({ title: '已回到手机继续播 · 可再点投屏', icon: 'none' })
    this.stopCastingCleanup()
  },
  // 投屏共存态「退出投屏」钮（批6·与原生投屏共存；批7 改 fail-safe）：exitCasting 特性检测（同 startCasting
  // 惯例，低版本微信直接调用会报错）。video 版 exitCasting 官方签名 (): void——无 success/fail/complete
  // 回调（api-typings 逐字·有回调的是 LivePlayerContext 版），批6 把清态挂在 complete 里＝永不执行、投屏
  // UI 卡死（真机第三轮实锤）——清态必须同步无条件执行，不赌任何平台回调；exitCasting 尽力通知平台即可。
  onCastExit() {
    const ctx = wx.createVideoContext('lp-video', this) as unknown as { exitCasting?: () => void }
    if (typeof ctx.exitCasting === 'function') {
      try {
        ctx.exitCasting()
      } catch {
        // 投屏可能早已断开，退出调用失败无碍——本地清态才是目的
      }
    }
    wx.showToast({ title: '已退出投屏', icon: 'none' })
    this.stopCastingCleanup()
  },
  // 顶栏投屏首次气泡关闭（T1·手动关或点投屏钮时顺手关，见 onCast 开头）。
  onCastTipClose() {
    this.setData({ castTip: false })
  },

  // 求助面板入口（P3·播放器重设计战役批D）：占常规播放键位的求助钮不再直连客服，改拉起底部 sheet——
  // 客服真调用移入面板卡1（onHelpContact，守卫 rw-mp-customer-service-wired 触点表钉这里）；播放不阻断
  // （唯一暂停例外＝内嵌视频播放，见 onHelpPlaySegment）。wxml 上 bind:tap="onHelp" 绑定原样保留（守卫
  // rw-mp-player-immersive-casting 钉的是这个节点，与本方法体内调用什么无关）。
  onHelp() {
    this.setData({ helpPanel: 'menu' })
  },
  // 卡1 联系客服。
  onHelpContact() {
    openCustomerService()
  },
  // 卡2 帮助视频：进子层 + 每次重拉（短时 URL 过期特性·辅助内容低频不缓存，与主播放地址缓存策略不同）。
  onHelpVideos() {
    this.setData({ helpPanel: 'videos', helpVideosState: 'loading', helpTopics: [] })
    void this.loadHelpVideos()
  },
  async loadHelpVideos() {
    const token = ++this.helpVideosToken // 本次进入子层的请求令牌·await 后复核，防慢回旧请求覆盖新请求
    const r = await getHelpVideos()
    // 令牌不匹配＝更晚的一次 onHelpVideos 已接管（含「退出再重进 videos 层」这种 helpPanel 状态不变但
    // 请求已过期的场景，光判 helpPanel==='videos' 拦不住）：丢弃本次回包，不覆盖新数据。
    if (token !== this.helpVideosToken) return
    if (this.data.helpPanel !== 'videos') return // 用户已退出 videos 层（返回/关面板）：同样丢弃，不写脏 state
    const topics = mapHelpVideos(r)
    this.setData(topics.length ? { helpVideosState: 'ok', helpTopics: topics } : { helpVideosState: 'empty', helpTopics: [] })
  },
  // 卡3 常见问题：诚实空态（云端 FAQ 单源=客服知识库 KB，无面向小程序的公开下发接口，R37b 已立需求——不造假 Q&A）。
  onHelpFaq() {
    this.setData({ helpPanel: 'faq' })
  },
  // 子层顶部返回箭头：回 menu（videos/faq 共用同一个方法）。
  onHelpBackMenu() {
    this.setData({ helpPanel: 'menu' })
  },
  // 关面板：scrim 点击 / grab 区关闭钮共用——helpSrc 一并清（卸载内嵌 <video>，防后台仍在解码占用流量）。
  onHelpClose() {
    this.setData({ helpPanel: '', helpSrc: '', helpSegName: '' })
  },
  // 点可播段（url 非 null）→ 同一 sheet 内切到内嵌播放视图；先暂停主视频防双声（P3b-play 简化决策：
  // 辅助内容用原生 <video controls>，不做自绘控制条，见 wxml 头注）。
  onHelpPlaySegment(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { url?: string; name?: string }
    const url = String(ds.url || '')
    if (!url) return // 无地址段（url:null）置灰不可点——理论到不了这里，双保险
    wx.createVideoContext('lp-video', this).pause()
    this.setData({ helpSrc: url, helpSegName: String(ds.name || '') })
  },
  // 内嵌播放视图返回箭头：回列表（helpPanel 保持 'videos'）——不自动恢复主视频，用户自己点单击画面。
  onHelpVideoBack() {
    this.setData({ helpSrc: '', helpSegName: '' })
  },
  onHelpVideoError() {
    wx.showToast({ title: '这段视频暂时播放不了', icon: 'none' })
  },
  // 求助面板遮罩/壳体锁背景滚动的占位 handler（catch:touchmove 绑定必须真实存在，抄写错题本 E2：
  // wxml 事件绑定与 ts 方法定义是一对，抄一半＝真机报错）。
  noop() {},

  // 返回（P5·设计拍板③每次返回都出现二次确认；P5b④首次成功退出加桌引导）：求助面板开着时先逐层
  // 收口（四级链：内嵌播放→videos/faq 列表→menu→关面板），不计入退出确认；面板已关时才走二次确认。
  onBack() {
    if (this.data.helpSrc) {
      this.setData({ helpSrc: '', helpSegName: '' })
      return
    }
    if (this.data.helpPanel === 'videos' || this.data.helpPanel === 'faq') {
      this.setData({ helpPanel: 'menu' })
      return
    }
    if (this.data.helpPanel === 'menu') {
      this.setData({ helpPanel: '' })
      return
    }
    const now = Date.now()
    if (now - this._backAt > BACK_CONFIRM_MS) {
      this._backAt = now
      wx.showToast({ title: '再返回一次退出', icon: 'none' }) // 文案兼容箭头点击与侧滑手势两条路径（批5 措辞微调）
      return
    }
    // 窗口内第二按：已展示过加桌引导直接真退；否则弹一次引导、不退（storage 读失败 fail-open 视同
    // 已展示——宁可少弹一次不可卡住用户退出）。
    let shown = true
    try {
      shown = !!wx.getStorageSync(DESK_GUIDE_KEY)
    } catch {
      shown = true
    }
    if (!shown) {
      try {
        wx.setStorageSync(DESK_GUIDE_KEY, 1)
      } catch {
        // 存不上只影响下次是否重复弹，不影响本次展示——宁可多弹一次不可读写失败卡退出
      }
      let ios = false
      try {
        ios = wx.getDeviceInfo().platform === 'ios'
      } catch {
        ios = false
      }
      this.setData({ deskGuide: true, deskGuideIOS: ios })
      return
    }
    this.exitPlayer()
  },
  // 侧滑/系统返回被 page-container 垫层消耗（bind:leave·批5）：先重新武装（平台要求先落 false 再延时拉回
  // true——同 tick 重复 show 不生效），再走与自绘返回箭头完全同一条 onBack 决策链（面板逐层收口/二次确认/
  // 加桌引导）；真退路径由 exitPlayer 置 _guardExiting 阻断重装。定时器 onUnload 必清（孤儿定时器会对已退
  // 页 setData）。
  onGuardLeave() {
    if (this._guardExiting) return // 真退中：撤垫层的 setData 若在某些机型反触发 leave，不得再进 onBack 链（防双重 navigateBack）
    this.setData({ backGuard: false })
    if (this._guardTimer) clearTimeout(this._guardTimer)
    this._guardTimer = setTimeout(() => {
      if (!this._guardExiting) this.setData({ backGuard: true })
    }, 80) as unknown as number
    this.onBack()
  },
  // 真退单出口：原生返回栈优先，深链无上级页兜底回首页（既有兜底逻辑原样保留）。
  // 批5：垫层还在场时（自绘箭头路径）navigateBack 会先被自己的垫层吃掉一层——先撤垫层再退；
  // _guardExiting 置位让 onGuardLeave 的重装定时器失效，防「撤了又被装回去」死循环。
  exitPlayer() {
    this._guardExiting = true
    const go = () => {
      const pages = getCurrentPages()
      if (pages.length > 1) wx.navigateBack()
      else wx.reLaunch({ url: '/pages/home/home' }) // 深链直接进入播放页（无上级页可退）时兜底回首页
    }
    if (this.data.backGuard) this.setData({ backGuard: false }, go)
    else go()
  },
  // 加桌引导（P5b）：继续学习＝关弹窗留下（不退）；先退出＝执行真退。
  onDeskGuideStay() {
    this.setData({ deskGuide: false })
  },
  onDeskGuideExit() {
    this.setData({ deskGuide: false })
    this.exitPlayer()
  },

  // 段落导航（批7：投屏态先经 endCastingForSwitch 收口——换 src 电视不跟随，切段真实结果=回手机播新段，
  // UI 必须先跟上；非投屏态该收口零动作）。收口放在 navSegment 判定之前：到边界段（无上/下一段）时切段
  // 不会发生，但用户点了按钮＝表达了「要在手机上操作」的意图，投屏态同样该收口回本机（否则边界段上点
  // 切段钮毫无反馈、投屏态还挂着）。
  onPrev() {
    this.endCastingForSwitch()
    const cur = this.data.current
    const prev = cur && navSegment(this.course, cur.segmentId, -1)
    if (prev) void this.playSegment(prev, 'seg')
  },
  onNext() {
    this.endCastingForSwitch()
    const cur = this.data.current
    const next = cur && navSegment(this.course, cur.segmentId, 1)
    if (next) void this.playSegment(next, 'seg')
  },
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
    if (this._guardTimer) clearTimeout(this._guardTimer) // 垫层重装定时器必清：孤儿定时器会对已退页 setData（批5）
    this.reportWatchAt()
  },
})
