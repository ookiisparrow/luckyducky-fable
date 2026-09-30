#!/usr/bin/env node
// 像素皮肤生成器（Claude Design「像素化落地规格.md」2c/3a·老板 2026-09-30 定稿；按键后改回平滑）→ rewrite/mp/styles/px-skin.wxss
// 卡片/凹槽/半屏/提示框的阶梯圆角 + 描边 + 顶高光全部画进一张点阵 SVG，用 border-image 九宫格贴在 ::before 上——
// 不用 box-shadow/border-radius（阶梯会把外投影裁掉·描边在拐角断开）。点阵算法照搬设计稿 pixelize.js 的 pz-step。
// 一格 = 2px。改完跑 `node scripts/gen-px-skin.mjs`；tests/px-skin.test.ts 核对产物与本脚本一致。
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CELL = 2
const HAIR = ['#111111', 0.14]

// 阶梯写法 [a,b,c]：从角起第 1 行缩进 a 格、第 2 行 b 格…之后 0；top＝只上两角（半屏）。
// 颜色写 [hex, 透明度]；down＝按下态（规格：键座 −1 格、外硬投影收为 0；面色沿用现有按下色）。
export const SKINS = {
  card: { r: [3, 1, 1], face: '#ffffff', ring: HAIR, down: { face: '#f3f3f0' } },
  cardOn: { r: [3, 1, 1], face: '#ffffff', ring: '#8a5ae0' },
  well: { r: [3, 1, 1], face: '#ededea', hl: '#e3e3df' },
  wellOn: { r: [3, 1, 1], face: '#ededea', ring: '#8a5ae0' },
  wellWarn: { r: [3, 1, 1], face: '#ededea', ring: '#f4bd3f' },
  wellErr: { r: [3, 1, 1], face: '#ededea', ring: '#d9483b' },
  toast: { r: [3, 1, 1], face: ['#111111', 0.88] },
  sheet: { r: [4, 2, 1, 1], top: true, face: '#fafaf8' },
}
// 固定尺寸的像素圆（3a）：n 格见方，格中心到圆心 ≤ 半径 + 0.08 格即填
export const CIRCLES = {
  radio: { n: 11, face: '#ffffff', ring: HAIR },
  radioOn: { n: 11, face: '#ffffff', ring: '#8a5ae0' },
  disc: { n: 28, face: ['#121212', 0.55] },
}
// 皮肤直接挂到现有类上（6 个半屏、全仓凹槽不用逐个改 wxml）。按键不走像素：老板 2026-09-30 定回平滑线性描边（app.wxss .k-*）。
// tests/scripts/pixelize.test.js 核对每个登记的类名真有页面在用，改名漏了会红。
const ALIAS = {
  well: ['.well'],
  wellOn: ['.well-focus'],
  wellWarn: ['.ae-warn'],
  toast: ['.ld-toast'],
  sheet: ['.sh-panel'],
}
const DOWN_ALIAS = {
  card: ['.px-card.k-card-down'],
}
// 挂皮肤的元素要成定位与层叠上下文（::before 垫在字下面）；页面自己写 fixed/absolute 的以页面为准（后加载）
const HOSTS = ['.px-skin', '.well', '.sh-panel', '.ld-toast']
export const ALIAS_CLASSES = [...Object.values(ALIAS), ...Object.values(DOWN_ALIAS)].flat().flatMap((sel) => sel.match(/[a-z][\w-]*/g))
// 只裁外形（照片/缩略图/标签/头像）：按原圆角档
export const CLIPS = { 4: [1], 6: [2, 1], 8: [3, 1, 1] }

const col = (c) => (Array.isArray(c) ? c : [c, 1])

function stepInside(r, top, cols, rows) {
  return (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false
    let n = 0
    if (y < r.length) n = r[y]
    else if (!top && rows - 1 - y < r.length) n = r[rows - 1 - y]
    return x >= n && x < cols - n
  }
}
export function circleInside(n) {
  const c = n / 2
  return (x, y) => x >= 0 && y >= 0 && x < n && y < n && Math.hypot(x + 0.5 - c, y + 0.5 - c) <= c + 0.08
}

