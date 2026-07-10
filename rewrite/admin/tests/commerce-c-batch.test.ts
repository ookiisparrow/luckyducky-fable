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
  // I2（防线·执行者错题本 E1 在测试层的翻版）：返回值须是剥去注释后的函数体，不是原始切片——原始切片里
  // 若「保护代码被注释掉」，注释文本本身仍会命中 toMatch/indexOf 正则，断言假绿。逐字符扫描时同步攒 out，
  // 跳过注释段（行注释/块注释不写入 out），字符串字面量内容原样保留（断言认代码 token，不认字符串内容）。
  let out = ''
  for (let j = braceStart; j < src.length; j++) {
    const c = src[j]
    const c2 = src[j + 1]
    if (inLineComment) {
      if (c === '\n') {
        inLineComment = false
        out += c
      }
      continue
    }
    if (inBlockComment) {
      if (c === '*' && c2 === '/') {
        inBlockComment = false
        j++
      } else if (c === '\n') {
        out += c
      }
      continue
    }
    if (inString) {
      out += c
      if (c === '\\') {
        j++
        out += src[j] ?? ''
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
      out += c
      continue
    }
    if (c === '{') {
      depth++
      out += c
    } else if (c === '}') {
      depth--
      out += c
      if (depth === 0) return out
    } else {
      out += c
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

describe('Products.vue closeEditor 补存失败不静默（F3·P1·bug 清除战役II）', () => {
  it('大白话：关闭前的最后快照补存必须消费返回值——失败给提示且不 emit(saved)；只有真保存成功才 emit(saved)', () => {
    const body = extractFunctionBody(scriptSetupSrc(productsSrc), 'function closeEditor() {')
    // then 回调须带上 r（消费返回值，不是原来那种不带参数、无条件 emit 的写法）
    const thenRe = /\.then\(\(r\)\s*=>\s*\{/
    expect(body).toMatch(thenRe)
    const thenIdx = body.search(thenRe)
    const okBranchRe = /if\s*\(\s*r\.ok\s*\)\s*\{/
    expect(body).toMatch(okBranchRe)
    const okBranchIdx = body.search(okBranchRe)
    expect(okBranchIdx).toBeGreaterThan(thenIdx)
    const elseIdx = body.indexOf('} else {', okBranchIdx)
    expect(elseIdx).toBeGreaterThan(okBranchIdx)
    const emitIdx = body.indexOf("emit('saved')", okBranchIdx)
    expect(emitIdx).toBeGreaterThan(okBranchIdx)
    expect(emitIdx).toBeLessThan(elseIdx) // emit 只落在成功分支内
    const messageIdx = body.indexOf('message.value =', elseIdx)
    expect(messageIdx).toBeGreaterThan(elseIdx) // 失败分支给出提示，不静默
    // 旧写法（.then 不带参数、无条件 emit）不再存在
    expect(body).not.toMatch(/\.then\(\(\)\s*=>\s*\{\s*void silentRefresh/)
  })
})

describe('Products.vue closeEditor 失败提示补 openEditGen 代际锚（N1·P3·bug 清除战役II 遗留）', () => {
  it('大白话：openEditGen++ 之后要快照 myGen，异步补存失败时只有仍是本代才写 message，不得晚落地误标到期间新开的编辑器屏上', () => {
    const body = extractFunctionBody(scriptSetupSrc(productsSrc), 'function closeEditor() {')
    // openEditGen++ 之后紧接着快照 myGen（同文件 openEdit 既有代际模式）
    const bumpIdx = body.indexOf('openEditGen++')
    expect(bumpIdx).toBeGreaterThanOrEqual(0)
    const snapRe = /const myGen = openEditGen/
    expect(body).toMatch(snapRe)
    const snapIdx = body.search(snapRe)
    expect(snapIdx).toBeGreaterThan(bumpIdx) // 快照落在自增之后，取到的是本次关闭这一代
    // 失败分支的 message.value 赋值必须被 openEditGen === myGen 复核包住
    const okBranchIdx = body.search(/if\s*\(\s*r\.ok\s*\)\s*\{/)
    const elseIdx = body.indexOf('} else {', okBranchIdx)
    const guardRe = /if\s*\(\s*openEditGen === myGen\s*\)\s*message\.value = /
    expect(body).toMatch(guardRe)
    const guardIdx = body.search(guardRe)
    expect(guardIdx).toBeGreaterThan(elseIdx) // 复核闸落在失败分支内
    // 成功分支的 silentRefresh/emit 保持无条件（幂等刷新 + emit 语义与编辑器代际无关，读现场判断保留）
    const emitIdx = body.indexOf("emit('saved')", okBranchIdx)
    expect(emitIdx).toBeGreaterThan(okBranchIdx)
    expect(emitIdx).toBeLessThan(elseIdx) // emit 落在成功分支内、在 else（失败分支）之前——不被代际闸包住
  })
})
