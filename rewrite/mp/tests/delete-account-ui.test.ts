// 「我」页删除资料：两次确认 + 上屏用首屏字体已有的字（「注销账」不在 tier1）。
import { describe, it, expect } from 'vitest'
import meTs from '../pages/me/me.ts?raw'
import meWxml from '../pages/me/me.wxml?raw'

function methodBody(src: string, name: string): string {
  const m = src.match(new RegExp(`${name}\\s*\\([^)]*\\)\\s*\\{`))
  if (!m || m.index == null) return ''
  const start = m.index + m[0].length - 1
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return ''
}

describe('删除资料入口（我的页·两次确认·首屏字体安全）', () => {
  it('大白话：已登录才露出「删除资料」；点下去要连确认两次才真删', () => {
    expect(meWxml).toContain('删除资料')
    expect(meWxml).toContain('bind:tap="onDeleteAccount"')
    expect(meWxml).toMatch(/wx:if="\{\{loggedIn\}\}"[^>]*onDeleteAccount|onDeleteAccount[^>]*wx:if="\{\{loggedIn\}\}"/)
    const body = methodBody(meTs, 'onDeleteAccount')
    expect(body.match(/wx\.showModal/g)?.length).toBe(2)
    expect(body).toContain("confirmText: '继续'")
    expect(body).toContain("confirmText: '删除'")
    expect(methodBody(meTs, 'runDeleteAccount')).toContain('deleteAccount()')
    expect(methodBody(meTs, 'runDeleteAccount')).toContain('clearAddresses()')
    expect(methodBody(meTs, 'runDeleteAccount')).toContain('loginGate.logout()')
  })

  it('大白话：第五条发票句在默认协议里；「我」页上屏不用「注销账户」四字（首屏字体没有注/销/账）', () => {
    expect(meWxml.replace(/<!--[\s\S]*?-->/g, '')).not.toContain('注销账户')
    expect(meTs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')).not.toMatch(/['"`][^'"`]*注销账户/)
  })
})
