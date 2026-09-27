// 像素画布驱动（px-anim / px-scene 共用）：canvas type="2d" 取节点 → 按设备像素比开位图 → 逐帧 draw。
// 每格在「设备像素」上取整绘制（x0=round(x·cell·dpr)），安卓非整数倍屏也不出半格糊边。
// 只在「页面可见且画布在视口内」时跑帧（IntersectionObserver + pageLifetimes），首页一长串动画滚出屏即停。
import type { Plot } from './pixelAnim'

type Ctx2D = {
  fillStyle: string
  clearRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
}
type Canvas2D = {
  width: number
  height: number
  getContext(kind: '2d'): Ctx2D
  requestAnimationFrame(cb: () => void): number
  cancelAnimationFrame(id: number): void
}
type Host = WechatMiniprogram.Component.TrivialInstance

export interface PixelCanvas {
  setVisible(v: boolean): void
  destroy(): void
}

/**
 * @param draw 每帧回调：t＝可见累计毫秒（暂停期间不走表，恢复后接着播），P 画一格
 * @param loop false＝只画一帧（静态图/减弱动效）
 */
export function mountPixelCanvas(
  host: Host,
  cols: number,
  rows: number,
  cell: number,
  draw: (t: number, P: Plot) => void,
  loop = true
): PixelCanvas {
  let canvas: Canvas2D | null = null
  let ctx: Ctx2D | null = null
  let raf = 0
  let shown = true
  let inView = true
  let dead = false
  let elapsed = 0
  let lastNow = 0
  const dpr = wx.getWindowInfo().pixelRatio || 2
  const edge = (i: number) => Math.round(i * cell * dpr)
  const P: Plot = (x, y, col) => {
    if (!ctx) return
    const gx = Math.round(x)
    const gy = Math.round(y)
    if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return
    ctx.fillStyle = col
    ctx.fillRect(edge(gx), edge(gy), edge(gx + 1) - edge(gx), edge(gy + 1) - edge(gy))
  }
  const paint = () => {
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    draw(elapsed, P)
  }
  const tick = () => {
    raf = 0
    if (dead || !canvas) return
    const now = Date.now()
    elapsed += lastNow ? Math.min(48, now - lastNow) : 16
    lastNow = now
    paint()
    if (loop && shown && inView) raf = canvas.requestAnimationFrame(tick)
  }
  const kick = () => {
    if (!canvas || raf || !loop || !shown || !inView || dead) return
    lastNow = 0
    raf = canvas.requestAnimationFrame(tick)
  }
  const halt = () => {
    if (canvas && raf) canvas.cancelAnimationFrame(raf)
    raf = 0
  }

  host
    .createSelectorQuery()
    .select('.pxc')
    .fields({ node: true, size: true })
    .exec((res) => {
      const node = res && res[0] && (res[0].node as Canvas2D | undefined)
      if (dead || !node) return
      node.width = edge(cols)
      node.height = edge(rows)
      ctx = node.getContext('2d')
      canvas = node
      paint()
      kick()
    })
  const io = host.createIntersectionObserver({}).relativeToViewport({ top: 40, bottom: 40 })
  io.observe('.pxc', (r) => {
    inView = r.intersectionRatio > 0
    if (inView) kick()
    else halt()
  })

  return {
    setVisible(v) {
      shown = v
      if (v) kick()
      else halt()
    },
    destroy() {
      dead = true
      halt()
      io.disconnect()
    },
  }
}
