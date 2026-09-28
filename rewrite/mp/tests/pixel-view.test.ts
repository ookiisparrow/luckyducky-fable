// 像素画改用普通元素渲染（不再用 <canvas>：canvas 是原生组件，放在 scroll-view 里滚动会漂、会盖住 TabBar）。
// 一帧 = 每行一条硬色标渐变；同色相邻格合并成一段，透明处留空。
import { describe, it, expect } from 'vitest'
import { rowGradients } from '../lib/pixelView'

describe('rowGradients', () => {
  it('大白话：同一行相邻同色格合并成一段，段与段之间是透明，最后收成透明', () => {
    const rows = rowGradients(
      [
        [0, 0, '#111'],
        [1, 0, '#111'],
        [3, 0, '#abc'],
      ],
      2,
      4
    )
    expect(rows).toEqual([
      'linear-gradient(to right,#111 0px,#111 8px,transparent 8px,transparent 12px,#abc 12px,#abc 16px,transparent 16px)',
      '',
    ])
  })

  it('大白话：后画的格盖住先画的（同一格以最后一次为准），越界的格丢掉', () => {
    const rows = rowGradients(
      [
        [0, 0, '#111'],
        [0, 0, '#f00'],
        [-1, 0, '#111'],
        [5, 0, '#111'],
        [0, 9, '#111'],
      ],
      1,
      2,
      2
    )
    expect(rows).toEqual(['linear-gradient(to right,#f00 0px,#f00 2px,transparent 2px)'])
  })

  it('大白话：坐标是小数（动画插值）时四舍五入到整格，不出半格', () => {
    expect(rowGradients([[0.6, 0.4, '#111']], 1, 2)).toEqual(['linear-gradient(to right,transparent 0px,transparent 2px,#111 2px,#111 4px,transparent 4px)'])
  })
})
