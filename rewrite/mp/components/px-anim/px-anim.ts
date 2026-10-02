// 像素动效图标 <px-anim name="truck|shield|heart|loader|…" size="4" delay="600" dark hold="1200" p="0.5">
// v5 设计稿 pixel-anim-icons.js 的小程序版：13×13 格循环动画，图形见 lib/pixelAnim。
// 固定循环的图标（无 p、有预渲染精灵图）走 CSS steps 动画：不 JS 逐帧、不 setData（lib/pixelBaked，scripts/gen-px-bake.mjs 生成）；
// 带进度 p、truck、没烘过的尺寸/暗底组合回落原 JS 引擎（lib/pixelView）。
// delay＝错峰起播（毫秒）；hold＝播到该时刻停住（只动一次）；p＝仅 loader：按进度逐格点亮；dark＝暗底换色。
import { PIXEL_ANIMS, PIXEL_ANIM_DARK, type Plot } from '../../lib/pixelAnim'
import { mountPixelView, type PixelView } from '../../lib/pixelView'
import { BAKED_FRAMES, BAKED_SPRITES } from '../../lib/pixelBaked'

const live = new WeakMap<object, PixelView>()
const timers = new WeakMap<object, ReturnType<typeof setTimeout>>()

Component({
  properties: {
    name: { type: String, value: '' },
    size: { type: Number, value: 2 },
    delay: { type: Number, value: 0 },
    hold: { type: Number, value: 0 },
    dark: { type: Boolean, value: false },
    p: { type: Number, value: -1 },
  },
  data: { baked: false, bakedCls: '', bakedStyle: '', paused: false },
  lifetimes: {
    attached() {
      const { name, size, dark, p, delay, hold } = this.data
      const img = BAKED_SPRITES[`${name}-${size}${dark ? 'd' : ''}`]
      if (!img || p >= 0) return
      const side = 13 * size
      const sheetW = BAKED_FRAMES[name] * side
      this.setData({
        baked: true,
        bakedCls: `pxb pxb-${name}`,
        // 负延迟＝从循环中途起播（等价原来的 t+delay 错峰）
        bakedStyle: `width:${side}px;height:${side}px;background-image:url(${img});background-size:${sheetW}px ${side}px;animation-delay:-${delay}ms`,
      })
      // hold＝播到该时刻停住：到点暂停动画（hold 落在静止平台上，定时器误差无感）
      if (hold) timers.set(this, setTimeout(() => this.setData({ paused: true }), Math.max(0, hold - delay)))
    },
    ready() {
      if (this.data.baked) return
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
      clearTimeout(timers.get(this))
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
