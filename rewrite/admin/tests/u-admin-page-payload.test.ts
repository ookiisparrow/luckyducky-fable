// 表单被编辑后再出 payload：限长、封顶、mePage 空 label 回落默认名都必须照样生效（payload 复用 normalize 的锁）。
import { describe, it, expect } from 'vitest'
import {
  normalizeWelcome,
  welcomePayload,
  normalizeCatalogPlayer,
  catalogPlayerPayload,
  normalizeMePage,
  mePagePayload,
  normalizeAbout,
  aboutPayload,
  normalizeAgreement,
  agreementPayload,
} from '../src/lib/mapPageContent'

describe('payload 对编辑后的表单模型再裁一次', () => {
  it('超长字符串按各自限长截断', () => {
    const w = normalizeWelcome(null)
    w.w1.sub = 's'.repeat(200)
    w.w2.items.push({ title: 't'.repeat(99), desc: 'd'.repeat(3000) })
    const pw = welcomePayload(w) as any
    expect(pw.w1.sub).toHaveLength(120)
    expect(pw.w2.items[0]).toEqual({ title: 't'.repeat(60), desc: 'd'.repeat(2000) })

    const c = normalizeCatalogPlayer(null)
    c.catalog.resumeCta = 'r'.repeat(50)
    c.help.faq.push({ q: 'q'.repeat(130), a: 'a'.repeat(1100) })
    const pc = catalogPlayerPayload(c) as any
    expect(pc.catalog.resumeCta).toHaveLength(40)
    expect(pc.help.faq[0]).toEqual({ q: 'q'.repeat(120), a: 'a'.repeat(1000) })

    const a = normalizeAbout(null)
    a.lead = 'l'.repeat(300)
    a.sections.push(...Array.from({ length: 12 }, () => ({ title: 'x', body: 'y' })))
    const pa = aboutPayload(a) as any
    expect(pa.lead).toHaveLength(200)
    expect(pa.sections).toHaveLength(10)
  })

  it('mePage：label 清空回落默认名、超长截到 60、昵称截到 20、visible 原样', () => {
    const m = normalizeMePage(null)
    m.defaultNickname = 'n'.repeat(30)
    m.entries[0].label = ''
    m.entries[1].label = 'L'.repeat(70)
    m.entries[2].visible = false
    const p = mePagePayload(m) as any
    expect(p.defaultNickname).toHaveLength(20)
    expect(p.entries[0]).toEqual({ key: 'courses', label: '全部教程', visible: true })
    expect(p.entries[1].label).toHaveLength(60)
    expect(p.entries[2].visible).toBe(false)
  })

  it('agreement：段落封顶 30、版本号截到 20、history 不进 payload', () => {
    const m = normalizeAgreement(null)
    m.user.version = 'v'.repeat(25)
    m.privacy.sections.push(...Array.from({ length: 31 }, () => ({ title: 't', body: 'b' })))
    m.history.push({ part: 'user', version: 'v1', at: 'x' })
    const p = agreementPayload(m) as any
    expect(p.user.version).toHaveLength(20)
    expect(p.privacy.sections).toHaveLength(30)
    expect(Object.keys(p).sort()).toEqual(['privacy', 'user'])
  })
})
