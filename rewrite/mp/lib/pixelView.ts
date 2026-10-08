// 像素画渲染驱动（px-anim / px-scene / px-truck / px-ground / px-duck 共用）：普通元素，不用 <canvas>。
// 为什么不用 canvas：canvas 是原生组件，放在 scroll-view 里滚动时位置同步跟不上（画面乱飘），层级还会盖住 TabBar
// （开发者工具实测复现）。改为每行一个 view，背景是一条硬色标渐变（同色相邻格合并成一段）——普通元素随页面滚动、层级正常。
// 帧率照设计稿（pixel-*.js 全用 requestAnimationFrame 逐帧画·≈60fps·老板 2026-10-01「像素动效流畅丝滑」）：每帧只 setData
// 变了的行（静止帧零开销）；页面隐藏或滚出视口即停，draw 返回 false（静止画面）也停，kick() 唤醒。
import type { Plot } from './pixelAnim'

type Host = WechatMiniprogram.Component.TrivialInstance
type Cell = [number, number, string]
type Grid = string[][] // grid[y][x]＝颜色（空洞＝透明）

export interface PixelView {
  /** 画面状态变了（加箱子/开走等）：停着的循环重新跑起来 */
  kick(): void
  setVisible(v: boolean): void
  destroy(): void
}

/** 画布格数：定值，或按实测宽度（px）算（满宽画布如小货车，列数随屏宽）。 */
export type PixelDims = { cols: number; rows: number } | ((widthPx: number) => { cols: number; rows: number })

const FRAME_MS = 16 // ≈60fps（设计稿 requestAnimationFrame）
const STALL_MS = 200 // 某视图上一帧的回执迟迟不回：最多等这么久就重发（后台页的视图渲染层不画，回执永远不来）

// 全站一个帧调度器，三条保证丝滑：
// ① 一个计时器驱动所有活着的像素画，同一趟出帧（原先各开 setTimeout 互不对齐，渲染层每秒被零散打断几十次）；
// ② 同一页这一帧的各组件 setData 用 groupSetData 合成一次绘制（官方：用于不同组件同时 setData 时同步绘制）；
// ③ 背压（见 mountPixelView 的 waitSince）：视图自己上一帧渲染层还没回执就跳过这帧——不在渲染层排队（排队＝攒一批再
//    一口气画＝顿挫），慢机器自动降帧；动画时间照真实时钟走，只是帧变少、不变慢。
//    背压按视图、不按全局：后台页上的视图回执永远不来，只卡它自己（2026-10-01 模拟器实测：做成全局时，首页切到后台后
//    那页的一个 loader 把全站像素画拖到 5fps）。
type Entry = { host: Host; page: string }
const live = new Map<() => void, Entry>()
let timer: ReturnType<typeof setTimeout> | null = null

// 前台页（页栈顶）的标识；拿不到（老基础库/测试环境）回 ''＝不判。
// 为什么要它：页面切到后台后才创建的像素画（如首页 wx:if 的加载转圈）收不到 pageLifetimes.hide，会以为自己可见一直跑——
// 后台页渲染层不画、回执永远不来，白白每 200ms 重发一次。每帧对一下前台页，不在前台的先停；回前台时 pageLifetimes.show → kick 续上。
function frontPageId(): string {
  try {
    const ps = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    const top = ps[ps.length - 1] as unknown as { getPageId?: () => string } | undefined
    return top && typeof top.getPageId === 'function' ? top.getPageId() : ''
  } catch {
    return '' // 刻意静默：判不出前台页就不停任何视图（最多多画几帧）
  }
}

function pump() {
  timer = null
  if (!live.size) return
  const now = Date.now()
  const front = frontPageId()
  const pages = new Map<string, { host: Host; steps: (() => void)[] }>()
  for (const [step, e] of live) {
    if (front && e.page && e.page !== front) {
      live.delete(step) // 不在前台：先停（见 frontPageId）
      continue
    }
    const g = pages.get(e.page)
    if (g) g.steps.push(step)
    else pages.set(e.page, { host: e.host, steps: [step] })
  }
  for (const { host, steps } of pages.values()) {
    const run = () => {
      for (const s of steps) s()
    }
    if (typeof host.groupSetData === 'function') host.groupSetData(run)
    else run()
  }
  // 下一帧按本帧起点算，处理耗时不吃进间隔
  if (live.size) timer = setTimeout(pump, Math.max(0, FRAME_MS - (Date.now() - now)))
}
const wake = () => {
  if (!timer) timer = setTimeout(pump, 0)
}

/** 仅测试：清空全站调度状态（用例间假时钟被换掉，旧计时器永远不会触发）。 */
export function __resetForTest(): void {
  if (timer) clearTimeout(timer)
  timer = null
  live.clear()
}

