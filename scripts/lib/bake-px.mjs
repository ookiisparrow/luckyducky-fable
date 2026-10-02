// 像素图标预渲染核心（纯函数·脚本与 vitest 共用）：把 lib/pixelAnim 的 draw(t) 按 1ms 精确采样一整个循环，
// 连续相同的画面并成一帧 → { frames, keys }；再按「格子边长」编成横条 PNG。小程序侧用 CSS steps 动画播放，
// 不再每帧 JS 重画 + setData（见 components/px-anim）。
import { deflateSync } from 'node:zlib'

export const GRID = 13

/** 一个循环的时长（ms）。只收「无参数、纯时间」的图标；truck 周期过长、loader 带进度 p 的走原 JS 引擎。 */
export const PERIOD = { shield: 2000, checkin: 2000, heart: 1100, hourglass: 2600, alert: 2000, signal: 1800, coin: 1600, loader: 720 }

/** 实际用到的变体（name → [[格边长, 暗底?]…]）。没列的组合运行时自动回落到 JS 引擎，所以漏列只是慢、不会坏。 */
export const VARIANTS = {
  signal: [[2, false], [4, false]],
  loader: [[2, false], [2, true]],
  coin: [[2, false], [4, false]],
  hourglass: [[2, false]],
  checkin: [[2, true]],
  shield: [[4, false]],
  heart: [[4, false]],
  alert: [[2, false], [4, false]],
}

/** 采样一整个循环：返回去重后的帧（长 169 的颜色数组，'' ＝透明）与切帧时刻。落格规则同 lib/pixelView.plotInto：四舍五入、越界丢、后写覆盖。 */
export function sample(draw, period, darkMap = null) {
  const frames = []
  const keys = []
  const index = new Map()
  let last = -1
  for (let t = 0; t < period; t++) {
    const cells = new Array(GRID * GRID).fill('')
    draw((fx, fy, col) => {
      const x = Math.round(fx)
      const y = Math.round(fy)
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) return
      cells[y * GRID + x] = darkMap ? darkMap[col] || col : col
    }, t, null)
    const sig = cells.join('|')
    let f = index.get(sig)
    if (f === undefined) {
      f = frames.length
      frames.push(cells)
      index.set(sig, f)
    }
    if (f !== last) {
      keys.push({ t, f })
      last = f
    }
  }
  return { frames, keys }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** 帧 → 横条 PNG（RGBA·每格放大成 cell×cell 实心方块，不依赖 image-rendering）。返回 base64 data URI。 */
export function encodeStrip(frames, cell) {
  const w = frames.length * GRID * cell
  const h = GRID * cell
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1)
    raw[row] = 0
    const gy = Math.floor(y / cell)
    for (let x = 0; x < w; x++) {
      const fi = Math.floor(x / (GRID * cell))
      const gx = Math.floor((x % (GRID * cell)) / cell)
      const col = frames[fi][gy * GRID + gx]
      if (!col) continue
      const o = row + 1 + x * 4
      raw[o] = parseInt(col.slice(1, 3), 16)
      raw[o + 1] = parseInt(col.slice(3, 5), 16)
      raw[o + 2] = parseInt(col.slice(5, 7), 16)
      raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
  return 'data:image/png;base64,' + png.toString('base64')
}

/** 产物文本：lib/pixelBaked.ts（元数据 + 精灵图 data URI）与 components/px-anim/px-baked.wxss（每个图标一条 keyframes）。 */
export function buildOutputs(anims, darkMap) {
  const meta = {}
  const sprites = {}
  const css = []
  for (const name of Object.keys(PERIOD).sort()) {
    const period = PERIOD[name]
    const light = sample(anims[name], period)
    const dark = sample(anims[name], period, darkMap)
    meta[name] = { period, frames: light.frames.length, darkFrames: dark.frames.length }
    for (const [cell, isDark] of VARIANTS[name] || []) {
      const s = isDark ? dark : light
      sprites[`${name}-${cell}${isDark ? 'd' : ''}`] = encodeStrip(s.frames, cell)
    }
    // 帧数在明/暗底相同（换色只改颜色不会合并/拆分帧）——keyframes 共用一份，用 light 的 keys 即可；不同则以 dark 单独成份（断言见测试）
    const n = light.frames.length
    const pos = (f) => (n > 1 ? ((f / (n - 1)) * 100).toFixed(4).replace(/\.?0+$/, '') : '0') + '%'
    const kf = light.keys.map((k) => `${((k.t / period) * 100).toFixed(4).replace(/\.?0+$/, '') || '0'}%{background-position:${pos(k.f)} 0}`).join('')
    css.push(`@keyframes pxb-${name}{${kf}}\n.pxb-${name}{animation-name:pxb-${name};animation-duration:${period}ms}`)
  }
  const ts = `// 本文件由 scripts/gen-px-bake.mjs 生成，勿手改（改 lib/pixelAnim 或 scripts/lib/bake-px.mjs 的 VARIANTS 后重跑）。\n// 像素图标预渲染精灵图：键＝\`<图标>-<格边长>[d＝暗底]\`，值＝横条 PNG data URI；BAKED_FRAMES＝帧数（决定 background-size 宽度）。\nexport const BAKED_FRAMES: Record<string, number> = ${JSON.stringify(Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, v.frames])))}\nexport const BAKED_SPRITES: Record<string, string> = ${JSON.stringify(sprites, null, 2)}\n`
  const wxss = `/* 本文件由 scripts/gen-px-bake.mjs 生成，勿手改。像素图标预渲染动画：按帧切换用 step-end（每个关键帧保持到下一个关键帧）。 */\n.pxb{background-repeat:no-repeat;animation-timing-function:step-end;animation-iteration-count:infinite}\n.pxb-paused{animation-play-state:paused}\n${css.join('\n')}\n`
  return { ts, wxss, meta }
}
