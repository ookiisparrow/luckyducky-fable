// 像素小货车一族（v5 设计稿 pixel-truck.js 移植·4px 场景格·统一 17 行高、底行是虚线地面）：
//   truck  小货车：cargo 0–3 个箱子；pose park|drive|slow|unload|pay|broken|reverse；go() 开走 / restart() 重新发动 / stamp() 盖章飞走
//   box    空状态纸箱          pin  收货地址定位针
//   pay    支付成功金币：落地、轻弹、翻两圈停正面（¥），四周闪光，之后定时扫高光
//   egg    小鸭蛋：未孵化轻晃；hatched 首次看到播孵化，之后小鸭在地面线上来回走；shell 只剩下半蛋壳
// 每个场景＝{ rows, draw(t, P, cols) }：t＝可见累计毫秒，cols＝按容器实测宽度算出的列数；draw 返回 false＝画面静止可停帧。
// 地面线全站同一高度（状态栏+44+groundGap+车高 68·groundGap 见 lib/ground：屏高<700 为 56、其余 120）：页面把画布放在
// 顶栏下 groundGap 处即对齐，不做设计稿的 anchor 测量。
import type { Plot } from './pixelAnim'

export const PX_ROWS = 17

export interface GroundScene {
  /** skip＝步进后、落笔前问一次：None 照常画；Still 交给 CSS 烘焙层且画面静止（这一帧不画，draw 回 false 摘出调度）；Moving 交给烘焙层但车在移动（不画，调度继续） */
  draw(t: number, P: Plot, cols: number, skip?: () => TakeResult): boolean
}

const K = '#1c1c1a'
const W = '#F7F7F4'
const GL = '#DCDCF5'
const Y = '#F2D27A'
const D = '#D9B45A'
const G = '#C9C9C2'
const LT = '#F4BD3F'
const P1 = '#8A5AE0'
const P2 = '#B79CF0'
const GR = '#9A9A92'
const RD = '#D9483B'
const COIN_HI = '#FFF3C4'

/** 地面虚线色（巡航烘焙层的 CSS 地面取它） */
export const GROUND_COLOR = G
/** 车速基准：巡航 1、慢速 0.4。地面每格滚动时长＝GROUND_CELL_MS / 车速（JS 的 gOff 与烘焙层 CSS 地面同源，改这里两边一起变） */
export const TRUCK_SPEED = { cruise: 1, slow: 0.4 }
export const GROUND_CELL_MS = 40
export const groundCellMs = (slow: boolean): number => GROUND_CELL_MS / (slow ? TRUCK_SPEED.slow : TRUCK_SPEED.cruise)
/** 烘焙层只烘了这一档格边长（px-truck 的 scale）；别的 scale 回落逐行渐变 */
export const TRUCK_CELL = 4
/** draw 的 skip 回答：画布交不交给烘焙层 */
export const Take = { None: 0, Still: 1, Moving: 2 } as const
export type TakeResult = (typeof Take)[keyof typeof Take]
const ground = (P: Plot, cols: number, off = 0) => {
  const go = Math.floor(off)
  for (let g = 0; g < cols; g++) if ((((g + go) % 4) + 4) % 4 < 2) P(g, PX_ROWS - 1, G)
}

// ── 小货车 ──
const BODY = ['...............KKKKK....', '...............KWWWKK...', '...............KWWWWKK..', '...............KWWWWWKK.', '...............KKKKKKKKK', 'K..............KKKKKKKKL', 'K..............KKKKKKKKK', 'KKKKKKKKKKKKKKKKKKKKKKKK', 'KKKKKKKKKKKKKKKKKKKKKKKK']
const TOP = 5
const COLS = 24
const WHEELS = [3, 17]
const BOXES = [
  [1, 0],
  [8, 0],
  [4, -5],
]
const GB = 6
const WHEEL_SPOTS = [
  [1, 1],
  [2, 1],
  [2, 2],
  [1, 2],
]
const STAMP_MARK = [
  [1, 1],
  [3, 1],
  [2, 2],
  [1, 3],
  [3, 3],
]
const PIN = ['.PPP.', 'PPPPP', 'PPWPP', 'PPPPP', '.PPP.', '..P..', '..P..']
const COIN = ['.DDD.', 'DYWYD', 'DYDYD', 'DYDYD', '.DDD.']
const STAMP = ['.PPPPP.', 'PPPPPPP', '.PPPPP.', '...P...', '..PPP..', 'PPPPPPP']

