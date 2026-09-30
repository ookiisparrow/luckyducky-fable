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
  it('大白话：墨黑键——[2,1] 阶梯、顶一格高光、底两格键座、键外一格硬投影；按下键座剩一格、投影收掉', () => {
    const p = SKINS.ink
    const cols = 9
    const rows = 11
    const inside = (x, y) => {
      const r = [2, 1]
      const n = y < 2 ? r[y] : rows - 1 - y < 2 ? r[rows - 1 - y] : 0
      return x >= 0 && y >= 0 && x < cols && y < rows && x >= n && x < cols - n
    }
    const G = paint(p, inside, cols, rows)
    expect(G[0].slice(0, 3)).toEqual([null, null, p.hl])
    expect(G.map((r) => r[4])).toEqual([p.hl, ...Array(8).fill(p.face), p.seatc, p.seatc, p.dropc])
    const D = paint({ ...p, seat: 1, drop: 0 }, inside, cols, rows)
    expect(D.map((r) => r[4]).slice(-2)).toEqual([p.face, p.seatc])
    expect(D.length).toBe(rows)
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

describe('页面不再写平滑圆角/模糊投影', () => {
  // 例外：骨架灰条（规格：骨架不随 2c 改）、原生 <video> 外框（同层渲染下阶梯裁切不可靠，留平滑）
  const KEEP = /skel|lp-stage|lp-help-play/
  it('大白话：页面/组件/全局样式里的 border-radius 只剩骨架条与视频外框', () => {
    const bad = []
    for (const [f, s] of src('.wxss')) {
      if (f.startsWith('styles/')) continue
      for (const m of s.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (/radius\s*:/.test(m[2]) && !KEEP.test(m[1])) bad.push(`${f} ${m[1].trim()}`)
    }
    expect(bad).toEqual([])
  })
  it('大白话：没有带模糊半径的投影（阶梯只配硬边）', () => {
    const bad = []
    for (const [f, s] of src('.wxss')) for (const m of s.matchAll(/box-shadow\s*:([^;]*);/g)) if (m[1].split(',').some((l) => /-?\d+px\s+-?\d+px\s+[1-9]\d*px/.test(l.trim().replace(/^inset\s+/, '')))) bad.push(`${f}: ${m[1].trim()}`)
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