// 设计稿 pz-step.paint 原样：投影 → 描边（4 邻接）→ 顶高光 → 键座（每列自底向上 seat 格）
export function paint(p, inside, cols, rows) {
  const G = Array.from({ length: rows + (p.drop || 0) }, () => Array(cols).fill(null))
  const ring = (x, y) => !!p.ring && inside(x, y) && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1))
  for (let y = 0; y < rows + (p.drop || 0); y++) for (let x = 0; x < cols; x++) if (p.drop && inside(x, y - p.drop) && !inside(x, y)) G[y][x] = p.dropc
  const bot = []
  for (let x = 0; x < cols; x++) {
    let yb = -1
    for (let y = rows - 1; y >= 0; y--)
      if (inside(x, y) && !ring(x, y)) {
        yb = y
        break
      }
    bot.push(yb)
  }
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (!inside(x, y)) continue
      let c = p.face
      if (ring(x, y)) c = p.ring
      else {
        if (p.hl && (!inside(x, y - 1) || ring(x, y - 1))) c = p.hl
        if (p.seat && p.seatc && y > bot[x] - p.seat) c = p.seatc
      }
      G[y][x] = c
    }
  return G
}

// 点阵 → SVG（每色一条 path，同色相邻格并成一段）→ data URI
export function svgOf(G) {
  const h = G.length
  const w = G[0].length
  const paths = new Map()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; ) {
      const c = G[y][x]
      if (!c) {
        x++
        continue
      }
      let e = x
      while (e < w && G[y][e] === c) e++
      const k = col(c).join('/')
      paths.set(k, (paths.get(k) || '') + `M${x} ${y}h${e - x}v1h${x - e}z`)
      x = e
    }
  let body = ''
  for (const [k, d] of paths) {
    const [hex, a] = k.split('/')
    body += `<path fill='${hex}'${a === '1' ? '' : ` fill-opacity='${a}'`} d='${d}'/>`
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' shape-rendering='crispEdges'>${body}</svg>`
  return `url("data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`
}

// 九宫格：四边各留 S 格（盖住全部拐角细节），中间 1 格拉伸；底边另加键座 + 投影
export function nineSlice(p) {
  const r = p.r
  const S = Math.max(r[0] || 0, r.length) + 2
  const T = S
  const B = p.top ? 1 : S + (p.seat || 0)
  const cols = S + 1 + S
  const rows = T + 1 + B
  const G = paint(p, stepInside(r, !!p.top, cols, rows), cols, rows)
  const d = p.drop || 0
  const b = B + d
  return (
    `border-style: solid; border-color: transparent; border-width: ${T * CELL}px ${S * CELL}px ${b * CELL}px; ` +
    `border-image: ${svgOf(G)} ${T} ${S} ${b} fill / ${T * CELL}px ${S * CELL}px ${b * CELL}px / 0 0 ${d * CELL}px stretch;`
  )
}

const withDown = (p) => ({ ...p, ...p.down, seat: Math.max(0, (p.seat || 0) - 1), drop: 0, dropc: undefined })

// 阶梯裁切 polygon（四角对称；像素单位）
export function clipPath(r, top = false) {
  const px = (n) => `${n * CELL}px`
  const R = (n) => (n ? `calc(100% - ${px(n)})` : '100%')
  const pts = []
  // 左上角：自上而下每行 (缩进, 行顶)(缩进, 行底)
  r.forEach((n, y) => pts.push(`${px(n)} ${px(y)}`, `${px(n)} ${px(y + 1)}`))
  pts.push(`0 ${px(r.length)}`)
  if (top) pts.push('0 100%', '100% 100%')
  else {
    pts.push(`0 calc(100% - ${px(r.length)})`)
    for (let y = r.length - 1; y >= 0; y--) pts.push(`${px(r[y])} ${R(y + 1)}`, `${px(r[y])} ${R(y)}`)
    for (let y = 0; y < r.length; y++) pts.push(`${R(r[y])} ${R(y)}`, `${R(r[y])} ${R(y + 1)}`)
    pts.push(`100% calc(100% - ${px(r.length)})`)
  }
  pts.push(`100% ${px(r.length)}`)
  for (let y = r.length - 1; y >= 0; y--) pts.push(`${R(r[y])} ${px(y + 1)}`, `${R(r[y])} ${px(y)}`)
  return `polygon(${pts.join(', ')})`
}

