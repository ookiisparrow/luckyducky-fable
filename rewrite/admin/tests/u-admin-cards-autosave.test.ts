// @vitest-environment happy-dom
// Cards.vue 防抖自动保存已落盘后离页，不再重复提交 saveCard（同 page-content-save「自动保存已完成，离签不再重复提交」）。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { saveCardMock } = vi.hoisted(() => ({ saveCardMock: vi.fn() }))
vi.mock('../src/api/products', () => ({
  getCard: vi.fn().mockResolvedValue({ ok: true, card: null }),
  saveCard: saveCardMock,
  uploadImage: vi.fn(),
  listDrafts: vi.fn().mockResolvedValue({ ok: true, list: [{ id: 'p1', name: '小熊' }], urls: {} }),
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ replace: vi.fn() }) }))

import Cards from '../src/pages/Cards.vue'

afterEach(() => vi.useRealTimers())

describe('Cards.vue 自动保存完成后离页不补发', () => {
  it('大白话：改一次标题、防抖存完后离开页面，saveCard 只调一次', async () => {
    vi.useFakeTimers()
    saveCardMock.mockResolvedValue({ ok: true })
    const w = mount(Cards, { props: { wizardProductId: 'p1' } })
    await flushPromises()
    await vi.runAllTimersAsync() // 让 nextTick 里的 loaded=true 落地
    await w.find('input.in').setValue('新标题')
    await vi.advanceTimersByTimeAsync(800)
    await flushPromises()
    expect(saveCardMock).toHaveBeenCalledTimes(1)
    w.unmount()
    await flushPromises()
    expect(saveCardMock).toHaveBeenCalledTimes(1)
  })
})
