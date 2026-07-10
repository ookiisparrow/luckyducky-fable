// bug 清除战役 II 批H（三 pattern 全量清扫）H1 源码断言：表单误关族（admin·await 恢复点后无条件清/复位共享编辑态）。
// 取真源（@vue/compiler-sfc parse <script setup> 原文·花括号配平抽函数体）断言四处修复落在真代码里，不是另抄一份
// 影子实现。helper 抄自 rewrite/admin/tests/admin-races-g-batch.test.ts（跨文件不共享，Rule of Three 未到——
// 执行者错题本 E1 同款共享 helper 纪律只对 check-structure.mjs 守卫本体生效）。
import { describe, it, expect } from 'vitest'
import { parse } from '@vue/compiler-sfc'
import scmPurchaseSrc from '../src/pages/ScmPurchase.vue?raw'
import scmOutworkSrc from '../src/pages/ScmOutwork.vue?raw'
import scmMaterialsSrc from '../src/pages/ScmMaterials.vue?raw'
import productsSrc from '../src/pages/Products.vue?raw'

// 抠出指定函数的完整函数体（花括号配平·跳过注释/字符串内的花括号，防 E1 同类坑）。只服务本文件的静态断言。
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

describe('ScmPurchase.vue doSave() 快照编辑目标（H1·必修 1/4）', () => {
  it('大白话：回包后核对仍是发起时那张草稿才写反馈/清空表单，过期回包不打到新表单上；列表刷新照旧无条件', () => {
    const body = extractFunctionBody(scriptSetupSrc(scmPurchaseSrc), 'async function doSave() {')
    expect(body).toMatch(/const snap = f\b/)
    const snapIdx = body.indexOf('const snap = f')
    const ifRe = /if\s*\(\s*form\.value === snap\s*\)\s*\{/
    expect(body).toMatch(ifRe)
    const ifIdx = body.search(ifRe)
    expect(ifIdx).toBeGreaterThan(snapIdx)
    const noteIdx = body.indexOf('note(r.ok,', ifIdx)
    const clearIdx = body.indexOf('if (r.ok) form.value = null', ifIdx)
    const reloadIdx = body.indexOf('void reload()')
    expect(noteIdx).toBeGreaterThan(ifIdx) // note() 落在快照核对分支内
    expect(clearIdx).toBeGreaterThan(noteIdx) // 清表单也在分支内
    expect(reloadIdx).toBeGreaterThan(clearIdx) // reload 保持无条件、落在分支外之后
    // 旧「无条件」写法不再存在
    expect(body).not.toMatch(/scmErrorText\(r\.error\)\)\n\s*if \(r\.ok\) form\.value = null\n\s*void reload/)
  })
})

describe('ScmOutwork.vue doSave() 快照编辑目标（H1·必修 2/4）', () => {
  it('大白话：同文件 doRecv 已有 forId 快照参照——doSave 补齐同款：回包后核对仍是发起时那张草稿才写反馈/清空表单', () => {
    const body = extractFunctionBody(scriptSetupSrc(scmOutworkSrc), 'async function doSave() {')
    expect(body).toMatch(/const snap = f\b/)
    const snapIdx = body.indexOf('const snap = f')
    const ifRe = /if\s*\(\s*form\.value === snap\s*\)\s*\{/
    expect(body).toMatch(ifRe)
    const ifIdx = body.search(ifRe)
    expect(ifIdx).toBeGreaterThan(snapIdx)
    const noteIdx = body.indexOf('note(r.ok,', ifIdx)
    const clearIdx = body.indexOf('if (r.ok) form.value = null', ifIdx)
    const reloadIdx = body.indexOf('void reload()')
    expect(noteIdx).toBeGreaterThan(ifIdx)
    expect(clearIdx).toBeGreaterThan(noteIdx)
    expect(reloadIdx).toBeGreaterThan(clearIdx)
    expect(body).not.toMatch(/scmErrorText\(r\.error\)\)\n\s*if \(r\.ok\) form\.value = null\n\s*void reload/)
  })
})

describe('ScmMaterials.vue doSaveSupplier() 快照编辑目标（H1·必修 3/4）', () => {
  it('大白话：回包后核对仍是发起时那位供应商才写反馈/复位表单，过期回包不打到新表单上（且 note 用快照身份判断新建/更新文案）', () => {
    const body = extractFunctionBody(scriptSetupSrc(scmMaterialsSrc), 'async function doSaveSupplier() {')
    expect(body).toMatch(/const snap = supForm\.value/)
    const snapIdx = body.indexOf('const snap = supForm.value')
    const ifRe = /if\s*\(\s*supForm\.value === snap\s*\)\s*\{/
    expect(body).toMatch(ifRe)
    const ifIdx = body.search(ifRe)
    expect(ifIdx).toBeGreaterThan(snapIdx)
    const noteIdx = body.indexOf('note(r.ok,', ifIdx)
    const resetIdx = body.indexOf('if (r.ok) resetSupForm()', ifIdx)
    const reloadIdx = body.indexOf('void reload()')
    expect(noteIdx).toBeGreaterThan(ifIdx)
    expect(resetIdx).toBeGreaterThan(noteIdx)
    expect(reloadIdx).toBeGreaterThan(resetIdx)
    // note 用 snap（快照）判断文案，不读回包后可能已属别位供应商的 supForm.value
    expect(body).toMatch(/note\(r\.ok, snap\.supplierId \? '供应商已更新' : '供应商已保存', scmErrorText\(r\.error\)\)/)
    expect(body).not.toMatch(/scmErrorText\(r\.error\)\)\n\s*if \(r\.ok\) resetSupForm\(\)\n\s*void reload/)
  })
})