export type TruckPose = 'park' | 'drive' | 'slow' | 'unload' | 'pay' | 'broken' | 'reverse'
type Mode = 'park' | 'cruise' | 'slowc' | 'start' | 'drive' | 'away' | 'gone' | 'back' | 'broken' | 'restart' | 'unload'
interface Puff {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  c: string
}
interface Drop {
  i: number
  y: number
  v: number
  land: number
  coin?: boolean
}

export interface Truck extends GroundScene {
  setCargo(n: number): void
  setPose(p: string): void
  /** 开走；back=false 不回来。返回需要等待的毫秒数（0＝没动，直接跳转） */
  go(o?: { back?: boolean }): number
  restart(): number
  stamp(): number
  /** 车是否可交给 CSS 烘焙层（无掉箱/盖章/卸货/定位针）：move=false 为巡航/慢速循环（home＝车左缘列）；move=true 为开走/屏外/开回（x＝车左缘列，浮点）。ground＝地面相位（格） */
  view(): { move: boolean; slow: boolean; shown: number; mir: boolean; home: number; x: number; ground: number } | null
  /** 烘焙层播了 ms 毫秒后交还给 JS：把地面相位补上，免得接手时地面虚线跳一下 */
  syncIdle(ms: number): void
}

// ── 巡航烘焙层（components/px-truck 的 CSS 精灵图）──
// 烘焙画面的坐标系：宽 SPR_COLS 格，车左缘放在 SPR_ORG（倒车镜像放 SPR_ORG_MIR），尾气最远漂 ~18 格。
export const SPR_COLS = 46
export const SPR_ORG = 20
export const SPR_ORG_MIR = 2
/** 巡航 / 慢速各自的循环时长（ms）= 车身颠、车轮高光、尾灯三者节拍的最小公倍数；烘焙每 SPR_STEP ms 取一帧 */
export const IDLE_PERIOD = { cruise: 360, slow: 600 }
export const SPR_STEP = 30
// 固定循环的尾气（取代随机冒）：发射时刻 ms、速度系数；存活 340ms < 周期，首尾相接
const PUFF_AT = {
  cruise: [
    [0, 0.6],
    [80, 0.75],
    [170, 0.66],
    [250, 0.85],
    [310, 0.7],
  ],
  slow: [
    [0, 0.65],
    [170, 0.8],
    [330, 0.7],
    [470, 0.75],
  ],
}
function idlePuffs(t: number, slow: boolean, mir: boolean, x: number): Puff[] {
  const period = slow ? IDLE_PERIOD.slow : IDLE_PERIOD.cruise
  const out: Puff[] = []
  PUFF_AT[slow ? 'slow' : 'cruise'].forEach(([at, v], j) => {
    const age = (((t - at) % period) + period) % period
    if (age >= 340) return
    const f = age / 16.67
    out.push({ x: x + (mir ? COLS : -1) + (mir ? 1 : -1) * v * f, y: TOP + 7 + (-0.1 - 0.05 * (j % 3)) * f, vx: 0, vy: 0, life: age, max: 340, c: G })
  })
  return out
}

type TruckOpts = { cargo?: number; pose?: string; arrive?: number; pin?: boolean }
/** 生产用的货车（公开接口不含 sprite）。 */
export function createTruck(opts: TruckOpts = {}): Truck {
  const { sprite, ...pub } = buildTruck(opts)
  void sprite
  return pub
}
/** 仅烘焙器用：多一个 sprite(t, P)——把车摆到精灵图坐标系里画一帧「纯时间」的巡航画面（无地面；尾气走固定循环），会改内部状态。 */
export function createTruckForBake(opts: TruckOpts = {}): Truck & { sprite(t: number, P: Plot): void } {
  return buildTruck(opts)
}

