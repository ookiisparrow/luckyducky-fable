// 像素小货车 <px-truck id="truck" cargo="2" pose="park|drive|slow|unload|pay|broken|reverse" arrive="160" scale="4" />
// 满宽、17 格高；图形与状态机见 lib/pixelTruck。页面经 this.selectComponent('#truck') 调 go/restart/stamp，
// 返回需要等待的毫秒数（等车开走再跳转；0＝没动，直接跳）。
// 三条渲染路径（scale=4 才有烘焙，别的 scale 一律走①）：
//   ① 逐行渐变（lib/pixelView）：起步抖动、掉箱、盖章、卸货、故障、停车——每帧拼行渐变 + setData，只留给短动作；
//   ② 巡航烘焙：巡航/慢速/倒车（原地）——精灵图 steps 切帧 + 地面虚线 CSS 滚动，JS 零 setData；
//   ③ 移动层：开走/屏外/开回——同一张精灵图，JS 每帧只推两个数（车 translateX、地面 background-position）。
// ②③ 的素材由 scripts/gen-truck-bake.mjs 生成（lib/truckBaked），选哪层由 lib/truckLayer.layerOf(truck.view()) 决定；
// 动作/姿态变化先交还 JS（leave），同一帧由 takeOver 决定撤层还是换层。
import { createTruck, PX_ROWS, Take, TRUCK_CELL, type TakeResult, type Truck } from '../../lib/pixelTruck'
import { mountPixelView, type PixelView } from '../../lib/pixelView'
import { layerOf, type Layer } from '../../lib/truckLayer'

const live = new WeakMap<object, { truck: Truck; cv: PixelView; since: number; leaving: boolean }>()

type Host = { data: { bk: Layer | null }; setData(d: object): void }
// 交还：下一帧 JS 先补地面相位，再由 takeOver 决定撤层还是换成移动层（同一趟 groupSetData，不闪）。
function leave(host: object): void {
  const l = live.get(host)
  if (l && (host as Host).data.bk) l.leaving = true
}

Component({
  properties: {
    cargo: { type: Number, value: 0 },
    pose: { type: String, value: 'park' },
    arrive: { type: Number, value: -1 }, // ≥0＝进场时从屏外开进来（延迟 ms）
    scale: { type: Number, value: 4 },
  },
  data: { bk: null as Layer | null },
  observers: {
    cargo(n: number) {
      const l = live.get(this)
      if (!l) return
      leave(this)
      l.truck.setCargo(n)
      l.cv.kick()
    },
    pose(p: string) {
      const l = live.get(this)
      if (!l) return
      leave(this)
      l.truck.setPose(p)
      l.cv.kick()
    },
  },
  lifetimes: {
    ready() {
      const s = this.data.scale
      const truck = createTruck({
        cargo: this.data.cargo,
        pose: this.data.pose,
        arrive: this.data.arrive >= 0 ? this.data.arrive : undefined,
      })
      let cols = 0
      const self = this
      // 烘焙层接手（见 lib/truckLayer）：Still＝静止循环（不画，摘出调度）；Moving＝移动中（不画，调度继续，每帧只推位置）；None＝照常逐行画
      const takeOver = (): TakeResult => {
        const l = live.get(self)
        const v = s === TRUCK_CELL ? truck.view() : null
        const next = v && layerOf(v)
        if (!l || !next) {
          if (self.data.bk) self.setData({ bk: null })
          return Take.None
        }
        const bk = self.data.bk
        if (!bk || bk.mv !== next.mv || bk.img !== next.img) {
          self.setData({ bk: next })
          l.since = next.mv ? 0 : Date.now() // 静止循环从此刻起计时，交还时据此补地面相位
        } else if (next.mv && (bk.tx !== next.tx || bk.gp !== next.gp)) self.setData({ 'bk.tx': next.tx, 'bk.gp': next.gp })
        return next.mv ? Take.Moving : Take.Still
      }
      const cv = mountPixelView(
        this,
        (wpx) => {
          cols = Math.floor(wpx / s)
          return { cols, rows: PX_ROWS }
        },
        s,
        (t, P) => {
          const l = live.get(self)
          if (l?.leaving) {
            l.leaving = false
            // 只有静止循环（CSS 自己滚地面）才需要补相位；烘焙层留着，由 takeOver 在同一帧决定撤掉、换成移动层还是照旧
            if (l.since) truck.syncIdle(Date.now() - l.since)
            l.since = l.since ? Date.now() : 0
          }
          return truck.draw(t, P, cols, takeOver)
        }
      )
      live.set(this, { truck, cv, since: 0, leaving: false })
    },
    detached() {
      live.get(this)?.cv.destroy()
      live.delete(this)
    },
  },
  pageLifetimes: {
    show() {
      live.get(this)?.cv.setVisible(true)
    },
    hide() {
      live.get(this)?.cv.setVisible(false)
    },
  },
  methods: {
    go(o?: { back?: boolean }): number {
      const l = live.get(this)
      if (!l) return 0
      leave(this)
      const ms = l.truck.go(o)
      l.cv.kick()
      return ms
    },
    restart(): number {
      const l = live.get(this)
      if (!l) return 0
      leave(this)
      const ms = l.truck.restart()
      l.cv.kick()
      return ms
    },
    stamp(): number {
      const l = live.get(this)
      if (!l) return 0
      leave(this)
      const ms = l.truck.stamp()
      l.cv.kick()
      return ms
    },
  },
})
