// 套装介绍页售后 FAQ 带发票句（与小程序用户协议第五条同句）。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const kits = readFileSync(new URL('../src/pages/kits.astro', import.meta.url), 'utf8')

describe('官网套装页售后 FAQ', () => {
  it('大白话：现有 FAQ 里有一条售后/发票，原句「如需发票，请联系客服。」', () => {
    expect(kits).toContain('如需发票，请联系客服。')
    expect(kits).toContain('售后怎么申请？需要发票怎么办？')
    expect(kits).toContain('除新疆、内蒙古、西藏外包邮')
    expect(kits).toContain('确认进课后该件不可退')
    expect(kits).not.toContain('材料包')
    expect(kits).not.toMatch(/满\s*¥?\s*100\s*包邮/)
    expect(kits).not.toContain('全场包邮')
  })

  it('大白话：四条问答人看得见（<details>），不是只塞进 JSON-LD 给机器', () => {
    expect(kits).toContain('<details>')
    expect(kits).toContain('<summary>{f.q}</summary>')
    expect(kits).toContain('<p>{f.a}</p>')
    expect(kits).toContain('pairs.map')
    expect(kits).toContain('faqSchema(pairs)')
  })
})
