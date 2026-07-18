// 课程播放页（M2 批11·竖屏沉浸全屏重设计批新增帮助入口）：video + 分段列表 + 上/下一段 +
// 进度上报 + 首帧埋点。鉴权 fail-closed 在云端（getPlaybackUrl 须本人已进课）；素材未剪 url:null → 空态不裂
// 播放器；未授权 → 导流激活页。地址经 TTL 缓存（切段回看零重复取址）。
// 自绘 seek 条（播放器重设计战役批C，取代原生 <slider>）：两段式语义——拖动中只改显示（onSeekStart/
// onSeekMove），松手才真 seek（onSeekEnd）；关键动作节点磁吸（nearestMark）+ 拖动阻尼震感配方照抄
// pages/flip-demo 已验真机参考实现（lib/haptics 单源 shouldTick/VIBE_GAP_MS/DRAG_TICK_GAP_MS）。
// 拖动浮层原设计有雪碧图缩略图窗（R36 后端未建），诚实降级为时间浮窗 + 命中节点时的鸭黄气泡。
import { trackEvent, getHelpVideos, getPublicFaq } from '../../api/learning'
import {
  flattenSegments,
  navSegment,
  formatClock,
  clampSeek,
  lessonStrip,
  nearestMark,
  type CoursePub,
  type FlatSegment,
  type LessonStrip,
} from '../../lib/player'
// 播放地址缓存单例迁 lib（批3·跨页取址预热·根因#15）：本地名仍叫 cache（守卫 rw-mp-player-prefetch-cache
// 正则钉 cache.prefetch(·且 catalog/me 共享同一实例才能预热·拆回页面私有即断跨页预热）。
import { playbackCache as cache } from '../../lib/playbackCache'
import { getCourseByIdDetailed } from '../../lib/courses'
import { getPageContent } from '../../lib/pageContent'
import { openCustomerService } from '../../utils/customerService'
import { shouldTick, VIBE_GAP_MS, DRAG_TICK_GAP_MS } from '../../lib/haptics'
import { mapHelpVideos, mapPublicFaq, type HelpTopicVM, type FaqItemVM } from '../../lib/mapLearning'
import { mapCatalogPlayer, type CatalogPlayerVM } from '../../lib/mapPages'

const TIME_UPDATE_THROTTLE_MS = 250
// 磁吸窗口（秒）：拖动秒数落在关键动作节点前后 3 秒内即吸附（批C 规格默认值·真机手感待调参 flag）。
const MARK_SNAP_SEC = 3
// 拖动预览浮层防出屏边距（rpx）：规格原定 CSS clamp(64rpx, ..., calc(100% - 64rpx)) 夹取，改在 JS 侧算好
// 像素值再传 px 内联样式——WXSS clamp() 是本仓首次出现的用法（无既有先例，真机支持度未经验证，CLAUDE.md
// §4 对同类兼容性存疑的 CSS 函数已有专门规避先例 backdrop-filter/color-mix()），JS 算值零风险等价替代。
const PREVIEW_EDGE_RPX = 64
// 返回二次确认窗口（ms·P5 设计拍板②）：每次返回都出现「再按一次返回退出」，非仅首次；侧滑/系统手势
// 返回无法拦截（WebView 页无 onBackPress——平台限制），仅本页自绘返回箭头点击经此判定。
const BACK_CONFIRM_MS = 2500
// 首次成功退出加桌引导 storage key（storage key 收敛·CLAUDE §7）：仅展示一次（P5b 设计拍板④）。
const DESK_GUIDE_KEY = 'ld_player_desk_guide_shown'

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

