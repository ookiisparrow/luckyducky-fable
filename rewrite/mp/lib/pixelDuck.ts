// 探头像素小鸭（v5 设计稿 pixel-truck.js 的 PxDuck 移植·13×7 格）：登录半屏顶边右侧冒出来的那只。
// 时间轴：t<120 藏在画布下方 → 120–360ms 从下往上冒出 → 820–940ms 眨一次眼 → 1000ms 后停帧（返回 false 省电）。
import type { Plot } from './pixelAnim'

export const DUCK_COLS = 13
export const DUCK_ROWS = 7
const DUCK = ['....YYYY.....', '...YYYYYY....', '...YYEYYYOO..', '...YYYYYYOO..', '....YYYY.....', '.YYYYYYYYYY..', 'YYYYYYYYYYYY.']
const PAL: Record<string, string> = { Y: '#F2D27A', O: '#E98A6E' }
const EYE = '#1c1c1a'
const LID = '#B8923F'

/** 画一帧；返回 false＝动画已播完、画面静止。越界格由 Plot 裁掉（冒出过程只露上半身）。 */
export function drawDuck(t: number, P: Plot): boolean {
  if (t < 120) return true
  const off = t < 360 ? Math.round(DUCK_ROWS * (1 - (t - 120) / 240)) : 0
  const blink = t >= 820 && t < 940
  DUCK.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== '.') P(x, y + off, ch === 'E' ? (blink ? LID : EYE) : PAL[ch])
    })
  )
  return t < 1000
}
