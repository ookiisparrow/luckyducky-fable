#!/usr/bin/env node
// 货车巡航预渲染生成器：lib/pixelTruck 的 sprite → 精灵图 + 动画样式（核心见 scripts/lib/bake-truck.mjs）。
// 产物：rewrite/mp/lib/truckBaked.ts、rewrite/mp/components/px-truck/truck-baked.wxss。改了 pixelTruck 的巡航画面/节拍必须重跑；
// tests/scripts/truck-baked.test.js 核对产物与本脚本一致。
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { buildTruckOutputs } from './lib/bake-truck.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = await build({ entryPoints: [root + 'rewrite/mp/lib/pixelTruck.ts'], bundle: true, format: 'esm', write: false })
const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
const { ts, wxss, frames } = buildTruckOutputs(mod)
writeFileSync(root + 'rewrite/mp/lib/truckBaked.ts', ts)
writeFileSync(root + 'rewrite/mp/components/px-truck/truck-baked.wxss', wxss)
console.log('已生成', frames, `${Math.round(ts.length / 1024)}KB`)
