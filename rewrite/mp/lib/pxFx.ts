// 像素撒花 / 转场（v5 设计稿 party · fxEnter · fxRainbow·老板 2026-09-28「其他根据设计稿实现」）。
// 纯计算：参数原样移植设计稿；画在 components/px-fx 那张页面级全屏 canvas 上（不进 scroll-view，不会漂）。
// 与设计稿的差异（小程序做不到）：设计稿彩虹/暗场里「新页面」在圈内透出来；小程序不能把下一页画进当前页，
// 圈内先铺纸色（彩虹）/ 深色（暗场），铺满后再 navigateTo，新页滑进来时接得上底色。
// 每帧按行把同色相邻格并成一段（runs），一段只画一个 rect——整屏 2 万格压到几百次 rect，低端安卓也跟得上。

export const PX = 4
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
export const hsh = (i: number, t: number): number => {
  let h = Math.imul(i, 374761393) ^ Math.imul(t + 1, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
export const ease = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2)

export const PAPER = '#fafaf8' // = --v5-canvas，彩虹圈内铺这个等新页
export const DARK = '#121212' // = 播放页底色
const PURPLE = '#8A5AE0'

export type Rect = { left: number; top: number; right: number; bottom: number }
export type Field = { w: number; h: number; cols: number; rows: number; D: Float32Array; maxD: number }
/** 颜色 → 扁平 [x, y, w, …]（单位 px，高恒为 PX）。 */
export type Runs = Record<string, number[]>

/** 每格中心到键矩形的距离（键内为 0）。 */
export function distField(w: number, h: number, k: Rect): Field {
  const cols = Math.ceil(w / PX)
  const rows = Math.ceil(h / PX)
  const D = new Float32Array(cols * rows)
  let maxD = 0
  for (let gy = 0; gy < rows; gy++)
    for (let gx = 0; gx < cols; gx++) {
      const X = gx * PX + PX / 2
      const Y = gy * PX + PX / 2
      const d = Math.hypot(Math.max(k.left - X, 0, X - k.right), Math.max(k.top - Y, 0, Y - k.bottom))
      D[gy * cols + gx] = d
      if (d > maxD) maxD = d
    }
  return { w, h, cols, rows, D, maxD }
}

function toRuns(F: Field, colorOf: (gx: number, gy: number, i: number) => string): Runs {
  const out: Runs = {}
  for (let gy = 0; gy < F.rows; gy++) {
    let cur = ''
    let x0 = 0
    for (let gx = 0; gx <= F.cols; gx++) {
      const c = gx < F.cols ? colorOf(gx, gy, gy * F.cols + gx) : ''
      if (c === cur) continue
      if (cur) (out[cur] || (out[cur] = [])).push(x0 * PX, gy * PX, (gx - x0) * PX)
      cur = c
      x0 = gx
    }
  }
  return out
}

/** 暗场（设计稿 fxEnter）：p∈[0,1]，从键向外抖动铺深色，前沿一圈紫。 */
export function ditherRuns(F: Field, p: number): Runs {
  const band = 120
  const R = ease(Math.min(1, Math.max(0, p))) * (F.maxD + band)
  return toRuns(F, (gx, gy, i) => {
    const v = (R - F.D[i]) / band
    if (v <= 0) return ''
    const th = BAYER4[(gx & 3) | ((gy & 3) << 2)]
    if (v < th) return ''
    return v - th < 0.3 ? PURPLE : DARK
  })
}

export const RAINBOW_DUR = 680
/** 彩虹（设计稿 fxRainbow/rbLoop）：t＝起跑后毫秒（<0 为键先亮紫的 150ms）；st 记键内开始揭开的时刻。 */
export function rainbowRuns(F: Field, t: number, st: { rev?: number }): Runs {
  if (t < 0) return toRuns(F, (_x, _y, i) => (F.D[i] === 0 ? PURPLE : ''))
  const e = ease(Math.min(1, t / RAINBOW_DUR))
  const bw = PX * (2 + Math.round(2 * e))
  const W = bw * 3
  const R = e * (F.maxD + W + 28)
  const HL = 20
  const TL = 36
  if (R - W + PX > 0 && st.rev == null) st.rev = t
  const kq = st.rev != null ? (t - st.rev) / 240 : -1
  const tq = (t / 55) | 0
  return toRuns(F, (gx, gy, i) => {
    const d = F.D[i]
    const th = BAYER4[(gx & 3) | ((gy & 3) << 2)]
    if (d === 0) {
      if (kq < 0 || th > kq) return kq >= 0 && th - kq < 0.2 ? '#B79CF0' : PURPLE
      return PAPER
    }
    if (d > R + HL) return ''
    if (d > R) {
      const hv = hsh(i, tq)
      return hv < 0.3 * (1 - (d - R) / HL) ? (hv < 0.12 ? '#F4BD3F' : '#F9D77E') : ''
    }
    if (d > R - bw) return th < 0.7 ? '#F9D77E' : ''
    if (d > R - 2 * bw) return '#F4BD3F'
    if (d > R - W) return '#E3A02B'
    if (d >= R - W - TL) {
      const hv = hsh(i, tq)
      if (hv < 0.24 * (1 - (R - W - d) / TL)) return hv < 0.1 ? '#F9D77E' : '#F4BD3F'
    }
    return PAPER
  })
}

// ---------- 撒花（设计稿 party / cfLoop） ----------
const CF = ['#8A5AE0', '#F4BD3F', '#3F9A5E', '#D9483B', '#F28A3A', '#F4B4A4']
const CF_DARK: Record<string, string> = {
  '#8A5AE0': '#6B3FC4',
  '#F4BD3F': '#D9A52E',
  '#3F9A5E': '#2F7A48',
  '#D9483B': '#B7362B',
  '#F28A3A': '#C96A22',
  '#F4B4A4': '#DE8F7C',
}
export type Bit = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; s: number; c: string; life: number; max: number; ph: number }

