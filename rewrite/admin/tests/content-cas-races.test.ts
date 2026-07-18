// 内容域并发安全前端接线（批A·守卫 rw-admin-content-cas-races·根因#1 乐观并发 + #8 乱序响应）：
// 取真源（@vue/compiler-sfc parse <script setup> 原文·花括号配平抽函数体·剥注释防 E1/E10 假绿）断言
// 三页接 rev/baseRev + DRAFT_CONFLICT 乱序闸真落在代码里，不是另抄影子实现。helper 抄自
// rewrite/admin/tests/admin-races-g-batch.test.ts（跨文件不共享·Rule of Three 未到·同 E1 纪律只对守卫本体生效）。
import { describe, it, expect } from 'vitest'
import { parse } from '@vue/compiler-sfc'
import coursesSrc from '../src/pages/Courses.vue?raw'
import checkpointsSrc from '../src/pages/Checkpoints.vue?raw'
import helpVideosSrc from '../src/pages/HelpVideos.vue?raw'
import contentApiSrc from '../src/api/content.ts?raw'
import csApiSrc from '../src/api/cs.ts?raw'

// 抠出指定函数完整函数体（花括号配平·跳过并剥去注释/字符串内花括号·防 E1/E10 注释假绿）。仅服务本文件静态断言。
function extractFunctionBody(src: string, signature: string): string {
  const start = src.indexOf(signature)
  if (start === -1) throw new Error('函数签名未找到：' + signature)
  const braceStart = signature.trimEnd().endsWith('{') ? start + signature.length - 1 : src.indexOf('{', start + signature.length)
  if (braceStart === -1) throw new Error('函数体起始 { 未找到：' + signature)
  let depth = 0
  let inLineComment = false
  let inBlockComment = false
  let inString: string | null = null
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

describe('api 层透传 baseRev（乐观并发·批A）', () => {
  it('大白话：saveHelpVideos/saveCheckpoints 都透传 baseRev 供后端 CAS 比对', () => {
    expect(contentApiSrc).toMatch(/saveHelpVideos\s*=\s*\(items:\s*unknown\[\],\s*baseRev\?:\s*number\)/)
    expect(contentApiSrc).toMatch(/client\.post\('saveHelpVideos',\s*\{\s*items,\s*baseRev\s*\}\)/)
    expect(csApiSrc).toMatch(/saveCheckpoints\s*=\s*\(courseId:\s*string,\s*nodes:\s*unknown\[\],\s*baseRev\?:\s*number\)/)
    expect(csApiSrc).toMatch(/client\.post\('saveCheckpoints',\s*\{\s*courseId,\s*nodes,\s*baseRev\s*\}\)/)
  })
})

describe('Courses.vue load() 乱序守卫（批A·同 Batches G1）', () => {
  it('大白话：load() 套 useLatest 代际，旧回包不再把 course.value 污染成错课', () => {
    const src = scriptSetupSrc(coursesSrc)
    expect(src).toMatch(/const loadGen = useLatest\(\)/)
    const body = extractFunctionBody(src, 'async function load() {')
    const beginIdx = body.indexOf('loadGen.begin()')
    expect(beginIdx).toBeGreaterThan(-1)
    const staleIdx = body.search(/if\s*\(\s*loadGen\.isStale\(my\)\s*\)\s*return/)
    expect(staleIdx).toBeGreaterThan(beginIdx) // 先取号后判过期
    const writeIdx = body.indexOf('course.value =')
    expect(writeIdx).toBeGreaterThan(staleIdx) // 回写落在 isStale 判断之后
  })
})

describe('Checkpoints.vue load() 乱序守卫 + DRAFT_CONFLICT（批A）', () => {
  it('大白话：load() 套 useLatest，旧回包不再把 nodes 污染成错课', () => {
    const src = scriptSetupSrc(checkpointsSrc)
    expect(src).toMatch(/const loadGen = useLatest\(\)/)
    const body = extractFunctionBody(src, 'async function load() {')
    const beginIdx = body.indexOf('loadGen.begin()')
    expect(beginIdx).toBeGreaterThan(-1)
    const staleIdx = body.search(/if\s*\(\s*loadGen\.isStale\(my\)\s*\)\s*return/)
    expect(staleIdx).toBeGreaterThan(beginIdx)
    const writeIdx = body.indexOf('nodes.value =')
    expect(writeIdx).toBeGreaterThan(staleIdx)
  })
  it('大白话：save() 带 baseRev；DRAFT_CONFLICT 提示重载不自动 reload 不丢编辑', () => {
    const src = scriptSetupSrc(checkpointsSrc)
    const body = extractFunctionBody(src, 'async function save() {')
    expect(body).toMatch(/saveCheckpoints\(loadedCourseId\.value,\s*payload,\s*baseRev\.value\)/)
    expect(body).toMatch(/DRAFT_CONFLICT/)
  })
  it('大白话：save() 只在 r.ok/GC_REMOVE_FAIL 刷 baseRev——DRAFT_CONFLICT 回包也带 rev=curRev，若照刷基线，用户二次点击「保存整课」CAS 会通过、静默覆盖别处刚保存的策展（本批要防的场景·对齐姊妹页 HelpVideos）', () => {
    const src = scriptSetupSrc(checkpointsSrc)
    const body = extractFunctionBody(src, 'async function save() {')
    // 基线刷新必须被 r.ok/GC_REMOVE_FAIL 门控——不得裸 if (typeof r.rev === 'number') 无条件刷（DRAFT_CONFLICT 也带 rev 会被误刷）
    expect(body).toMatch(/if \(r\.ok \|\| r\.error === 'GC_REMOVE_FAIL'\) baseRev\.value =/)
    expect(body).not.toMatch(/if \(typeof r\.rev === 'number'\) baseRev\.value = r\.rev/)
    // 纵深防御：save() 顶部守卫含 conflicted，冲突未重载前不再发保存
    expect(body).toMatch(/if \(busy\.value \|\| !loadedCourseId\.value \|\| conflicted\.value\) return/)
  })
})

describe('HelpVideos.vue 乐观并发接线（批A）', () => {
  it('大白话：flushSave 带 baseRev；DRAFT_CONFLICT 停自动保存显式提示、不循环重试覆盖', () => {
    const src = scriptSetupSrc(helpVideosSrc)
    expect(src).toMatch(/const conflicted = ref\(false\)/)
    expect(src).toMatch(/saveHelpVideos\(items\.value,\s*baseRev\.value\)/)
    expect(src).toMatch(/DRAFT_CONFLICT/)
    // 冲突态阻断自动保存链（不得循环重试覆盖）
    const flushBody = extractFunctionBody(src, 'const flushSave = serialSave(async () => {')
    expect(flushBody).toMatch(/conflicted\.value/)
  })
  it('大白话：flushSave 在 GC_DELETE_FAIL 也刷 baseRev（与手动 save 一致）——漏刷会让下次自动保存拿旧 baseRev 撞出自造的假 DRAFT_CONFLICT、永久锁死自动保存链', () => {
    const src = scriptSetupSrc(helpVideosSrc)
    const flushBody = extractFunctionBody(src, 'const flushSave = serialSave(async () => {')
    // 成功 + GC_DELETE_FAIL 同门刷基线（后端 GC_DELETE_FAIL 回包已 bump rev）；不得只认 r.ok 把 GC_DELETE_FAIL 落进 else error 支不刷 rev
    expect(flushBody).toMatch(/if \(r\.ok \|\| r\.error === 'GC_DELETE_FAIL'\) \{/)
    expect(flushBody).toMatch(/baseRev\.value = Number\(r\.rev\)/)
  })
})
