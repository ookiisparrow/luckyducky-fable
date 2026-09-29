// 「我」页：静默登录回灌资料 + 继续学习卡 + 入口列。
// 登录零资料采集；继续学习定位纯函数（不假装有课·无课卡片走「去逛逛」兜底）。
import { tapHaptic } from '../../lib/haptics'
import { login, getMyProgress, updateProfile } from '../../api/user'
import { getMyOrders } from '../../api/orders'
import { countBadge } from '../../lib/mapOrders'
import { getMyCourses } from '../../api/learning'
import { getCoursesByIds } from '../../lib/courses'
import { playbackCache } from '../../lib/playbackCache' // 续播段取址预热（我页停留窗口预热·进播放器 peek 命中零云往返·根因#15）
import { getPageContent } from '../../lib/pageContent'
import { continueResolve } from '../../lib/continueResolve'
import { readStoredCont, writeStoredCont } from '../../lib/meCont'
import { mapMe, contMainLine, type MeVM } from '../../lib/mapMe' // 直引拆分模块（tab 闭包不拖 mapPages 法务长文）
import { openCustomerService } from '../../utils/customerService'
import { goHomeTab } from '../../lib/homeIntent'
// consumeExitGuard 别名：页面方法须叫 onExitGuardBeforeLeave（wxml bindbeforeleave 绑的就是它），同名易误读成递归
import { armExitGuard, releaseExitGuard, onExitGuardBeforeLeave as consumeExitGuard } from '../../utils/exitGuard'
import { loginGate } from '../../lib/loginGate'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxTransit, fxToast, fxHint } from '../../lib/pxFx'
import { uploadAvatar, hintProfileFail } from '../../lib/avatar'
import { groundGap } from '../../lib/ground'

// 切 tab 回「我」的去重窗：每次刷新是 login+CMS+进度+我的课（+课程）4-5 次云调用，tab 来回切不该每次都付。
// ponytail: 窗内从别的 tab 看完课再切回，继续学习卡的续播秒数最多旧 30s；要更准就改成播放器写进度时主动作废。
const ME_FRESH_MS = 30_000
const COUNT_PAGE = 20 // 订单格数字按一页数（满页显示 20+）

function continueCourseIds(progress: unknown, mine: unknown): string[] {
  const ids: string[] = []
  const add = (id: unknown) => {
    const s = String(id || '')
    if (s && !ids.includes(s)) ids.push(s)
  }
  if (Array.isArray(progress)) for (const p of progress) add((p as { courseId?: unknown } | null)?.courseId)
  if (Array.isArray(mine)) for (const m of mine) add((m as { courseId?: unknown } | null)?.courseId)
  return ids
}

/** 小鸭蛋孵化判定（v5 D1）：有一门课「段数>0 且每段都在 done 里」→ 回该课 id 当 hatch-key，否则 ''。
 *  口径同 mapLearning.mapMyCourses 的 percent===100（done 键=segmentId·取交集防 stale）；
 *  不 import mapLearning：它会把激活错误长文案拖进 tab 首屏字体闭包（同 lib/mapMe 拆分理由）。 */
function hatchedCourseId(progress: unknown, courses: Record<string, unknown>[]): string {
  if (!Array.isArray(progress)) return ''
  const doneOf = new Map<string, Record<string, unknown>>()
  for (const p of progress as { courseId?: unknown; done?: unknown }[]) {
    if (p && p.courseId && p.done && typeof p.done === 'object') doneOf.set(String(p.courseId), p.done as Record<string, unknown>)
  }
  for (const c of courses) {
    const done = doneOf.get(String(c.id || ''))
    if (!done) continue
    const segs: string[] = []
    for (const ch of Array.isArray(c.chapters) ? c.chapters : [])
      for (const l of Array.isArray(ch?.lessons) ? ch.lessons : [])
        for (const sg of Array.isArray(l?.segments) ? l.segments : []) if (sg && sg.id) segs.push(String(sg.id))
    if (segs.length && segs.every((id) => done[id])) return String(c.id)
  }
  return ''
}

