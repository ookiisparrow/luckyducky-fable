// 像素小鸭场景（v5 设计稿 pixel-duck-scenes.js 移植·4px 场景格·首页「品牌」段）：
//   hats  换帽子：三色帽子在架子与小鸭头上轮换
//   charm 包挂：小鸭挂在包带上，包一颠就晃
//   share 借帽：帽子在 小鸭 → 小熊 → 小蛙 之间传递
// createScene(kind) 返回带状态的场景；draw(t, P) 由组件 px-scene 逐帧调用（t＝挂载后毫秒，单调递增）。
import type { Plot } from './pixelAnim'

export interface PixelScene {
  cols: number
  rows: number
  draw(t: number, P: Plot): void
}

const K = '#1c1c1a'
const WH = '#F7F7F4'
const Y = '#F2D27A'
const D = '#D9B45A'
const O = '#E98A6E'
const LID = '#B8923F'
const GRD = '#C9C9C2'
const HATS = [
  { H: '#EC8FB8', h: '#C9668F', w: '#F8CADD' },
  { H: '#8A5AE0', h: '#6B3FC4', w: '#B79CF0' },
  { H: '#D9483B', h: '#B7362B', w: '#EE8A7F' },
]
const HAT = ['..HHHH..', '.HWHHHH.', '.hhhhhh.', 'HHHHHHHH']
const HAT_S = ['..HHHH..', '.hhhhhh.', 'HHHHHHHH']
const DUCK = ['...YYYY...', '..YYYYYY..', '.YYYYYYYY.', '.YEYYYYEY.', '.YYYOOYYY.', '..YOOOOY..', '..YYYYYY..', '.YYYYYYYY.', 'YDYYYYYYDY', 'YDYYYYYYDY', '.YYYYYYYY.', '..OO..OO..']
const BEAR = ['BB......BB', 'BBBBBBBBBB', 'BBBBBBBBBB', 'BBEBBBBEBB', 'BBBBBBBBBB', 'BBBMMMMBBB', 'BBBMKKMBBB', '.BBBBBBBB.', 'BdBBBBBBdB', 'BdBBBBBBdB', '.BBBBBBBB.', '.dd....dd.']
const FROG = ['.GG......GG.', 'GWEG....GEWG', 'GGGGGGGGGGGG', 'GGGGGGGGGGGG', 'GKGGGGGGGGKG', 'GGKKKKKKKKGG', '.GGGGGGGGGG.', '.GGLLLLLLGG.', 'GGLLLLLLLLGG', 'GGLLLLLLLLGG', '.GGGGGGGGGG.', 'GGG......GGG']
const MINI = ['..YYYY..', '.YYYYYY.', 'YEYYYYEY', 'YYYOOYYY', '.YYOOYY.', '.YYYYYY.', 'YYYYYYYY', 'YDYYYYDY', '.YYYYYY.']
const PAL: Record<string, string> = { Y, D, O, K, W: WH, B: '#A87A52', d: '#7E5638', M: '#E2C49C', G: '#7DB35A', L: '#D6E8A8' }
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2)

function kit(P: Plot) {
  const spr = (rows: string[], ox: number, oy: number, blink: boolean) =>
    rows.forEach((r, ry) =>
      [...r].forEach((ch, rx) => {
        if (ch === '.') return
        let c = ch === 'E' ? (blink ? LID : K) : PAL[ch]
        if (ch === 'E' && blink && rows === FROG) c = PAL.G
        if (ch === 'E' && blink && rows === BEAR) c = PAL.d
        P(ox + rx, oy + ry, c)
      })
    )
  const hat = (i: number, ox: number, oy: number, small = false) => {
    const p = HATS[i]
    ;(small ? HAT_S : HAT).forEach((r, ry) =>
      [...r].forEach((ch, rx) => {
        if (ch !== '.') P(ox + rx, oy + ry, ch === 'H' ? p.H : ch === 'h' ? p.h : p.w)
      })
    )
  }
  const ground = (cols: number, y: number) => {
    for (let i = 0; i < cols; i += 2) P(i, y, GRD)
  }
  const spark = (cx: number, cy: number, u: number, col: string) => {
    if (u < 0 || u > 1) return
    const r = 2 + Math.round(u * 3)
    ;[[0, -1], [-1, 0], [1, 0], [-1, -1], [1, -1]].forEach(([a, b], k) => {
      if (k > 2 && u < 0.3) return
      P(cx + a * r, cy + b * r, col)
    })
  }
  return { spr, hat, ground, spark }
}

