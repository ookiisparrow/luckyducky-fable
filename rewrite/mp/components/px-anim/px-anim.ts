// 像素动效图标 <px-anim name="truck|shield|heart|loader|…" size="4" delay="600" dark hold="1200" p="0.5">
// v5 设计稿 pixel-anim-icons.js 的小程序版：13×13 格循环动画，图形见 lib/pixelAnim。
// delay＝错峰起播（毫秒）；hold＝播到该时刻停住（只动一次）；p＝仅 loader：按进度逐格点亮；dark＝暗底换色。
import { PIXEL_ANIMS, PIXEL_ANIM_DARK } from '../../lib/pixelAnim'
import { mountPixelCanvas, type PixelCanvas } from '../../lib/pixelCanvas'

const live = new WeakMap<object, PixelCanvas>()

Component({
  properties: {
    name: { type: String, value: '' },
    size: { type: Number, value: 2 },
    delay: { type: Number, value: 0 },
    hold: { type: Number, value: 0 },
    dark: { type: Boolean, value: false },
    p: { type: Number, value: -1 },
  },
  lifetimes: {
    ready() {
      const f = PIXEL_ANIMS[this.data.name]
      if (!f) return
      const hold = this.data.hold
      const delay = this.data.delay
      live.set(
        this,
        mountPixelCanvas(this, 13, 13, this.data.size, (t, P) => {
          const tt = hold && t + delay >= hold ? hold : t + delay
          const plot = this.data.dark ? (x: number, y: number, c: string) => P(x, y, PIXEL_ANIM_DARK[c] || c) : P
          f(plot, tt, this.data.p >= 0 ? this.data.p : null)
        })
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