/** 格子网 → 每行一条渐变（空行＝''）：同色相邻格并成一段，空洞是透明。逐格扫一遍，不排序不建 Map（60fps 下少造垃圾）。 */
function gridGradients(grid: Grid, rows: number, cell: number): string[] {
  const out: string[] = new Array(rows)
  for (let y = 0; y < rows; y++) {
    const row = grid[y]
    if (!row || !row.length) {
      out[y] = ''
      continue
    }
    let s = 'linear-gradient(to right'
    let prevEnd = 0
    let x = 0
    while (x < row.length) {
      const col = row[x]
      if (col === undefined) {
        x++
        continue
      }
      let end = x + 1
      while (end < row.length && row[end] === col) end++
      if (x > prevEnd) s += `,transparent ${prevEnd * cell}px,transparent ${x * cell}px`
      s += `,${col} ${x * cell}px,${col} ${end * cell}px`
      prevEnd = end
      x = end
    }
    out[y] = `${s},transparent ${prevEnd * cell}px)`
  }
  return out
}

/** 落一格：坐标四舍五入到整格；越界丢弃；同一格以最后一次为准。 */
function plotInto(grid: Grid, rows: number, cols: number, fx: number, fy: number, col: string): void {
  const x = Math.round(fx)
  const y = Math.round(fy)
  if (x < 0 || y < 0 || y >= rows || x >= cols) return
  ;(grid[y] || (grid[y] = []))[x] = col
}

/**
 * 一帧的格子 → 每行一条渐变（空行＝''）。同一格以最后一次为准；坐标四舍五入到整格；越界丢弃。
 * @param cols 不传＝不限右边界（满宽画布由容器裁掉）
 */
export function rowGradients(cells: Cell[], rows: number, cell: number, cols = Infinity): string[] {
  const grid: Grid = []
  for (const [fx, fy, col] of cells) plotInto(grid, rows, cols, fx, fy, col)
  return gridGradients(grid, rows, cell)
}

/**
 * 挂到组件上：组件 data 里维护 pxRows（[{ t: 顶部 px, g: 渐变 }]）与 pxH；wxml 用 .pxc 容器 + 行 view 渲染（见 px-anim.wxml）。
 * @param draw 每帧回调：t＝可见累计毫秒（暂停期间不走表），P 画一格；返回 false＝画面静止，停帧
 */
export function mountPixelView(host: Host, dims: PixelDims, cell: number, draw: (t: number, P: Plot) => boolean | void): PixelView {
  let cols = 0
  let rows = 0
  let ready = false
  let shown = true
  let inView = true
  let dead = false
  let elapsed = 0
  let lastNow = 0
  let prev: string[] = []
  const page = typeof host.getPageId === 'function' ? host.getPageId() : '' // 同页的像素画合成一次绘制（见 pump）
  const grid: Grid = [] // 每帧复用（清空行长度而不是新建），P 直接落格不造临时数组
  const plot: Plot = (x, y, col) => plotInto(grid, rows, cols, x, y, col)
  let waitSince = 0 // 背压：上一帧发出、渲染层还没回执的时刻（0＝没有在途）
  let sendSeq = 0 // 只认最近一次发出的回执（超时重发后，旧回执迟到不算）

  const paint = (): boolean => {
    for (const row of grid) if (row) row.length = 0
    const more = draw(elapsed, plot) !== false
    const next = gridGradients(grid, rows, cell)
    let patch: Record<string, string> | null = null
    for (let i = 0; i < rows; i++) {
      if (next[i] !== prev[i]) (patch || (patch = {}))[`pxRows[${i}].g`] = next[i]
    }
    prev = next
    if (patch) {
      const seq = ++sendSeq
      waitSince = Date.now()
      host.setData(patch, () => {
        if (seq === sendSeq) waitSince = 0
      })
    }
    return more
  }
  // 共享调度器每帧调一次；不该再动（静止/隐藏/滚出视口/已销毁）就把自己摘掉
  const step = () => {
    if (dead || !ready) {
      live.delete(step)
      return
    }
    const now = Date.now()
    if (waitSince && now - waitSince < STALL_MS) return // 自己上一帧还没画完：跳过这帧（时间照真实时钟走，下一帧补上）
    elapsed += lastNow ? Math.min(120, now - lastNow) : FRAME_MS
    lastNow = now
    const more = paint()
    if (!(more && shown && inView)) live.delete(step)
  }
  const kick = () => {
    if (!ready || !shown || !inView || dead || live.has(step)) return
    lastNow = 0
    live.set(step, { host, page })
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

/** 像素组件共用的 pageLifetimes：页面切后台停画、回前台续画。view 取本组件挂着的视图（还没挂上＝undefined，跳过）。 */
export function pixelPageLifetimes(view: (host: object) => PixelView | undefined) {
  return {
    show(this: object) {
      view(this)?.setVisible(true)
    },
    hide(this: object) {
      view(this)?.setVisible(false)
    },
  }
}
