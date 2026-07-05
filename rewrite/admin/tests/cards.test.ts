// 卡面 SVG 生成黄金基准（守卫 rw-admin-cards-golden·换皮丢了整块卡片设计器·误判"卡后端"实则后端早就绪·仅前端从没接）：
// 正面满版图/品牌角标条件渲染 / 反面五项文案 + 品牌条 / 文本转义防注入 / 双版尺寸不崩。
import { describe, it, expect } from 'vitest'
import { buildFrontSvg, buildBackSvg, type CardModel } from '../src/lib/cardSvg'

const card: CardModel = {
  productId: 'p1',
  courseId: 'course-p1',
  name: '小熊 · 激活卡',
  status: 'final',
  front: { art: 'cloud://a.jpg', bg: '#f6e9b8', showBrand: true },
  back: {
    bg: '#ffffff',
    brandText: 'Lucky Ducky · 小棉鸭',
    texts: { title: '恭喜解锁', sub: '扫码看教程', scanHint: '微信扫一扫', warning: '激活后不退货 <注意>' },
  },
  sizeMM: { w: 90, h: 54 },
}

describe('卡面正面（插画面）', () => {
  it('大白话：有 artHref 才渲图；showBrand 才渲角标条；尺寸写进 svg', () => {
    const withArt = buildFrontSvg(card, 'https://tmp/a.jpg')
    expect(withArt).toContain('width="90mm" height="54mm"')
    expect(withArt).toContain('<image href="https://tmp/a.jpg"') // 有素材渲图
    expect(withArt).toContain('Lucky Ducky · 小棉鸭') // 品牌角标
    const noArt = buildFrontSvg({ ...card, front: { ...card.front, showBrand: false } }, undefined)
    expect(noArt).not.toContain('<image ') // 无素材不渲图
    expect(noArt).not.toContain('Lucky Ducky') // showBrand=false 无角标
  })
})

describe('卡面反面（二维码面）', () => {
  it('大白话：五项文案 + 品牌条都在；二维码占位框在；文本转义防注入', () => {
    const svg = buildBackSvg(card)
    expect(svg).toContain('恭喜解锁')
    expect(svg).toContain('扫码看教程')
    expect(svg).toContain('微信扫一扫')
    expect(svg).toContain('二维码区 · 一码一图') // 占位框（印刷厂一码一图）
    expect(svg).toContain('Lucky Ducky · 小棉鸭') // 品牌条
    expect(svg).toContain('激活后不退货 &lt;注意&gt;') // <> 转义（防 SVG 注入·根因#3 不信输入）
    expect(svg).not.toContain('<注意>')
  })

  it('大白话：竖版尺寸也生成不崩', () => {
    const tall = buildBackSvg({ ...card, sizeMM: { w: 105, h: 148 } })
    expect(tall).toContain('width="105mm" height="148mm"')
  })
})
