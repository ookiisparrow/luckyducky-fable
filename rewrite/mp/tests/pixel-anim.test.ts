// 像素动画移植冒烟（v5 设计稿 pixel-anim-icons.js / pixel-duck-scenes.js）：每个图形在一串时刻都画得出东西、
// 且不越界（越界＝移植抄错坐标）。组件层（行元素渲染/逐帧）靠真机走查；渲染拼行见 pixel-view 测试。
import { describe, it, expect } from 'vitest'
import { PIXEL_ANIMS } from '../lib/pixelAnim'
import { createScene } from '../lib/pixelScenes'

const TIMES = [0, 100, 450, 900, 1300, 2100, 2700, 5200, 9000]

function probe(draw: (P: (x: number, y: number, c: string) => void) => void) {
  const pts: [number, number][] = []
  draw((x, y) => pts.push([Math.round(x), Math.round(y)]))
  return pts
}

describe('像素动效图标', () => {
  it('大白话：设计稿首页/流程用到的 9 个图标都在', () => {
    expect(Object.keys(PIXEL_ANIMS).sort()).toEqual(['alert', 'checkin', 'coin', 'heart', 'hourglass', 'loader', 'shield', 'signal', 'truck'])
  })

  it.each(Object.keys(PIXEL_ANIMS))('大白话：%s 每个时刻都有画面、全落在 13×13 格里', (name) => {
    for (const t of TIMES) {
      const pts = probe((P) => PIXEL_ANIMS[name](P, t, null))
      expect(pts.length).toBeGreaterThan(0)
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(-1) // 警示三角左右抖 1 格属设计（画布边缘裁掉）
        expect(x).toBeLessThanOrEqual(13)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(12)
      }
    }
  })

  it('大白话：loader 给进度时按进度点亮（一半进度＝4 段亮紫）', () => {
    const cols: string[] = []
    PIXEL_ANIMS.loader((_x, _y, c) => cols.push(c), 0, 0.5)
    expect(cols.filter((c) => c !== '#C9C9C2').length).toBe(4 * 4)
  })
})

describe('像素小鸭场景', () => {
  it.each(['hats', 'charm', 'share'])('大白话：%s 连续播放每帧都有画面、不越界', (kind) => {
    const s = createScene(kind)!
    expect(s).not.toBeNull()
    for (let t = 0; t <= 9000; t += 150) {
      const pts = probe((P) => s.draw(t, P))
      expect(pts.length).toBeGreaterThan(0)
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThan(s.cols)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThan(s.rows)
      }
    }
  })

  it('大白话：换帽子场景会真的把帽子换到头上（播一轮后头上帽色变了）', () => {
    const s = createScene('hats')!
    const headColor = (t: number) => {
      let c = ''
      s.draw(t, (x, y, col) => {
        if (x === 16 && y === 21) c = col
      })
      return c
    }
    const before = headColor(0)
    for (let t = 0; t <= 4000; t += 16) s.draw(t, () => {})
    expect(headColor(4000)).not.toBe(before)
  })

  it('大白话：不认识的场景名返回空', () => {
    expect(createScene('nope')).toBeNull()
  })
})
