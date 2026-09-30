import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, OUT, SKINS, CIRCLES, ALIAS_CLASSES, paint, circleInside, avatarGrid, avatarSvg, AVATARS, STATIC } from '../../scripts/gen-px-skin.mjs'

// 像素化 2c/3a（Claude Design「像素化落地规格.md」·老板 2026-09-30 定稿）：阶梯外形全由生成器画，页面不再写平滑圆角/模糊投影。
const MP = path.resolve(import.meta.dirname, '../../rewrite/mp')
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
const files = walk(MP).filter((f) => !f.includes('node_modules') && !f.includes('/tests/'))
const src = (ext) => files.filter((f) => f.endsWith(ext)).map((f) => [path.relative(MP, f), fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')])
const insets = (inside, n) => Array.from({ length: n }, (_, y) => Array.from({ length: n }).findIndex((_, x) => inside(x, y)))

describe('像素皮肤生成', () => {
  it('大白话：styles/px-skin.wxss 与生成器一致（改了生成器忘了重跑会红）', () => {
    expect(fs.readFileSync(OUT, 'utf8')).toBe(render())
  })
  it('大白话：两个像素圆逐行缩进与规格 3a 一字不差', () => {
    expect(insets(circleInside(CIRCLES.radio.n), 11)).toEqual([3, 2, 1, 0, 0, 0, 0, 0, 1, 2, 3])
    expect(insets(circleInside(CIRCLES.disc.n), 28)).toEqual([10, 8, 6, 5, 4, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 8, 10])
  })
  it('大白话：白卡——[3,1,1] 阶梯、一格发丝描边沿阶梯走（4 邻接）、里面白底；凹槽顶一格 sunk-2 代替内阴影', () => {
    const inside = (cols, rows, r) => (x, y) => {
      const n = y < r.length ? r[y] : rows - 1 - y < r.length ? r[rows - 1 - y] : 0
      return x >= 0 && y >= 0 && x < cols && y < rows && x >= n && x < cols - n
    }
    const C = paint(SKINS.card, inside(11, 11, [3, 1, 1]), 11, 11)
    expect(C[0].slice(0, 4)).toEqual([null, null, null, SKINS.card.ring])
    expect(C[1].slice(0, 4)).toEqual([null, SKINS.card.ring, SKINS.card.ring, SKINS.card.face])
    expect(C[5][0]).toBe(SKINS.card.ring)
    expect(C[5][5]).toBe(SKINS.card.face)
    const W = paint(SKINS.well, inside(11, 11, [3, 1, 1]), 11, 11)
    expect(W.map((r) => r[5]).slice(0, 2)).toEqual([SKINS.well.hl, SKINS.well.face])
  })
  it('大白话：默认头像小鸭与规格 5c 逐格点阵一字不差，static 里的 svg 是生成器产物', () => {
    const L = { '#F2D27A': 'Y', '#D9B45A': 'D', '#E98A6E': 'O', '#111111': 'K', '#ededea': 's' }
    const txt = (G) => G.map((r) => r.map((c) => L[c]).join(''))
    expect(txt(avatarGrid(...AVATARS['avatar-duck-16.svg']))).toEqual(['ssssssssssssssss', 'ssssssssssssssss', 'ssssssssssssssss', 'ssssssYYYYssssss', 'sssssYYYYYYsssss', 'ssssYYYYYYYYssss', 'ssssYKYYYYKYssss', 'ssssYYYOOYYYssss', 'sssssYOOOOYsssss', 'sssssYYYYYYsssss', 'ssssYYYYYYYYssss', 'sssYYYYYYYYYYsss', 'ssYDYYYYYYYYDYss', 'ssYDYYYYYYYYDYss', 'ssYYYYYYYYYYYYss', 'ssYYYYYYYYYYYYss'])
    expect(txt(avatarGrid(...AVATARS['avatar-duck-22.svg']))).toEqual(['ssssssssssssssssssssss', 'ssssssssssssssssssssss', 'ssssssssssssssssssssss', 'ssssssssssssssssssssss', 'ssssssssssssssssssssss', 'ssssssssssssssssssssss', 'ssssssssssssssssssssss', 'sssssssssYYYYsssssssss', 'ssssssssYYYYYYssssssss', 'sssssssYYYYYYYYsssssss', 'sssssssYKYYYYKYsssssss', 'sssssssYYYOOYYYsssssss', 'ssssssssYOOOOYssssssss', 'ssssssssYYYYYYssssssss', 'sssssssYYYYYYYYsssssss', 'ssssssYYYYYYYYYYssssss', 'sssssYDYYYYYYYYDYsssss', 'sssssYDYYYYYYYYDYsssss', 'sssssYYYYYYYYYYYYsssss', 'sssssYYYYYYYYYYYYsssss', 'sssssYYYYYYYYYYYYsssss', 'sssssYYYYYYYYYYYYsssss'])
    for (const name of Object.keys(AVATARS)) expect(fs.readFileSync(STATIC + name, 'utf8')).toBe(avatarSvg(name) + '\n')
  })
  it('大白话：登记的「包一层按下」类名都真有页面在用（改名漏改会红）', () => {
    const all = src('.wxml').map(([, s]) => s).join('\n') + src('.wxss').filter(([f]) => !f.startsWith('styles/px-skin')).map(([, s]) => s).join('\n')
    for (const c of ALIAS_CLASSES) expect(all, c).toMatch(new RegExp(`(?<![\\w-])${c}(?![\\w-])`))
  })
})

describe('页面不再写平滑圆角/模糊投影（按键除外）', () => {
  // 例外：按键（老板 2026-09-30 定回平滑线性描边·app.wxss .k-* 与页面里的键帽/勾选框/回顶键）、骨架灰条（规格：骨架不随 2c 改）、
  // 原生 <video> 外框（同层渲染下阶梯裁切不可靠，留平滑）
  const KEYS = /\.k(-[\w-]+)?\b|ps-btn|co-step-key|co-check|ca-check|ca-step-key|rv-box|rv-star-on|ae-knob|ae-region|rv-tag\b|hm-backtop|nv-back|wl-back|me-av-k|me-play|pe-av-k|lp-back-key|ls-check/
  const KEEP = /skel|lp-stage|lp-help-play/
  const rules = () => src('.wxss').filter(([f]) => !f.startsWith('styles/')).flatMap(([f, s]) => [...s.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [f, m[1].trim(), m[2]]))
  it('大白话：border-radius 只剩按键、骨架条与视频外框', () => {
    const bad = rules().filter(([, sel, body]) => /radius\s*:/.test(body) && !KEEP.test(sel) && !KEYS.test(sel)).map(([f, sel]) => `${f} ${sel}`)
    expect(bad).toEqual([])
  })
  it('大白话：按键是平滑线性描边——键帽有 6px 圆角、浅色键一圈 1px 发丝线；不再挂像素点阵', () => {
    const app = fs.readFileSync(path.join(MP, 'app.wxss'), 'utf8')
    expect(app).toMatch(/\.k \{[^}]*border-radius: 6px;/)
    expect(app).toMatch(/\.k-light \{[^}]*0 0 0 1px var\(--v5-hair\)/)
    expect(render()).not.toMatch(/(?<![\w-])\.k(-[\w-]+)?::before|px-check|px-top/) // 白卡按下 .px-card.k-card-down 不算
  })
  // 老板 2026-09-30：所有图片取消倒角，一律直角（连同它们的加载占位块·买家秀卡片图铺满顶部，整卡直角）；标签/气泡/其余卡片仍是阶梯
  const IMAGES = ['hm-rv', 'ca-thumb', 'co-thumb', 'hm-card-media', 'hm-rs-media', 'mc-thumb', 'mc-skel-thumb', 'me-av', 'me-thumb', 'od-thumb', 'ol-thumb', 'pe-av', 'rv-photo-img', 'rv-pic', 'rv-thumb']
  it('大白话：图片（缩略图、商品图、头像、晒图）及其占位块一律直角——不裁阶梯、不写圆角', () => {
    const bad = []
    const re = new RegExp(`class="[^"]*(?<![\\w-])(${IMAGES.join('|')})(?![\\w-])[^"]*"`, 'g')
    for (const [f, s] of src('.wxml')) for (const m of s.matchAll(re)) if (/px-clip|px-skin/.test(m[0])) bad.push(`${f}: ${m[0]}`)
    for (const [f, s] of src('.wxss')) for (const m of s.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (/radius\s*:/.test(m[2]) && IMAGES.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(m[1]))) bad.push(`${f} ${m[1].trim()}`)
    expect(bad).toEqual([])
  })
  it('大白话：除按键外没有带模糊半径的投影（阶梯只配硬边）', () => {
    const blur = (body) => [...body.matchAll(/box-shadow\s*:([^;]*);/g)].some((m) => m[1].split(',').some((l) => /-?\d+px\s+-?\d+px\s+[1-9]\d*px/.test(l.trim().replace(/^inset\s+/, ''))))
    const bad = rules().filter(([, sel, body]) => blur(body) && !KEYS.test(sel)).map(([f, sel]) => `${f} ${sel}`)
    expect(bad).toEqual([])
  })
})

describe('自绘系统层铺满（像素化 9c）', () => {
  const ts = src('.ts')
  it('大白话：原生提示/加载/确认框只剩 utils/sysUi 的兜底与版本更新弹窗（规格留原生）', () => {
    const bad = []
    for (const [f, s] of ts) {
      if (f === 'utils/sysUi.ts' || f === 'utils/appUpdate.ts') continue
      for (const m of s.matchAll(/wx\.(showToast|showLoading|hideLoading|showModal)\(/g)) bad.push(`${f}: ${m[0]}`)
    }
    expect(bad).toEqual([])
  })
  it('大白话：每个页面都挂了 <px-fx id="fx" /> 并登记了组件——提示/确认在哪页都画得出来', () => {
    for (const p of fs.readdirSync(path.join(MP, 'pages'))) {
      expect(fs.readFileSync(path.join(MP, 'pages', p, p + '.wxml'), 'utf8'), p).toContain('<px-fx id="fx" />')
      expect(JSON.parse(fs.readFileSync(path.join(MP, 'pages', p, p + '.json'), 'utf8')).usingComponents['px-fx'], p).toBe('/components/px-fx/px-fx')
    }
  })
  it('大白话：删除个人资料＝危险确认（红字按住·右边「保留」）；确认收货＝普通确认；结算三种通知＝只一颗「知道了」', () => {
    const get = (f) => ts.find(([n]) => n === f)[1]
    expect(get('pages/agreement/agreement.ts')).toMatch(/fxConfirm\(this, \{\s*title: '删除个人资料',[\s\S]*?confirmText: '删除',\s*cancelText: '保留',\s*danger: true,/)
    for (const f of ['pages/order/order.ts', 'pages/order-list/order-list.ts']) expect(get(f)).toContain("fxConfirm(this, { title: '确认收货', content: '确认已收到宝贝了吗？', confirmText: '确认收货' })")
    expect(get('pages/checkout/checkout.ts').match(/confirmText: '知道了',?\s*single: true/g)).toHaveLength(3)
  })
})
