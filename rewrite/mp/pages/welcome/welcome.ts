// 激活页（M2 批10）：扫激活卡二维码带 ?code= 进入（或手动输码）→ 兑课三态屏 → 确认进课。
// 一码一用/幂等/退货权失效节点全在云端；本页只编排三态视图与背景回退链。
import { activateCourse, confirmEnter } from '../../api/learning'
import { getContent } from '../../api/catalog'
import { activationView, bgFor, type ActivationKind } from '../../lib/mapLearning'
import type { ApiResult } from '../../utils/cloud'

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
  // getContent（背景图）与 activateCourse（兑课）互不依赖：并行发起省一次云调用往返（0.7-1.4s/次）。
  // 页实例持有而非模块级——同 home 一样跟着本次 onLoad 走，避免跨实例复用陈旧 promise。
  homeReady: null as Promise<ApiResult> | null,
  unloaded: false, // 页面已退出标记（同 checkout/review 范式·bug sweep II 批E）：onEnter 进课回包在途用户已退出本页（自绘导航无返回箭头，但侧滑/物理键仍可退），迟到回包不再 redirectTo
  onUnload() {
    this.unloaded = true
  },
  onLoad(query: Record<string, string | undefined>) {
    const info = wx.getWindowInfo()
    this.setData({ statusBarHeight: info.statusBarHeight })
    this.homeReady = getContent() // 不 await：activate() 里再取，跟 activateCourse 并行
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
    const contentReady = this.homeReady ?? Promise.resolve({ ok: false } as ApiResult)
    const [result, content] = await Promise.all([activateCourse(code), contentReady])
    if (this.unloaded) return // await 恢复点复核（H·完备性扫描新增·同 onEnter 范式）：用户已退出本页——不再 setData
    this.home = content.ok ? content.home : null // bgFor null-safe：取不到就走回退链，不阻塞结果屏
    const view = activationView(result)
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
    if (this.unloaded) return // await 恢复点复核（bug sweep II 批E）：用户已退出本页——不再 setData/toast/redirectTo
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