Page({
  data: {
    statusBarHeight: 0,
    capsuleBottom: 0, // 原生胶囊底边 y（px·onLoad 取 getMenuButtonBoundingClientRect().bottom）：段落进度条按此动态避让落胶囊下方（2026-07-13 反馈·Bug D1）
    videoRatio: 168, // 播放框比例 padding-top%（默认 1:1.68·onVideoMeta 拿素材真实宽高后贴合·去左右黑边·2026-07-13 反馈·Bug D2）
    title: '',
    segments: [] as FlatSegment[],
    current: null as FlatSegment | null,
    src: '',
    canPrev: false,
    canNext: false,
    state: 'loading' as 'loading' | 'playing' | 'empty' | 'denied' | 'missing' | 'error',
    paused: false, // 真实播放/暂停态·只认 bind:play/bind:pause 回报，不在 tap 里直接翻转当真相
    buffering: false, // 播放中缓冲失速角标（bind:waiting 起·timeupdate/play 恢复清·见 onVideoWaiting）
    bufferPct: 0, // 缓冲水位（0-100·bind:progress 的 e.detail.buffered 整段已加载百分比·seek 条底层灰条·换段清零·见 onVideoProgress）
    initialTime: 0, // 续播秒（<video> initial-time·仅组件首挂载读一次·换段/重试归 0 防续秒串段·见 playSegment/_wantAt）
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
    helpFaqState: 'loading' as 'loading' | 'ok' | 'empty', // 常见问题子层拉取态（R37b·KB 精选 FAQ 公开读·同 videos 每次重拉口径）
    helpFaqList: [] as FaqItemVM[], // 精选 FAQ VM（mapPublicFaq 产出）
    helpSrc: '', // 内嵌播放（P3b-play）地址：非空=切到播放视图；关面板/返回列表/退出播放视图清空
    helpSegName: '', // 内嵌播放视图顶部标题（=命中小段 name）
    deskGuide: false, // 首次成功退出加桌引导弹窗可见态（P5b·仅展示一次）
    deskGuideIOS: false, // 加桌引导分端文案（true=iOS「添加到我的小程序」·false=其余平台「添加到桌面」）
    help: mapCatalogPlayer(null).help as CatalogPlayerVM['help'], // 求助面板三卡标题 + FAQ（CMS·首帧默认·到达覆盖·批B）
  },
  courseId: '',
  unloaded: false, // 已退页标记（await 恢复点复核·同 welcome/catalog 范式·onUnload 置真）
  course: null as CoursePub | null,
  srcSetAt: 0,
  windowWidthPx: 0, // rpx→px 换算基准（onLoad 存·750rpx = windowWidthPx px）
  windowHeightPx: 0, // 视频框比例封顶基准（onLoad 存·防超高素材撑破屏·见 onVideoMeta）
  firstFrameScene: 'enter' as 'enter' | 'seg' | 'retry',
  firstFrameReported: false,
  playToken: 0, // 切段请求令牌（防乱序回包覆盖·守卫 rw-mp-player-stale-guarded）
  helpVideosToken: 0, // 帮助视频子层请求令牌（防乱序回包覆盖·同 playToken 惯用法·评审 finding 复核 2026-07-11
  // 批D 补丁：粗粒度 helpPanel==='videos' 判定无法区分「快速退出再进入」产生的新旧两次请求，慢的旧请求
  // 若晚于新请求回包，会用旧数据把刚渲染好的新列表覆盖回去——必须用自增代次精确丢弃过期回包）。
  helpFaqToken: 0, // 常见问题子层请求令牌（R37b·同 helpVideosToken 惯用法·防「快速退出再进入」乱序回包覆盖）
  errSeg: '', // 上次因视频加载失败重试过的段
  // 本段自动重试预算（课程链路审计 2026-07-17·替代原一次性 errRetried 布尔）：原布尔跨整段播放生命周期
  // 不复位——同段先后两次独立的瞬时网络抖动（中途正常播放数分钟）会让第二次直接跳过自动重试落硬失败态。
  // 改计数预算 2 次：容两次独立抖动自愈；预算耗尽即硬失败（保住原设计的「防不可恢复媒体无限重取死循环」——
  // 坏媒体每轮消耗一次预算，最多 2 轮即停，不会每 N 秒一次 getPlaybackUrl 打转）。换段/手动重试复位。
  errCount: 0,
  _bufTimer: null as ReturnType<typeof setTimeout> | null, // 缓冲失速升级定时器（onVideoWaiting 起·timeupdate/play 恢复即清·timer 必清理）
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
  _wantSeg: '', // onLoad 期望起播段（存实例供 initCourse 课程级失败重试后仍定位到原目标段）
  _wantAt: 0, // onLoad 期望续播秒（query.t·仅对目标段 _wantSeg 生效·playSegment 首次应用即清零·防换段/重试再续到旧秒串段）
  _resumeAt: 0, // 本次起播待物理落位的续播秒（=本次 initialTime·onVideoMeta 双保险 seek 兜底 initial-time 失效后消费清零·每次 playSegment 重置）

  async onLoad(query: Record<string, string | undefined>) {
    const info = wx.getWindowInfo()
    this.windowWidthPx = info.windowWidth || 0 // rpx→px 换算基准（750rpx = 本机 windowWidth px），供拖动预览浮层防出屏边距用
    this.windowHeightPx = info.windowHeight || 0 // 视频框比例封顶基准（防超高素材撑破屏·见 onVideoMeta）
    // 原生胶囊 rect（屏幕左上原点·px，与 .lp-stage inset:0 同坐标系）：段落进度条 top 按胶囊底边动态避让，
    // 逐机型胶囊位不同·statusBarHeight 近似不可靠（2026-07-13 反馈·Bug D1）。
    // 防御：PC/mac 客户端与部分安卓冷启动下该 API 可返回全 0 rect 甚至异常（社区反复确认的平台怪癖）——
    // 裸取 .bottom 会让段条 top:8px 撞状态栏、极端态 TypeError 打断 onLoad 整页死在加载骨架。
    // 兜底 statusBarHeight+36（常规胶囊 top≈sbh+4·高 32；sbh 自身也可为空，Number()||0 后 PC 上退化 36px）。
    const sbh = Number(info.statusBarHeight) || 0
    let capsuleBottom = 0
    try {
      const capsule = wx.getMenuButtonBoundingClientRect()
      if (capsule && Number.isFinite(capsule.bottom) && capsule.bottom > 0) capsuleBottom = capsule.bottom
    } catch {
      /* 无胶囊环境（PC 等）·走兜底 */
    }
    this.setData({ statusBarHeight: sbh, capsuleBottom: capsuleBottom || sbh + 36 })
    this.courseId = String(query.courseId || '')
    void this.loadPageContent() // 求助面板文案/FAQ·与取课/取址互不依赖，并行发起（不阻塞首帧·默认已在 data）
    this._wantSeg = String(query.segmentId || '')
    this._wantAt = Math.max(0, Math.floor(Number(query.t) || 0)) // 续播秒（catalog/me 带 &t=·仅对 _wantSeg 生效·脏值归 0）
    await this.initCourse()
  },
  // 课程目录装载（onLoad 与 onRetryError 课程级重试共用）：来源页（me/my-courses）已把课程目录热进
  // lib/courses 缓存→这里零云调用；深链冷启动（分享链直进播放页）缓存未热→内部兜底重拉一次目录（根因账本#15）。
  // 失败≠不存在（根因#14·守卫 rw-mp-list-loadfailed-state）：目录拉取失败落 error 态给重试，
  // 只有拉取成功且查无此课才是 missing「课程不存在」。
  async initCourse() {
    // 深链冷启并行（根因#15·省一次串行往返）：目录详情与期望段取址同时发起——原先串行（先等目录回、再进
    // playSegment 才现取地址），深链两跳叠加。并行后耗时＝max(目录, 取址) 而非目录+取址；取址结果不在此直接
    // 消费（只暖缓存·err 吞掉），仍待目录确认段存在后由 playSegment 经 peek/在途去重命中；期望段空则不发。
    // NOT_ENTITLED 语义不变：暖取抛错吞掉不缓存，playSegment 正路 cache.get 再抛→denied（错误路径原样）。
    const [d] = await Promise.all([
      getCourseByIdDetailed(this.courseId),
      this._wantSeg ? cache.get(this.courseId, this._wantSeg).catch(() => '') : Promise.resolve(''),
    ])
    if (d.failed) {
      this.setData({ state: 'error' })
      return
    }
    const course = d.course as CoursePub | null
    if (!course) {
      this.setData({ state: 'missing' })
      return
    }
    this.course = course
    const segments = flattenSegments(course)
    this.setData({ title: String(course.title || ''), segments })
    const want = this._wantSeg
    const start = segments.find((s) => s.segmentId === want && s.hasVideo) || segments.find((s) => s.hasVideo) || null
    if (!start) {
      this.setData({ state: 'empty' }) // 全课无可播段（半上线）
      return
    }
    await this.playSegment(start, 'enter')
  },

  async playSegment(seg: FlatSegment, scene: 'enter' | 'seg' | 'retry') {
    if (scene !== 'retry') {
      this.errSeg = '' // 换段（非重试）重置视频加载失败重试预算
      this.errCount = 0
    }
    this.clearBuffering() // 换段/重试即清缓冲失速态与升级定时器（旧段的缓冲不带进新段）
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
    // 续播秒（批3·数据已在库·接通最后一公里·根因#15）：仅当本段就是 onLoad 期望段且有未消费续播位置才带 initialTime
    // 起播，一次性消费（清 _wantAt·防换段/重试再续到旧秒串段）；换段/重试一律 0。_resumeAt 记本次待物理落位的秒供
    // onVideoMeta 双保险（每次 playSegment 都重置，含 0），initial-time 只在 <video> 首挂载读一次，运行时兜底靠 seek。
    const initialTime = seg.segmentId === this._wantSeg && this._wantAt > 0 ? this._wantAt : 0
    this._resumeAt = initialTime
    if (initialTime > 0) this._wantAt = 0
    // 换段清零字段单源（peek 直落 playing 与常规 loading→playing 两路共用这份 patch·勿两处各写漂移·病根#5）：
    // src 清空另在各自 setData 给（loading 给 ''·卸载旧/坏 <video> 显骨架；peek 直给新 url）。进度/暂停/播完通栏/
    // 自绘 seek 填充节点气泡/缓冲水位都属旧段，一律归零重算（completed=false）——新段是新的播放单元。
    const strip = lessonStrip(this.course, seg.segmentId, false)
    const clearPatch = {
      current: seg,
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
      bufferPct: 0,
    }
    // 起播落定回调（peek 直落 / 取址落定共用·定义在方法体内以内联段间预取与 autoplay 兜底·守卫 rw-mp-player-prefetch-cache 咬）。
    const onPlaying = () => {
      // 首次量取 seek 条布局；换段重入该回调时已有值即跳过——底条布局不随段变化，无需重量。
      if (!this._seekRect) this.measureSeekRect()
      // autoplay 停摆兜底（根因#8·真机 <video autoplay> 首帧常静默不起播·尤 iOS/弱网/上下文冷启）：src 落定即显式
      // play 一次，与 wxml 的 autoplay 属性叠加（已在播则 play 为 no-op·幂等·不会双播）；停摆时给它第二次触发。
      // 注：此调用在异步 setData 回调里、不在用户手势栈内，iOS WebKit autoplay 限制可能仍拒——iOS 的可靠恢复靠
      // onTapVideo（tap 是真手势），两者互补不冗余。
      wx.createVideoContext('lp-video', this).play()
      // 段间提速（根因#8·段间转场卡顿·承退役老线 prefetch 语义，新线重写缓存却漏接线）：当前段就绪即预热下一段
      // 地址，用户点「下一段」时命中缓存零云往返。纯 cache 暖（不 setData·不改 this.data），故不复核 playToken——
      // 慢回调预热了用户不会到的段也无害；cache.prefetch 对新鲜命中 no-op、在途去重（见 lib/player.ts）。
      const next = navSegment(this.course, seg.segmentId, 1)
      if (next) void cache.prefetch(this.courseId, next.segmentId)
    }
    // peek 消初见切段闪烁（根因#8）：来源页/上一段预热过则缓存新鲜命中，跳过 state:'loading' 中间态、一次 setData
    // 直落 playing+src（清零字段全并入同一次·无「加载首帧」骨架一闪）。peek 同步纯读、无异步空窗、无乱序风险，故此路
    // 不复核请求令牌；令牌复核仍在下方取址路一处（守卫 rw-mp-player-stale-guarded 咬那处·勿动）。
    const peeked = cache.peek(this.courseId, seg.segmentId)
    if (peeked) {
      this.srcSetAt = Date.now()
      this.setData(
        { ...clearPatch, state: 'playing', src: peeked, initialTime, canPrev: !!navSegment(this.course, seg.segmentId, -1), canNext: !!navSegment(this.course, seg.segmentId, 1) },
        onPlaying
      )
      return
    }
    // 缓存未命中：走 loading 骨架 + 取址（initialTime:0 并入清态·换段/重试不带旧段续播秒·防串段）。
    this.setData({ ...clearPatch, state: 'loading', src: '', initialTime: 0 })
    let url = ''
    try {
      url = await cache.get(this.courseId, seg.segmentId)
    } catch (e) {
      if (token !== this.playToken) return // 已被更晚的切段接管·本次作废
      // NOT_ENTITLED→denied 导流激活；FETCH_FAIL（网络/服务失败）→error 态给重试（根因#14：
      // 不再伪装成「素材整理中」的 empty 死态）。
      if ((e as Error).message === 'NOT_ENTITLED') {
        this.setData({ state: 'denied' })
        return
      }
      // 取址失败上报（课程链路审计 2026-07-17·根因#14）：核心内容链的失败率此前对服务端完全不可见——
      // fire-and-forget 留痕（弱网下本次上报也可能失败，可容忍：能到达的样本已足以暴露分布）。
      trackEvent('video_error', 'player', seg.segmentId, { courseId: this.courseId, phase: 'fetch' })
      this.setData({ state: 'error', canPrev: !!navSegment(this.course, seg.segmentId, -1), canNext: !!navSegment(this.course, seg.segmentId, 1) })
      return
    }
    if (token !== this.playToken) return // 乱序回包：更晚的 playSegment 已接管·丢弃本次结果（不覆盖新段）
    if (!url) {
      this.setData({ state: 'empty', src: '', canPrev: !!navSegment(this.course, seg.segmentId, -1), canNext: !!navSegment(this.course, seg.segmentId, 1) })
      return
    }
    this.srcSetAt = Date.now()
    this.setData(
      { state: 'playing', src: url, initialTime, canPrev: !!navSegment(this.course, seg.segmentId, -1), canNext: !!navSegment(this.course, seg.segmentId, 1) },
      onPlaying
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
    this.onFirstPlay()
    this.clearBuffering() // 恢复播放＝缓冲已过（waiting 的恢复信号之一）
    this.setData({ paused: false })
    // 用户经系统手势/重播外路径恢复播放时，完成态不该残留（P4）：常规路径已由 onReplay/playSegment 复位，
    // 这里兜底任何其他恢复播放的入口。
    if (this.data.segDone) this.exitSegDone()
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
  // 课程级失败（initCourse 目录都没拉到·current 尚无）走 initCourse 重试——error 态不留死按钮（根因#14）。
  onRetryError() {
    const cur = this.data.current
    if (!cur) {
      this.setData({ state: 'loading' })
      void this.initCourse()
      return
    }
    this.errSeg = ''
    this.errCount = 0
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
    // 地址可能过期（可恢复）→ 失效后重取；预算 2 次（见 errCount 字段注：容同段两次独立瞬时抖动自愈，
    // 又保住「坏媒体不无限重取」）。耗尽落播放失败态让用户换段/稍后再试，并上报留痕（根因#14）。
    if (this.errSeg === cur.segmentId && this.errCount >= 2) {
      trackEvent('video_error', 'player', cur.segmentId, { courseId: this.courseId, phase: 'media', retries: this.errCount })
      this.clearBuffering()
      this.setData({ state: 'error' })
      return
    }
    if (this.errSeg !== cur.segmentId) {
      this.errSeg = cur.segmentId
      this.errCount = 0
    }
    this.errCount++
    cache.invalidate(this.courseId, cur.segmentId)
    void this.playSegment(cur, 'retry')
  },

  // 缓冲失速可视化（课程链路审计 2026-07-17·根因#8/#14·真机验证项）：播放中缓冲区耗尽触发 bind:waiting
  // （常见于弱网/WiFi-蜂窝切换，非 error——画面冻结但无任何事件语义上的「失败」），此前零监听：用户只见
  // 画面静止、无转圈无提示，易误判「小程序卡死」。补两层——① 轻量「正在缓冲…」角标（不占播放键位、
  // 点击穿透逻辑不变：角标是 tapzone 子节点、tap 冒泡照常整屏播放/暂停）；② 失速升级：10s 仍无恢复信号
  // （timeupdate/play）判为地址过期/链路断，失效缓存地址并落 error 态给「重试本段」入口（重试会重新取址）。
  onVideoWaiting() {
    if (this.data.state !== 'playing' || !this.data.src) return
    if (!this.data.buffering) this.setData({ buffering: true })
    if (this._bufTimer) clearTimeout(this._bufTimer)
    this._bufTimer = setTimeout(() => {
      this._bufTimer = null
      if (this.unloaded || !this.data.buffering || this.data.state !== 'playing') return
      if (this.data.paused) {
        // 用户已暂停：无所谓失速，收起角标即可（暂停中不判失败）
        this.setData({ buffering: false })
        return
      }
      const cur = this.data.current
      if (cur) {
        trackEvent('video_error', 'player', cur.segmentId, { courseId: this.courseId, phase: 'stall' })
        cache.invalidate(this.courseId, cur.segmentId) // 失速常因临时地址过期——重试须重新取址
      }
      this.setData({ buffering: false, state: 'error' })
    }, 10_000)
  },
  // 缓冲态单出口清理：恢复信号（timeupdate/play）/换段/离页共用。
  clearBuffering() {
    if (this._bufTimer) {
      clearTimeout(this._bufTimer)
      this._bufTimer = null
    }
    if (this.data.buffering) this.setData({ buffering: false })
  },

  // 缓冲水位（批3·根因#8/#14 缓冲可视化第二通道·与失速角标 buffering 是两条独立通道不合并）：bind:progress 的
  // e.detail.buffered=整段已加载百分比 0-100（真机才触发·可能播 1s 后才首发·偶发 null）——只做尽力而为的 seek 条
  // 底层灰条（用户能看到「已缓冲到哪」），勿作逻辑判据。节流：与 data.bufferPct 差 ≥2 才 setData（progress 高频·免抖动刷帧）。
  // 换段清零并入 playSegment 清态 setData（clearPatch.bufferPct:0·旧段缓冲不带进新段）。
  onVideoProgress(e: WechatMiniprogram.CustomEvent<{ buffered: number }>) {
    const b = e.detail && e.detail.buffered
    if (typeof b !== 'number' || !Number.isFinite(b)) return // null/偶发脏值忽略（尽力而为·不崩）
    const pct = Math.max(0, Math.min(100, b))
    if (Math.abs(pct - this.data.bufferPct) >= 2) this.setData({ bufferPct: pct })
  },

  // 视频框贴合素材真实比例（2026-07-13 反馈·Bug D2）：loadedmetadata 拿到真实宽高后把播放框 padding-top 设成
  // height/width——竖版素材比默认 1:1.68 框更窄，contain 会在左右留黑；框贴合素材比例后恰好铺满、不裁切、无左右黑边。
  // 封顶到屏幕比例防超高素材撑破屏（.ld-player overflow:hidden·封顶后素材比框更瘦高，contain 高度顶满、
  // 宽度不足→退化为左右留黑不裁切·「去左右黑边」性质在此极端分支保不住，合的是「不裁切」诉求）。
  onVideoMeta(e: WechatMiniprogram.CustomEvent<{ width: number; height: number; duration: number }>) {
    // 续播秒双保险（批3·根因#15）：initial-time 只在 <video> 首挂载读一次、平台偶有不生效（官方 issue #83 变体）。
    // 本段有未消费续播位置（_resumeAt>0）时，元数据就绪即兜底——离目标 >2s 判为未落位、seek 一次；消费清零（一次性）。
    // 无同步读 currentTime 的 API，用最近 timeupdate 的 _at 近似（元数据就绪时通常仍为 0→触发一次幂等 seek 到目标·
    // 已在目标则平台自 no-op）；initial-time 生效则实际位置≈目标、距离判定自动 no-op。置于比例分支之前（脏元数据早退不漏兜底）。
    if (this._resumeAt > 0) {
      const target = this._resumeAt
      this._resumeAt = 0
      if (Math.abs((this._at || 0) - target) > 2) wx.createVideoContext('lp-video', this).seek(target)
    }
    const w = Number(e.detail && e.detail.width)
    const h = Number(e.detail && e.detail.height)
    if (!(w > 0) || !(h > 0)) return // 脏元数据：保持默认 168%·不算比例
    const raw = (h / w) * 100
    const cap = this.windowWidthPx > 0 && this.windowHeightPx > 0 ? (this.windowHeightPx / this.windowWidthPx) * 100 : raw
    const ratio = Math.min(raw, cap) // 封顶屏幕比例·不撑破屏
    if (Math.abs(ratio - this.data.videoRatio) > 0.5) this.setData({ videoRatio: ratio }) // 有意义变化才 setData（免抖动）
  },

  // 全屏单击播放/暂停：只调用视频上下文 play()/pause()，真实态由 bind:play/bind:pause 回报（不臆断本地态）。
  // 首次 tap 永久关闭单击提示条（页面实例级 data.hintDismissed·不持久化·无定时器）。
  onTapVideo() {
    if (this.data.state !== 'playing' || !this.data.src) return
    if (!this.data.hintDismissed) this.setData({ hintDismissed: true })
    const ctx = wx.createVideoContext('lp-video', this)
    // paused 只认 bind:play/pause 真回报（初始 false）：autoplay 停摆时无 bind:play → paused 恒 false，原
    // 「if paused play else pause」会把用户「点画面想起播」错判成 pause（反向）→ 原地永远救不回、只能切段重建
    // <video> 才逃出（正是「有时要切下一集才能加载」根因）。补 !firstFrameReported：本段尚未起播过时点击一律 play。
    // tap 是 iOS 真用户手势、能绕过 WebKit autoplay 限制——这条也是 iOS 停摆的可靠恢复路径（与 playSegment 里的
    // 显式 play 兜底互补）。firstFrameReported 由 onFirstPlay（bind:play）置真、playSegment 换段时复位。
    if (this.data.paused || !this.firstFrameReported) ctx.play()
    else ctx.pause()
  },

  // 进度上报（250ms 节流·seeking 时不覆盖显示值·秒取整减频 setData）；同步补自绘 seek 条填充百分比 seekPct；
  // 首次拿到非零 durSec 时顺带算一次关键动作节点位图 markVMs（durSec 已有值后不重算——布局不随后续 timeupdate 变）。
  onTimeUpdate(e: WechatMiniprogram.CustomEvent<{ currentTime: number; duration: number }>) {
    // 每次事件都更新（不 setData·不节流）：watch_at/segment_done 埋点要最新播放位置，UI 节流不该拖累它（P2·bug sweep R1 #14）。
    this._at = Math.floor(e.detail.currentTime || 0)
    this._dur = Math.floor(e.detail.duration || 0)
    if (this.data.buffering) this.clearBuffering() // 播放位置在推进＝数据到了，缓冲已过（waiting 的恢复信号）
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

  // CMS 求助面板文案 + FAQ（批B·fail-soft·拉不到维持默认）：三卡标题回退默认；FAQ 空 → 维持诚实空态导流客服
  // （不造假 Q&A·见 wxml faq 子层）。await 恢复点复核 unloaded（守卫 rw-mp-await-side-effect-unloaded-recheck 纪律）。
  async loadPageContent() {
    const content = await getPageContent('catalogPlayer')
    if (this.unloaded) return
    this.setData({ help: mapCatalogPlayer(content).help })
  },

  // 求助面板入口（P3·播放器重设计战役批D）：占常规播放键位的求助钮不再直连客服，改拉起底部 sheet——
  // 客服真调用移入面板卡1（onHelpContact，守卫 rw-mp-customer-service-wired 触点表钉这里）；播放不阻断
  // （唯一暂停例外＝内嵌视频播放，见 onHelpPlaySegment）。wxml 上 bind:tap="onHelp" 绑定原样保留（守卫
  // rw-mp-player-immersive 钉的是这个节点，与本方法体内调用什么无关）。
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
  // 卡3 常见问题（R37b 已接线：云端 FAQ 单源=客服知识库 KB，getPublicFaq 只回精选条目）：进子层 + 每次重拉
  // （同 onHelpVideos 口径·辅助内容低频不缓存）；载入失败/空仍诚实空态导流客服，不造假 Q&A。
  // help.faq（CMS 自由文本·并行战役新增·wxml 级联优先）非空时该子层直接渲染 CMS 内容，不必再打 KB 请求
  // ——两套编辑面并存是待用户裁决的 flag（docs/待办与债.md），此处只做最小的「CMS 已覆盖就不浪费一次请求」。
  onHelpFaq() {
    this.setData({ helpPanel: 'faq', helpFaqState: 'loading', helpFaqList: [] })
    if ((this.data.help.faq || []).length > 0) return // CMS 自由文本已覆盖，wxml 走 help.faq 分支，跳过 KB 拉取
    void this.loadHelpFaq()
  },
  async loadHelpFaq() {
    const token = ++this.helpFaqToken // 本次进入子层的请求令牌·await 后复核，防慢回旧请求覆盖新请求
    const r = await getPublicFaq()
    if (token !== this.helpFaqToken) return // 更晚的一次 onHelpFaq 已接管，丢弃本次回包
    if (this.data.helpPanel !== 'faq') return // 用户已退出 faq 层：同样丢弃，不写脏 state
    const list = mapPublicFaq(r)
    this.setData(list.length ? { helpFaqState: 'ok', helpFaqList: list } : { helpFaqState: 'empty', helpFaqList: [] })
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
      wx.showToast({ title: '再按一次返回退出', icon: 'none' })
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
  // 真退单出口：原生返回栈优先，深链无上级页兜底回首页（既有兜底逻辑原样保留）。
  exitPlayer() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/home/home' }) // 深链直接进入播放页（无上级页可退）时兜底回首页
  },
  // 加桌引导（P5b）：继续学习＝关弹窗留下（不退）；先退出＝执行真退。
  onDeskGuideStay() {
    this.setData({ deskGuide: false })
  },
  onDeskGuideExit() {
    this.setData({ deskGuide: false })
    this.exitPlayer()
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
    // 后台挂起清缓冲升级定时器（timer 必清理·CLAUDE §7）：挂起期无 timeupdate，10s 定时器醒来会把
    // 正常的后台停留误判成失速落 error 态；回前台若真在缓冲，waiting 会再次触发重建角标与定时器。
    this.clearBuffering()
  },
  onUnload() {
    this.unloaded = true
    this.reportWatchAt()
    if (this._bufTimer) {
      clearTimeout(this._bufTimer) // 离页销毁定时器（timer 必清理）；不再 setData（页面已卸载）
      this._bufTimer = null
    }
  },
})