function buildTruck(opts: TruckOpts): Truck & { sprite(t: number, P: Plot): void } {
  const clamp = (n: number) => Math.max(0, Math.min(3, Math.round(Number(n) || 0)))
  let cargo = clamp(opts.cargo || 0)
  let shown = cargo
  let pose = (opts.pose || 'park') as TruckPose
  let mir = pose === 'reverse'
  let mode: Mode = 'park'
  let t = 0
  let x: number | null = null
  let vx = 0
  let ret = true
  let bx0 = 0
  let gOff = 0
  let spd = 0
  let puffs: Puff[] = []
  let drops: Drop[] = []
  const groundBoxes: number[] = []
  let fly: { lx: number; ly: number; t: number } | null = null
  let st: { i: number; t: number; flown?: boolean } | null = null
  let uq: { i: number; k: number; t: number } | null = null
  let pinY: number | null = opts.pin ? -34 : null
  let pinV = 0
  let clock = 0
  let lastT = -1
  let w = 0

  const settle = () => {
    t = 0
    mode = pose === 'drive' || pose === 'reverse' || pose === 'pay' ? 'cruise' : pose === 'slow' ? 'slowc' : pose === 'broken' ? 'broken' : pose === 'unload' && shown > 0 ? 'unload' : 'park'
    if (mode === 'unload') t = -240
  }
  if (pose === 'pay') {
    shown = 0
    for (let i = 0; i < cargo; i++) drops.push({ i, y: -18 - i * 14, v: 0, land: 0, coin: true })
  }
  if (opts.arrive !== undefined) {
    mode = 'gone'
    t = 520 - (opts.arrive || 0)
  } else settle()

  const home = () => Math.round((w - COLS) / 2) + (mir ? -1 : 1) * (pose === 'unload' ? Math.ceil((cargo * GB) / 2) : 0) - (opts.pin ? 4 : 0)
  const gx = (k: number) => {
    const ox = Math.round(x || 0)
    return mir ? ox + COLS + 2 + k * GB : ox - 2 - GB - k * GB + 1
  }

  const exhaust = (p: number, v: number) => {
    const dir = mir ? -1 : 1
    if (Math.random() < p) puffs.push({ x: (x || 0) + (mir ? COLS : -1), y: TOP + 7, vx: -dir * (v + Math.random() * 0.3), vy: -0.1 - Math.random() * 0.2, life: 0, max: 340, c: G })
  }

  // 掉落的箱子/金币 + 顶上的定位针：返回是否还在动
  const stepDrops = (dt: number, f: number, hm: number): boolean => {
    for (const d of drops) {
      if (d.land) {
        d.land += dt
        continue
      }
      d.v += 0.35 * f
      d.y += d.v * f
      if (d.y < 0) continue
      d.y = 0
      d.land = 1
      shown = Math.max(shown, d.i + 1)
      if (!d.coin) continue
      const [bx, by] = BOXES[d.i]
      for (let k = 0; k < 4; k++)
        puffs.push({ x: Math.round(x || 0) + bx + (k < 2 ? -1 : 5), y: TOP + by + (k % 2 ? 1 : -1), vx: k < 2 ? -0.35 : 0.35, vy: k % 2 ? 0.1 : -0.25, life: 0, max: 260, c: LT })
    }
    drops = drops.filter((d) => !d.land || d.land < 120)
    let live = drops.length > 0
    if (pinY != null && pinY < 0) {
      pinV += 0.5 * f
      pinY = Math.min(0, pinY + pinV * f)
      live = true
      if (pinY === 0) for (let k = 0; k < 4; k++) puffs.push({ x: hm + COLS + 6 + (k < 2 ? -1 : 5), y: PX_ROWS - 2, vx: k < 2 ? -0.3 : 0.3, vy: -0.2, life: 0, max: 220, c: G })
    }
    return live
  }

  // 卸货：箱子一个个落到车旁地面
  const stepUnload = (dt: number): void => {
    if (t >= 0 && !uq && shown > 0) uq = { i: shown - 1, k: groundBoxes.length, t: 0 }
    if (!uq) return
    uq.t += dt
    if (uq.t < 300) return
    groundBoxes.push(uq.i)
    shown--
    const g = gx(uq.k)
    for (let k = 0; k < 3; k++) puffs.push({ x: g + k * 2, y: PX_ROWS - 2, vx: (k - 1) * 0.3, vy: -0.2, life: 0, max: 220, c: G })
    uq = null
    t = -120
    if (shown <= 0) mode = 'park'
  }

  // 每种行驶状态一个小处理：返回画面是否还在动
  const MODES: Record<Mode, (dt: number, f: number, hm: number) => boolean> = {
    park: (_dt, _f, hm) => {
      x = hm
      return false
    },
    cruise: (_dt, _f, hm) => {
      x = hm
      spd = TRUCK_SPEED.cruise
      exhaust(0.2, 0.6)
      return true
    },
    slowc: (_dt, _f, hm) => {
      x = hm
      spd = TRUCK_SPEED.slow
      exhaust(0.1, 0.6)
      return true
    },
    start: (_dt, _f, hm) => {
      x = hm
      exhaust(0.5, 0.35)
      if (t > 260) {
        mode = 'drive'
        t = 0
        vx = 0
      }
      return true
    },
    drive: (_dt, f) => {
      vx = Math.min(3.2, vx + 0.09 * f)
      x = (x || 0) + (mir ? -1 : 1) * vx * f
      spd = vx
      exhaust(0.6, 0.6)
      if (x > w + 4 || x < -COLS - 4) {
        mode = ret ? 'gone' : 'away'
        t = 0
      }
      return true
    },
    away: () => {
      x = mir ? -COLS - 40 : w + 40
      return false
    },
    gone: () => {
      x = mir ? w + 4 : -COLS - 4
      if (t > 520) {
        mode = 'back'
        t = 0
        bx0 = x
      }
      return true
    },
    back: (_dt, _f, hm) => {
      const u = Math.min(1, t / 560)
      x = bx0 + (hm - bx0) * (1 - Math.pow(1 - u, 3))
      spd = 1 - u
      if (u >= 1) {
        x = hm
        settle()
      }
      return true
    },
    broken: (_dt, _f, hm) => {
      x = hm
      if (Math.random() < 0.22) puffs.push({ x: hm + (mir ? COLS - 21 : 20) + ((Math.random() * 3) | 0), y: TOP - 1, vx: (Math.random() - 0.5) * 0.2, vy: -0.25 - Math.random() * 0.2, life: 0, max: 700, c: GR })
      return true
    },
    restart: (_dt, _f, hm) => {
      x = hm
      exhaust(0.7, 0.4)
      if (t > 480) {
        pose = 'park'
        mode = 'park'
        t = 0
      }
      return true
    },
    unload: (dt, _f, hm) => {
      x = hm
      stepUnload(dt)
      return true
    },
  }

  // 盖章飞走 + 飞出的箱子 + 尾气烟：返回是否还在动
  const stepEffects = (dt: number, f: number): boolean => {
    let live = false
    if (st) {
      const S = st
      S.t += dt
      live = true
      if (S.t >= 420 && !S.flown) {
        S.flown = true
        shown--
        const [bx, by] = BOXES[S.i]
        fly = { lx: bx, ly: by, t: 0 }
      }
      if (S.t >= 900) st = null
    }
    if (fly) {
      fly.t += dt
      if (fly.t >= 480) fly = null
      else live = true
    }
    for (let j = puffs.length - 1; j >= 0; j--) {
      const p = puffs[j]
      p.life += dt
      if (p.life >= p.max) {
        puffs.splice(j, 1)
        continue
      }
      p.x += p.vx * f
      p.y += p.vy * f
      live = true
    }
    return live
  }

  const step = (dt: number): boolean => {
    const f = dt / 16.67
    const hm = home()
    spd = 0
    if (x == null) x = hm
    const dropping = stepDrops(dt, f, hm)
    t += dt
    const moving = MODES[mode](dt, f, hm)
    gOff += (dt / GROUND_CELL_MS) * spd * (mir ? -1 : 1)
    const fx = stepEffects(dt, f)
    return dropping || moving || fx
  }

  // ── 绘制 ──
  const crate = (P: Plot, X: number, Y0: number) => {
    for (let r = 0; r < 5; r++) for (let q = 0; q < 5; q++) P(X + q, Y0 + r, q === 2 ? D : r === 4 || q === 4 ? D : Y)
  }

  // 车斗里的箱子、掉落中的箱子/金币、卸在地上的箱子
  const paintCargo = (P: Plot, L: Plot, oy: number) => {
    const ox = Math.round(x || 0)
    for (let i = 0; i < shown; i++) {
      if (drops.some((d) => d.i === i && !d.land)) continue
      if (uq && uq.i === i) continue
      const [bx, by] = BOXES[i]
      crate(L, bx, TOP + by + oy)
      if (st && st.i === i && st.t > 200) STAMP_MARK.forEach(([a, b]) => L(bx + a, TOP + by + oy + b, P1))
    }
    for (const d of drops) {
      if (d.land) continue
      const [bx, by] = BOXES[d.i]
      const yy = TOP + by + Math.round(d.y)
      if (!d.coin) {
        crate(L, bx, yy)
        continue
      }
      COIN.forEach((r, ry) =>
        [...r].forEach((ch, rx) => {
          if (ch !== '.') L(bx + rx, yy + ry, ch === 'D' ? D : ch === 'W' ? COIN_HI : Y)
        })
      )
    }
    groundBoxes.forEach((_i, k) => crate(P, gx(k), TOP + GB))
    if (uq) {
      const [bx, by] = BOXES[uq.i]
      const u = Math.min(1, uq.t / 300)
      const tgx = gx(uq.k)
      const sx = mir ? ox + COLS - 1 - bx - 4 : ox + bx
      crate(P, Math.round(sx + (tgx - sx) * u), Math.round(TOP + by + (GB - by) * u * u - Math.sin(u * Math.PI) * 3))
    }
  }

  // 车身、车窗、车轮（转动的高光点）、尾灯/故障灯
  const paintBody = (L: Plot, oy: number, mv: boolean) => {
    const brk = mode === 'broken'
    const lit = mode !== 'park' && !brk
    BODY.forEach((r, ry) =>
      [...r].forEach((ch, rx) => {
        if (ch !== '.') L(rx, TOP + ry + oy, ch === 'K' ? K : ch === 'W' ? GL : lit ? LT : GR)
      })
    )
    L(17, TOP + 2 + oy, W)
    const fr = mv ? Math.floor(clock / (spd < 0.6 ? 150 : 90)) % 4 : 0
    const spot = WHEEL_SPOTS[mir ? 3 - fr : fr]
    for (const wx of WHEELS)
      for (let r = 0; r < 4; r++)
        for (let q = 0; q < 4; q++) {
          if ((r === 0 || r === 3) && (q === 0 || q === 3)) continue
          const inner = r > 0 && r < 3 && q > 0 && q < 3
          L(wx + q - 1, TOP + 7 + r, inner ? (q === spot[0] && r === spot[1] ? W : '#62625C') : K)
        }
    if (brk && Math.floor(clock / 400) % 2) {
      L(23, TOP + 5 + oy, LT)
      L(0, TOP + 5 + oy, LT)
    }
    const running = mode === 'start' || mode === 'drive' || mode === 'cruise' || mode === 'restart'
    if (!brk && running && Math.floor(clock / 180) % 2) L(COLS, TOP + 5 + oy, LT)
    if (mode === 'slowc') L(0, TOP + 6 + oy, RD)
  }

  // 定位针（pin 模式）
  const paintPin = (P: Plot) => {
    if (pinY == null) return
    const pxx = Math.round(x || 0) + COLS + 4
    const py = PX_ROWS - 1 - PIN.length + Math.round(pinY)
    PIN.forEach((r, yy) =>
      [...r].forEach((ch, xx) => {
        if (ch !== '.') P(pxx + xx, py + yy, ch === 'W' ? W : P1)
      })
    )
  }

  // 盖章落下再抬起
  const paintStamp = (L: Plot) => {
    if (!st) return
    const [bx, by] = BOXES[st.i]
    const tt = st.t
    if (tt >= 420) return
    const sy = tt < 180 ? -12 + 5 * (tt / 180) * (tt / 180) + (tt / 180) * 7 : tt < 300 ? 0 : -((tt - 300) / 120) * 8
    const yy = TOP + by - 6 + Math.round(sy) + (tt >= 180 && tt < 300 ? 1 : 0)
    const col = tt >= 180 && tt < 260 ? P2 : P1
    STAMP.forEach((r, ry) =>
      [...r].forEach((ch, rx) => {
        if (ch !== '.') L(bx - 1 + rx, yy + ry, col)
      })
    )
  }

  // 盖过章的箱子飞出画面
  const paintFly = (P: Plot) => {
    if (!fly) return
    const ox = Math.round(x || 0)
    const u = fly.t / 480
    const e = u * u
    const X = mir ? ox + COLS - 1 - fly.lx - 4 - e * w : ox + fly.lx + e * w
    const Yy = TOP + fly.ly - Math.round(e * 18 + Math.sin(u * Math.PI) * 4)
    const sz = Math.max(2, 5 - Math.round(u * 3))
    for (let r = 0; r < sz; r++) for (let q = 0; q < sz; q++) P(Math.round(X) + q, Yy + r, q === Math.floor(sz / 2) ? D : Y)
  }

  const paint = (P: Plot, noGround = false) => {
    const mv = spd > 0.01
    const sh = mode === 'start' || mode === 'restart' ? Math.floor(t / 50) % 2 : 0
    const bob = mv && Math.floor(clock / (spd < 0.6 ? 150 : 90)) % 2 ? 1 : 0
    const ox = Math.round(x || 0)
    const oy = sh || bob ? -1 : 0
    const L: Plot = (lx, ly, col) => P(mir ? ox + COLS - 1 - lx : ox + lx, ly, col)
    if (!noGround) ground(P, w, gOff)
    if (mode === 'away') return
    if (mv && spd > 0.5) for (let k = 0; k < 3; k++) for (let j = 1; j <= 3 + k; j++) L(-1 - j - k * 2, TOP + 2 + k * 2, G)
    for (const p of puffs) P(Math.round(p.x), Math.round(p.y), p.c)
    paintCargo(P, L, oy)
    paintBody(L, oy, mv)
    paintPin(P)
    paintStamp(L)
    paintFly(P)
  }

  return {
    draw(tt, P, cols, skip) {
      w = cols
      const dt = lastT < 0 ? 16 : Math.min(48, tt - lastT)
      lastT = tt
      clock += dt
      const live = step(dt)
      const sk = skip ? skip() : 0
      if (sk) return sk === Take.Moving && (live || spd > 0.01) // 交给烘焙层：这一帧不画，画布留空
      paint(P)
      return live || spd > 0.01
    },
    view() {
      if (opts.pin || drops.length || st || fly || uq || groundBoxes.length) return null
      const idle = mode === 'cruise' || mode === 'slowc'
      if (!idle && mode !== 'drive' && mode !== 'gone' && mode !== 'back' && mode !== 'away') return null
      return { move: !idle, slow: mode === 'slowc', shown, mir, home: home(), x: x || 0, ground: gOff }
    },
    syncIdle(ms) {
      gOff += (ms / groundCellMs(mode === 'slowc')) * (mir ? -1 : 1)
    },
    sprite(tt, P) {
      w = SPR_COLS
      x = mir ? SPR_ORG_MIR : SPR_ORG
      clock = tt
      spd = mode === 'slowc' ? TRUCK_SPEED.slow : TRUCK_SPEED.cruise
      puffs = idlePuffs(tt, mode === 'slowc', mir, x)
      paint(P, true)
    },
    setCargo(n) {
      const k = clamp(n)
      if (k === cargo) return
      const up = k > cargo
      cargo = k
      if (up && mode === 'park') for (let i = shown; i < k; i++) drops.push({ i, y: -14 - i * 4, v: 0, land: 0 })
      else shown = Math.min(shown, k)
      if (!up) shown = k
    },
    setPose(p) {
      const next = (p || 'park') as TruckPose
      if (next === pose) return
      pose = next
      mir = next === 'reverse'
      if (mode !== 'gone' && mode !== 'back') {
        shown = cargo
        groundBoxes.length = 0
        settle()
      }
    },
    go(o) {
      if (['park', 'cruise', 'slowc'].indexOf(mode) < 0) return 0
      ret = !(o && o.back === false)
      drops = []
      shown = cargo
      if (mode === 'park') mode = 'start'
      else {
        vx = mode === 'slowc' ? TRUCK_SPEED.slow : TRUCK_SPEED.cruise
        mode = 'drive'
      }
      t = 0
      return 600
    },
    restart() {
      if (mode !== 'broken') {
        pose = 'park'
        settle()
        return 0
      }
      mode = 'restart'
      t = 0
      return 520
    },
    stamp() {
      if (shown <= 0 || st || ['park', 'cruise', 'slowc'].indexOf(mode) < 0) return 0
      st = { i: shown - 1, t: 0 }
      return 900
    },
  }
}

