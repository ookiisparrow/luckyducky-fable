// 探头像素小鸭 <px-duck scale="4" />（登录半屏顶边用）：图形与时间轴见 lib/pixelDuck。
import { drawDuck, DUCK_COLS, DUCK_ROWS } from '../../lib/pixelDuck'
import { mountPixelCanvas, type PixelCanvas } from '../../lib/pixelCanvas'

const live = new WeakMap<object, PixelCanvas>()

Component({
  properties: {
    scale: { type: Number, value: 4 },
  },
  data: { w: DUCK_COLS * 4, h: DUCK_ROWS * 4 },
  lifetimes: {
    attached() {
      this.setData({ w: DUCK_COLS * this.data.scale, h: DUCK_ROWS * this.data.scale })
    },
    ready() {
      live.set(this, mountPixelCanvas(this, { cols: DUCK_COLS, rows: DUCK_ROWS }, this.data.scale, drawDuck))
    },
    detached() {
      live.get(this)?.destroy()
      live.delete(this)
    },
  },
})
