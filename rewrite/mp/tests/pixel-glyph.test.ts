// 像素小字形（v5 设计稿 pixel-mini.js 移植）：点阵 → 一串 box-shadow，每格一个方块、整格不出半格。
import { describe, it, expect } from 'vitest'
import { PIXEL_GLYPHS, glyphShadow } from '../lib/pixelGlyph'

describe('glyphShadow', () => {
  it('大白话：尺寸＝点阵宽高×格子大小，每个实心格一条阴影，偏移都是格子的整数倍', () => {
    const g = glyphShadow('check', 2)
    expect(g).toEqual(expect.objectContaining({ w: 14, h: 12, cell: 2 }))
    const solid = PIXEL_GLYPHS.check.join('').split('').filter((c) => c === 'X').length
    expect(g.solid.split(',').length).toBe(solid)
    for (const m of g.solid.matchAll(/(-?\d+)px (-?\d+)px/g)) {
      expect(Number(m[1]) % 2).toBe(0)
      expect(Number(m[2]) % 2).toBe(0)
    }
  })

  it('大白话：左上角那格也画得出来（阴影整体错开一格，不会被元素自身挡住）', () => {
    const g = glyphShadow('dot', 4)
    expect(g.solid.startsWith('4px 4px 0 0 currentColor')).toBe(true)
  })

  it('大白话：状态灯的淡晕单独一层（x 格），关掉淡晕就没有这层', () => {
    expect(glyphShadow('led', 2).halo).not.toBe('')
    expect(glyphShadow('led', 2, false).halo).toBe('')
    expect(glyphShadow('check', 2).halo).toBe('')
  })

  it('大白话：不认识的名字不报错，画空', () => {
    expect(glyphShadow('nope', 2)).toEqual({ w: 0, h: 0, cell: 2, solid: '', halo: '' })
  })
})