// ── 空状态纸箱 ──
const BOX = ['YYY..........YYY', '.YYY........YYY.', '..YDDDDDDDDDDY..', '..YBBBBBBBBBBY..', '..YYYYYDDYYYYY..', '..YYYYYDDYYYYY..', '..YYYYYDDYYYYY..', '..YYYYYDDYYYYY..', '..YYYYYDDYYYYY..', '..YYYYYDDYYYYY..', '..DDDDDDDDDDDD..']
function box(): GroundScene {
  return {
    draw(_t, P, cols) {
      ground(P, cols)
      const ox = Math.round((cols - BOX[0].length) / 2)
      const oy = PX_ROWS - 1 - BOX.length
      BOX.forEach((r, ry) =>
        [...r].forEach((ch, rx) => {
          if (ch !== '.') P(ox + rx, oy + ry, ch === 'Y' ? Y : ch === 'D' ? D : '#B8923F')
        })
      )
      return false
    },
  }
}

// ── 收货地址定位针 ──
const PINB = ['.PPPPP.', 'PPPPPPP', 'PPWWWPP', 'PPWWWPP', 'PPPPPPP', '.PPPPP.', '..PPP..', '..PPP..', '...P...', '...P...']
function pin(): GroundScene {
  return {
    draw(_t, P, cols) {
      ground(P, cols)
      const cx = Math.round(cols / 2)
      const gy = PX_ROWS - 1
      for (let i = -1; i <= 1; i++) P(cx + i, gy - 1, '#d6d6d1') // 落影（设计稿 20% 墨）
      PINB.forEach((r, ry) =>
        [...r].forEach((ch, rx) => {
          if (ch !== '.') P(cx - 3 + rx, gy - PINB.length + ry, ch === 'W' ? W : P1)
        })
      )
      return false
    },
  }
}

