// 激活页（M2 批10·播放器重设计战役批E 扩 W1/W2 恭喜/学习方式两屏）：扫激活卡二维码带 ?code= 进入
// （或手动输码）→ 兑课三态屏 → （新激活）W1 恭喜屏 → W2 三件事屏 → 确认进课。
// 一码一用/幂等/退货权失效节点全在云端；本页只编排各态视图与背景回退链。kind==='mine'/'taken'/'invalid'
// 三态沉浸壳与文案一字不动；仅 kind==='activated' 的结果屏改走 W1/W2 lilac 壳（见 wxml 头注）。
import { tapHaptic } from '../../lib/haptics'
import { activateCourse, confirmEnter } from '../../api/learning'
import { getContent } from '../../api/catalog'
import { getPageContent } from '../../lib/pageContent'
import { getCourseById } from '../../lib/courses'
import { activationView, bgFor, type ActivationKind } from '../../lib/mapLearning'
import { mapWelcome, type WelcomeVM } from '../../lib/mapPages'
import type { ApiResult } from '../../utils/cloud'
import { goHomeTab } from '../../lib/homeIntent'

Page({
  data: {
    statusBarHeight: 0,
    phase: 'input' as 'input' | 'result' | 'w2',
    kind: 'invalid' as ActivationKind,
    code: '',
    courseId: '',
    courseTitle: '', // W1 课程名行数据源（取不到/空则不渲染该行·诚实回退，见 activate()）
    bg: '',
    busy: false,
    welcome: mapWelcome(null) as WelcomeVM, // W1/W2 文案·首帧即默认（CMS 到达后覆盖·不空屏）
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
    void this.loadPageContent() // W1/W2 文案·与激活流程互不依赖，并行发起（不阻塞首帧·默认已在 data）
    const code = String(query.code || '').trim()
    if (code) {
      this.setData({ code })
      void this.activate(code)
    }
  },
  // CMS W1/W2 文案（fail-soft·拉不到维持默认）：await 恢复点复核 unloaded（守卫 rw-mp-await-side-effect-unloaded-recheck 纪律）。
  async loadPageContent() {
    const content = await getPageContent('welcome')
    if (this.unloaded) return
    this.setData({ welcome: mapWelcome(content) })
  },
  onInput(e: WechatMiniprogram.Input) {
    this.setData({ code: e.detail.value.trim().toUpperCase() })
  },
  onActivate() {
    if (!this.data.code) {
      wx.showToast({ title: '先输入激活码', icon: 'none' })
      return
    }
    if (this.data.busy) return // 兑课在途（按钮 dim）：不重复触发、不震
    tapHaptic()
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
      courseTitle: '',
      bg: bgFor(this.home, view.courseId, view.kind),
    })
    if (view.kind === 'activated' && view.courseId) {
      // W1 课程名行（fail-soft）：新激活才取，mine/taken/invalid 三态沉浸壳不显课程名、不必取。
      const course = await getCourseById(view.courseId)
      if (this.unloaded) return // await 恢复点复核（新增 await 点同守 rw-mp-await-side-effect-unloaded-recheck 纪律）
      const title = course ? String((course as Record<string, unknown>).title || '') : ''
      if (title) this.setData({ courseTitle: title })
    }
  },
  // W1 → W2（纯前端翻屏，不发请求）。
  onNextWelcome() {
    tapHaptic()
    this.setData({ phase: 'w2' })
  },
  async onEnter() {
    if (this.data.busy) return
    tapHaptic()
    this.setData({ busy: true })
    const r = await confirmEnter(this.data.code)
    if (this.unloaded) return // await 恢复点复核（bug sweep II 批E）：用户已退出本页——不再 setData/toast/redirectTo
    if (!r.ok) {
      // 仅失败复位 busy（深审20260712 P3·同 review/feedback onSubmit 范式）：成功路径保持锁定直至 redirectTo——
      // 提前解锁则导航完成前双击可再次 confirmEnter+redirectTo
      this.setData({ busy: false })
      wx.showToast({ title: '进课没成功，稍后再试', icon: 'none' })
      return
    }
    // 进课直达该课目录（W2「进入课程」/mine 屏「继续学习」共用本方法）；courseId 前置缺失兜底回我的课程列表（无参）。
    const courseId = this.data.courseId
    wx.redirectTo({ url: courseId ? '/pages/catalog/catalog?courseId=' + courseId : '/pages/my-courses/my-courses' })
  },
  onRetry() {
    this.setData({ phase: 'input', code: '', kind: 'invalid', bg: '' })
  },
  onGoHome() {
    // 「先逛逛，稍后再进课」→ 首页应从头逛起：防上次恰好滚到 FAQ 板块的旧滚动位置残留，造成错位观感
    goHomeTab()
  },
})
