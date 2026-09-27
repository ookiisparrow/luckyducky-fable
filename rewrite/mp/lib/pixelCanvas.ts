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
  /** 画面状态变了（加箱子/开走等）：停着的循环重新跑起来 */
  kick(): void
  setVisible(v: boolean): void
  destroy(): void
}

/** 画布格数：定值，或按实测宽度（px）算（满宽画布如小货车，列数随屏宽）。 */
export type PixelDims = { cols: number; rows: number } | ((widthPx: number) => { cols: number; rows: number })

/**
 * @param draw 每帧回调：t＝可见累计毫秒（暂停期间不走表，恢复后接着播），P 画一格；
 *             返回 false＝画面静止，停帧省电，状态变了由 kick() 唤醒（小货车停着时）
 * @param loop false＝只画一帧（静态图/减弱动效）
 */
export function mountPixelCanvas(
  host: Host,
  dims: PixelDims,
  cell: number,
  draw: (t: number, P: Plot) => boolean | void,
  loop = true
): PixelCanvas {
  let cols = 0
  let rows = 0
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
  const paint = (): boolean => {
    if (!canvas || !ctx) return false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    return draw(elapsed, P) !== false
  }
  const tick = () => {
    raf = 0
    if (dead || !canvas) return
    const now = Date.now()
    elapsed += lastNow ? Math.min(48, now - lastNow) : 16
    lastNow = now
    const more = paint()
    if (loop && more && shown && inView) raf = canvas.requestAnimationFrame(tick)
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
      const d = typeof dims === 'function' ? dims(Number(res[0].width) || 0) : dims
      cols = d.cols
      rows = d.rows
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
    kick,
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
