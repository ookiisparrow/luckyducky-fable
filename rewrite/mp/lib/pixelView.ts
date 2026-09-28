// 像素画渲染驱动（px-anim / px-scene / px-truck / px-ground / px-duck 共用）：普通元素，不用 <canvas>。
// 为什么不用 canvas：canvas 是原生组件，放在 scroll-view 里滚动时位置同步跟不上（画面乱飘），层级还会盖住 TabBar
// （开发者工具实测复现）。改为一个普通元素 + 每帧一张 SVG 背景（pixelSvg）——随页面滚动、层级正常。
// 不能逐行拼（每行一个 view / 一层渐变）：一格的边界落不到整物理像素上时（模拟器缩放、安卓 2.625 倍屏、rpx 半像素位置）
// 行间漏出浅灰细缝（2x 截图核过·老板反馈「线元素错误」）；SVG crispEdges 相邻格共用一条边，任何缩放下都无缝。
// 每帧只 setData 变了的行；~15fps（像素风不需要更高）；页面隐藏或滚出视口即停，draw 返回 false（静止画面）也停，kick() 唤醒。
import type { Plot } from './pixelAnim'

type Host = WechatMiniprogram.Component.TrivialInstance
type Cell = [number, number, string]

export interface PixelView {
  /** 画面状态变了（加箱子/开走等）：停着的循环重新跑起来 */
  kick(): void
  setVisible(v: boolean): void
  destroy(): void
}

/** 画布格数：定值，或按实测宽度（px）算（满宽画布如小货车，列数随屏宽）。 */
export type PixelDims = { cols: number; rows: number } | ((widthPx: number) => { cols: number; rows: number })

const FRAME_MS = 66 // ≈15fps

/**
 * 一帧的格子 → 一张 SVG 背景（CSS background 值）。同一格以最后一次为准；坐标四舍五入到整格；越界丢弃。
 * 同色格合成一条路径（每行相邻同色合并成一段）；crispEdges 让相邻格共用的边在任何缩放下取整一致＝无缝。
 * @param cols 不传＝不限右边界（满宽画布由容器裁掉，图宽取最右一格）
 */
export function pixelSvg(cells: Cell[], rows: number, cell: number, cols = Infinity): string {
  const grid: Map<number, string>[] = Array.from({ length: rows }, () => new Map())
  let maxX = -1
  for (const [fx, fy, col] of cells) {
    const x = Math.round(fx)
    const y = Math.round(fy)
    if (x < 0 || y < 0 || y >= rows || x >= cols) continue
    grid[y].set(x, col)
    if (x > maxX) maxX = x
  }
  if (maxX < 0) return 'none'
  const paths = new Map<string, string>()
  grid.forEach((row, y) => {
    const xs = [...row.keys()].sort((a, b) => a - b)
    for (let i = 0; i < xs.length; i++) {
      const start = xs[i]
      const col = row.get(start) as string
      let end = start + 1
      while (i + 1 < xs.length && xs[i + 1] === end && row.get(xs[i + 1]) === col) {
        i++
        end++
      }
      paths.set(col, (paths.get(col) || '') + `M${start} ${y}h${end - start}v1h-${end - start}z`)
    }
  })
  const w = Number.isFinite(cols) ? cols : maxX + 1
  let body = ''
  paths.forEach((d, col) => (body += `<path fill="${col}" d="${d}"/>`))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${rows}" shape-rendering="crispEdges">${body}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 0/${w * cell}px ${rows * cell}px no-repeat`
}

/**
 * 挂到组件上：组件 data 里维护 pxBg（SVG 背景）；wxml 就是一个 .pxc 容器 style="background:{{pxBg}}"（见 px-anim.wxml）。
 * @param draw 每帧回调：t＝可见累计毫秒（暂停期间不走表），P 画一格；返回 false＝画面静止，停帧
 * @param loop false＝只画一帧
 */
export function mountPixelView(host: Host, dims: PixelDims, cell: number, draw: (t: number, P: Plot) => boolean | void, loop = true): PixelView {
  let cols = 0
  let rows = 0
  let ready = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let shown = true
  let inView = true
  let dead = false
  let elapsed = 0
  let lastNow = 0
  let prev = ''

  const paint = (): boolean => {
    const cells: Cell[] = []
    const more = draw(elapsed, (x, y, col) => cells.push([x, y, col])) !== false
    const next = pixelSvg(cells, rows, cell, cols)
    if (next !== prev) host.setData({ pxBg: next })
    prev = next
    return more
  }
  const tick = () => {
    timer = null
    if (dead || !ready) return
    const now = Date.now()
    elapsed += lastNow ? Math.min(120, now - lastNow) : FRAME_MS
    lastNow = now
    const more = paint()
    if (loop && more && shown && inView) timer = setTimeout(tick, FRAME_MS)
  }
  const kick = () => {
    if (!ready || timer || !loop || !shown || !inView || dead) return
    lastNow = 0
    timer = setTimeout(tick, 0)
  }
  const halt = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  host
    .createSelectorQuery()
    .select('.pxc')
    .boundingClientRect()
    .exec((res) => {
      if (dead) return
      const w = (res && res[0] && Number(res[0].width)) || 0
      const d = typeof dims === 'function' ? dims(w) : dims
      cols = d.cols
      rows = d.rows
      prev = ''
      ready = true
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
