/**
 * 把 kfCallback/atomic-v1 打成 csAtomicAssets.generated.json（构建时内联，运行时不拉 GitHub）。
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = import.meta.dirname
const SRC = join(ROOT, '..', 'src', 'functions', 'cs', 'kfCallback', 'atomic-v1')
const OUT = join(ROOT, '..', 'src', 'functions', 'cs', 'kfCallback', 'csAtomicAssets.generated.json')

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

const files = {}
for (const p of walk(join(SRC, 'lib'))) {
  if (!p.endsWith('.txt')) continue
  const rel = relative(join(SRC, 'lib'), p).replace(/\\/g, '/').replace(/\.txt$/, '')
  files[rel] = readFileSync(p, 'utf8')
}

const sequences = {}
for (const p of walk(join(SRC, 'sequences'))) {
  if (!p.endsWith('.json')) continue
  const seq = JSON.parse(readFileSync(p, 'utf8'))
  sequences[seq.id] = seq
}

writeFileSync(
  OUT,
  JSON.stringify({
    id: 'atomic-v1',
    route: JSON.parse(readFileSync(join(SRC, 'route.json'), 'utf8')),
    sequences,
    files,
  }) + '\n'
)
console.log(`bundled atomic-v1 (${Object.keys(files).length} atoms, ${Object.keys(sequences).length} sequences) → csAtomicAssets.generated.json`)
