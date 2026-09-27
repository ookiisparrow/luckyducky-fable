// 像素小鸭场景 <px-scene kind="hats|charm|share" scale="4">：首页「品牌」段三幕，图形见 lib/pixelScenes。
import { createScene } from '../../lib/pixelScenes'
import { mountPixelCanvas, type PixelCanvas } from '../../lib/pixelCanvas'

const live = new WeakMap<object, PixelCanvas>()

Component({
  properties: {
    kind: { type: String, value: '' },
    scale: { type: Number, value: 4 },
  },
  data: { w: 0, h: 0 },
  lifetimes: {
    attached() {
      const s = createScene(this.data.kind)
      if (s) this.setData({ w: s.cols * this.data.scale, h: s.rows * this.data.scale })
    },
    ready() {
      const s = createScene(this.data.kind)
      if (!s) return
      live.set(
        this,
        mountPixelCanvas(this, { cols: s.cols, rows: s.rows }, this.data.scale, (t, P) => s.draw(t, P))
      )
    },
    detached() {
      live.get(this)?.destroy()
      live.delete(this)
    },
  },
  pageLifetimes: {
    show() {
      live.get(this)?.setVisible(true)
    },
    hide() {
      live.get(this)?.setVisible(false)
    },
  },
})
