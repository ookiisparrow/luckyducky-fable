// 像素地面场景 <px-ground kind="box|pin|pay|egg" hatched shell hatch-key="kit01" scale="4" />
// 满宽、17 格高、底行虚线地面（与小货车同一条地面线）；图形见 lib/pixelTruck createGround。
import { createGround, PX_ROWS } from '../../lib/pixelTruck'
import { mountPixelView, pixelPageLifetimes, type PixelView } from '../../lib/pixelView'

const live = new WeakMap<object, PixelView>()

Component({
  properties: {
    kind: { type: String, value: '' },
    hatched: { type: Boolean, value: false },
    shell: { type: Boolean, value: false },
    hatchKey: { type: String, value: '' },
    scale: { type: Number, value: 4 },
  },
  lifetimes: {
    ready() {
      const scene = createGround(this.data.kind, { hatched: this.data.hatched, shell: this.data.shell, hatchKey: this.data.hatchKey })
      if (!scene) return
      const s = this.data.scale
      let cols = 0
      live.set(
        this,
        mountPixelView(
          this,
          (wpx) => {
            cols = Math.floor(wpx / s)
            return { cols, rows: PX_ROWS }
          },
          s,
          (t, P) => scene.draw(t, P, cols)
        )
      )
    },
    detached() {
      live.get(this)?.destroy()
      live.delete(this)
    },
  },
  pageLifetimes: pixelPageLifetimes((c) => live.get(c)),
})
