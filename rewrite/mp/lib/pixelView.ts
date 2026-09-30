// 像素画渲染驱动（px-anim / px-scene / px-truck / px-ground / px-duck 共用）：普通元素，不用 <canvas>。
// 为什么不用 canvas：canvas 是原生组件，放在 scroll-view 里滚动时位置同步跟不上（画面乱飘），层级还会盖住 TabBar
// （开发者工具实测复现）。改为每行一个 view，背景是一条硬色标渐变（同色相邻格合并成一段）——普通元素随页面滚动、层级正常。
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

// 全站一个帧调度器：一页上的几个像素画（播放页 5 个、首页 5 个）共用一个计时器，每帧各自的 setData 在同一个
// JS 任务里连发、渲染层一批处理。之前每个组件各开一个 setTimeout，计时器互不对齐，渲染层每秒被零散打断几十次，
// 和滚动抢渲染线程就掉帧。
const live = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null
const pump = () => {
  timer = null
  const t0 = Date.now()
  for (const step of [...live]) step()
  // 下一帧按本帧起点算，处理耗时不吃进间隔（模拟器实测：不补偿会从 15fps 掉到 13）；下限 16 防慢帧空转
  if (live.size) timer = setTimeout(pump, Math.max(16, FRAME_MS - (Date.now() - t0)))
}
const wake = () => {
  if (!timer) timer = setTimeout(pump, 0)
}

/**
 * 一帧的格子 → 每行一条渐变（空行＝''）。同一格以最后一次为准；坐标四舍五入到整格；越界丢弃。
 * @param cols 不传＝不限右边界（满宽画布由容器裁掉）
 */
export function rowGradients(cells: Cell[], rows: number, cell: number, cols = Infinity): string[] {
  const grid: Map<number, string>[] = Array.from({ length: rows }, () => new Map())
  for (const [fx, fy, col] of cells) {
    const x = Math.round(fx)
    const y = Math.round(fy)
    if (x < 0 || y < 0 || y >= rows || x >= cols) continue
    grid[y].set(x, col)
  }
  return grid.map((row) => {
    if (!row.size) return ''
    const xs = [...row.keys()].sort((a, b) => a - b)
    const stops: string[] = []
    let i = 0
    let prevEnd = 0
    while (i < xs.length) {
      const start = xs[i]
      const col = row.get(start) as string
      let end = start + 1
      while (i + 1 < xs.length && xs[i + 1] === end && row.get(xs[i + 1]) === col) {
        i++
        end++
      }
      if (start > prevEnd) stops.push(`transparent ${prevEnd * cell}px`, `transparent ${start * cell}px`)
      stops.push(`${col} ${start * cell}px`, `${col} ${end * cell}px`)
      prevEnd = end
      i++
    }
    stops.push(`transparent ${prevEnd * cell}px`)
    return `linear-gradient(to right,${stops.join(',')})`
  })
}

/**
 * 挂到组件上：组件 data 里维护 pxRows（[{ t: 顶部 px, g: 渐变 }]）与 pxH；wxml 用 .pxc 容器 + 行 view 渲染（见 px-anim.wxml）。
 * @param draw 每帧回调：t＝可见累计毫秒（暂停期间不走表），P 画一格；返回 false＝画面静止，停帧
 * @param loop false＝只画一帧
 */
export function mountPixelView(host: Host, dims: PixelDims, cell: number, draw: (t: number, P: Plot) => boolean | void, loop = true): PixelView {
  let cols = 0
  let rows = 0
  let ready = false
  let shown = true
  let inView = true
  let dead = false
  let elapsed = 0
  let lastNow = 0
  let prev: string[] = []

  const paint = (): boolean => {
    const cells: Cell[] = []
    const more = draw(elapsed, (x, y, col) => cells.push([x, y, col])) !== false
    const next = rowGradients(cells, rows, cell, cols)
    const patch: Record<string, string> = {}
    next.forEach((g, i) => {
      if (g !== prev[i]) patch[`pxRows[${i}].g`] = g
    })
    prev = next
    if (Object.keys(patch).length) host.setData(patch)
    return more
  }
  // 共享调度器每帧调一次；不该再动（静止/隐藏/滚出视口/已销毁）就把自己摘掉
  const step = () => {
    if (dead || !ready) {
      live.delete(step)
      return
    }
    const now = Date.now()
    elapsed += lastNow ? Math.min(120, now - lastNow) : FRAME_MS
    lastNow = now
    const more = paint()
    if (!(loop && more && shown && inView)) live.delete(step)
  }
  const kick = () => {
    if (!ready || !loop || !shown || !inView || dead || live.has(step)) return
    lastNow = 0
    live.add(step)
    wake()
  }
  const halt = () => {
    live.delete(step)
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
      prev = Array.from({ length: rows }, () => '')
      host.setData({ pxH: rows * cell, pxCell: cell, pxRows: prev.map((g, i) => ({ t: i * cell, g })) })
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