/** 从键（k）喷一把；big＝整屏大撒花（键两轮 + 屏幕两侧各一股）。n 为主股粒数。 */
export function party(L: Bit[], k: Rect, screen: { w: number; h: number }, big = false, n?: number, rnd: () => number = Math.random): void {
  const cx = (k.left + k.right) / 2
  const kw = k.right - k.left
  const burst = (ox: number, oy: number, cnt: number, base: number, spr: number, s0: number, s1: number, d0 = 0) => {
    for (let i = 0; i < cnt; i++) {
      const a = base + (rnd() - 0.5) * spr
      const sp = s0 + rnd() * s1
      L.push({
        x: ox + (rnd() - 0.5) * kw * 0.6,
        y: oy + 4,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        rot: rnd() * 6.28,
        vr: 0.12 + rnd() * 0.3,
        s: big ? (rnd() < 0.45 ? 2 : rnd() < 0.2 ? 3 : 1) : rnd() < 0.3 ? 2 : 1,
        c: CF[(rnd() * CF.length) | 0],
        life: -d0 - rnd() * 60,
        max: (big ? 2100 : 1500) + rnd() * 900,
        ph: rnd() * 6.28,
      })
    }
  }
  const up = -Math.PI / 2
  if (big) {
    const m = n || 160
    burst(cx, k.top, m, up, 2.6, 7, 10)
    burst(cx, k.top, Math.round(m * 0.6), up, 1.4, 9, 8, 260)
    burst(-6, screen.h * 0.62, 70, up + 0.62, 0.7, 9, 7, 140)
    burst(screen.w + 6, screen.h * 0.62, 70, up - 0.62, 0.7, 9, 7, 140)
  } else burst(cx, k.top, n || 96, up, 1.9, 5, 7.5)
}

export type Chip = { x: number; y: number; w: number; h: number; c: string; a: number }
/** 推进 dt 毫秒并给出这一帧要画的纸片；L 原地更新（落地/寿终的移除）。 */
export function stepConfetti(L: Bit[], dt: number, h: number, rnd: () => number = Math.random): Chip[] {
  const f = dt / 16.67
  const dr = Math.pow(0.955, f)
  const out: Chip[] = []
  for (let i = L.length - 1; i >= 0; i--) {
    const p = L[i]
    p.life += dt
    if (p.life < 0) continue
    if (p.life >= p.max || p.y > h + 20) {
      L.splice(i, 1)
      continue
    }
    p.vx *= dr
    p.vy = Math.min(2.6, p.vy * dr + 0.2 * f)
    p.x += (p.vx + Math.sin(p.life / 180 + p.ph) * 0.6) * f
    p.y += p.vy * f
    p.rot += p.vr * f
    const rem = 1 - p.life / p.max
    if (rem < 0.2 && rnd() < 0.4) continue // 临终闪烁
    const q = Math.abs(Math.cos(p.rot))
    out.push({
      x: Math.round(p.x / PX) * PX,
      y: Math.round(p.y / PX) * PX,
      w: Math.max(1, Math.round(p.s * q)) * PX,
      h: PX * p.s,
      c: q < 0.35 ? CF_DARK[p.c] || p.c : p.c,
      a: rem < 0.2 ? 0.6 : 1,
    })
  }
  return out
}

// ---------- 页面调用口（页面根下放 <px-fx id="fx" />） ----------
// 提示/加载/确认在 utils/sysUi（utils 也要用·依赖方向 lib→utils），这里原样转出，页面照旧从 lib/pxFx 取。
export { fxConfirm, fxHint, fxLoaded, fxLoading, fxToast, type ConfirmOpts } from '../utils/sysUi'
type Host = { createSelectorQuery(): WechatMiniprogram.SelectorQuery; selectComponent(sel: string): unknown }
type Layer = {
  party(k: Rect, big?: boolean, n?: number): void
  transit(kind: 'rainbow' | 'dither', k: Rect, go: () => void): void
}

const layer = (page: Host): Layer | null =>
  typeof page.selectComponent === 'function' ? ((page.selectComponent('#fx') as Layer | null) ?? null) : null

function keyRect(page: Host, sel: string): Promise<Rect | null> {
  return new Promise((resolve) => {
    page
      .createSelectorQuery()
      .select(sel)
      .boundingClientRect((r) => resolve(r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null))
      .exec()
  })
}

/** 从 sel 那颗键撒花（找不到特效层/键就什么都不做）。 */
export async function fxParty(page: Host, sel: string, big = false, n?: number): Promise<void> {
  const fx = layer(page)
  const k = fx && (await keyRect(page, sel))
  if (fx && k) fx.party(k, big, n)
}

/** 从 sel 那颗键起转场，铺满后 go()；特效层/键缺失就直接 go()——转场是加分项，不能挡跳转。 */
export async function fxTransit(page: Host, kind: 'rainbow' | 'dither', sel: string, go: () => void): Promise<void> {
  const fx = layer(page)
  const k = fx && (await keyRect(page, sel))
  if (fx && k) fx.transit(kind, k, go)
  else go()
}