// ── 支付成功金币 ──
const YEN = ['X...X', '.X.X.', '..X..', 'XXXXX', '..X..', 'XXXXX', '..X..']
const CH0: number[] = []
for (let ry = 0; ry < 13; ry++) {
  let h = -1
  for (let rx = 0; rx <= 6; rx++) if (Math.hypot(rx, ry - 6) <= 6.4) h = rx
  CH0.push(h)
}
const FLIP = [6, 5, 3, 1, 0, 1, 3, 5, 6]
function pay(): GroundScene {
  return {
    draw(t, P, cols) {
      ground(P, cols)
      const cx = Math.round(cols / 2)
      const gy = PX_ROWS - 1
      const y = t < 360 ? Math.round(-15 * (1 - Math.pow(t / 360, 2))) : t >= 400 && t < 520 ? -1 : 0
      let hw = 6
      if (t >= 520 && t < 1330) hw = FLIP[Math.floor((t - 520) / 45) % FLIP.length]
      const oy = gy - 1 - 13 + y
      if (t >= 300) {
        const sw = Math.max(1, Math.round((3 * (hw + 1)) / 7))
        for (let q = -sw; q <= sw; q++) P(cx + q, gy - 1, '#e6e6e1') // 落影
      }
      if (t >= 360 && t < 620) {
        const q = (t - 360) / 260
        const d = Math.round(q * 3)
        const u = Math.round(q * 1.5)
        ;[
          [-8 - d, -1 - u],
          [8 + d, -1 - u],
          [-7 - d, -2 - u * 2],
          [7 + d, -2 - u * 2],
        ].forEach(([a, b]) => P(cx + a, gy + b, G))
      }
      const shine = t >= 1730 ? Math.floor(((t - 1730) % 2800) / 40) - 4 : -99
      CH0.forEach((h0, ry) => {
        const w = Math.round((h0 * hw) / 6)
        const Y0 = oy + ry
        for (let c = -w; c <= w; c++) {
          let col: string
          if (hw === 6) {
            const dd = Math.hypot(c, ry - 6)
            col = dd > 5.4 ? D : Y
            const gx = c + 2
            const gyy = ry - 3
            if (gyy >= 0 && gyy < 7 && gx >= 0 && gx < 5 && YEN[gyy][gx] === 'X') col = D
            else if (col === Y && ((c === -3 && ry === 3) || (c === -4 && ry === 4) || (c === -3 && ry === 4))) col = COIN_HI
            else if (col === Y && (c + 6 + ry === shine || c + 6 + ry === shine + 1)) col = COIN_HI
          } else col = c === -w || c === w || w === 0 || ry === 0 || ry === 12 ? D : c === -w + 1 ? COIN_HI : Y
          P(cx + c, Y0, col)
        }
      })
      if (t >= 1330 && t < 1730) {
        const q = (t - 1330) / 400
        const big = q > 0.25 && q < 0.7
        ;[
          [-9, 3],
          [9, 5],
          [-8, 10],
          [8, 11],
        ].forEach(([a, b], i) => {
          if (q < i * 0.08) return
          const X = cx + a
          const Yy = oy + b
          P(X, Yy, LT)
          if (big) {
            P(X - 1, Yy, Y)
            P(X + 1, Yy, Y)
            P(X, Yy - 1, Y)
            P(X, Yy + 1, Y)
          }
        })
      }
      return true
    },
  }
}

