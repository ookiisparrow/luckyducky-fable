// 激活页（M2 批10）：扫激活卡二维码带 ?code= 进入（或手动输码）→ 兑课三态屏 → 确认进课。
// 一码一用/幂等/退货权失效节点全在云端；本页只编排三态视图与背景回退链。
import { activateCourse, confirmEnter } from '../../api/learning'
import { getContent } from '../../api/catalog'
import { activationView, bgFor, type ActivationKind } from '../../lib/mapLearning'

Page({
  data: {
    statusBarHeight: 0,
    phase: 'input' as 'input' | 'result',
    kind: 'invalid' as ActivationKind,
    code: '',
    courseId: '',
    bg: '',
    busy: false,
  },
  home: null as unknown,
  async onLoad(query: Record<string, string | undefined>) {
    const info = wx.getWindowInfo()
    this.setData({ statusBarHeight: info.statusBarHeight })
    const content = await getContent()
    this.home = content.ok ? content.home : null
    const code = String(query.code || '').trim()
    if (code) {
      this.setData({ code })
      void this.activate(code)
    }
  },
  onInput(e: WechatMiniprogram.Input) {
    this.setData({ code: e.detail.value.trim().toUpperCase() })
  },
  onActivate() {
    if (!this.data.code) {
      wx.showToast({ title: '先输入激活码', icon: 'none' })
      return
    }
    void this.activate(this.data.code)
  },
  async activate(code: string) {
    if (this.data.busy) return
    this.setData({ busy: true })
    const view = activationView(await activateCourse(code))
    this.setData({
      busy: false,
      phase: 'result',
      kind: view.kind,
      courseId: view.courseId,
      bg: bgFor(this.home, view.courseId, view.kind),
    })
  },
  async onEnter() {
    if (this.data.busy) return
    this.setData({ busy: true })
    const r = await confirmEnter(this.data.code)
    this.setData({ busy: false })
    if (!r.ok) {
      wx.showToast({ title: '进课没成功，稍后再试', icon: 'none' })
      return
    }
    // 定位：带上刚激活的 courseId，我的课程页高亮该课卡（用户扫码激活后要一眼找到刚拿到的课）；空值不带参（onEnter 前置 courseId 缺失兜底）
    wx.redirectTo({ url: '/pages/my-courses/my-courses' + (this.data.courseId ? '?courseId=' + this.data.courseId : '') })
  },
  onRetry() {
    this.setData({ phase: 'input', code: '', kind: 'invalid', bg: '' })
  },
  onGoHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },
})
