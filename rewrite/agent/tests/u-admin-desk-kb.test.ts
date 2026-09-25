// @vitest-environment happy-dom
// Desk.vue FAQ 面板「刷新」失败不冲掉已拉到的快捷回复（同 refreshLists「失败不清已有」·失败≠空态）。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { postMock, listKbMock } = vi.hoisted(() => ({ postMock: vi.fn(), listKbMock: vi.fn() }))
vi.mock('../src/api/client', () => ({ post: postMock, logout: vi.fn(), listKb: listKbMock }))

import Desk from '../src/Desk.vue'

afterEach(() => vi.useRealTimers())

describe('Desk.vue 知识库刷新失败保留已有快捷回复', () => {
  it('大白话：已拉到的快捷回复，FAQ 面板点刷新失败后仍在，不显示「没有匹配的条目」', async () => {
    vi.useFakeTimers()
    postMock.mockImplementation(async (action: string) => {
      if (action === 'listMyActive') return { ok: true, sessions: [{ sessionId: 's1', externalUserId: 'wm-000001' }] }
      if (action === 'listQueue') return { ok: true, items: [] }
      if (action === 'getThread') return { ok: true, messages: [], nextCursor: 0 }
      return { ok: true, panels: [] }
    })
    listKbMock
      .mockResolvedValueOnce({ ok: true, list: [{ key: 'k1', question: '多久发货', answer: '48 小时内' }] })
      .mockResolvedValue({ ok: false, error: 'NETWORK' })
    const w = mount(Desk)
    await flushPromises()
    await w.find('aside .qitem').trigger('click')
    await flushPromises()
    await w.find('button.chip.faq').trigger('click')
    const refresh = w.findAll('.faq-head button').find((b) => b.text() === '刷新')!
    await refresh.trigger('click')
    await flushPromises()
    expect(listKbMock).toHaveBeenCalledTimes(2)
    expect(w.find('.faq-list').text()).toContain('多久发货')
    expect(w.find('.faq-list').text()).not.toContain('没有匹配的条目')
    expect(w.find('.quickbar').exists()).toBe(true)
    w.unmount()
  })
})
