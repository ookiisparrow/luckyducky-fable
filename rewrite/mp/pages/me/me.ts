// 「我」页（M2 批13 真化）：静默登录回灌资料 + 继续学习卡 + 入口列。
// 登录零资料采集（黄金 §九）；继续学习定位纯函数（不假装有课·无课卡片走「去逛逛」兜底）。
import { tapHaptic } from '../../lib/haptics'
import { login, getMyProgress, deleteAccount } from '../../api/user'
import { clearAll as clearAddresses } from '../../lib/address'
import { getMyCourses } from '../../api/learning'
import { getCoursesByIds } from '../../lib/courses'
import { playbackCache } from '../../lib/playbackCache' // 续播段取址预热（我页停留窗口预热·进播放器 peek 命中零云往返·根因#15）
import { getPageContent } from '../../lib/pageContent'
import { continueResolve, type ContinueTarget } from '../../lib/continueResolve'
import { mapMe, type MeVM } from '../../lib/mapMe' // 直引拆分模块（tab 闭包不拖 mapPages 法务长文·字体分层批）
import { openCustomerService } from '../../utils/customerService'
import { goHomeTab } from '../../lib/homeIntent'
// consumeExitGuard 别名：页面方法须叫 onExitGuardBeforeLeave（wxml bindbeforeleave 绑的就是它），同名易误读成递归
import { armExitGuard, releaseExitGuard, onExitGuardBeforeLeave as consumeExitGuard } from '../../utils/exitGuard'
import { loginGate } from '../../lib/loginGate'
import { currentAppVersionLine } from '../../lib/appVersion'
import { BRAND_SHORT } from '../../lib/brand'

const CONT_KEY = 'ld:me-cont'

function sanitizeCont(raw: unknown): ContinueTarget | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const courseId = String(o.courseId || '')
  const lessonId = String(o.lessonId || '')
  if (!courseId || !lessonId) return null
  return {
    courseId,
    courseTitle: String(o.courseTitle || ''),
    lessonId,
    lessonName: String(o.lessonName || ''),
    segmentId: String(o.segmentId || ''),
    resumeAt: Math.floor(Number(o.resumeAt) || 0),
  }
}

function readStoredCont(): ContinueTarget | null {
  try {
    return sanitizeCont(wx.getStorageSync(CONT_KEY))
  } catch {
    return null
  }
}

function writeStoredCont(cont: ContinueTarget | null): void {
  try {
    if (cont) wx.setStorageSync(CONT_KEY, cont)
    else wx.removeStorageSync(CONT_KEY)
  } catch {
    /* 旧卡是加分项·存不上不影响本趟刷新 */
  }
}

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

const seededCont = readStoredCont()

