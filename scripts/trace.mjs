#!/usr/bin/env node
/**
 * 需求爆炸半径（P2 · 需求→守卫闭环）
 * 正查：npm run trace -- R4        → R4 牵动的 函数 / 测试 / 守卫
 * 反查：npm run trace -- --fn confirmEnter      → 哪些需求碰这个函数
 *       npm run trace -- --guard fen-money-chain → 哪些需求靠这个守卫
 * 数据源：docs/需求清单.md「需求→实现映射」表（由 requirement-trace 守卫保完整且 resolve）。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const req = readFileSync(join(ROOT, 'docs/需求清单.md'), 'utf8')

const cells = (s) => s.split(/[,，、]/).map((x) => x.trim().replace(/`/g, '')).filter(Boolean)
const mapSec = req.split('## 需求→实现映射')[1] || ''
const rows = [...mapSec.matchAll(/^\|\s*(R\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/gm)].map(
  ([, R, kind, fns, tests, guards]) => ({ R, kind: kind.trim(), fns: cells(fns), tests: cells(tests), guards: cells(guards) })
)
const desc = (R) => {
  const m = req.match(new RegExp(`^\\|\\s*\\*{0,2}${R}\\b[^|]*\\|\\s*([^|]+?)\\s*\\|`, 'm'))
  return m ? m[1].replace(/\*\*/g, '').trim().slice(0, 56) : ''
}

const a = process.argv[2]
if (!a) {
  console.log('用法：npm run trace -- R4  |  npm run trace -- --fn confirmEnter  |  npm run trace -- --guard fen-money-chain')
  process.exit(0)
}
if (a === '--fn' || a === '--guard') {
  const key = process.argv[3] || ''
  const field = a === '--fn' ? 'fns' : 'guards'
  const hits = rows.filter((r) => r[field].includes(key))
  console.log(`🔎 碰「${key}」的需求（${hits.length}）：`)
  for (const r of hits) console.log(`  ${r.R}  ${desc(r.R)}`)
  if (!hits.length) console.log('  （无——核对名字，或它不在映射里）')
} else {
  const r = rows.find((x) => x.R === a)
  if (!r) {
    console.log(`无 ${a} 的实现映射（R0/L2 占位无实现，或编号错）`)
    process.exit(0)
  }
  console.log(`💥 ${r.R} [${r.kind}]  ${desc(r.R)}`)
  console.log(`   函数：${r.fns.join(', ') || '—'}`)
  console.log(`   测试：${r.tests.join(', ') || '—'}`)
  console.log(`   守卫：${r.guards.join(', ') || '—'}`)
}
