#!/usr/bin/env node
// 像素图标预渲染生成器：lib/pixelAnim.ts 的 draw → 精灵图 + keyframes（核心见 scripts/lib/bake-px.mjs）。
// 产物：rewrite/mp/lib/pixelBaked.ts、rewrite/mp/components/px-anim/px-baked.wxss。改完 pixelAnim 必须重跑；
// tests/px-baked.test.ts 核对产物与本脚本一致，且逐毫秒与 draw 对拍。
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { buildOutputs } from './lib/bake-px.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = await build({ entryPoints: [root + 'rewrite/mp/lib/pixelAnim.ts'], bundle: true, format: 'esm', write: false })
const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
const { ts, wxss, meta } = buildOutputs(mod.PIXEL_ANIMS, mod.PIXEL_ANIM_DARK)
writeFileSync(root + 'rewrite/mp/lib/pixelBaked.ts', ts)
writeFileSync(root + 'rewrite/mp/components/px-anim/px-baked.wxss', wxss)
console.log('已生成', meta, `${Math.round(ts.length / 1024)}KB`)
