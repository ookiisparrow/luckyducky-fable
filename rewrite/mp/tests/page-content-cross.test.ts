// pageContent 跨页并发缓存回归（课程链路审计 2026-07-17）：原实现用全局单计数器 token 判「过期回包」，
// A 页在途时 B 页发起会把 A 的成功回包判为过期、跳过缓存写入——弱网多页快速切换下 A 页每次回来都白拉。
// 同页乱序本就被 inflight 在途去重串行化（在途即复用、结算才清键），token 是纯误伤，已移除；本测钉死
// 「跨页并发在途互不打断彼此缓存」这一行为不变量。
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolvers: {} as Record<string, (v: unknown) => void>,
  fetchCount: {} as Record<string, number>,
}))
vi.mock('../api/catalog', () => ({
  getPageContent: (page: string) => {
    h.fetchCount[page] = (h.fetchCount[page] || 0) + 1
    return new Promise((resolve) => {
      h.resolvers[page] = resolve
    })
  },
}))

import { getPageContent, __resetForTest } from '../lib/pageContent'

beforeEach(() => {
  __resetForTest()
  h.resolvers = {}
  h.fetchCount = {}
})

describe('pageContent 跨页并发', () => {
  it('大白话：我的页内容还在路上时用户切去目录页——先发的那页回包照样进缓存，回来零重拉', async () => {
    const pA = getPageContent('mePage') // A 在途
    const pB = getPageContent('catalogPlayer') // B 后发（旧实现：全局 token 前进，A 的回包被判过期）
    h.resolvers['catalogPlayer']({ ok: true, content: { t: 'B' } })
    expect(await pB).toEqual({ t: 'B' })
    h.resolvers['mePage']({ ok: true, content: { t: 'A' } })
    expect(await pA).toEqual({ t: 'A' })
    // A 的成功回包必须已落缓存：再取零重拉（旧实现此处 fetchCount 变 2——本会话每次回 A 页都白拉一遍）
    expect(await getPageContent('mePage')).toEqual({ t: 'A' })
    expect(h.fetchCount['mePage']).toBe(1)
    expect(await getPageContent('catalogPlayer')).toEqual({ t: 'B' })
    expect(h.fetchCount['catalogPlayer']).toBe(1)
  })

  it('大白话：失败不缓存——下次再取真的会重试；在途并发同页只发一次请求', async () => {
    const p1 = getPageContent('welcome')
    const p2 = getPageContent('welcome') // 在途去重：复用同一 promise
    expect(h.fetchCount['welcome']).toBe(1)
    h.resolvers['welcome']({ ok: false, error: 'CALL_FAIL' })
    expect(await p1).toBeNull()
    expect(await p2).toBeNull()
    const p3 = getPageContent('welcome') // 失败未缓存 → 真重试
    expect(h.fetchCount['welcome']).toBe(2)
    h.resolvers['welcome']({ ok: true, content: { t: 'W' } })
    expect(await p3).toEqual({ t: 'W' })
  })
})