// ── 小鸭蛋 ──
const EGG = ['...KKK...', '..KWWWK..', '.KWWWWWK.', '.KWWSWWK.', 'KWWWWWWWK', 'KWSWWWWWK', 'KWWWWWSWK', 'KWWWWWWWK', 'KWWSWWWWK', '.KWWWWWK.', '..KKKKK..']
const DK2 = ['....YYYY....', '...YYYYYY...', '...YYEYYYOO.', '...YYYYYYOO.', '....YYYY....', '.Y.YYYYYY...', 'YYYYYYYYYY..', 'YYYDDDDYYY..', 'YYYYDDDYYY..', '.YYYYYYYY...', '..YYYYYY....']
const EW = '#F7F1DC'
const ES = '#D9B45A'
const seenHatch = new Set<string>() // 同一只鸭（hatch-key）本次运行只播一次孵化
function egg(opts: { hatched?: boolean; shell?: boolean; hatchKey?: string }): GroundScene {
  const h = !!opts.hatched
  const key = opts.hatchKey || 'x'
  let hatching = h && !seenHatch.has(key)
  if (h) seenHatch.add(key)
  let dx: number | null = null
  let wd = 1
  let pause = 0
  let acc = 0
  let lt = -1
  const drawEgg = (P: Plot, ox: number, oy: number, part: 'all' | 'bot', wob: number) =>
    EGG.forEach((r, ry) => {
      if (part === 'bot' && ry < 5) return
      ;[...r].forEach((ch, rx) => {
        if (ch !== '.') P(ox + rx + (ry < 6 ? wob : 0), oy + ry, ch === 'K' ? K : ch === 'S' ? ES : EW)
      })
    })
  const duck = (P: Plot, X: number, oy: number, dir: number, stepOn: number, blink: boolean) => {
    DK2.forEach((r, ry) =>
      [...r].forEach((ch, rx) => {
        if (ch === '.') return
        const cx = dir > 0 ? rx : 11 - rx
        P(X + cx, oy + ry, ch === 'E' ? (blink ? '#B8923F' : K) : ch === 'O' ? '#E98A6E' : ch === 'D' ? D : Y)
      })
    )
    const fx = dir > 0 ? [3, 6] : [5, 8]
    P(X + fx[0] + (stepOn ? 0 : 1), oy + 11, '#E98A6E')
    P(X + fx[1] - (stepOn ? 0 : 1), oy + 11, '#E98A6E')
  }
  return {
    draw(t, P, cols) {
      ground(P, cols)
      const ex = Math.round((cols - 9) / 2)
      const ey = PX_ROWS - 1 - EGG.length
      if (opts.shell) {
        drawEgg(P, ex, ey, 'bot', 0)
        return false
      }
      if (!h) {
        const p = t % 2400
        const wob = p < 480 ? [0, 1, 0, -1][Math.floor(p / 120) % 4] : 0
        drawEgg(P, ex, ey, 'all', wob)
        return true
      }
      const dy = PX_ROWS - 1 - 12
      if (hatching && t >= 2500) hatching = false
      if (hatching) {
        const SH = [0, 1, 0, -1, 0, 1, 0, -1, 0]
        const SH2 = [0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 2, 1, 0, -1, -2, -1, 0]
        const wob = t < SH.length * 70 ? SH[Math.floor(t / 70)] || 0 : t >= 1000 && t < 1000 + SH2.length * 45 ? SH2[Math.floor((t - 1000) / 45)] || 0 : 0
        const CR = [
          [4, 4],
          [3, 5],
          [5, 5],
          [2, 4],
          [6, 4],
          [1, 5],
          [7, 5],
        ]
        const nCr = t < SH.length * 70 ? 0 : t < 1000 ? 3 : 7
        if (t < 1800) {
          drawEgg(P, ex, ey, 'all', wob)
          CR.slice(0, nCr).forEach(([cx, cy]) => P(ex + cx + wob, ey + cy, K))
          return true
        }
        const u = Math.min(1, (t - 1800) / 360)
        duck(P, ex - 1, dy + Math.round((1 - u) * 6), 1, 0, false)
        drawEgg(P, ex, ey, 'bot', 0)
        const lift = Math.round(u * u * 20)
        EGG.slice(0, 5).forEach((r, ry) =>
          [...r].forEach((ch, rx) => {
            if (ch !== '.') P(ex + rx + Math.round(u * 6), ey + ry - lift, ch === 'K' ? K : ch === 'S' ? ES : EW)
          })
        )
        if (t > 2150) {
          const q = (t - 2150) / 350
          ;[
            [0, -1],
            [-1, 0],
            [1, 0],
          ].forEach(([a, b]) => {
            if (q <= 0.8) P(ex + 4 + a * (3 + q * 6), dy - 1 + b * (2 + q * 4), P1)
          })
        }
        return true
      }
      if (dx == null) dx = ex - 1
      const dt = lt < 0 ? 16 : Math.min(48, t - lt)
      lt = t
      if (pause > 0) pause -= dt
      else {
        acc += dt
        while (acc >= 140) {
          acc -= 140
          dx += wd
          if (dx <= 0 || dx >= cols - 12) {
            wd *= -1
            pause = 600
          } else if (Math.random() < 0.015) pause = 900
        }
      }
      drawEgg(P, ex, ey, 'bot', 0)
      const stepOn = pause > 0 ? 0 : Math.floor(t / 140) % 2
      const bob = stepOn ? 0 : 1
      duck(P, dx, dy - bob + 1, wd, stepOn, t % 3200 < 130)
      return true
    },
  }
}

/** 按名字建地面场景（box/pin/pay/egg）；不认识返回 null。truck 另有 createTruck（带方法）。 */
export function createGround(kind: string, opts: { hatched?: boolean; shell?: boolean; hatchKey?: string } = {}): GroundScene | null {
  if (kind === 'box') return box()
  if (kind === 'pin') return pin()
  if (kind === 'pay') return pay()
  if (kind === 'egg') return egg(opts)
  return null
}
