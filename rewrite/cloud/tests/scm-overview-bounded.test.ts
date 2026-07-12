// SCM 总览有界查询守卫（批 B2·根因#7/#8）：getScmOverview 本文件内直接发起的每条数据库查询链——
// 只要该链调用了 `.get()`，就必须在同一条链上也带 `.limit(`（禁止裸取封顶外的无界扫描）；计数
// 一律走 `.count()`（精确·不受 limit 影响·不编数）。
//
// 守卫结构抄既有源码扫描型守卫（rewrite/cloud/tests/scm-paging-bounded.test.ts 的 stripComments+
// funcSlice 范式，本文件按「查询链」而非「函数声明」再切一层）：读源文件文本 → 剥注释（防 E1 注释假绿）
// → 取 getScmOverview 函数体切片 → 按 `db.collection(` 切成一条条查询链 → 逐链核验含 `.get()` 的链必含
// `.limit(`；并核验 inTransit 计数确实调了 `.count()`（非全量拉取内存数）。
//
// 反向自检：把 PAYABLE_SCAN_CAP 那条链的 `.limit(PAYABLE_SCAN_CAP)` 删掉 → 本文件用例立即红；改回即绿。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src', 'functions', 'adminApi', 'actions', 'scmOverview.ts')

/** 剥单行注释与块注释（E1 教训：裸写正则会被注释文本假命中）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** 截取「从某导出函数声明起到文件末尾」的源码片段（剥注释后）——本文件只有一个 action，无需 until 边界。 */
function funcSlice(rawSrc: string, name: string): string {
  const src = stripComments(rawSrc)
  const start = new RegExp(`(export\\s+)?async\\s+function\\s+${name}\\s*\\(`).exec(src)
  if (!start) throw new Error(`未找到函数 ${name}`)
  return src.slice(start.index)
}

/** 按 `db.collection(` 切成一条条查询链（每条从此关键字起到下一条同关键字前）。 */
function chains(body: string): string[] {
  const idxs = [...body.matchAll(/db\.collection\(/g)].map((m) => m.index as number)
  return idxs.map((start, i) => body.slice(start, i + 1 < idxs.length ? idxs[i + 1] : body.length))
}

const raw = readFileSync(SRC, 'utf8')
const body = funcSlice(raw, 'getScmOverview')

describe('SCM 总览有界查询（批 B2·根因#7/#8）：getScmOverview 每条 .get() 查询链带 .limit()，计数走 .count()', () => {
  it('大白话：本文件内直发的每条 db.collection(...) 查询链，只要含 .get() 就必须同链带 .limit(', () => {
    const cs = chains(body)
    expect(cs.length).toBeGreaterThan(0) // 断言本身没扫空（防切片逻辑失效导致假绿）
    for (const c of cs) {
      if (/\.get\(\)/.test(c)) expect(c).toMatch(/\.limit\(/)
    }
  })

  it('大白话：应付未结扫描链、materials 主档读取、流水最近 8 条、供应商查找都在场且各自有界', () => {
    expect(body).toMatch(/listMaterialDocs\(\)/) // 主档经门1 只读出口（内部已 bounded）
    expect(body).toMatch(/outworkOrders['"]\)\s*\.where\(\{\s*status:\s*OUTWORK_ORDER_STATUS\.DELIVERED\s*\}\)\s*\.limit\(/)
    expect(body).toMatch(/COLLECTIONS\.stockLedger\)\s*\.orderBy\(['"]at['"],\s*['"]desc['"]\)\s*\.limit\(/)
    expect(body).toMatch(/COLLECTIONS\.suppliers\)\s*\.limit\(/)
  })

  it('大白话：在途采购/外协计数与应付扫描总量核验走 .count()，不是拉全量数组数长度', () => {
    expect(body).toMatch(/purchaseOrders['"]\)\s*\.where\(\{\s*status:\s*PURCHASE_ORDER_STATUS\.ORDERED\s*\}\)\s*\.count\(\)/)
    expect(body).toMatch(/outworkOrders['"]\)\s*\.where\(\{\s*status:\s*OUTWORK_ORDER_STATUS\.ISSUED\s*\}\)\s*\.count\(\)/)
    expect(body).toMatch(/outworkOrders['"]\)\s*\.where\(\{\s*status:\s*OUTWORK_ORDER_STATUS\.DELIVERED\s*\}\)\s*\.count\(\)/)
  })
})
