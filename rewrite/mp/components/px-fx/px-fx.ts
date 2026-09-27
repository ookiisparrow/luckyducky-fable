// 全屏像素特效层 <px-fx id="fx" />：撒花 / 彩虹转场 / 暗场转场（算法见 lib/pxFx，调用走 lib/pxFx 的 runFx）。
// 页面级 position:fixed 的 2d canvas，放在页面根下、不进 scroll-view（canvas 进滚动容器会漂·见 lib/pixelView 注）。
// 转场进行中盖一层透明挡板吃掉点按，防连点二次跳转。
import { ditherRuns, distField, party, rainbowRuns, stepConfetti, RAINBOW_DUR, type Bit, type Rect, type Runs } from '../../lib/pxFx'
import { burstHaptic } from '../../lib/haptics'

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

function paint(x: Ctx, runs: Runs) {
  for (const c in runs) {
    const r = runs[c]
    x.fillStyle = c
    x.beginPath()
    for (let i = 0; i < r.length; i += 3) x.rect(r[i], r[i + 1], r[i + 2], 4)
    x.fill()
  }
}

Component({
  data: { busy: false },
  lifetimes: {
    attached() {
      const wi = wx.getWindowInfo()
      S.set(this, { w: wi.windowWidth, h: wi.windowHeight, bits: [], cfRaf: 0, cfLast: 0, fxRaf: 0 })
    },
    detached() {
      const s = S.get(this)
      if (s?.cv) {
        s.cv.cancelAnimationFrame(s.cfRaf)
        s.cv.cancelAnimationFrame(s.fxRaf)
      }
      S.delete(this)
    },
  },
  pageLifetimes: {
    show() {
      // 转场跳走后铺满的纸色/深色留在本页；回到本页时擦掉（跳走那一刻不能擦，新页还在滑入）
      const s = S.get(this)
      if (s?.x && !this.data.busy) s.x.clearRect(0, 0, s.w, s.h)
    },
  },
  methods: {
    noop() {},
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
      let t0 = 0
      const frame = (now: number) => {
        if (!t0) t0 = now + delay
        const t = now - t0
        const x = s.x!
        x.clearRect(0, 0, s.w, s.h)
        if (t >= dur) {
          x.fillStyle = kind === 'rainbow' ? '#fafaf8' : '#121212'
          x.fillRect(0, 0, s.w, s.h)
          s.fxRaf = 0
          this.setData({ busy: false })
          go()
          return
        }
        paint(x, kind === 'rainbow' ? rainbowRuns(F, t, st) : ditherRuns(F, Math.max(0, t) / dur))
        s.fxRaf = s.cv!.requestAnimationFrame(frame)
      }
      s.fxRaf = s.cv.requestAnimationFrame(frame)
    },
  },
})
