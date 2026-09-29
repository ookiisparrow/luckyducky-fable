// 像素小字形 <px-i name="back|chev|arrow|check|plus|minus|times|star|led|…" size="2" tone="#8a5ae0" halo="none">
// v5 设计稿 pixel-mini.js 的小程序版：点阵见 lib/pixelGlyph。tone 不传＝跟随父级文字色（currentColor）。
import { glyphShadow } from '../../lib/pixelGlyph'

Component({
  properties: {
    name: { type: String, value: '' },
    size: { type: Number, value: 2 },
    tone: { type: String, value: '' },
    halo: { type: String, value: '' },
  },
  data: { w: 0, h: 0, cell: 2, solid: '', soft: '' },
  observers: {
    'name, size, halo'(name: string, size: number, halo: string) {
      const g = glyphShadow(name, Math.max(1, size || 2), halo !== 'none')
      this.setData({ w: g.w, h: g.h, cell: g.cell, solid: g.solid, soft: g.halo })
    },
  },
})