Page({
  data: {
    statusBarHeight: 0, // 沉浸式自绘导航：头部让开状态栏（navigationStyle:custom·2026-07-16 用户需求）
    nickname: '',
    avatar: '',
    bio: '',
    cont: seededCont,
    entries: mapMe(null).entries as MeVM['entries'], // 九入口标题/可见性·首帧默认（CMS 到达覆盖）
    contFailed: false, // 继续学习区取数失败标记（同 aftersales/order-list loadFailed 分治：失败≠没进度）
    contLoaded: !!seededCont, // 继续学习区首次取数是否落地（加载中≠没课·根因#8/#14）；有上次会话旧卡则首帧先画、后台再刷
    // 和「确认无课」，无 loading 位会让空态在数据未回来时就渲染成假空态（先空后有闪烁·2026-07-13 反馈）；
    // 置 true 前空态不显、改显骨架；首次 refresh 落地后恒 true（成功/失败任一路都置）。
    guestGreet: '欢迎来到' + BRAND_SHORT,
    loggedIn: false, // 已显式同意登录（loginGate hint）：真才显真实资料 + 退出按钮，假显登出态（默认身份 + 登录入口）
    exitGuardArmed: false, // 误触退出提醒（决策§30）：驱动 <page-container show>·onShow 武装（初值 false·未上屏不拦）
    versionLine: currentAppVersionLine(), // 页底版本行（开发/测试/发布候选·数字跟 package.json）
  },
  onLoad() {
    this.setData({ statusBarHeight: wx.getWindowInfo().statusBarHeight }) // 沉浸式：读状态栏高度让开自绘导航（onLoad 一次即可·不随 onShow 变）
  },
  onShow() {
    armExitGuard(this) // tabBar 栈底页误触退出提醒：武装 page-container 拦第一次返回（决策§30·见 utils/exitGuard）
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('me')
    loginGate.maybePromptOnce() // 软门槛本会话至多弹一次（首页/我页共用·未同意才弹）
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
    void this.refresh()
  },
  _seq: 0, // refresh 代次（同 order-list/aftersales 范式）：onShow 多触发点（tab 切回/其他页返回）并发 refresh，
  // 慢回包迟到落地会覆盖更晚一次 refresh 已落的新结果（P2·bug sweep Round2 item1）。
  async refresh() {
    const seq = ++this._seq
    const contP = this.refreshCont(seq) // 继续学习卡不等人资料/CMS（那两路只喂头像昵称/入口）
    const [u, meContent] = await Promise.all([login(), getPageContent('mePage')])
    if (seq !== this._seq) return
    const user = (u.ok ? u.user : null) as Record<string, any> | null
    const me = mapMe(meContent)
    const agreed = loginGate.hasAgreed()
    this.setData({
      loggedIn: agreed,
      nickname: (agreed && user && String(user.nickname || '')) || me.defaultNickname,
      avatar: (agreed && user && String(user.avatar || '')) || '',
      bio: (agreed && user && String(user.bio || '')) || '',
      entries: me.entries,
    })
    await contP
  },
  async refreshCont(seq: number) {
    const [progress, mine] = await Promise.all([getMyProgress(), getMyCourses()])
    if (seq !== this._seq) return
    if (!progress.ok || !mine.ok) {
      this.setData({ contLoaded: true, ...(this.data.cont ? {} : { contFailed: true }) })
      return
    }
    const ids = continueCourseIds(progress.list, mine.list)
    const courses = ids.length ? await getCoursesByIds(ids) : []
    if (seq !== this._seq) return
    if (courses === null) {
      this.setData({ contLoaded: true, ...(this.data.cont ? {} : { contFailed: true }) })
      return
    }
    const cont = continueResolve(progress.list, mine.list, courses)
    writeStoredCont(cont)
    this.setData({ cont, contFailed: false, contLoaded: true })
    if (cont) void playbackCache.prefetch(cont.courseId, cont.segmentId)
  },
  onRetryCont() {
    tapHaptic()
    void this.refresh() // 继续学习区失败态重试入口（me 页未开下拉刷新·按钮重试同 detail onRetryLoad 范式）
  },
  onContinue() {
    tapHaptic()
    const c = this.data.cont
    if (c) {
      // 带上次段位回到那一段（卡片显的是该课时·不带则播放器落首段·卡片承诺≠行为）；段位空则不拼（播放器挑首个可播段）
      const seg = c.segmentId ? '&segmentId=' + encodeURIComponent(c.segmentId) : ''
      // 续播到秒（批3·数据已在库·接通最后一公里）：resumeAt>0 才拼 &t=（0=从头/挑段·不拼）
      const at = c.resumeAt > 0 ? '&t=' + c.resumeAt : ''
      wx.navigateTo({ url: '/pages/player/player?courseId=' + c.courseId + seg + at })
    } else {
      // 兜底去逛逛→首页应从头逛起：防首页上次恰好滚到 FAQ 板块的旧滚动位置残留，造成「弹出大家都在问」错位观感
      goHomeTab()
    }
  },
  onEditProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })
  },
  // 登出态头部「登录」入口：打开登录半屏（同软门槛入口·loginGate 单例驱动）
  onLoginTap() {
    loginGate.open()
  },
  // 退出登录：确认后清本地登录 hint → 我的页转登出态（默认身份）。openid 固定身份不变、
  // 服务端订单/学习/资料仍在（再登即回）；刚主动退出本次不再自动弹登录（下次进 App 才软门槛）。
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需重新登录才能同步资料，你的订单和学习记录仍在。',
      confirmText: '退出',
      success: (r) => {
        if (!r.confirm) return
        loginGate.logout() // 清本地登录 hint（会话已弹过·不会立即再自动弹·下次进 App 才软门槛）
        void this.refresh()
        wx.showToast({ title: '已退出登录', icon: 'none' })
      },
    })
  },
  // 删除资料（隐私政策第六条）：两次确认后清云端个人资料/课程权限 + 本地登录与地址簿。
  // 上屏文案只用「我」页首屏字体已有的字（「注销账」不在 tier1·写上去会掉系统字体）。
  _deleting: false,
  onDeleteAccount() {
    if (this._deleting) return
    wx.showModal({
      title: '删除资料',
      content: '删除后这个微信不能再回到你的个人资料。学习记录和地址都会没有。订单还在。点继续才会删除。',
      confirmText: '继续',
      success: (r) => {
        if (!r.confirm) return
        wx.showModal({
          title: '删除资料',
          content: '删除后不能再看学习记录。',
          confirmText: '删除',
          success: (r2) => {
            if (!r2.confirm) return
            void this.runDeleteAccount()
          },
        })
      },
    })
  },
  async runDeleteAccount() {
    if (this._deleting) return
    this._deleting = true
    const r = await deleteAccount()
    this._deleting = false
    if (!r.ok) {
      wx.showToast({ title: '没删成请稍后再试', icon: 'none' })
      return
    }
    clearAddresses()
    loginGate.logout()
    writeStoredCont(null)
    this.setData({ cont: null, contFailed: false, contLoaded: true })
    void this.refresh()
    wx.showToast({ title: '已删除', icon: 'none' })
  },
  onCourses() {
    wx.navigateTo({ url: '/pages/my-courses/my-courses' })
  },
  onActivate() {
    wx.navigateTo({ url: '/pages/welcome/welcome' })
  },
  // 三格（待付款/待发货/待收货）带 data-tab 直落对应分栏；「全部订单」无 dataset 不带 tab（order-list.ts query.tab 契约）。
  onOrders(e?: WechatMiniprogram.TouchEvent) {
    const tab = (e && e.currentTarget && e.currentTarget.dataset && String(e.currentTarget.dataset.tab || '')) || ''
    wx.navigateTo({ url: '/pages/order-list/order-list' + (tab ? '?tab=' + tab : '') })
  },
  onAfterSales() {
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
  onConsent() {
    wx.navigateTo({ url: '/pages/consent/consent' })
  },
})
