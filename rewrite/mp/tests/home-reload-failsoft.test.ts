// G1（P1·bug）home.reload() 失败清空已渲染商品轨：getAllProducts({force:true}) 失败返 null →
// 此前 mapProducts(null) 得 [] → 与已渲染非空 products 不同 → patch.products=[] 清屏，误导「上新在路上」
// 空态。修复同 detail.ts loadRecs fail-soft 范式：products===null 时不计算/不写入 patch.products，保留现状。
// 源码扫描式断言（同 home-intent.test.ts 范式·rewrite/mp tsconfig 无 node:fs·E1 教训剥注释防假绿）。
import { describe, it, expect } from 'vitest'
import homeSrc from '../pages/home/home.ts?raw'

/** 剥单行注释与块注释（E1 教训：裸写正则会被注释文本假命中）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** 截取「从某方法声明起、花括号配平到该方法体结束」的源码片段（剥注释后·同 home-intent.test.ts helper）。 */
function methodBody(rawSrc: string, name: string): string {
  const src = stripComments(rawSrc)
  const start = new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:function\\s+)?${name}\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\{`).exec(src)
  if (!start) throw new Error(`未找到方法 ${name}`)
  let depth = 0
  let i = start.index + start[0].length - 1 // 落在起始 `{`
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return src.slice(start.index, i + 1)
}

describe('home.reload() 失败清空已渲染商品轨 fail-soft（G1）', () => {
  it('大白话：products 为 null（本次强刷失败）时不计算/不写入 patch.products——保留已渲染现状不动，不清屏', () => {
    const body = methodBody(homeSrc, 'reload')
    // nextProducts 门控计算：null 时不跑 mapProducts（同 detail.ts loadRecs 的 if (list) 范式）
    expect(body).toMatch(/products\s*!==\s*null\s*\?\s*mapProducts\(products\)\s*:\s*null/)
    // 写入门控：patch.products 只在 nextProducts 非 null 时才赋值
    expect(body).toMatch(/nextProducts\s*!==\s*null\s*&&[\s\S]{0,80}patch\.products\s*=\s*nextProducts/)
  })

  it('大白话：loadFailed 判据不受本次改动影响——仍是 products===null && !_hadSnapshot（本批只动 products 分支）', () => {
    const body = methodBody(homeSrc, 'reload')
    expect(body).toMatch(/loadFailed:\s*products\s*===\s*null\s*&&\s*!this\._hadSnapshot/)
  })
})
