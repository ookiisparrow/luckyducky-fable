// bug 清除战役 II 批G 源码断言（G1–G6·跨目标竞态家族）：取真源（@vue/compiler-sfc parse <script setup> 原文·
// 花括号配平抽函数体）断言六处修复落在真代码里，不是另抄一份影子实现。helper 抄自
// rewrite/admin/tests/commerce-c-batch.test.ts 的 scriptSetupSrc()+extractFunctionBody()（跨文件不共享，
// Rule of Three 未到——执行者错题本 E1 同款共享 helper 纪律只对 check-structure.mjs 守卫本体生效）。
import { describe, it, expect } from 'vitest'
import { parse } from '@vue/compiler-sfc'
import batchesSrc from '../src/pages/Batches.vue?raw'
import coursesSrc from '../src/pages/Courses.vue?raw'
import scmOutworkSrc from '../src/pages/ScmOutwork.vue?raw'
import inventorySrc from '../src/pages/Inventory.vue?raw'
import scmBomSrc from '../src/pages/ScmBom.vue?raw'
import scmPlannerSrc from '../src/pages/ScmPlanner.vue?raw'

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

describe('Batches.vue load() 乱序守卫（G1·P1）', () => {
  it('大白话：load() 套 useLatest 代际，旧回包不再把 loadedCourse 污染成错课·防 doCreate 错课量产激活码', () => {
    const src = scriptSetupSrc(batchesSrc)
    expect(src).toMatch(/const loadGen = useLatest\(\)/)
    const body = extractFunctionBody(src, 'async function load() {')
    expect(body).toMatch(/const my = loadGen\.begin\(\)/)
    const beginIdx = body.indexOf('loadGen.begin()')
    const staleIdx = body.search(/if\s*\(\s*loadGen\.isStale\(my\)\s*\)\s*return/)
    expect(staleIdx).toBeGreaterThan(beginIdx) // 先取号后判过期
    const rowsIdx = body.indexOf('rows.value =')
    const loadedCourseIdx = body.indexOf('loadedCourse.value =')
    expect(rowsIdx).toBeGreaterThan(staleIdx) // 三处回写都落在 isStale 判断之后
    expect(loadedCourseIdx).toBeGreaterThan(staleIdx)
  })
})

