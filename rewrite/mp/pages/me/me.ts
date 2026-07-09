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
  },
  onShow() {
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('me')
    void this.refresh()
  },
  async refresh() {
    // login/getMyProgress/getMyCourses 保持实时（login 兼具服务端记账语义，进度/我的课不缓存）；
    // 课程目录本会话内不变，走 lib/courses 会话缓存（根因账本#15）——命中零云调用。
    const [u, progress, mine, courses] = await Promise.all([login(), getMyProgress(), getMyCourses(), getAllCourses()])
    const user = (u.ok ? u.user : null) as Record<string, any> | null
    this.setData({
      // 云端资料回灌：非空覆盖默认、空不显示假名（黄金 §九）
      nickname: (user && String(user.nickname || '')) || '钩织新手',
      avatar: (user && String(user.avatar || '')) || '',
      bio: (user && String(user.bio || '')) || '',
      cont: continueResolve(progress.ok ? progress.list : [], mine.ok ? mine.list : [], courses || []),
    })
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
  onOrders() {
    wx.navigateTo({ url: '/pages/order-list/order-list' })
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
