// 全屏像素特效层 <px-fx id="fx" />：撒花 / 彩虹转场 / 暗场转场（算法见 lib/pxFx，调用走 lib/pxFx 的 runFx）。
// 页面级 position:fixed 的 2d canvas，放在页面根下、不进 scroll-view（canvas 进滚动容器会漂·见 lib/pixelView 注）。
// 转场进行中盖一层透明挡板吃掉点按，防连点二次跳转。
// 跨页接力（60fps 录屏逐帧核过的错乱）：navigateTo 自带系统滑入动画关不掉，旧页画布在跳页那一刻会丢——
// 旧页内容闪回 ~130ms，再滑入一张没盖底的新页。所以铺满后旧页换成纯色遮罩 view（不会丢），新页一出生就盖同色
// 遮罩（同色盖同色，滑入看不出来），滑完再照设计稿 fxEnter 淡出（280ms ease-out）。
import { ditherRuns, distField, ease, party, rainbowRuns, stepConfetti, RAINBOW_DUR, PAPER, DARK, type Bit, type ConfirmOpts, type Rect, type Runs } from '../../lib/pxFx'
import { burstHaptic } from '../../lib/haptics'
import { createHold, type Hold } from '../../lib/hold'
import { keyDown, keyPress, keyUp } from '../../lib/keyFx'

type Ctx = {
  clearRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  rect(x: number, y: number, w: number, h: number): void
  fill(): void
  scale(x: number, y: number): void
  fillStyle: string
  globalAlpha: number
}
type Cv = { width: number; height: number; getContext(t: '2d'): Ctx; requestAnimationFrame(cb: (t: number) => void): number; cancelAnimationFrame(id: number): void }
type St = { cv?: Cv; x?: Ctx; w: number; h: number; bits: Bit[]; cfRaf: number; cfLast: number; fxRaf: number }

const S = new WeakMap<object, St>()
const DITHER_DUR = 800
const SLIDE_MS = 300 // 系统 navigateTo 滑入时长（工具 60fps 录屏实测 ~250ms·留余量）：新页遮罩等滑完再淡出
const FADE_MS = 280
// 铺满那一刻记下底色，新页的 px-fx attached 时认领；1.5s 内有效（跳到没挂 px-fx 的页就作废，不串到以后的页）
let entering: { color: string; at: number } | null = null

function paint(x: Ctx, runs: Runs) {
  for (const c in runs) {
    const r = runs[c]
    x.fillStyle = c
    x.beginPath()
    for (let i = 0; i < r.length; i += 3) x.rect(r[i], r[i + 1], r[i + 2], 4)
    x.fill()
  }
}

// 提示定时器每实例一份（页面栈里多页各挂一个·共用一个会被别页的提示清掉，本页提示就卡住不消失）
const toastTimers = new WeakMap<object, ReturnType<typeof setTimeout>>()
// 跨页接力（像素化 9c 替原生 showToast·原生提示是全局的、跳页还在）：提示期间换页（返回/跳转），
// 新露面那页的 px-fx 认领剩余时长接着显示——「已保存」随即返回、「已提交」随即跳售后都照旧看得到。
let lastToast: { text: string; kind: ToastKind; until: number; owner: object } | null = null
type ToastKind = '' | 'ok' | 'loading'
const CF_OUT_MS = 240 // 同 leave-sheet：面板 240ms 下滑后撤节点
const CF_HOLD_MS = 700 // 规格 9c：危险确认按住 700ms
const cfDone = new WeakMap<object, (ok: boolean) => void>()
const cfHolds = new WeakMap<object, Hold>()