describe('Courses.vue pickVideo() 纳入上传锁 + 删段重定位（G2·P1）', () => {
  it('大白话：单段上传期间锁批量标志（load()/UI 同步拦截），写回前核对段是否仍在数组里', () => {
    const src = scriptSetupSrc(coursesSrc)
    // 签名扩到三参 (l, sg, ev)
    const body = extractFunctionBody(src, 'async function pickVideo(l: Record<string, any>, sg: Record<string, any>, ev: Event) {')
    expect(body).toMatch(/batchUploading\.value = true/)
    expect(body).toMatch(/setUploadLock\(\)/)
    // 锁必须落在 try/finally 里、失败也能解锁
    expect(body).toMatch(/finally\s*\{[\s\S]*batchUploading\.value = false[\s\S]*clearUploadLock\(\)[\s\S]*\}/)
    // 写回前的引用重定位判据
    const guardRe = /if\s*\(\s*!l\.segments\.includes\(sg\)\s*\)\s*\{/
    expect(body).toMatch(guardRe)
    const guardIdx = body.search(guardRe)
    const writeIdx = body.indexOf('sg.videoFileId = r.fileId')
    expect(writeIdx).toBeGreaterThan(guardIdx) // 写回落在重定位判据之后
    // 模板调用点同步扩参（模板在 <template> 块、不在 <script setup>，对整份原文断言）
    expect(coursesSrc).toMatch(/@change="\(e\) => pickVideo\(l, sg, e\)"/)
    expect(coursesSrc).not.toMatch(/@change="\(e\) => pickVideo\(sg, e\)"/) // 旧两参调用点不再存在
  })
})

describe('ScmOutwork.vue doRecv() 快照目标（G3·P2）', () => {
  it('大白话：回包后核对仍是发起时那张收货单才写反馈/清理表单，过期回包不打到新表单上；列表刷新照旧无条件', () => {
    const body = extractFunctionBody(scriptSetupSrc(scmOutworkSrc), 'async function doRecv() {')
    expect(body).toMatch(/const forId = recvFor\.value/)
    const snapIdx = body.indexOf('const forId = recvFor.value')
    const ifRe = /if\s*\(\s*recvFor\.value === forId\s*\)\s*\{/
    expect(body).toMatch(ifRe)
    const ifIdx = body.search(ifRe)
    expect(ifIdx).toBeGreaterThan(snapIdx)
    const noteIdx = body.indexOf('note(r.ok,', ifIdx)
    const cancelIdx = body.indexOf('cancelRecv()', ifIdx)
    const reloadIdx = body.indexOf('void reload()')
    expect(noteIdx).toBeGreaterThan(ifIdx) // note() 落在快照核对分支内
    expect(cancelIdx).toBeGreaterThan(noteIdx) // cancelRecv() 也在分支内
    expect(reloadIdx).toBeGreaterThan(cancelIdx) // reload 保持无条件、落在分支外之后
    // 旧「无条件」写法不再存在（note/cancelRecv 紧跟 await 后、无判断包裹）
    expect(body).not.toMatch(/scmErrorText\(r\.error\)\)\n\s*if \(r\.ok\) cancelRecv\(\)\n\s*void reload/)
  })
})

describe('Inventory.vue doSave() 快照 editKey（G4·P2）', () => {
  it('大白话：成功后只在仍是发起时那行才清 editKey，不顶掉新打开的行内编辑；失败提示不受影响', () => {
    const body = extractFunctionBody(scriptSetupSrc(inventorySrc), 'async function doSave(row: Row) {')
    expect(body).toMatch(/const key = editKey\.value/)
    const snapIdx = body.indexOf('const key = editKey.value')
    const clearRe = /if\s*\(\s*editKey\.value === key\s*\)\s*editKey\.value = ''/
    expect(body).toMatch(clearRe)
    const clearIdx = body.search(clearRe)
    expect(clearIdx).toBeGreaterThan(snapIdx)
    // 旧「无条件清空」写法不再存在
    expect(body).not.toMatch(/if \(r\.ok\) \{\n\s*editKey\.value = ''/)
  })
})

describe('ScmBom.vue doPreview() 乱序守卫（G5·P2）', () => {
  it('大白话：doPreview 套 useLatest 代际，旧回包不再把 watch(run) 已深清的预演表重新灌回', () => {
    const src = scriptSetupSrc(scmBomSrc)
    expect(src).toMatch(/const previewGen = useLatest\(\)/)
    const body = extractFunctionBody(src, 'async function doPreview() {')
    const beginIdx = body.indexOf('previewGen.begin()')
    expect(beginIdx).toBeGreaterThan(-1)
    const staleIdx = body.search(/if\s*\(\s*previewGen\.isStale\(my\)\s*\)\s*return/)
    expect(staleIdx).toBeGreaterThan(beginIdx)
    const previewIdx = body.indexOf('preview.value =')
    const noteIdx = body.indexOf('note(r.ok,')
    expect(previewIdx).toBeGreaterThan(staleIdx) // preview/note 均在 isStale 判断之后才写
    expect(noteIdx).toBeGreaterThan(staleIdx)
  })

  it('大白话：watch(run) 改目标时也调用 previewGen.begin()，同步作废在途旧预演请求——否则旧回包晚到时代际号未变、isStale 判「不过期」，会把 watch 刚清空的 preview 重新灌回（复审补漏）', () => {
    const src = scriptSetupSrc(scmBomSrc)
    const watchIdx = src.indexOf('watch(run, () => {')
    expect(watchIdx).toBeGreaterThan(-1)
    const endIdx = src.indexOf('}, { deep: true })', watchIdx)
    expect(endIdx).toBeGreaterThan(watchIdx)
    const body = src.slice(watchIdx, endIdx)
    expect(body).toMatch(/preview\.value = \[\]/)
    expect(body).toMatch(/previewGen\.begin\(\)/)
  })
})

describe('ScmOutwork.vue more() 乱序守卫（D4·战役3 批D·同 ScmPurchase.vue 判例）', () => {
  it('大白话：reload 套 useLatest begin/isStale，more() 用 peek 绑定当前代际（不递增，防与 reload 互杀）、回包过期即丢弃、append/cursor 写入落在复核之后', () => {
    const src = scriptSetupSrc(scmOutworkSrc)
    expect(src).toMatch(/const listGen = useLatest\(\)/)
    const reloadBody = extractFunctionBody(src, 'async function reload() {')
    const reloadBeginIdx = reloadBody.indexOf('listGen.begin()')
    expect(reloadBeginIdx).toBeGreaterThan(-1)
    const reloadStaleIdx = reloadBody.search(/if\s*\(\s*listGen\.isStale\(my\)\s*\)\s*return/)
    expect(reloadStaleIdx).toBeGreaterThan(reloadBeginIdx)
    const ordersIdx = reloadBody.indexOf('orders.value =')
    expect(ordersIdx).toBeGreaterThan(reloadStaleIdx) // 回写落在过期判断之后

    const moreBody = extractFunctionBody(src, 'async function more() {')
    const peekIdx = moreBody.indexOf('listGen.peek()')
    expect(peekIdx).toBeGreaterThan(-1)
    const moreStaleIdx = moreBody.search(/if\s*\(\s*listGen\.isStale\(gen\)\s*\)\s*return/)
    expect(moreStaleIdx).toBeGreaterThan(peekIdx)
    const appendIdx = moreBody.indexOf('orders.value = [...orders.value')
    const cursorIdx = moreBody.indexOf('cursor.value = r.nextCursor')
    expect(appendIdx).toBeGreaterThan(moreStaleIdx) // append 复核后才写
    expect(cursorIdx).toBeGreaterThan(moreStaleIdx) // cursor 复核后才写
  })
})

describe('ScmPlanner.vue calc() 乱序守卫（G6·P2）', () => {
  it('大白话：calc 套 useLatest 代际，并发多次点「算缺口」旧回包不覆盖新请求的 plan', () => {
    const src = scriptSetupSrc(scmPlannerSrc)
    expect(src).toMatch(/const calcGen = useLatest\(\)/)
    const body = extractFunctionBody(src, 'async function calc() {')
    const beginIdx = body.indexOf('calcGen.begin()')
    expect(beginIdx).toBeGreaterThan(-1)
    const staleIdx = body.search(/if\s*\(\s*calcGen\.isStale\(my\)\s*\)\s*return/)
    expect(staleIdx).toBeGreaterThan(beginIdx)
    const planIdx = body.indexOf('plan.value =')
    expect(planIdx).toBeGreaterThan(staleIdx)
  })
})
