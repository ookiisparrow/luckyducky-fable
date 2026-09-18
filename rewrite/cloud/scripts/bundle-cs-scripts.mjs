/**
 * 把 kfCallback/cs-scripts/*.md 打成 scriptAssets.generated.json（构建时内联，运行时不拉 GitHub）。
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = import.meta.dirname
const SRC = join(ROOT, '..', 'src', 'functions', 'cs', 'kfCallback', 'cs-scripts')
const OUT = join(ROOT, '..', 'src', 'functions', 'cs', 'kfCallback', 'scriptAssets.generated.json')

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (e.endsWith('.md')) acc.push(p)
  }
  return acc
}

const files = walk(SRC)
const obj = {}
for (const p of files) obj[relative(SRC, p).replace(/\\/g, '/')] = readFileSync(p, 'utf8')
writeFileSync(OUT, JSON.stringify(obj) + '\n')
console.log(`bundled ${files.length} cs-scripts → scriptAssets.generated.json`)
