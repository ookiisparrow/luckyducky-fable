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
})
