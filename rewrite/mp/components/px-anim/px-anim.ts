// 像素动效图标 <px-anim name="truck|shield|heart|loader|…" size="4" delay="600" dark hold="1200" p="0.5">
// v5 设计稿 pixel-anim-icons.js 的小程序版：13×13 格循环动画，图形见 lib/pixelAnim。
// delay＝错峰起播（毫秒）；hold＝播到该时刻停住（只动一次）；p＝仅 loader：按进度逐格点亮；dark＝暗底换色。
import { PIXEL_ANIMS, PIXEL_ANIM_DARK, type Plot } from '../../lib/pixelAnim'
import { mountPixelView, type PixelView } from '../../lib/pixelView'

const live = new WeakMap<object, PixelView>()

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
      let darkPlot: Plot | null = null // 暗底换色的落格函数只建一次（60fps 下不每帧造闭包）
      live.set(
        this,
        mountPixelView(this, { cols: 13, rows: 13 }, this.data.size, (t, P) => {
          const held = !!hold && t + delay >= hold
          const plot = this.data.dark ? darkPlot || (darkPlot = (x, y, c) => P(x, y, PIXEL_ANIM_DARK[c] || c)) : P
          f(plot, held ? hold : t + delay, this.data.p >= 0 ? this.data.p : null)
          return !held // 播到 hold 停住：画完这一帧就摘出调度，不再空转
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
