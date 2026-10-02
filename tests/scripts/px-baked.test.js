// 像素图标预渲染（lib/pixelBaked + px-baked.wxss）：产物必须与生成器一致、且逐毫秒与 lib/pixelAnim 的 draw 对拍。
// 改了 pixelAnim 却没重跑 `node scripts/gen-px-bake.mjs`，这里就红。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as bake from '../../scripts/lib/bake-px.mjs'
import { PIXEL_ANIMS, PIXEL_ANIM_DARK } from '../../rewrite/mp/lib/pixelAnim'
import { BAKED_FRAMES, BAKED_SPRITES } from '../../rewrite/mp/lib/pixelBaked'

const ROOT = join(__dirname, '../..')
const GRID = bake.GRID
const NAMES = Object.keys(bake.PERIOD)

function frameAt(draw, t, dark) {
  const cells = new Array(GRID * GRID).fill('')
  draw((fx, fy, col) => {
    const x = Math.round(fx)
    const y = Math.round(fy)
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return
    cells[y * GRID + x] = dark ? PIXEL_ANIM_DARK[col] || col : col
  }, t, null)
  return cells
}

describe('像素图标预渲染', () => {
  it('大白话：落盘的精灵图/动画样式和生成器现算的一模一样（没重跑生成器就红）', () => {
    const out = bake.buildOutputs(PIXEL_ANIMS, PIXEL_ANIM_DARK)
    expect(readFileSync(join(__dirname, '../../rewrite/mp/lib/pixelBaked.ts'), 'utf8')).toBe(out.ts)
    expect(readFileSync(join(ROOT, 'rewrite/mp/components/px-anim/px-baked.wxss'), 'utf8')).toBe(out.wxss)
  })

  it.each(NAMES)('大白话：%s 一个循环里每一毫秒，预渲染的帧和现画的一样；循环首尾无缝', (name) => {
    const T = bake.PERIOD[name]
    const draw = PIXEL_ANIMS[name]
    for (const dark of [false, true]) {
      const { frames, keys } = bake.sample(draw, T, dark ? PIXEL_ANIM_DARK : null)
      let k = 0
      for (let t = 0; t < T; t++) {
        while (k + 1 < keys.length && keys[k + 1].t <= t) k++
        expect(frames[keys[k].f], `${name} dark=${dark} t=${t}`).toEqual(frameAt(draw, t, dark))
      }
      // 周期性：t 与 t+T 画面相同（否则 CSS infinite 循环会在接缝处跳）
      for (const t of [0, 1, 137, T - 1]) expect(frameAt(draw, t + T, dark)).toEqual(frameAt(draw, t, dark))
    }
  })

  it('大白话：明底、暗底的切帧时刻一致（keyframes 共用一份）', () => {
    for (const name of NAMES) {
      const a = bake.sample(PIXEL_ANIMS[name], bake.PERIOD[name], null)
      const b = bake.sample(PIXEL_ANIMS[name], bake.PERIOD[name], PIXEL_ANIM_DARK)
      expect(b.keys, name).toEqual(a.keys)
    }
  })

  it('大白话：每张精灵图的宽高 = 帧数 × 13 × 格边长（组件按这个算 background-size）', () => {
    for (const [key, uri] of Object.entries(BAKED_SPRITES)) {
      const m = /^(\w+)-(\d+)d?$/.exec(key)
      const png = Buffer.from(uri.split(',')[1], 'base64')
      expect(png.readUInt32BE(16), key).toBe(BAKED_FRAMES[m[1]] * GRID * Number(m[2]))
      expect(png.readUInt32BE(20), key).toBe(GRID * Number(m[2]))
    }
  })

  it('大白话：页面里写死的 <px-anim>（非 truck、无进度）都有预渲染图——漏了会静悄悄退回 JS 逐帧', () => {
    const missing = []
    const walk = (d) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) walk(p)
        else if (n.endsWith('.wxml')) {
          for (const m of readFileSync(p, 'utf8').matchAll(/<px-anim\b([^>]*)>/g)) {
            const a = m[1]
            const name = /\bname="([a-z]+)"/.exec(a)?.[1]
            const size = /\bsize="(\d+)"/.exec(a)?.[1]
            if (!name || !size || name === 'truck' || /\bp="/.test(a)) continue
            const key = `${name}-${size}${/\bdark\b/.test(a.replace(/name="[^"]*"/, '')) ? 'd' : ''}`
            if (!BAKED_SPRITES[key]) missing.push(`${p}: ${key}`)
          }
        }
      }
    }
    walk(join(ROOT, 'rewrite/mp'))
    expect(missing).toEqual([])
  })
})
