// 卡面 SVG 生成黄金基准（守卫 rw-admin-cards-golden·换皮丢了整块卡片设计器·误判"卡后端"实则后端早就绪·仅前端从没接）：
// 正面满版图/品牌角标条件渲染 / 反面五项文案 + 品牌条 / 文本转义防注入 / 双版尺寸不崩。
import { describe, it, expect } from 'vitest'
import { buildFrontSvg, buildBackSvg, type CardModel } from '../src/lib/cardSvg'
import cardsSrc from '../src/pages/Cards.vue?raw'

// 死胡同改选择器（UX 体检批3）：顶层导航「卡片设计」直入曾甩红错「缺少 productId（请从商品页进入）」
// ——入口即错误态，且红色与真故障同色（狼来了稀释红色语义）。listDrafts 本就在本页 import 却没用来
// 兜底。修后：无 productId 时列商品可选（选择器），报错文案绝迹。
describe('Cards.vue 无 productId 不再是死胡同（商品选择器兜底）', () => {
  it('大白话：直入列商品可选（pickProduct 深链重载），「缺少 productId」红错文案绝迹', () => {
    expect(cardsSrc).not.toContain('缺少 productId')
    expect(cardsSrc).toMatch(/function pickProduct\(/)
    expect(cardsSrc).toMatch(/pickRows/)
  })
})

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

// 深审20260712 P3：esc 原只转 &<> 不转引号，且 bg 颜色值完全不经 esc 裸内插——含引号脏档可越出
// SVG 双引号属性注入任意属性（如 onload）。修法对齐 fulfill.ts esc（&<>"' 五件套）+ bg 走 esc。
describe('属性注入防御（esc 转引号 + bg 不裸内插）', () => {
  const dirty: CardModel = {
    ...card,
    front: { ...card.front, bg: '#fff" onload="evil()' },
    back: { ...card.back, bg: "#fff' x=\"1", texts: { ...card.back.texts, title: '他说"你好"和\'单引号\'' } },
  }
  it('大白话：文案里的双/单引号被转义——不越出 SVG 属性边界', () => {
    const back = buildBackSvg(dirty)
    expect(back).toContain('他说&quot;你好&quot;和&#39;单引号&#39;')
    expect(back).not.toContain('他说"你好"')
  })
  it('大白话：bg 颜色值经 esc 内插——带引号的注入串不裸插成新属性', () => {
    const front = buildFrontSvg(dirty, 'https://tmp/a"onload="x.jpg')
    expect(front).not.toContain('" onload="') // 旧裸内插会产出 fill="#fff" onload="evil()"
    expect(front).toContain('fill="#fff&quot; onload=&quot;evil()"')
    expect(front).toContain('href="https://tmp/a&quot;onload=&quot;x.jpg"') // artHref 引号同样收口
    const back = buildBackSvg(dirty)
    expect(back).not.toContain(`' x="1`) // 旧裸内插会产出 fill="#fff' x="1"（注意别只查 x="1——rx="1.5" 会误命中）
    expect(back).toContain('fill="#fff&#39; x=&quot;1"')
  })
})
