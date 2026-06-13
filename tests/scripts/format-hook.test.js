import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { inScope, formatFile } from '../../scripts/format-hook.mjs'

// 守卫「格式交给工具」主张：编辑即由 prettier 按仓配置(.prettierrc.json)格式化，不靠人手动 npm run format。
const ROOT = resolve(import.meta.dirname, '../..')

// 临时文件建在仓内（让 prettier resolveConfig 能向上找到 .prettierrc.json），用后即删
let tmpDir
afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  tmpDir = null
})

describe('format-hook：编辑即格式化（指南「格式交给工具」机器化）', () => {
  it('inScope 与 npm run format 同范围：只认 packages/miniapp/src 下的 vue/js/scss/json', () => {
    const base = `${ROOT}/packages/miniapp/src`
    expect(inScope(`${base}/utils/format.js`)).toBe(true)
    expect(inScope(`${base}/pages/home/index.vue`)).toBe(true)
    expect(inScope(`${base}/manifest.json`)).toBe(true)
    // 越界 / 非治理类型一律放行（false）：云函数 ts、根脚本、static 资源
    expect(inScope(`${ROOT}/packages/cloud/src/functions/user/login.ts`)).toBe(false)
    expect(inScope(`${ROOT}/scripts/check-structure.mjs`)).toBe(false)
    expect(inScope(`${base}/static/icons/house.svg`)).toBe(false)
  })

  it('formatFile 按仓 .prettierrc.json 就地格式化（单引号 / 无分号 / 收紧空格）', async () => {
    tmpDir = mkdtempSync(join(ROOT, '.fmt-test-'))
    const f = join(tmpDir, 'a.js')
    writeFileSync(f, 'const  x   =  "hi" ;\n')
    expect(await formatFile(f)).toBe(true)
    expect(readFileSync(f, 'utf8')).toBe("const x = 'hi'\n")
  })

  it('formatFile 对已规范文件零改动（幂等，不冒犯工作树）', async () => {
    tmpDir = mkdtempSync(join(ROOT, '.fmt-test-'))
    const f = join(tmpDir, 'b.js')
    writeFileSync(f, "const x = 'hi'\n")
    expect(await formatFile(f)).toBe(false)
    expect(readFileSync(f, 'utf8')).toBe("const x = 'hi'\n")
  })
})
