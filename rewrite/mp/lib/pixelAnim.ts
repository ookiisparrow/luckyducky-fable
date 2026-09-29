// 像素动效图标（v5 设计稿 pixel-anim-icons.js 移植）：13×13 格无缝循环。
// 每个图标＝draw(P, t, p)：P(x,y,颜色) 画一格，t＝毫秒，p＝仅 loader 用的 0–1 进度。纯函数，组件 px-anim 逐帧调用。
export type Plot = (x: number, y: number, col: string) => void
type Draw = (P: Plot, t: number, p?: number | null) => void

const K = '#1c1c1a'
const WH = '#F7F7F4'
const P1 = '#8A5AE0'
const P2 = '#B79CF0'
const Y1 = '#F2D27A'
const Y2 = '#D9B45A'
const Y3 = '#FFF3C4'
const G1 = '#C9C9C2'
const G2 = '#3A3A36'
const GN = '#3F9A5E'
const YL = '#F4BD3F'
const YD = '#D9A52E'
const KK = '#1c1c1b'
/** dark 底换色表（播放页等暗底）。 */
export const PIXEL_ANIM_DARK: Record<string, string> = { [K]: '#F2F2EC', [WH]: '#262626', [G1]: '#55554F', [G2]: '#9A9A92' }

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
const bth = (gx: number, gy: number) => BAYER[(gx & 3) | ((gy & 3) << 2)]
const md = (a: number, n: number) => ((a % n) + n) % n
const spr = (P: Plot, rows: string[], ox: number, oy: number, m: Record<string, string>) =>
  rows.forEach((r, y) =>
    [...r].forEach((ch, x) => {
      const c = m[ch]
      if (c) P(ox + x, oy + y, c)
    })
  )
const HB = ['.XXX...XXX.', 'XXXXX.XXXXX', 'XXXXXXXXXXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..XXXXXXX..', '...XXXXX...', '....XXX....', '.....X.....']
const HS = ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....']
const SH = [[1, 2, 10], [2, 1, 11], [3, 1, 11], [4, 1, 11], [5, 1, 11], [6, 1, 11], [7, 2, 10], [8, 3, 9], [9, 4, 8], [10, 5, 7], [11, 6, 6]]
const CK = [[3, 6], [4, 7], [5, 8], [6, 7], [7, 6], [8, 5], [9, 4]]

