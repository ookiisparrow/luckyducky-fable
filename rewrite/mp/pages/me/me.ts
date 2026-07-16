// 「我」页（M2 批13 真化）：静默登录回灌资料 + 继续学习卡 + 入口列。
// 登录零资料采集（黄金 §九）；继续学习定位纯函数（不假装有课·无课卡片走「去逛逛」兜底）。
import { tapHaptic } from '../../lib/haptics'
import { login, getMyProgress } from '../../api/user'
import { getMyCourses } from '../../api/learning'
import { getAllCourses } from '../../lib/courses'
import { getPageContent } from '../../lib/pageContent'
import { continueResolve, type ContinueTarget } from '../../lib/continueResolve'
import { mapMe, type MeVM } from '../../lib/mapPages'
import { openCustomerService } from '../../utils/customerService'
import { goHomeTab } from '../../lib/homeIntent'
import { armExitAlert } from '../../utils/exitGuard'
import { loginGate } from '../../lib/loginGate'

Page({
  data: {
    statusBarHeight: 0, // 沉浸式自绘导航：头部让开状态栏（navigationStyle:custom·2026-07-16 用户需求）
    nickname: '',
    avatar: '',
    bio: '',
    cont: null as ContinueTarget | null,
    entries: mapMe(null).entries as MeVM['entries'], // 九入口标题/可见性·首帧默认（CMS 到达覆盖）
    contFailed: false, // 继续学习区取数失败标记（同 aftersales/order-list loadFailed 分治：失败≠没进度）
    loggedIn: false, // 已显式同意登录（loginGate hint）：真才显真实资料 + 退出按钮，假显登出态（默认身份 + 登录入口）
  },
  onLoad() {
    this.setData({ statusBarHeight: wx.getWindowInfo().statusBarHeight }) // 沉浸式：读状态栏高度让开自绘导航（onLoad 一次即可·不随 onShow 变）
  },
  onShow() {
    armExitAlert() // tabBar 根页误触退出提醒（返回二次确认·2026-07-13 用户反馈·覆盖边界见 utils/exitGuard）
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('me')
    loginGate.maybePromptOnce() // 软门槛本会话至多弹一次（首页/我页共用·未同意才弹）
    void this.refresh()
  },
  // 登录半屏「微信一键登录」成功回调：刷新资料（hint 已由组件写·此处回灌头像昵称/入口可见性）
  onLoggedIn() {
    void this.refresh()
  },
  _seq: 0, // refresh 代次（同 order-list/aftersales 范式）：onShow 多触发点（tab 切回/其他页返回）四路并发 Promise.all，
  // 慢回包迟到落地会覆盖更晚一次 refresh 已落的新结果（P2·bug sweep Round2 item1）。
  async refresh() {
    // login/getMyProgress/getMyCourses 保持实时（login 兼具服务端记账语义，进度/我的课不缓存）；
    // 课程目录本会话内不变，走 lib/courses 会话缓存（根因账本#15）——命中零云调用。
    const seq = ++this._seq
    // mePage 内容（默认昵称 + 九入口标题/可见性）并入 Promise.all——本会话内经 lib/pageContent 缓存命中零重拉，
    // 且随 _seq 一并做过期回包复核（慢回包不覆盖更晚一次 refresh 的落地）。
    const [u, progress, mine, courses, meContent] = await Promise.all([
      login(),
      getMyProgress(),
      getMyCourses(),
      getAllCourses(),
      getPageContent('mePage'),
    ])
    if (seq !== this._seq) return // 过期回包（被更晚 refresh 取代）：丢弃
    const user = (u.ok ? u.user : null) as Record<string, any> | null
    const me = mapMe(meContent)
    // 登出态不显真实资料（退出登录后即便 openid 仍可回灌，也按登出显默认身份·不假装还登着）
    const agreed = loginGate.hasAgreed()
    // 失败≠没进度（同 aftersales/order-list loadFailed 分治·失败伪装空态 P2）：progress/mine/courses
    // 任一取数失败时，空列表与「真没进度/没买课」数据形状等价，喂 continueResolve 会渲染成假空态。
    // 失败不覆盖已有 cont（旧卡仍可点）；一无所有才亮 contFailed 给重试；真空态（全成功无课）仍走引导。
    const contFetchFailed = !progress.ok || !mine.ok || courses === null
    this.setData({
      loggedIn: agreed,
      // 云端资料回灌：已登录时非空覆盖默认、空回退 CMS 默认昵称（黄金 §九·不显示假名）；登出态一律默认身份
      nickname: (agreed && user && String(user.nickname || '')) || me.defaultNickname,
      avatar: (agreed && user && String(user.avatar || '')) || '',
      bio: (agreed && user && String(user.bio || '')) || '',
      entries: me.entries,
      ...(contFetchFailed
        ? { contFailed: !this.data.cont }
        : { cont: continueResolve(progress.list, mine.list, courses), contFailed: false }),
    })
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
      wx.navigateTo({ url: '/pages/player/player?courseId=' + c.courseId + seg })
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
