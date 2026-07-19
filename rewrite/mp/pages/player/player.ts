// 课程播放页（M2 批11·竖屏沉浸全屏重设计批新增帮助入口）：video + 分段列表 + 上/下一段 +
// 进度上报 + 首帧埋点。鉴权 fail-closed 在云端（getPlaybackUrl 须本人已进课）；素材未剪 url:null → 空态不裂
// 播放器；未授权 → 导流激活页。地址经 TTL 缓存（切段回看零重复取址）。
// 自绘 seek 条（播放器重设计战役批C 起·批5 WXS 化取代原生 <slider>）：两段式语义——拖动中只改显示、松手才真
// seek。拖动几何（clientX→秒/磁吸/预览 left）移入 pages/player/seek.wxs 渲染层闭环（批5·根因#15：60Hz touchmove
// 每帧 5 字段 setData 双向过桥＝跟手延迟/掉帧源）；逻辑层经 change:cfg 下发几何（seekCfg），收 WXS callMethod
// onSeekTick（过秒·刷文案+震动·~10fps）/ onSeekCommit（松手·真 seek）。关键动作节点磁吸（nearestMark 双源在 seek.wxs·
// 对拍钉死）+ 拖动阻尼震感配方照抄 pages/flip-demo 真机参考（lib/haptics 单源 shouldTick/VIBE_GAP_MS/DRAG_TICK_GAP_MS）。
// 拖动浮层雪碧图缩略图窗（R36 后端未建）诚实降级为时间浮窗 + 命中节点时的鸭黄气泡。
import { trackEvent, getHelpVideos, getPublicFaq } from '../../api/learning'
import {
  flattenSegments,
  navSegment,
  formatClock,
  lessonStrip,
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
// 拖动文案刷新节流（批5·ms）：位置由 seek.wxs 渲染层 60fps 跟手，curClock/snapName 文案经 onSeekTick 回逻辑层
// ~10fps 刷新（可感知取舍已拍板接受）——过秒时 WXS 才回桥，此处再钳一层防同秒内多次回桥抖刷文案。
const SEEK_TEXT_THROTTLE_MS = 100
// 磁吸窗口（秒）：拖动秒数落在关键动作节点前后 3 秒内即吸附（批C 规格默认值·真机手感待调参 flag）。批5 起经
// seekCfg.snapSec 下发 seek.wxs（渲染层磁吸单源本常量·不在 WXS 里另立 3 防漂）。
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
    initialTime: 0, // 续播秒（<video> initial-time·仅组件首挂载读一次·换段天然归 0 防续秒串段·同段重试可携原值·见 playSegment/_wantAt）
    curSec: 0,
    durSec: 0,
    curClock: '0:00',
    durClock: '0:00',
    seeking: false, // 拖动进度条中：阻断 timeupdate 覆盖显示值
    segDone: false, // 段落播完（P4）：不再自动切下一段，停在完成态给用户看通栏重播/自己切段
    strip: null as LessonStrip | null, // 顶条两行标题 + 分段进度条浮层数据源（批A lib/player lessonStrip）
    capText: '', // segstrip 左侧文案（三态，见 buildCapText）
    hintDismissed: false, // 单击提示条是否已被首次 tap 关闭（页面实例级·不持久化·无定时器）
    seekPct: 0, // 自绘 seek 条填充百分比（0–100·非拖动期 onTimeUpdate 低频维护·驱动 fill 宽/handle left；拖动期由 seek.wxs setStyle 接管·seeking 冻结此字段不抢写）
    snapName: '', // 拖动磁吸命中的关键动作节点名（seeking 时气泡文案·onSeekTick 刷新·未命中为空串）
    markVMs: [] as { at: number; pct: number; name: string }[], // 关键动作节点位图（onTimeUpdate 首次拿到非零 durSec 时算一次，durSec 已有值后不重算）
    seekCfg: null as { rect: { left: number; width: number }; durSec: number; marks: { at: number; name: string }[]; edgePx: number; snapSec: number } | null, // 拖动几何下发 seek.wxs（批5·change:cfg 观察者接收·rect 量轨后 + durSec 首个 timeupdate 后组装·换段 durSec 归 0 拦 WXS 不响应）
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
  _seekRect: null as { left: number; width: number } | null, // 自绘 seek 条量轨缓存（首次播放成功后量一次·换段不重量，见 playSegment）；量得即组装 seekCfg 下发 seek.wxs
  _seekPrevSec: 0, // 拖动逐秒轻嗒判重锚点（onSeekTick 首个 tick＝拖动起始时置为当前 curSec）
  _lastSnapAt: -1, // 拖动进节点重嗒判重（onSeekTick 首个 tick 重置为 -1·新命中/换节点才震）
  _seekTextAt: 0, // 拖动文案 setData 节流时间戳（SEEK_TEXT_THROTTLE_MS·onSeekTick 用·位置 WXS 60fps、文案 ~10fps）
  lastTick: 0, // 拖动阻尼「嗒」时间戳（配方单源 lib/haptics·照抄 pages/flip-demo）
  lastVibe: 0, // 事件震（vibe()）时间戳（同上·两类震共用时间地板防叠震）
  _backAt: 0, // 返回二次确认判定锚点（P5·BACK_CONFIRM_MS 窗口内二次按返回才真退，见 onBack）
  _wantSeg: '', // onLoad 期望起播段（存实例供 initCourse 课程级失败重试后仍定位到原目标段）
  _wantAt: 0, // onLoad 期望续播秒（query.t·仅对目标段 _wantSeg 生效·playSegment 成功把非空 src 交给挂载 video 才消费清零——取址失败/url 为空不消费，留给重试续到秒；G2 批修正消费时机）
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
    // 续播秒（批3·数据已在库·接通最后一公里·根因#15；G2 批修正消费时机）：仅当本段就是 onLoad 期望段且有未消费
    // 续播位置才带 initialTime 起播。消费（清 _wantAt）挪到「真正把非空 src 交给挂载 video」的成功路径（peek 命中
    // 分支 / 取址成功且 url 非空分支，各见下方）——取址异常（denied/error）与 url 为空（素材未剪·转码未就绪·落
    // 'empty' 态）都不消费，留给之后重试续到秒。换段（seg.segmentId !== this._wantSeg）天然 initialTime=0，不受
    // 影响——防串秒不变量本质是「跨段挂载绝不携他段的秒」，由该相等判据保证，本批只挪同段内的消费时机。
    // _resumeAt 记本次待物理落位的秒供 onVideoMeta 双保险（每次 playSegment 都重置，含 0），initial-time 只在
    // <video> 首挂载读一次，运行时兜底靠 seek。
    const initialTime = seg.segmentId === this._wantSeg && this._wantAt > 0 ? this._wantAt : 0
    this._resumeAt = initialTime
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
      // 换段重置 seek.wxs 几何（批5·根因#15）：durSec 归 0 → WXS onStart 天然拦住不响应（防换段空窗里用旧段几何算错秒），
      // 换新段 marks；新段首个 timeupdate 拿到真时长后重新下发完整 cfg。rect 未量得（首次播放）→ buildSeekCfg 回 null·WXS onCfg 防御。
      seekCfg: this.buildSeekCfg(0, seg.marks),
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
      if (initialTime > 0) this._wantAt = 0 // 消费（peek 命中即真把非空 src 交给挂载 video）
      this.setData(
        { ...clearPatch, state: 'playing', src: peeked, initialTime, canPrev: !!navSegment(this.course, seg.segmentId, -1), canNext: !!navSegment(this.course, seg.segmentId, 1) },
        onPlaying
      )
      return
    }
    // 缓存未命中：走 loading 骨架 + 取址（这里的 initialTime:0 只是骨架态占位·<video> 此刻尚未挂载不读它·
    // 真正带给挂载 video 的 initialTime 在下方成功分支才落地、此时 _wantAt 仍未消费）。
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
    if (initialTime > 0) this._wantAt = 0 // 消费（取址成功且 url 非空即真把非空 src 交给挂载 video）
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

  // 退出播完完成态（P4）单出口：恢复播放的三条路径（onVideoPlay 兜底/onReplay/onSeekCommit）共用——
  // 重算 strip/capText（completed=false）+ 复位 segDone；extra 并入同一次 setData（onSeekCommit 要一并收口拖动态+落位秒）。
  exitSegDone(extra: Partial<{ seeking: boolean; snapName: string; curSec: number; curClock: string; seekPct: number }> = {}) {
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
      // 首个非零 durSec：组装完整 seek.wxs 几何下发（批5·根因#15·rect 已在首帧 onPlaying 量得则此处即完整；
      // 若 rect 尚未量得则 buildSeekCfg 回 null·由 measureSeekRect 落定回调补下发·两序都收口）。
      const cfg = this.buildSeekCfg(durSec, marks)
      if (cfg) patch.seekCfg = cfg
    }
    this.setData(patch)
  },

  // 自绘 seek 条量轨（批5·根因#15 拖动几何 WXS 化后仍由逻辑层量轨·渲染层拿不到 boundingClientRect）：
  // 首次播放成功后量一次（playSegment 的 state:'playing' 回调守卫 !_seekRect），换段不重量。width>0 才落缓存：
  // 若 setData 回调触发时 .lp-seek 尚未真正上屏（布局未提交的已知小程序时序坑），boundingClientRect 会回一个
  // 非空但 width:0 的节点——写入 _seekRect 会被「已测过」误判、永不重测，seek.wxs 从此恒因 rect.width=0 算不出秒。
  // 量得即组装 seekCfg 下发 seek.wxs（rect 就绪的两序之一·另一序在 onTimeUpdate 首个非零 durSec·见那处注）。
  measureSeekRect() {
    wx.createSelectorQuery()
      .in(this)
      .select('.lp-seek')
      .boundingClientRect()
      .exec((res: { left: number; width: number }[]) => {
        const r = res && res[0]
        if (r && r.width > 0) {
          this._seekRect = { left: r.left, width: r.width }
          // rect 落定即下发（durSec 此刻可能仍 0·WXS 天然拦住不响应，真时长到达时 onTimeUpdate 再下发完整 cfg）：
          // 兜「timeupdate 首个 durSec 先于量轨完成」的时序——那一序 buildSeekCfg 拿不到 rect 回 null 未下发，
          // 必须靠这里补下发，否则完整 cfg 永不下发、拖动永久失效（durSec 的 0→非零只触发一次·不会再补）。
          const cur = this.data.current
          const cfg = this.buildSeekCfg(this.data.durSec, cur ? cur.marks : [])
          if (cfg) this.setData({ seekCfg: cfg })
        }
      })
  },
  // 拖动预览浮层防出屏边距（rpx→px·PREVIEW_EDGE_RPX 换算）：seek.wxs previewLeft 夹取用，经 seekCfg.edgePx 下发
  // （JS 定值替代 WXSS clamp()·见 PREVIEW_EDGE_RPX 注·渲染层不做 rpx→px 换算，逻辑层算好传 px）。
  seekEdgePx(): number {
    return (PREVIEW_EDGE_RPX / 750) * (this.windowWidthPx || 0)
  },
  // 组装 seek.wxs 拖动几何（批5·根因#15）：量轨（rect）+ 时长（durSec）+ 关键动作节点（marks）+ 预览边距（edgePx）+
  // 磁吸窗口（snapSec）一次性打包经 change:cfg 下发渲染层。rect 未量得回 null（WXS onCfg 防御·不响应拖动）；
  // durSec 传 0＝换段空窗占位（WXS onStart 据 durSec>0 才响应·拦住用旧几何算错秒）。marks 不按 durSec 过滤（磁吸
  // 命中后 WXS clampSeek 再兜一次·与 onTimeUpdate 的 markVMs 过滤不同源·效果等价·同原 updateSeekDisplay 注）。
  buildSeekCfg(durSec: number, marks: { at: number; name: string }[]) {
    if (!this._seekRect) return null
    return { rect: this._seekRect, durSec, marks, edgePx: this.seekEdgePx(), snapSec: MARK_SNAP_SEC }
  },
  // WXS 过秒回桥（批5·根因#15）：位置已由 seek.wxs 渲染层 60fps setStyle 落位，本方法只做「过桥才做」的两件事——
  // ① 震感（配方单源 lib/haptics·数值用户真机拍板禁改·照抄 pages/flip-demo）：逐秒轻嗒（shouldTick·40ms 钳制快扫
  // 跳齿）+ 进节点重嗒（vibe('medium')·≥80ms 节流·两类震共用 lastTick/lastVibe 时间地板防叠震）；② 文案 ~100ms
  // 节流 setData（curClock/snapName·位置 60fps、文案 ~10fps 的可感知取舍已拍板）。首个 tick（!seeking）＝拖动起始
  // （原 onSeekStart 职责）：复位逐秒/节点判重锚点 + 进 seeking 态（阻断 onTimeUpdate 覆盖 seekPct 抢写 WXS 落位）。
  // 绝不 .seek(——两段式：提交只在 onSeekCommit（松手）。snapAt→name 经本段 marks 反查（WXS 只回数字 at·载荷精简）。
  onSeekTick(e: WechatMiniprogram.CustomEvent<{ sec: number; snapAt: number }>) {
    const d = e.detail || ({} as { sec: number; snapAt: number })
    const sec = Math.max(0, Math.floor(Number(d.sec) || 0))
    const snapAt = Number(d.snapAt)
    const cur = this.data.current
    const marks = cur ? cur.marks : []
    const hit = snapAt >= 0 ? marks.find((m) => m.at === snapAt) : undefined
    const patch: Record<string, unknown> = {}
    if (!this.data.seeking) {
      // 拖动起始（原 onSeekStart 职责）：复位判重锚点为拖前播放位置 + 进 seeking 态（timeupdate 从此不覆盖显示/seekPct）
      this._seekPrevSec = this.data.curSec
      this._lastSnapAt = -1
      patch.seeking = true
    }
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
    if (now - this._seekTextAt >= SEEK_TEXT_THROTTLE_MS) {
      this._seekTextAt = now
      patch.curSec = sec
      patch.curClock = formatClock(sec)
      patch.snapName = hit ? hit.name : ''
    }
    if (Object.keys(patch).length) this.setData(patch)
  },
  // WXS 松手提交（批5·根因#15·原 onSeekEnd 语义整体迁入）：真正 seek 到 seek.wxs 回报的落位秒（渲染层唯一提交出口）。
  // 完成态下拖动＝用户想回看，恢复播放并退出完成遮罩（同 onReplay 语义·completed=false——不留播完遮罩挡住刚拖到的
  // 画面）。收口 seeking/snapName 态 + 把 seekPct/curSec/curClock 同步到落位秒（拖动中 seekPct 被冻结·此处补齐数据
  // 绑定与 WXS 落位一致·免松手一帧回跳）。防御：非 seeking 态的杂散提交丢弃（不误 seek）。
  onSeekCommit(e: WechatMiniprogram.CustomEvent<{ sec: number }>) {
    if (!this.data.seeking) return
    const d = e.detail || ({} as { sec: number })
    const sec = Math.max(0, Math.floor(Number(d.sec) || 0))
    const ctx = wx.createVideoContext('lp-video', this)
    ctx.seek(sec)
    const durSec = this.data.durSec
    const seekPct = durSec ? Math.min(100, Math.round((sec / durSec) * 10000) / 100) : 0
    if (this.data.segDone) {
      ctx.play()
      this.exitSegDone({ seeking: false, snapName: '', curSec: sec, curClock: formatClock(sec), seekPct })
      return
    }
    this.setData({ seeking: false, snapName: '', curSec: sec, curClock: formatClock(sec), seekPct })
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