describe('Products.vue doSave() 快照编辑目标（H1·完备性扫描新增 4/4）', () => {
  it('大白话：编辑器非遮罩、列表「编辑」按钮无 busy 门控——回包后核对仍是发起时那件商品才关编辑器/发 saved 事件，过期回包不打到新打开的编辑器上；列表刷新按 ok 无条件', () => {
    const body = extractFunctionBody(scriptSetupSrc(productsSrc), 'async function doSave() {')
    expect(body).toMatch(/const snap = edit\.value/)
    const snapIdx = body.indexOf('const snap = edit.value')
    const ifRe = /if\s*\(\s*edit\.value === snap\s*\)\s*\{/
    expect(body).toMatch(ifRe)
    const ifIdx = body.search(ifRe)
    expect(ifIdx).toBeGreaterThan(snapIdx)
    const messageIdx = body.indexOf("message.value = ok ? '' : '保存失败：请重试'", ifIdx)
    const clearIdx = body.indexOf('edit.value = null', ifIdx)
    const emitIdx = body.indexOf("emit('saved')", ifIdx)
    const reloadIdx = body.lastIndexOf('void reload()')
    expect(messageIdx).toBeGreaterThan(ifIdx) // message 落在快照核对分支内
    expect(clearIdx).toBeGreaterThan(messageIdx)
    expect(emitIdx).toBeGreaterThan(clearIdx)
    expect(reloadIdx).toBeGreaterThan(emitIdx) // reload 落在分支外之后，按 ok 无条件（与目标是否已切无关）
    expect(body).toMatch(/if \(ok\) void reload\(\)/)
    // 旧「无条件」写法不再存在
    expect(body).not.toMatch(/message\.value = ok \? '' : '保存失败：请重试'\n\s*if \(ok\) \{\n\s*editorLoaded = false\n\s*edit\.value = null\n\s*void reload\(\)\n\s*emit\('saved'\)/)
  })
})

describe('Products.vue pickCover() 快照上传目标（Round4 复审补漏·H1 完备性扫描漏点名）', () => {
  it('大白话：openEdit/列表「编辑」按钮无 busy 门控——压缩/上传 await 期间已切到另一件商品的编辑器，回包不得写进新编辑器的 cover 字段', () => {
    const body = extractFunctionBody(scriptSetupSrc(productsSrc), 'async function pickCover(ev: Event) {')
    expect(body).toMatch(/const snap = edit\.value/)
    const snapIdx = body.indexOf('const snap = edit.value')
    expect(body).toMatch(/uploadImage\(b64, String\(snap\.id\), 'jpg'\)/) // 用快照身份、不读可能已换目标的 edit.value.id
    const ifRe = /if\s*\(\s*edit\.value === snap\s*\)\s*\{/
    expect(body).toMatch(ifRe)
    const ifIdx = body.search(ifRe)
    expect(ifIdx).toBeGreaterThan(snapIdx)
    const coverIdx = body.indexOf('edit.value.cover =', ifIdx)
    const failIdx = body.indexOf("message.value = '图片上传失败：'", ifIdx)
    expect(coverIdx).toBeGreaterThan(ifIdx) // 写 cover 落在快照核对分支内
    expect(failIdx).toBeGreaterThan(ifIdx) // 失败反馈同样落在分支内
    // 旧「无条件」写法（`if (r.ok) {` 顶格紧跟在 busy.value=false 之后、外层无快照核对包裹）不再存在
    expect(body).not.toMatch(/busy\.value = false\n\s*if \(r\.ok\) \{/)
  })
})

describe('Products.vue addImages() 快照上传目标（Round4 复审补漏·H1 完备性扫描漏点名）', () => {
  it('大白话：多图循环内每次 await 都可能已切到另一件商品的编辑器——回包不得把图塞进新编辑器的 images 数组', () => {
    const body = extractFunctionBody(scriptSetupSrc(productsSrc), 'async function addImages(ev: Event) {')
    expect(body).toMatch(/const snap = edit\.value/)
    const snapIdx = body.indexOf('const snap = edit.value')
    expect(body).toMatch(/uploadImage\(b64, String\(snap\.id\), 'jpg'\)/)
    const ifRe = /if\s*\(\s*edit\.value === snap\s*\)\s*\{/
    expect(body).toMatch(ifRe)
    const ifIdx = body.search(ifRe)
    expect(ifIdx).toBeGreaterThan(snapIdx)
    const pushIdx = body.indexOf('(edit.value.images as string[]).push', ifIdx)
    const failIdx = body.indexOf("message.value = '有图上传失败：'", ifIdx)
    expect(pushIdx).toBeGreaterThan(ifIdx)
    expect(failIdx).toBeGreaterThan(ifIdx)
    // 旧「无条件」写法（`if (r.ok && r.fileID) {` 直接紧跟 uploadImage 回包、外层无快照核对包裹）不再存在
    expect(body).not.toMatch(/uploadImage\(b64, String\(edit\.value\.id\), 'jpg'\)/) // 旧写法读实时 edit.value.id，新写法读快照 snap.id
  })
})
