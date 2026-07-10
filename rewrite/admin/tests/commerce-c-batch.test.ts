// bug 清除战役 II 批C 源码断言（C1/C2/C3·守卫源见 execution spec，非独立黄金基准）：
// 取真源（@vue/compiler-sfc parse <script setup> 原文·花括号配平抽函数体）断言三处修复落在真代码里，
// 不是另抄一份影子实现。helper 抄自 rewrite/agent/tests/desk.test.ts 的 scriptSetupSrc()+extractFunctionBody()
// （跨包不共享，Rule of Three 未到——执行者错题本 E1 同款共享 helper 纪律只对 check-structure.mjs 守卫本体生效）。
import { describe, it, expect } from 'vitest'
import { parse } from '@vue/compiler-sfc'
import fulfillSrc from '../src/pages/Fulfill.vue?raw'
import reconciliationSrc from '../src/pages/Reconciliation.vue?raw'
import productsSrc from '../src/pages/Products.vue?raw'

// 抠出指定函数的完整函数体（花括号配平·跳过注释/字符串内的花括号，防 E1 同类坑：裸括号计数被注释/字符串里的
// { } 带偏）。只服务本文件的静态断言，不是 check-structure.mjs 的守卫 helper，不冒充共享实现。
function extractFunctionBody(src: string, signature: string): string {
  const start = src.indexOf(signature)
  if (start === -1) throw new Error('函数签名未找到：' + signature)
  const braceStart = signature.trimEnd().endsWith('{') ? start + signature.length - 1 : src.indexOf('{', start + signature.length)
  if (braceStart === -1) throw new Error('函数体起始 { 未找到：' + signature)
  let depth = 0
  let inLineComment = false
  let inBlockComment = false
  let inString: string | null = null
  for (let j = braceStart; j < src.length; j++) {
    const c = src[j]
    const c2 = src[j + 1]
    if (inLineComment) {
      if (c === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (c === '*' && c2 === '/') {
        inBlockComment = false
        j++
      }
      continue
    }
    if (inString) {
      if (c === '\\') {
        j++
        continue
      }
      if (c === inString) inString = null
      continue
    }
    if (c === '/' && c2 === '/') {
      inLineComment = true
      j++
      continue
    }
    if (c === '/' && c2 === '*') {
      inBlockComment = true
      j++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(braceStart, j + 1)
    }
  }
  throw new Error('函数体未闭合：' + signature)
}

function scriptSetupSrc(raw: string): string {
  const { descriptor } = parse(raw)
  if (!descriptor.scriptSetup?.content) throw new Error('缺少 <script setup> 块——测试抽不到真代码')
  return descriptor.scriptSetup.content
}

describe('Fulfill.vue doShip 在途闸带反馈（C1·P1）', () => {
  it('大白话：在途期第二枪不再静默 return——必须调 say() 告诉操作员这一枪没生效', () => {
    const body = extractFunctionBody(scriptSetupSrc(fulfillSrc), 'async function doShip(order: FulfillOrder, trackingNo: string) {')
    const guardRe = /if\s*\(\s*shipping\.value\s*\)\s*\{/
    expect(body).toMatch(guardRe)
    const guardIdx = body.search(guardRe)
    const sayIdx = body.indexOf("say('上一单发货还在处理中")
    const returnIdx = body.indexOf('return', guardIdx)
    expect(sayIdx).toBeGreaterThan(guardIdx) // say( 调用落在闸分支内
    expect(returnIdx).toBeGreaterThan(sayIdx) // 先反馈再 return，不是裸 return
    expect(body).not.toMatch(/if\s*\(\s*shipping\.value\s*\)\s*return\b/) // 旧裸 return 写法不再存在
  })
})

describe('Reconciliation.vue reload 分路报错（C2·P1）', () => {
  it('大白话：内部对账/外部勾对分别判失败，各自报——不被另一路成功清空', () => {
    const body = extractFunctionBody(scriptSetupSrc(reconciliationSrc), 'async function reload() {')
    expect(body).toMatch(/if\s*\(\s*!recon\.value\s*\)\s*bad\.push\(\s*'内部对账加载失败/)
    expect(body).toMatch(/if\s*\(\s*!match\.value\s*\)\s*bad\.push\(\s*'外部账单勾对加载失败/)
    expect(body).toMatch(/message\.value = bad\.join\(/)
    // 旧「任一成功即清空 message」的写法不再存在
    expect(body).not.toMatch(/recon\.value \|\| match\.value \? '' :/)
  })
})

describe('Products.vue editCourse 并入 serialSave 队列（C3·P1）', () => {
  it('大白话：编辑器正开着同一商品时走 flushSave（latest-wins），不再旁路直发旧快照 row.raw', () => {
    const body = extractFunctionBody(scriptSetupSrc(productsSrc), 'async function editCourse(row: DraftRowVM) {')
    const sameEditRe = /if\s*\(\s*edit\.value\s*&&\s*String\(edit\.value\.id\)\s*===\s*row\.id\s*\)\s*\{/
    expect(body).toMatch(sameEditRe)
    const sameEditIdx = body.search(sameEditRe)
    const flushIdx = body.indexOf('await flushSave()')
    const elseIdx = body.indexOf('} else {', sameEditIdx)
    const saveDraftIdx = body.indexOf('await saveDraft(', elseIdx)
    expect(flushIdx).toBeGreaterThan(sameEditIdx) // 同商品分支内调用 flushSave
    expect(flushIdx).toBeLessThan(elseIdx) // flushSave 调用落在 if 分支、不在 else 分支
    expect(saveDraftIdx).toBeGreaterThan(elseIdx) // else 分支（编辑器未开本品）才旁路直发 saveDraft(row.raw...)
    expect(body).toMatch(/edit\.value\.courseId = cid/) // 既有行为保留：先同步快照 courseId
  })
})
