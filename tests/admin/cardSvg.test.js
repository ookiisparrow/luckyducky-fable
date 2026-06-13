import { describe, it, expect } from 'vitest'
import { buildFrontSvg, buildBackSvg } from '../../packages/admin/src/utils/cardSvg.js'

// admin 质量基线（B8d）：admin 此前零测试——给纯逻辑一个测试家，并锁住卡面 SVG 的
// XSS 转义（esc）。卡面是印刷交付物、文案来自后台用户输入，不可注入。
const card = {
  sizeMM: { w: 90, h: 54 },
  front: { art: '', bg: '#f6e9b8', showBrand: true },
  back: {
    bg: '#ffffff',
    brandText: 'Lucky Ducky · 幸运小鸭',
    texts: { title: '快乐钩织', sub: '副标题', scanHint: '微信扫码', warning: '一码一用' },
  },
}

describe('admin cardSvg 卡面生成（B8d 基线）', () => {
  it('buildFrontSvg：含 svg 头 / 尺寸 mm / 正面底色 / 品牌角标', () => {
    const svg = buildFrontSvg(card, '')
    expect(svg).toContain('<svg')
    expect(svg).toContain('width="90mm"')
    expect(svg).toContain('height="54mm"')
    expect(svg).toContain('fill="#f6e9b8"')
    expect(svg).toContain('幸运小鸭')
  })

  it('buildBackSvg：含标题 / 二维码占位区 / 扫码说明', () => {
    const svg = buildBackSvg(card)
    expect(svg).toContain('快乐钩织')
    expect(svg).toContain('二维码区')
    expect(svg).toContain('微信扫码')
  })

  it('文案 XSS 转义：标题含 <script> 被 esc，不原样进 SVG', () => {
    const evil = {
      ...card,
      back: { ...card.back, texts: { ...card.back.texts, title: '<script>alert(1)</script>' } },
    }
    const svg = buildBackSvg(evil)
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
  })
})