Component({
  data: {
    busy: false,
    blocking: false,
    toastShow: false,
    toastKind: '' as ToastKind,
    toastText: '',
    cover: '',
    coverOut: false,
    cf: null as ConfirmOpts | null,
    cfOut: false,
    cfHold: false,
  },
  lifetimes: {
    attached() {
      const wi = wx.getWindowInfo()
      S.set(this, { w: wi.windowWidth, h: wi.windowHeight, bits: [], cfRaf: 0, cfLast: 0, fxRaf: 0 })
      if (entering && Date.now() - entering.at < 1500) this.setData({ cover: entering.color, coverOut: false })
      entering = null
      this.claimToast()
      cfHolds.set(
        this,
        createHold(CF_HOLD_MS, () => this.closeCf(true), {
          onQuick: () => this.toast('按住' + (this.data.cf?.confirmText || '')),
          onChange: (v) => this.setData({ cfHold: v }),
        })
      )
    },
    ready() {
      if (this.data.cover) setTimeout(() => this.uncover(), SLIDE_MS + 60)
    },
    detached() {
      const s = S.get(this)
      if (s?.cv) {
        s.cv.cancelAnimationFrame(s.cfRaf)
        s.cv.cancelAnimationFrame(s.fxRaf)
      }
      S.delete(this)
      clearTimeout(toastTimers.get(this))
      cfHolds.get(this)?.cancel()
      cfDone.get(this)?.(false) // 页面带着没答的确认半屏卸掉＝当取消（调用方的 await 不能永远挂着）
      cfDone.delete(this)
    },
  },
  pageLifetimes: {
    show() {
      this.claimToast()
    },
    hide() {
      // 跳走后旧页遮罩等新页滑完再撤（本页已被盖住·撤了看不见），返回时就是干净的本页
      if (this.data.cover) setTimeout(() => this.clearCover(), SLIDE_MS + 140)
    },
  },
  methods: {
    noop() {},
    clearCover() {
      this.setData({ cover: '', coverOut: false })
      this.tabBar(false)
    },
    uncover() {
      if (!this.data.cover || this.data.coverOut) return
      this.setData({ coverOut: true })
      setTimeout(() => this.clearCover(), FADE_MS)
    },
    // 自定义 TabBar 是框架独立层、页面内 z-index 盖不住：转场铺到底部那一刻让它让位（tab 页才有·非 tab 页 getTabBar 为空）
    tabBar(covered: boolean) {
      const owner = this.selectOwnerComponent() as unknown as { getTabBar?: () => { setCovered?: (v: boolean) => void } | null }
      owner?.getTabBar?.()?.setCovered?.(covered)
    },
    /** 系统层轻提示（设计稿 toast：阶梯深色框，成功带像素 ✓，默认 1.5 秒后 180ms 淡出）。mask＝提示期间挡住点按。 */
    toast(text: string, ok = false, ms = 1500, mask = false) {
      clearTimeout(toastTimers.get(this))
      const kind: ToastKind = ok ? 'ok' : ''
      lastToast = { text, kind, until: Date.now() + ms, owner: this }
      this.setData({ toastText: text, toastKind: kind, toastShow: true, blocking: mask })
      toastTimers.set(
        this,
        setTimeout(() => {
          toastTimers.delete(this)
          this.setData({ toastShow: false, blocking: false })
        }, ms)
      )
    },
    /** 别页刚弹、还没到点的提示：本页露面时接着显示剩下的时长。 */
    claimToast() {
      const t = lastToast
      if (!t || t.owner === this || t.kind === 'loading') return
      const left = t.until - Date.now()
      if (left > 200) this.toast(t.text, t.kind === 'ok', left)
    },
    /** 加载框（替原生 showLoading）：像素转圈 + 字，挡住点按，直到 loaded()。 */
    loading(text: string) {
      clearTimeout(toastTimers.get(this))
      toastTimers.delete(this)
      lastToast = null
      this.setData({ toastText: text, toastKind: 'loading', toastShow: true, blocking: true })
    },
    loaded() {
      if (this.data.toastKind === 'loading') this.setData({ toastShow: false, blocking: false })
    },
    /** 确认半屏（替原生 showModal）：resolve(true)＝确认。danger＝左键红字按住 700ms 才确认；single＝只一颗「知道了」。 */
    confirm(o: ConfirmOpts): Promise<boolean> {
      cfDone.get(this)?.(false)
      return new Promise((resolve) => {
        cfDone.set(this, resolve)
        this.setData({ cf: { confirmText: '确定', cancelText: '取消', ...o }, cfOut: false, cfHold: false })
      })
    },
    closeCf(ok: boolean) {
      if (!this.data.cf || this.data.cfOut) return
      cfHolds.get(this)?.cancel()
      const done = cfDone.get(this)
      cfDone.delete(this)
      this.setData({ cfOut: true })
      setTimeout(() => {
        this.setData({ cf: null, cfOut: false })
        done?.(ok)
      }, CF_OUT_MS)
    },
    onCfYes() {
      this.closeCf(true)
    },
    onCfNo() {
      this.closeCf(false)
    },
    onCfMask() {
      this.closeCf(!!this.data.cf?.single) // 只一颗键的通知：点遮罩＝知道了
    },
    onCfHoldStart(e: WechatMiniprogram.TouchEvent) {
      keyPress('light') // 按住类键自己 catch 了 touchstart，手感在这里补
      const t = e.touches[0]
      cfHolds.get(this)?.start(t?.clientX, t?.clientY)
    },
    onCfHoldMove(e: WechatMiniprogram.TouchEvent) {
      const t = e.touches[0]
      if (t) cfHolds.get(this)?.move(t.clientX, t.clientY)
    },
    onCfHoldEnd() {
      cfHolds.get(this)?.end()
    },
    onCfHoldCancel() {
      cfHolds.get(this)?.cancel()
    },
    onKeyDown: keyDown,
    onKeyUp: keyUp,
    canvas(): Promise<St | null> {
      const s = S.get(this)
      if (!s) return Promise.resolve(null)
      if (s.x) return Promise.resolve(s)
      return new Promise((resolve) => {
        this.createSelectorQuery()
          .select('#fx')
          .fields({ node: true, size: true })
          .exec((res) => {
            const cv = res && res[0] && (res[0].node as Cv)
            if (!cv) return resolve(null)
            const dpr = wx.getWindowInfo().pixelRatio || 2
            cv.width = s.w * dpr
            cv.height = s.h * dpr
            const x = cv.getContext('2d')
            x.scale(dpr, dpr)
            s.cv = cv
            s.x = x
            resolve(s)
          })
      })
    },
    /** 撒花：从键矩形 k 喷出；big＝整屏大撒花（完课/好评）。 */
    async party(k: Rect, big = false, n?: number) {
      const s = await this.canvas()
      if (!s || !s.cv || !s.x) return
      party(s.bits, k, s, big, n)
      if (big) burstHaptic()
      if (s.cfRaf) return
      s.cfLast = 0
      const loop = (now: number) => {
        const dt = s.cfLast ? Math.min(48, now - s.cfLast) : 16.67
        s.cfLast = now
        if (!this.data.busy) s.x!.clearRect(0, 0, s.w, s.h) // 转场帧自己整屏重画，撒花只叠在上面
        for (const c of stepConfetti(s.bits, dt, s.h)) {
          s.x!.globalAlpha = c.a
          s.x!.fillStyle = c.c
          s.x!.fillRect(c.x, c.y, c.w, c.h)
        }
        s.x!.globalAlpha = 1
        s.cfRaf = s.bits.length ? s.cv!.requestAnimationFrame(loop) : 0
        if (!s.cfRaf && !this.data.busy) s.x!.clearRect(0, 0, s.w, s.h)
      }
      s.cfRaf = s.cv.requestAnimationFrame(loop)
    },
    /** 彩虹 / 暗场转场：铺满后调 go（跳页）。画不出来（取不到 canvas）直接 go，不耽误跳转。 */
    async transit(kind: 'rainbow' | 'dither', k: Rect, go: () => void) {
      if (this.data.busy) return
      const s = await this.canvas()
      if (!s || !s.cv || !s.x) return go()
      this.setData({ busy: true })
      const F = distField(s.w, s.h, k)
      const st: { rev?: number } = {}
      const delay = kind === 'rainbow' ? 150 : 90
      const dur = kind === 'rainbow' ? RAINBOW_DUR : DITHER_DUR
      // 底部 TabBar 中心离键的距离占全程的比例：扩散前沿过了这里就让 TabBar 让位
      const tabAt = F.D[Math.floor((s.h - 40) / 4) * F.cols + Math.floor(s.w / 8)] / F.maxD
      let tabHidden = false
      let t0 = 0
      const frame = (now: number) => {
        if (!t0) t0 = now + delay
        const t = now - t0
        const x = s.x!
        x.clearRect(0, 0, s.w, s.h)
        if (t >= dur) {
          const color = kind === 'rainbow' ? PAPER : DARK
          x.fillStyle = color
          x.fillRect(0, 0, s.w, s.h)
          s.fxRaf = 0
          // 遮罩上屏后再擦画布、再跳页（画布跨页会丢·见文件头）
          this.setData({ busy: false, cover: color, coverOut: false }, () => {
            x.clearRect(0, 0, s.w, s.h)
            entering = { color, at: Date.now() }
            go()
            // 跳页失败（页栈满/路径错）本页不会 hide：2s 后淡出遮罩兜底，不把人困在一块纯色里
            setTimeout(() => this.uncover(), 2000)
          })
          return
        }
        if (!tabHidden && ease(Math.max(0, t) / dur) >= tabAt) {
          tabHidden = true
          this.tabBar(true)
        }
        paint(x, kind === 'rainbow' ? rainbowRuns(F, t, st) : ditherRuns(F, Math.max(0, t) / dur))
        s.fxRaf = s.cv!.requestAnimationFrame(frame)
      }
      s.fxRaf = s.cv.requestAnimationFrame(frame)
    },
  },
})
