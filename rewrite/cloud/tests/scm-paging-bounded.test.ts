// SCM 列表分页收口守卫（B1·根因#7·债 #159 评审遗留#1）：listPurchases/listOutworks/listAssemblies/
// listSuppliers（scmMaterials.ts）/listStockLedger（kit/scmStock.ts）五处只读列表必须走 kit
// pageQuery，禁回退成裸 `.limit(cap)` 直取封顶（旧写法一超上限就把旧单永久挤出）。
//
// 守卫结构抄既有源码扫描型守卫（rewrite/admin/tests/scm-ui.test.ts 的 `?raw` 源文本 + 正则断言范式，
// 本文件因跨多个后端文件改用 node:fs 直读，效果同）：读源文件文本 → 剥注释（防注释里出现
// `.limit(`/`pageQuery(` 字样把断言唬成假绿——同 E1「裸写正则咬到注释」）→ 按函数声明切片（防同文件
// 其余合法仍保留裸 limit 的函数，如 listMaterials/listMaterialDocs，被误扫进本函数的断言范围）→
// 断言目标函数体内「调了 pageQuery」且「不再直接 .limit()」。
//
// 反向自检：把任一目标函数的 `pageQuery(...)` 手工改回 `.limit(cap)` 直取 → 对应用例立即红；改回即绿。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = (p: string) => join(HERE, '..', 'src', p)

/** 剥单行注释与块注释（E1 教训：裸写正则会被注释文本假命中）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** 截取「从某导出函数声明起、到下一个指名函数声明前（或文件末尾）」的源码片段（剥注释后）——
 *  防同文件其余合法保留裸 limit 的函数被误扫进本函数的断言范围。 */
function funcSlice(rawSrc: string, name: string, until: string[] = []): string {
  const src = stripComments(rawSrc)
  const start = new RegExp(`(export\\s+)?async\\s+function\\s+${name}\\s*\\(`).exec(src)
  if (!start) throw new Error(`未找到函数 ${name}`)
  let end = src.length
  for (const u of until) {
    const m = new RegExp(`(export\\s+)?async\\s+function\\s+${u}\\s*\\(`).exec(src.slice(start.index + 1))
    if (m) end = Math.min(end, start.index + 1 + m.index)
  }
  return src.slice(start.index, end)
}

const purchaseSrc = readFileSync(SRC('functions/adminApi/actions/scmPurchase.ts'), 'utf8')
const outworkSrc = readFileSync(SRC('functions/adminApi/actions/scmOutwork.ts'), 'utf8')
const assemblySrc = readFileSync(SRC('functions/adminApi/actions/scmAssembly.ts'), 'utf8')
const materialsSrc = readFileSync(SRC('functions/adminApi/actions/scmMaterials.ts'), 'utf8')
const scmStockSrc = readFileSync(SRC('kit/scmStock.ts'), 'utf8')

describe('SCM 列表分页收口（B1·根因#7）：5 处列表读走 pageQuery、禁裸 .limit() 直取封顶', () => {
  it('大白话：scmPurchase.listPurchases 调 pageQuery，函数体内无残留裸 .limit()', () => {
    const body = funcSlice(purchaseSrc, 'listPurchases', ['savePurchase'])
    expect(body).toMatch(/pageQuery\(/)
    expect(body).not.toMatch(/\.limit\(/)
  })

  it('大白话：scmOutwork.listOutworks 调 pageQuery，函数体内无残留裸 .limit()；BAD_STATUS 校验仍在场', () => {
    const body = funcSlice(outworkSrc, 'listOutworks', ['saveOutwork'])
    expect(body).toMatch(/pageQuery\(/)
    expect(body).not.toMatch(/\.limit\(/)
    expect(body).toMatch(/BAD_STATUS/)
  })

  it('大白话：scmAssembly.listAssemblies 调 pageQuery，函数体内无残留裸 .limit()', () => {
    const body = funcSlice(assemblySrc, 'listAssemblies', [])
    expect(body).toMatch(/pageQuery\(/)
    expect(body).not.toMatch(/\.limit\(/)
  })

  it('大白话：scmMaterials.listSuppliers 调 pageQuery（defaultLimit 200=现行上限），函数体内无残留裸 .limit()；listMaterials 刻意不收口仍保持全量', () => {
    const body = funcSlice(materialsSrc, 'listSuppliers', ['saveSupplier'])
    expect(body).toMatch(/pageQuery\(/)
    expect(body).toMatch(/200/)
    expect(body).not.toMatch(/\.limit\(/)
    const materialsBody = funcSlice(materialsSrc, 'listMaterials', ['saveMaterial'])
    expect(materialsBody).not.toMatch(/pageQuery\(/) // 明确不收口（picker 全量语义·主档规模有界）
  })

  it('大白话：kit/scmStock.ts listStockLedger 调 pageQuery，函数体内无残留裸 .limit()；写路径 applyStockMoves/casChange 不受影响', () => {
    const body = funcSlice(scmStockSrc, 'listStockLedger', ['sumLedgerByItemKey'])
    expect(body).toMatch(/pageQuery\(/)
    expect(body).not.toMatch(/\.limit\(/)
    const applyBody = funcSlice(scmStockSrc, 'applyStockMoves', ['casChange'])
    expect(applyBody).not.toMatch(/pageQuery\(/) // 门1 写路径本批不动
  })
})
