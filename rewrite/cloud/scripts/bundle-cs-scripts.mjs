/**
 * 把 scriptPool POOL_HINTS 用到的 kfCallback/cs-scripts/*.md 打成 scriptAssets.generated.json。
 * 未进池的文档（README / 设计笔记 / 空映射库）不打进函数 zip。
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = import.meta.dirname
const KF = join(ROOT, '..', 'src', 'functions', 'cs', 'kfCallback')
const SRC = join(KF, 'cs-scripts')
const OUT = join(KF, 'scriptAssets.generated.json')
const poolSrc = readFileSync(join(KF, 'scriptPool.ts'), 'utf8')
const live = new Set([...poolSrc.matchAll(/file:\s*'([^']+\.md)'/g)].map((m) => m[1]))
if (!live.size) throw new Error('bundle-cs-scripts: no POOL_HINTS files in scriptPool.ts')

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (e.endsWith('.md')) acc.push(p)
  }
  return acc
}

const files = walk(SRC).filter((p) => live.has(relative(SRC, p).replace(/\\/g, '/')))
const obj = {}
for (const p of files) obj[relative(SRC, p).replace(/\\/g, '/')] = readFileSync(p, 'utf8')
writeFileSync(OUT, JSON.stringify(obj) + '\n')
console.log(`bundled ${files.length} cs-scripts → scriptAssets.generated.json`)
