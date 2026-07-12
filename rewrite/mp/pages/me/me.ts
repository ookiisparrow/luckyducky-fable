// 「我」页（M2 批13 真化）：静默登录回灌资料 + 继续学习卡 + 入口列。
// 登录零资料采集（黄金 §九）；继续学习定位纯函数（不假装有课·无课卡片走「去逛逛」兜底）。
import { login, getMyProgress } from '../../api/user'
import { getMyCourses } from '../../api/learning'
import { getAllCourses } from '../../lib/courses'
import { continueResolve, type ContinueTarget } from '../../lib/continueResolve'
import { openCustomerService } from '../../utils/customerService'

Page({
  data: {
    nickname: '',
    avatar: '',
    bio: '',
    cont: null as ContinueTarget | null,
    contFailed: false, // 继续学习区取数失败标记（同 aftersales/order-list loadFailed 分治：失败≠没进度）
  },
  onShow() {
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('me')
    void this.refresh()
  },
  _seq: 0, // refresh 代次（同 order-list/aftersales 范式）：onShow 多触发点（tab 切回/其他页返回）四路并发 Promise.all，
  // 慢回包迟到落地会覆盖更晚一次 refresh 已落的新结果（P2·bug sweep Round2 item1）。
  async refresh() {
    // login/getMyProgress/getMyCourses 保持实时（login 兼具服务端记账语义，进度/我的课不缓存）；
    // 课程目录本会话内不变，走 lib/courses 会话缓存（根因账本#15）——命中零云调用。
    const seq = ++this._seq
    const [u, progress, mine, courses] = await Promise.all([login(), getMyProgress(), getMyCourses(), getAllCourses()])
    if (seq !== this._seq) return // 过期回包（被更晚 refresh 取代）：丢弃
    const user = (u.ok ? u.user : null) as Record<string, any> | null
    // 失败≠没进度（同 aftersales/order-list loadFailed 分治·失败伪装空态 P2）：progress/mine/courses
    // 任一取数失败时，空列表与「真没进度/没买课」数据形状等价，喂 continueResolve 会渲染成假空态。
    // 失败不覆盖已有 cont（旧卡仍可点）；一无所有才亮 contFailed 给重试；真空态（全成功无课）仍走引导。
    const contFetchFailed = !progress.ok || !mine.ok || courses === null
    this.setData({
      // 云端资料回灌：非空覆盖默认、空不显示假名（黄金 §九）
      nickname: (user && String(user.nickname || '')) || '钩织新手',
      avatar: (user && String(user.avatar || '')) || '',
      bio: (user && String(user.bio || '')) || '',
      ...(contFetchFailed
        ? { contFailed: !this.data.cont }
        : { cont: continueResolve(progress.list, mine.list, courses), contFailed: false }),
    })
  },
  onRetryCont() {
    void this.refresh() // 继续学习区失败态重试入口（me 页未开下拉刷新·按钮重试同 detail onRetryLoad 范式）
  },
  onContinue() {
    const c = this.data.cont
    if (c) {
      // 带上次段位回到那一段（卡片显的是该课时·不带则播放器落首段·卡片承诺≠行为）；段位空则不拼（播放器挑首个可播段）
      const seg = c.segmentId ? '&segmentId=' + encodeURIComponent(c.segmentId) : ''
      wx.navigateTo({ url: '/pages/player/player?courseId=' + c.courseId + seg })
    } else wx.switchTab({ url: '/pages/home/home' }) // 无课兜底：去逛逛
  },
  onEditProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })
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