function hats(): PixelScene {
  const cols = 76
  const state = [0, 1, 2] // [头上, 架1, 架2]
  let anim: { s: number; t: number; a: number; b: number } | null = null
  let last = 0
  let landT = -9e9
  const slot = (s: number) => (s === 0 ? { x: 14, y: 21 } : { x: s === 1 ? 46 : 60, y: 21 })
  return {
    cols,
    rows: 36,
    draw(t, P) {
      const { spr, hat, ground, spark } = kit(P)
      if (!anim && t > 1200 && t - last > 2600) {
        last = t
        const next = (state[0] + 1) % 3
        anim = { s: state.indexOf(next), t, a: state[0], b: next }
      }
      ground(cols, 34)
      for (let x = 40; x <= 73; x++) P(x, 25, '#62625C')
      ;[[43, 26], [43, 27], [70, 26], [70, 27]].forEach(([a, b]) => P(a, b, '#62625C'))
      if (anim) {
        const A = anim
        const u = Math.min(1, (t - A.t) / 700)
        const e = ease(u)
        const p0 = slot(0)
        const p1 = slot(A.s)
        const arc = (f: { x: number; y: number }, g: { x: number; y: number }) => ({
          x: f.x + (g.x - f.x) * e,
          y: f.y + (g.y - f.y) * e - Math.sin(Math.PI * e) * 10,
        })
        const toHead = arc(p1, p0)
        const toShelf = arc(p0, p1)
        toShelf.y += Math.sin(Math.PI * e) * 4
        ;[1, 2].forEach((s) => {
          if (s !== A.s) hat(state[s], slot(s).x, slot(s).y)
        })
        hat(A.a, toShelf.x, toShelf.y)
        const hop = u < 0.25 ? Math.round(u * 8) : 0
        if (u >= 1) {
          state[0] = A.b
          state[A.s] = A.a
          anim = null
          landT = t
        }
        spr(DUCK, 13, 23 - hop, false)
        hat(A.b, toHead.x, toHead.y - hop)
        return
      }
      const lt = t - landT
      const bob = lt < 160 ? 1 : 0
      ;[1, 2].forEach((s) => hat(state[s], slot(s).x, slot(s).y))
      spr(DUCK, 13, 23 + bob, t % 3400 > 3260)
      hat(state[0], 14, 21 + bob)
      if (lt < 500) spark(18, 22, lt / 500, HATS[state[0]].H)
    },
  }
}

function charm(): PixelScene {
  const cols = 76
  return {
    cols,
    rows: 40,
    draw(t, P) {
      const { spr, hat, ground } = kit(P)
      ground(cols, 38)
      const ph = t % 2600
      const bj = ph < 220 ? Math.round(Math.sin((ph / 220) * Math.PI) * 2) : 0
      const bag = (x: number, y: number, c: string) => P(x, y - bj, c)
      const BG = '#CFC3A5'
      const BS = '#B3A57F'
      const ST = '#E6DDC6'
      for (let y = 16; y <= 37; y++)
        for (let x = 20; x <= 50; x++) {
          let c = BG
          if (y === 37 || x === 50) c = BS
          if (y === 20 && x > 21 && x < 49 && x % 2 === 0) c = ST
          bag(x, y, c)
        }
      for (let y = 8; y <= 15; y++) {
        bag(25, y, BS)
        bag(26, y, BS)
        bag(44, y, BS)
        bag(45, y, BS)
      }
      for (let x = 27; x <= 43; x++) {
        bag(x, 6, BS)
        bag(x, 7, BS)
      }
      bag(26, 7, BS)
      bag(44, 7, BS)
      const rx = 46
      const ry = 13 - bj
      ;[[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]].forEach(([a, b]) => P(rx + a, ry + b, '#62625C'))
      const amp = ph < 220 ? 0 : 3 * Math.exp(-(ph - 220) / 1100)
      const sw = Math.round(amp * Math.sin(((ph - 220) / 700) * 2 * Math.PI))
      const L = 4
      const px0 = rx + 1
      const py0 = ry + 3
      for (let j = 0; j < L; j++) P(px0 + Math.round((sw * (j + 1)) / L), py0 + j, j % 2 ? '#9A9A92' : '#62625C')
      const dx = px0 + sw - 4
      const dy = py0 + L
      hat(1, dx, dy, true)
      spr(MINI, dx, dy + 2, t % 3000 > 2860)
    },
  }
}

function share(): PixelScene {
  const cols = 76
  const C = [
    { s: DUCK, x: 8, hx: 1, hy: 1 },
    { s: BEAR, x: 33, hx: 1, hy: 1 },
    { s: FROG, x: 57, hx: 2, hy: 2 },
  ]
  const top = 23
  const pos = (i: number) => ({ x: C[i].x + C[i].hx, y: top + C[i].hy - 3 })
  return {
    cols,
    rows: 36,
    draw(t, P) {
      const { spr, hat, ground, spark } = kit(P)
      ground(cols, 34)
      const T = 2000
      const k = Math.floor(t / T) % 3
      const ph = t % T
      const nx = (k + 1) % 3
      let hx: number
      let hy: number
      let rec = -1
      const hop = [0, 0, 0]
      if (ph < 700) {
        const e = ease(ph / 700)
        const a = pos(k)
        const b = pos(nx)
        const H = nx === 0 ? 16 : 9
        hx = a.x + (b.x - a.x) * e
        hy = a.y + (b.y - a.y) * e - Math.sin(Math.PI * e) * H
        if (ph < 140) hop[k] = 1
      } else {
        const p = pos(nx)
        hx = p.x
        hy = p.y
        rec = nx
        const lt = ph - 700
        if (lt < 260) hop[nx] = lt < 130 ? 2 : 1
      }
      C.forEach((c, i) => spr(c.s, c.x, top - hop[i], (t + i * 900) % 3600 > 3460))
      hat(1, hx, hy - (rec >= 0 ? hop[rec] : 0))
      if (rec >= 0) {
        const lt = ph - 700
        if (lt < 500) spark(pos(rec).x + 4, pos(rec).y + 1, lt / 500, HATS[1].H)
      }
    },
  }
}

const SCENES: Record<string, () => PixelScene> = { hats, charm, share }

/** 按名字建场景；不认识的名字返回 null（组件画空）。 */
export function createScene(kind: string): PixelScene | null {
  const make = SCENES[kind]
  return make ? make() : null
}
