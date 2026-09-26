// 扫码落地页明文 Scheme 的 PATH 必须是小程序已登记页（没有 pages/welcome/index）。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const landing = readFileSync(new URL('../public/q/index.html', import.meta.url), 'utf8')
const appJson = JSON.parse(
  readFileSync(new URL('../../mp/app.json', import.meta.url), 'utf8'),
) as { pages: string[] }

describe('扫码落地页拉起路径', () => {
  it('大白话：一键打开小程序必须落到已登记的欢迎页 pages/welcome/welcome，不能写不存在的 pages/welcome/index', () => {
    expect(landing).toContain("var PATH = 'pages/welcome/welcome'")
    expect(landing).not.toContain('pages/welcome/index')
    expect(appJson.pages).toContain('pages/welcome/welcome')
    expect(appJson.pages).not.toContain('pages/welcome/index')
  })

  it('大白话：印刷码以路径形 /q/<激活码> 为准，这页不给搜索引擎收录', () => {
    expect(landing).toContain('<meta name="robots" content="noindex">')
    expect(landing).toContain('/q/<激活码>')
    expect(landing).not.toContain('/q/?code=')
    expect(landing).toContain('兼容 ?code=')
  })
})