const seededCont = readStoredCont()
const seededMe = mapMe(null)
const seededLoggedIn = loginGate.hasAgreed() // 首帧跟继续学习卡同款：本地 hint 已同意就先画登录态，不等云回包（根因#8/#14）

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    groundGap: groundGap(), // 地面线上方留白（屏高<700 用 56·UI 审查 6 问 2a）
    statusBarHeight: 0, // 沉浸式自绘导航：头部让开状态栏（navigationStyle:custom·用户需求）
    hatchKey: '', // 小鸭蛋：非空＝已学完这门课（孵化·小鸭按课 id 定样子）；空＝未孵化蛋（取数失败/加载中也是蛋）
    nickname: seededMe.defaultNickname, // 默认名先上屏；云端真昵称 refresh 覆盖
    avatar: '',
    bio: '',
    cont: seededCont,
    contMain: '', // 继续学习卡下行（「1.3 鸭嘴收针」/「全部学完 · 可以重看」）；空＝旧卡还没刷，wxml 退回课时名
    entries: seededMe.entries as MeVM['entries'], // 九入口标题/可见性·首帧默认（CMS 到达覆盖）
    contFailed: false, // 继续学习区取数失败标记（同 aftersales/order-list loadFailed 分治：失败≠没进度）
    contLoaded: !!seededCont, // 继续学习区首次取数是否落地（加载中≠没课·根因#8/#14）；有上次会话旧卡则首帧先画、后台再刷
    // 和「确认无课」，无 loading 位会让空态在数据未回来时就渲染成假空态（先空后有闪烁）；
    // 置 true 前空态不显、改显骨架；首次 refresh 落地后恒 true（成功/失败任一路都置）。
    loggedIn: seededLoggedIn, // 已显式同意登录（loginGate hint）：真才显真实资料 + 头像可换，假显登出态（默认身份 + 登录入口）
    exitGuardArmed: false, // 误触退出提醒（决策§30）：驱动 <page-container show>·onShow 武装（初值 false·未上屏不拦）
    counts: { pending: '', paid: '', shipped: '' }, // 订单格数字（v5 D1·'' 不显示：加载中或取数失败）
  },
  onLoad() {
    this.setData({ statusBarHeight: wx.getWindowInfo().statusBarHeight }) // 沉浸式：读状态栏高度让开自绘导航（onLoad 一次即可·不随 onShow 变）
  },
  onShow() {
    armExitGuard(this) // tabBar 栈底页误触退出提醒：武装 page-container 拦第一次返回（决策§30·见 utils/exitGuard）
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('me')
    loginGate.maybePromptOnce() // 软门槛本会话至多弹一次（首页/我页共用·未同意才弹）
    if (Date.now() - this._freshAt < ME_FRESH_MS && this._freshAgreed === loginGate.hasAgreed()) return
    void this.refresh()
  },
  onHide() {
    releaseExitGuard(this) // 切走本 tab：清在途重武装定时器（不回调已隐藏页的 setData）
  },
  onUnload() {
    releaseExitGuard(this)
  },
  /** <page-container bindbeforeleave>：拦下第一次返回 →「再按一次退出」（2s 内再按放行·2s 后自动重新武装）。 */
  onExitGuardBeforeLeave() {
    consumeExitGuard(this)
  },
  // 登录半屏「微信一键登录」成功回调：刷新资料（hint 已由组件写·此处回灌头像昵称/入口可见性）
  onLoggedIn() {
    this.setData({ loggedIn: true }) // 先切到登录态（头部/继续学习卡立刻换），资料随后回灌
    void this.refresh()
  },
  _freshAt: 0, // 上次完整拉成功的时刻（没拉全不记·失败不缓存）；置 0 = 下次 onShow 必拉
  _freshAgreed: false, // 那次刷新时的登录态：登录/退出后切回必须重拉
  _seq: 0, // refresh 代次（同 order-list/aftersales 范式）：onShow 多触发点（tab 切回/其他页返回）并发 refresh，
  // 慢回包迟到落地会覆盖更晚一次 refresh 已落的新结果。
  /** 离开去做会改资料/进度的事：回来必须重拉。只清 _freshAt 不够——在途的 refresh 晚到会把去重窗重新记上，
   *  所以连代次一起作废，让它的结果整个丢掉（回来 onShow 反正全量重拉）。 */
  _expireFresh() {
    this._freshAt = 0
    this._seq++
  },
  async refresh() {
    const seq = ++this._seq
    this._freshAt = 0
    const contP = this.refreshCont(seq) // 继续学习卡不等人资料/CMS（那两路只喂头像昵称/入口）
    void this.refreshCounts(seq) // 订单格数字：独立一路，失败只是不显示数字
    const [u, meContent] = await Promise.all([login(loginGate.hasAgreed()), getPageContent('mePage')])
    if (seq !== this._seq) return
    const user = (u.ok ? u.user : null) as Record<string, any> | null
    const me = mapMe(meContent)
    const agreed = loginGate.hasAgreed()
    // 已登录但资料没拉到：保留已显示的名字/头像（失败≠空态·不把真昵称刷回默认名）
    const keep = agreed && !u.ok
    this.setData({
      loggedIn: agreed,
      entries: me.entries,
      ...(keep
        ? {}
        : {
            nickname: (agreed && user && String(user.nickname || '')) || me.defaultNickname,
            avatar: (agreed && user && String(user.avatar || '')) || '',
            bio: (agreed && user && String(user.bio || '')) || '',
          }),
    })
    if ((await contP) && u.ok && seq === this._seq) {
      this._freshAt = Date.now()
      this._freshAgreed = agreed
    }
  },
  /** 订单格数字：待支付/待发货/待收货各拉一页数条数（countBadge）；失败的格不显示数字。 */
  async refreshCounts(seq: number) {
    const keys = ['pending', 'paid', 'shipped'] as const
    // 单路失败（含云调用直接抛错）只让那一格不显示数字，不冒成未处理异常
    const rs = await Promise.all(keys.map((k) => getMyOrders(undefined, COUNT_PAGE, k).catch(() => ({ ok: false }))))
    if (seq !== this._seq) return
    this.setData({ counts: { pending: countBadge(rs[0], COUNT_PAGE), paid: countBadge(rs[1], COUNT_PAGE), shipped: countBadge(rs[2], COUNT_PAGE) } })
  },
  /** 返回是否拉全（供 refresh 判断能否进去重窗）。 */
  async refreshCont(seq: number): Promise<boolean> {
    const [progress, mine] = await Promise.all([getMyProgress(), getMyCourses()])
    if (seq !== this._seq) return false
    if (!progress.ok || !mine.ok) {
      this.setData({ contLoaded: true, ...(this.data.cont ? {} : { contFailed: true }) })
      return false
    }
    const ids = continueCourseIds(progress.list, mine.list)
    const courses = ids.length ? await getCoursesByIds(ids) : []
    if (seq !== this._seq) return false
    if (courses === null) {
      this.setData({ contLoaded: true, ...(this.data.cont ? {} : { contFailed: true }) })
      return false
    }
    const cont = continueResolve(progress.list, mine.list, courses)
    writeStoredCont(cont)
    const course = cont ? courses.find((c) => String(c.id || '') === cont.courseId) : null
    const contMain = cont ? contMainLine(cont, course, !!course && !!hatchedCourseId(progress.list, [course])) : ''
    this.setData({ cont, contMain, contFailed: false, contLoaded: true, hatchKey: hatchedCourseId(progress.list, courses) })
    if (cont) void playbackCache.prefetch(cont.courseId, cont.segmentId)
    return true
  },
  // 没有课程时的「去逛逛」：回首页（15 问 13a）
  onGoShop() {
    goHomeTab()
  },
  onRetryCont() {
    tapHaptic()
    void this.refresh() // 继续学习区失败态重试入口（me 页未开下拉刷新·按钮重试同 detail onRetryLoad 范式）
  },
  onContinue() {
    tapHaptic()
    this._expireFresh() // 看完课回来续播位置变了
    const c = this.data.cont
    if (c) {
      // 带上次段位回到那一段（卡片显的是该课时·不带则播放器落首段·卡片承诺≠行为）；段位空则不拼（播放器挑首个可播段）
      const seg = c.segmentId ? '&segmentId=' + encodeURIComponent(c.segmentId) : ''
      // 续播到秒（数据已在库·接通最后一公里）：resumeAt>0 才拼 &t=（0=从头/挑段·不拼）
      const at = c.resumeAt > 0 ? '&t=' + c.resumeAt : ''
      const url = '/pages/player/player?courseId=' + c.courseId + seg + at
      void fxTransit(this, 'dither', '.me-card', () => wx.navigateTo({ url })) // 暗场铺满再进播放页（设计稿 fxEnter）
    } else {
      // 兜底去逛逛→首页应从头逛起：防首页上次恰好滚到 FAQ 板块的旧滚动位置残留，造成「弹出大家都在问」错位观感
      goHomeTab()
    }
  },
  _avatarBusy: false, // 换头像在途锁（上传+保存）：重复选直接丢，防连传两张孤儿文件
  /** 点头像换微信头像（老板 2026-09-29 拍板 2）：选完立即上传 + 只存头像字段（不碰昵称/手机号）。
   *  只有已登录才渲染这颗能力键（wxml）——未登录点头像＝打开登录半屏，先登录再换（同「编辑」只给已登录的口径）。 */
  async onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    const path = e?.detail?.avatarUrl
    if (this._avatarBusy || !path) return
    this._avatarBusy = true
    wx.showLoading({ title: '头像保存中', mask: true })
    let fileID = ''
    let r: Awaited<ReturnType<typeof updateProfile>> | null = null
    try {
      fileID = await uploadAvatar(path)
      r = await updateProfile({ avatar: fileID }) // callApp 不抛错，失败收成 ok:false
    } catch {
      // 只有上传会抛：r 留空
    } finally {
      wx.hideLoading()
      this._avatarBusy = false
    }
    if (!r) return fxHint(this, '头像没传上去，稍后再试')
    if (!r.ok) return hintProfileFail(this, r.error, { text: false, avatar: true })
    this.setData({ avatar: String((r.user as { avatar?: unknown } | undefined)?.avatar || fileID) }) // 当场换上，不等整页重拉
    fxToast(this, '头像已更新')
    void this.refresh() // 整页重拉（新代次作废在途旧 refresh，免得旧回包把旧头像刷回来）
  },
  onEditProfile() {
    this._expireFresh() // 改完昵称头像回来要看到新的
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })
  },
  // 登出态头部「登录」入口：打开登录半屏（同软门槛入口·loginGate 单例驱动）
  onLoginTap() {
    loginGate.open()
  },
  // 数据共享授权（合规入口·隐私政策承诺随时可撤回）
  onConsent() {
    wx.navigateTo({ url: '/pages/consent/consent' })
  },
  onCourses() {
    this._expireFresh() // 从课程列表进播放器，回来进度变了
    wx.navigateTo({ url: '/pages/my-courses/my-courses' })
  },
  // 三格（待付款/待发货/待收货）带 data-tab 直落对应分栏；「全部订单」无 dataset 不带 tab（order-list.ts query.tab 契约）。
  onOrders(e?: WechatMiniprogram.TouchEvent) {
    const tab = (e && e.currentTarget && e.currentTarget.dataset && String(e.currentTarget.dataset.tab || '')) || ''
    this._expireFresh() // 回来订单格数字可能变了（付款/取消/收货）
    wx.navigateTo({ url: '/pages/order-list/order-list' + (tab ? '?tab=' + tab : '') })
  },
  onAfterSales() {
    this._expireFresh() // 售后改了订单状态，回来重数
    wx.navigateTo({ url: '/pages/aftersales/aftersales' })
  },
  onAddress() {
    wx.navigateTo({ url: '/pages/address/address' })
  },
  onFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' })
  },
  onKefu() {
    openCustomerService()
  },
  onAbout() {
    wx.navigateTo({ url: '/pages/about/about' })
  },
})
