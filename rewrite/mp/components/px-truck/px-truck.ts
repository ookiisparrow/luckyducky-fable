// 像素小货车 <px-truck id="truck" cargo="2" pose="park|drive|slow|unload|pay|broken|reverse" arrive="160" pin scale="4" />
// 满宽、17 格高；图形与状态机见 lib/pixelTruck。页面经 this.selectComponent('#truck') 调 go/restart/stamp，
// 返回需要等待的毫秒数（等车开走再跳转；0＝没动，直接跳）。
import { createTruck, PX_ROWS, type Truck } from '../../lib/pixelTruck'
import { mountPixelView, type PixelView } from '../../lib/pixelView'

const live = new WeakMap<object, { truck: Truck; cv: PixelView }>()

Component({
  properties: {
    cargo: { type: Number, value: 0 },
    pose: { type: String, value: 'park' },
    arrive: { type: Number, value: -1 }, // ≥0＝进场时从屏外开进来（延迟 ms）
    pin: { type: Boolean, value: false },
    scale: { type: Number, value: 4 },
  },
  observers: {
    cargo(n: number) {
      const l = live.get(this)
      if (!l) return
      l.truck.setCargo(n)
      l.cv.kick()
    },
    pose(p: string) {
      const l = live.get(this)
      if (!l) return
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
        pin: this.data.pin,
      })
      let cols = 0
      const cv = mountPixelView(
        this,
        (wpx) => {
          cols = Math.floor(wpx / s)
          return { cols, rows: PX_ROWS }
        },
        s,
        (t, P) => truck.draw(t, P, cols)
      )
      live.set(this, { truck, cv })
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
      const ms = l.truck.go(o)
      l.cv.kick()
      return ms
    },
    restart(): number {
      const l = live.get(this)
      if (!l) return 0
      const ms = l.truck.restart()
      l.cv.kick()
      return ms
    },
    stamp(): number {
      const l = live.get(this)
      if (!l) return 0
      const ms = l.truck.stamp()
      l.cv.kick()
      return ms
    },
  },
})