export const PIXEL_ANIMS: Record<string, Draw> = {
  truck: (P, t) => {
    const fr = Math.floor(t / 120) % 2
    const b = Math.floor(t / 240) % 3 === 0 ? 1 : 0
    for (let k = 0; k < 4; k++) P(md(k * 4 - Math.floor(t / 60), 13), 12, G1)
    if (Math.floor(t / 150) % 2) P(0, 4 - b, G1)
    else P(0, 6 - b, G1)
    for (let y = 3; y <= 8; y++) for (let x = 1; x <= 7; x++) P(x, y - b, y === 3 ? P2 : P1)
    for (let y = 5; y <= 8; y++) for (let x = 8; x <= 11; x++) P(x, y - b, K)
    P(9, 6 - b, WH)
    P(10, 6 - b, WH)
    ;[[2, 9], [3, 9], [2, 10], [3, 10], [9, 9], [10, 9], [9, 10], [10, 10]].forEach(([x, y]) => P(x, y, K))
    P(fr ? 2 : 3, fr ? 9 : 10, WH)
    P(fr ? 9 : 10, fr ? 9 : 10, WH)
  },
  heart: (P, t) => {
    const tt = t % 1100
    const big = tt < 120 || (tt >= 240 && tt < 360)
    if (big) {
      spr(P, HB, 1, 2, { X: P1 })
      P(2, 3, P2)
      P(3, 3, WH)
    } else {
      spr(P, HS, 2, 3, { X: P1 })
      P(3, 4, P2)
    }
    if (tt < 360 && Math.floor(tt / 60) % 2 === 0) {
      P(0, 1, P2)
      P(1, 0, P2)
      P(12, 1, P2)
      P(11, 0, P2)
    }
  },
  shield: (P, t) => {
    const tt = t % 2000
    const n = tt < 700 ? Math.floor(tt / 100) + 1 : 7
    const sw = tt >= 900 && tt < 1400 ? Math.floor((tt - 900) / 40) - 2 : -99
    SH.forEach(([r, a, b]) => {
      for (let c = a; c <= b; c++) {
        const edge = r === 1 || c === a || c === b
        P(c, r, edge ? K : c + r === sw || c + r === sw + 1 ? P2 : WH)
      }
    })
    CK.slice(0, n).forEach(([x, y]) => P(x, y, GN))
    if (tt >= 700 && tt < 1000 && Math.floor(tt / 75) % 2 === 0) {
      P(12, 1, P2)
      P(11, 0, P2)
      P(0, 1, P2)
    }
  },
  checkin: (P, t) => {
    const tt = t % 2000
    for (let y = 2; y <= 11; y++) for (let x = 1; x <= 11; x++) P(x, y, y <= 3 ? P1 : x === 1 || x === 11 || y === 11 ? K : WH)
    P(4, 1, K)
    P(8, 1, K)
    P(4, 2, K)
    P(8, 2, K)
    const n = tt < 700 ? Math.floor(tt / 100) + 1 : 7
    const q = tt > 1500 ? (tt - 1500) / 400 : 0
    ;[[3, 7], [4, 8], [5, 9], [6, 8], [7, 7], [8, 6], [9, 5]].slice(0, n).forEach(([x, y]) => {
      if (q > bth(x, y)) return
      P(x, y, GN)
    })
  },
  loader: (P, t, pr) => {
    const B = [[5, 1], [8, 2], [9, 5], [8, 8], [5, 9], [2, 8], [1, 5], [2, 2]]
    const h = Math.floor(t / 90) % 8
    const n = pr != null ? Math.round(Math.min(1, Math.max(0, pr)) * 8) : -1
    B.forEach(([x, y], k) => {
      const d = md(h - k, 8)
      const c = n >= 0 ? (k < n ? (k === n - 1 ? P1 : P2) : G1) : d === 0 ? P1 : d < 3 ? P2 : G1
      P(x, y, c)
      P(x + 1, y, c)
      P(x, y + 1, c)
      P(x + 1, y + 1, c)
    })
  },
  hourglass: (P, t) => {
    const tt = t % 2600
    const p = Math.min(1, tt / 2200)
    const R = [[2, 3, 9], [3, 3, 9], [4, 4, 8], [5, 5, 7], [6, 6, 6], [7, 5, 7], [8, 4, 8], [9, 3, 9], [10, 3, 9]]
    const top: number[][] = []
    const bot: number[][] = []
    for (let x = 1; x <= 11; x++) {
      P(x, 1, K)
      P(x, 11, K)
    }
    R.forEach(([r, a, b]) => {
      P(a - 1, r, K)
      P(b + 1, r, K)
      for (let c = a; c <= b; c++) {
        P(c, r, WH)
        if (r >= 3 && r <= 5) top.push([c, r])
        if (r >= 7) bot.push([c, r])
      }
    })
    bot.sort((u, v) => v[1] - u[1] || Math.abs(u[0] - 6) - Math.abs(v[0] - 6))
    const n = Math.floor(p * top.length)
    top.slice(n).forEach(([x, y]) => P(x, y, Y1))
    bot.slice(0, n).forEach(([x, y]) => P(x, y, Y2))
    if (p < 1) {
      P(6, 6, Y1)
      if (Math.floor(tt / 120) % 2) P(6, 7, Y1)
    }
  },
  alert: (P, t) => {
    const tt = t % 2000
    const sh = tt < 360 ? (Math.floor(tt / 60) % 2 ? 1 : -1) : 0
    for (let r = 1; r <= 11; r++) {
      const h = Math.floor((r - 1) / 2)
      for (let c = 6 - h; c <= 6 + h; c++) P(c + sh, r, c > 6 ? YD : YL)
    }
    ;[4, 5, 6, 7].forEach((y) => P(6 + sh, y, KK))
    P(6 + sh, 9, KK)
  },
  signal: (P, t) => {
    const k = Math.min(4, Math.floor((t % 1800) / 220))
    ;[[1, 3], [4, 5], [7, 7], [10, 9]].forEach(([c, h], j) => {
      const col = j < k ? (k < 4 ? P1 : K) : G1
      for (let y = 12 - h; y <= 11; y++) {
        P(c, y, col)
        P(c + 1, y, col)
      }
    })
  },
  coin: (P, t) => {
    const tt = t % 1600
    const W = [4, 3, 2, 0, 2, 3]
    const hw = tt < 900 ? 4 : W[Math.floor((tt - 900) / 117) % 6]
    const H = [2, 3, 4, 4, 4, 4, 4, 3, 2]
    for (let x = 4; x <= 8; x++) P(x, 12, G1)
    H.forEach((h, i) => {
      const r = i + 2
      const w = Math.round((h * hw) / 4)
      for (let c = 6 - w; c <= 6 + w; c++) {
        const edge = w > 0 && (c === 6 - w || c === 6 + w)
        P(c, r, edge || w === 0 ? Y2 : w > 1 && c === 6 - w + 1 ? Y3 : Y1)
      }
      if (hw === 4 && r >= 4 && r <= 8) P(6, r, Y2)
    })
    if (tt < 300 && Math.floor(tt / 75) % 2 === 0) {
      P(11, 1, P2)
      P(12, 2, P2)
      P(0, 2, P2)
    }
  },
}
