import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseExpectedIndexes } from '../../scripts/lib/index-check.mjs'

// #400-32：「代码 → 03 复合索引期望表」方向的核对。扫 rewrite/cloud/src 里带 where 又带排序的查询形状：
//   ① 链式 .collection(COLLECTIONS.x)…where({…})…orderBy('f')
//   ② 分页助手 fn(db, COLLECTIONS.x, filter, 'f', …)（pageQuery / readWindow 都是这个签名）
// 登记判据（最笨的前缀规则）：where 的键 + 排序列（去掉主键 _id）恰好是 03 表该集合某条索引的前几列（不计顺序）。
// where 是变量、读不出键时退一步：该集合至少有一条索引含排序列。where 为 {} 的纯排序读按 03 排除项不查。
// 只认字面量集合名与字面量排序列；动态拼的查询（kit/paging 内部）扫不到，这是已知盲区。

const ROOT = process.cwd()
const SRC = join(ROOT, 'rewrite', 'cloud', 'src')
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.ts') ? [join(d, n)] : []))
// 去注释：注释里的示例查询不算。行注释只认前面不是冒号/引号的 //，免得切断字符串里的 URL
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// s[i] 是开括号，回括号里的文本（不管字符串里的括号，查询参数里没有）
function inner(s, i) {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if ('({['.includes(s[j])) depth++
    else if (')}]'.includes(s[j]) && --depth === 0) return s.slice(i + 1, j)
  }
  return ''
}
// 按顶层逗号切
function splitTop(s) {
  const out = []
  let depth = 0
  let cur = ''
  for (const c of s) {
    if ('({['.includes(c)) depth++
    if (')}]'.includes(c)) depth--
    if (c === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}
// where 参数 → 键数组；不是对象字面量、或有展开/计算键，回 null（读不出形状）
function whereKeys(arg) {
  const t = arg.trim()
  if (!t.startsWith('{')) return null
  const keys = []
  for (const part of splitTop(inner(t, 0))) {
    const m = part.match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(?::|$)/)
    if (!m) return null
    keys.push(m[1] || m[2] || m[3])
  }
  return keys
}

function scanQueryShapes() {
  const shapes = []
  for (const file of walk(SRC)) {
    const s = stripComments(readFileSync(file, 'utf8'))
    const where = relative(SRC, file)
    for (const m of s.matchAll(/\.collection\(\s*COLLECTIONS\.(\w+)\s*\)/g)) {
      const rest = s.slice(m.index + m[0].length)
      const end = rest.search(/\.(get|count|update|remove|add|end|doc|set)\(|\.collection\(/)
      const chain = end < 0 ? rest : rest.slice(0, end)
      const w = chain.indexOf('.where(')
      const o = chain.match(/\.orderBy\(\s*'(\w+)'/)
      if (w < 0 || !o) continue
      shapes.push({ file: where, coll: m[1], keys: whereKeys(inner(chain, w + '.where'.length)), order: o[1] })
    }
    for (const m of s.matchAll(/\b\w+\(\s*\w+\s*,\s*COLLECTIONS\.(\w+)\s*,/g)) {
      const args = splitTop(inner(s, m.index + m[0].indexOf('(')))
      const order = (args[3] || '').match(/^'(\w+)'$/)
      if (!order) continue
      shapes.push({ file: where, coll: m[1], keys: whereKeys(args[2]), order: order[1] })
    }
  }
  return shapes
}

function registered(shape, byCollection) {
  const idx = (byCollection.get(shape.coll) || []).map((i) => i.fields.map((f) => f.name).filter((n) => n !== '_id'))
  if (!shape.keys) return shape.order === '_id' || idx.some((names) => names.includes(shape.order))
  const need = new Set([...shape.keys, shape.order].filter((n) => n !== '_id'))
  return idx.some((names) => names.length >= need.size && names.slice(0, need.size).every((n) => need.has(n)))
}

describe('03 复合索引期望表：代码里的 where+排序查询都已登记', () => {
  const md = readFileSync(join(ROOT, 'console-assets', '03-复合索引期望表.md'), 'utf8')
  const { byCollection } = parseExpectedIndexes(md)
  const shapes = scanQueryShapes()

  it('扫描器真扫到了查询（防空集合恒绿）', () => {
    expect(shapes.length).toBeGreaterThan(30)
    expect(shapes).toContainEqual({ file: 'functions/timers/recallScan.ts', coll: 'activations', keys: ['enteredAt'], order: 'enteredAt' })
    expect(shapes).toContainEqual({ file: 'functions/adminApi/actions/reconciliation.ts', coll: 'orders', keys: ['status'], order: 'paidAt' })
  })

  it('每个形状在 03 表里都有前缀对得上的索引（新增查询先登记再上线）', () => {
    const missing = shapes
      .filter((x) => !(x.keys && x.keys.length === 0) && !registered(x, byCollection))
      .map((x) => `${x.file} · ${x.coll} where{${x.keys ? x.keys.join(',') : '?'}} orderBy ${x.order}`)
    expect(missing).toEqual([])
  })

  it('判据自检：前缀对不上就算没登记', () => {
    const t = new Map([['c', [{ fields: [{ name: 'a' }, { name: 'b' }, { name: '_id' }] }]]])
    expect(registered({ coll: 'c', keys: ['a'], order: 'b' }, t)).toBe(true)
    expect(registered({ coll: 'c', keys: [], order: 'a' }, t)).toBe(true)
    expect(registered({ coll: 'c', keys: ['b'], order: 'b' }, t)).toBe(false) // b 不在第一列，前缀用不上
    expect(registered({ coll: 'c', keys: ['a', 'x'], order: 'b' }, t)).toBe(false)
    expect(registered({ coll: 'c', keys: null, order: 'b' }, t)).toBe(true)
    expect(registered({ coll: 'c', keys: null, order: 'z' }, t)).toBe(false)
    expect(registered({ coll: 'other', keys: ['a'], order: 'b' }, t)).toBe(false)
  })
})
