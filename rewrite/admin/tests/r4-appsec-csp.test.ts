// #400-9：后台和坐席台的令牌都在同源 localStorage，页面得带 CSP 挡住注入脚本。
// 这里锁住「策略在、脚本只认本站、没被放宽成 unsafe-inline/unsafe-eval、写在任何脚本之前」。
// 真浏览器里不误拦的核对是一次性的（构建产物本地起服务+无头浏览器走全部路由），不进单测。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const pages = ['../index.html', '../../agent/index.html'].map((p) => readFileSync(new URL(p, import.meta.url), 'utf8'))

describe.each(pages.map((html, i) => [i ? 'agent' : 'admin', html]))('%s/index.html 的 CSP', (_name, html) => {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)

  it('有 CSP meta，而且排在所有 <script> 前面', () => {
    expect(m).not.toBeNull()
    expect(html.indexOf(m![0])).toBeLessThan(html.indexOf('<script'))
  })

  it("脚本只认本站，不放 unsafe-inline / unsafe-eval；插件、<base>、表单提交都关掉", () => {
    const csp = m![1]
    expect(csp).toMatch(/(^|;)\s*script-src 'self'\s*(;|$)/)
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/)
    expect(csp).toMatch(/object-src 'none'/)
    expect(csp).toMatch(/base-uri 'none'/)
    expect(csp).toMatch(/form-action 'none'/)
  })
})