// 5c 默认头像：像素小鸭半身 12×12（px-duck 色）贴在 sunk 底上，身体向下铺到框底；64＝16 格（列 2 行 3）、88＝22 格（列 5 行 7）
const BUST = ['....YYYY....', '...YYYYYY...', '..YYYYYYYY..', '..YKYYYYKY..', '..YYYOOYYY..', '...YOOOOY...', '...YYYYYY...', '..YYYYYYYY..', '.YYYYYYYYYY.', 'YDYYYYYYYYDY', 'YDYYYYYYYYDY', 'YYYYYYYYYYYY']
const DUCK = { Y: '#F2D27A', D: '#D9B45A', O: '#E98A6E', K: '#111111', s: '#ededea' }
export function avatarGrid(n, ox, oy) {
  const rows = BUST.concat(Array(Math.max(0, n - oy - BUST.length)).fill('YYYYYYYYYYYY'))
  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => {
      const ch = rows[y - oy]?.[x - ox]
      return DUCK[ch && ch !== '.' ? ch : 's']
    }),
  )
}
export const AVATARS = { 'avatar-duck-16.svg': [16, 2, 3], 'avatar-duck-22.svg': [22, 5, 7] }
const svgFile = (G) => decodeURIComponent(svgOf(G).slice(5, -2).replace('data:image/svg+xml,', ''))

const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())

export function render() {
  const out = [
    '/* 由 scripts/gen-px-skin.mjs 生成，勿手改（Claude Design「像素化落地规格.md」2c/3a·老板 2026-09-30）。',
    '   .px-<皮肤>：元素本身透明、::before 贴阶梯点阵九宫格（元素需 position 非 static）；.px-<皮肤>-down 为按下态。',
    '   .px-clip-4/6/8：按原圆角档把照片/缩略图/标签裁成阶梯外形。.px-circle-*：固定尺寸像素圆。 */',
    `${HOSTS.join(',\n')} {\n  position: relative;\n  isolation: isolate;\n}`,
    '.px-skin {\n  background: transparent;\n  border-radius: 0;\n  box-shadow: none;\n}',
    `${HOSTS.map((h) => h + '::before').join(',\n')} {\n  content: "";\n  position: absolute;\n  left: 0;\n  top: 0;\n  right: 0;\n  bottom: 0;\n  z-index: -1;\n  pointer-events: none;\n  box-sizing: border-box;\n}`,
  ]
  for (const [name, p] of Object.entries(SKINS)) {
    const n = kebab(name)
    const sel = (list) => list.map((x) => x + '::before').join(',\n')
    out.push(`${sel([`.px-${n}`, ...(ALIAS[name] || [])])} {\n  ${nineSlice(p)}\n}`)
    if (p.down) out.push(`${sel([`.px-${n}-down`, ...(DOWN_ALIAS[name] || [])])} {\n  ${nineSlice(withDown(p))}\n}`)
  }
  for (const [name, c] of Object.entries(CIRCLES)) {
    const inside = circleInside(c.n)
    const G = paint(c, inside, c.n, c.n)
    out.push(`.px-circle-${kebab(name)} {\n  width: ${c.n * CELL}px;\n  height: ${c.n * CELL}px;\n  border-radius: 0;\n  box-shadow: none;\n  background: ${svgOf(G)} 0 0 / 100% 100% no-repeat;\n}`)
  }
  for (const [radius, r] of Object.entries(CLIPS)) out.push(`.px-clip-${radius} {\n  border-radius: 0;\n  clip-path: ${clipPath(r)};\n}`)
  return out.join('\n') + '\n'
}

export const OUT = fileURLToPath(new URL('../rewrite/mp/styles/px-skin.wxss', import.meta.url))
export const avatarSvg = (name) => svgFile(avatarGrid(...AVATARS[name]))
export const STATIC = fileURLToPath(new URL('../rewrite/mp/static/', import.meta.url))
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, render())
  for (const name of Object.keys(AVATARS)) writeFileSync(STATIC + name, avatarSvg(name) + '\n')
  console.log('✅ 写出', OUT, '与默认头像', Object.keys(AVATARS).join(' '))
}
