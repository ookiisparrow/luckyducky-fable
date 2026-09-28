// 像素画改用普通元素渲染（不再用 <canvas>：canvas 是原生组件，放在 scroll-view 里滚动会漂、会盖住 TabBar）。
// 一帧 = 一张 SVG 背景；同色格合成一条路径，透明处留空。
import { describe, it, expect } from 'vitest'
import { pixelSvg } from '../lib/pixelView'

// 2x 截图核过的接缝（老板反馈「线元素错误」）：一格的边界落不到整物理像素上时（工具模拟器 0.7 缩放、安卓 2.625 倍屏、
// rpx 排版出的半像素位置），逐行拼（每行一个 view 或一层背景）都会在行间漏出浅灰细缝。整帧画成一张 SVG 背景、
// shape-rendering=crispEdges：相邻格共用同一条边、取整方向一致，任何缩放下都无缝。
describe('pixelSvg', () => {
  const decode = (bg: string) => decodeURIComponent(bg.slice(bg.indexOf(',') + 1, bg.indexOf('")')))

  it('大白话：同色格合成一条路径（每行相邻同色合并成一段），开 crispEdges，图按 列×格宽 / 行×格宽 铺满不平铺', () => {
    const bg = pixelSvg(
      [
        [0, 0, '#111'],
        [1, 0, '#111'],
        [3, 0, '#abc'],
        [0, 1, '#111'],
      ],
      2,
      4
    )
    expect(bg.startsWith('url("data:image/svg+xml,')).toBe(true)
    expect(bg.endsWith('") 0 0/16px 8px no-repeat')).toBe(true)
    const svg = decode(bg)
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toContain('viewBox="0 0 4 2"')
    expect(svg).toContain('<path fill="#111" d="M0 0h2v1h-2zM0 1h1v1h-1z"/>')
    expect(svg).toContain('<path fill="#abc" d="M3 0h1v1h-1z"/>')
  })

  it('大白话：后画的格盖住先画的，越界丢掉，小数坐标四舍五入到整格', () => {
    const svg = decode(
      pixelSvg(
        [
          [0, 0, '#111'],
          [0, 0, '#f00'],
          [-1, 0, '#111'],
          [5, 0, '#111'],
          [0.6, 0.4, '#0f0'],
        ],
        1,
        2,
        2
      )
    )
    expect(svg).toContain('<path fill="#f00" d="M0 0h1v1h-1z"/>')
    expect(svg).toContain('<path fill="#0f0" d="M1 0h1v1h-1z"/>')
    expect(svg).not.toContain('#111')
  })

  it('大白话：整帧全空＝没有背景（none）', () => {
    expect(pixelSvg([], 3, 4)).toBe('none')
  })
})
