import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useContentStore } from '@/store/content.js'
import { TRUST_ITEMS } from '@/data/trust.js'
import { FAQ_ITEMS } from '@/data/faq.js'

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  delete globalThis.wx
})

describe('content store（首页内容：云端编辑 + 本地默认兜底）', () => {
  it('无云（H5 / 测试环境）：hero/trust/faq 全回退本地默认', async () => {
    const s = useContentStore()
    await s.load()
    expect(s.hero.title).toBe('创造幸运')
    expect(s.trust).toEqual(TRUST_ITEMS)
    expect(s.faq).toEqual(FAQ_ITEMS)
  })

  it('云端有内容：按块覆盖；空块仍用默认（防误清空线上）', async () => {
    globalThis.wx = {
      cloud: {
        callFunction: async () => ({
          result: { ok: true, home: { hero: { title: '六月上新', tagline: '' }, trust: [], faq: [{ title: 'Q', body: 'A' }] } },
        }),
      },
    }
    const s = useContentStore()
    await s.load()
    expect(s.hero.title).toBe('六月上新')
    expect(s.hero.tagline).toBe('Get ducky get lucky') // 空字段回退默认
    expect(s.trust).toEqual(TRUST_ITEMS) // 空数组回退默认
    expect(s.faq).toEqual([{ title: 'Q', body: 'A' }])
  })
})
