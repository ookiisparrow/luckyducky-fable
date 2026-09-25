// @vitest-environment happy-dom
// Conversations.vue 质检报表失败有自己的提示位：深链并发检索成功不能把它抹掉（失败≠空态·病根#14）。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { conversationsReportMock, searchConversationsMock } = vi.hoisted(() => ({
  conversationsReportMock: vi.fn(),
  searchConversationsMock: vi.fn(),
}))
vi.mock('../src/api/cs', () => ({
  conversationsReport: conversationsReportMock,
  searchConversations: searchConversationsMock,
  sampleQc: vi.fn(),
  saveQcMark: vi.fn(),
  listQcSampled: vi.fn().mockResolvedValue({ ok: true, list: [] }),
  getTrialRefreshGate: vi.fn().mockResolvedValue({ ok: true, enabled: false }),
  refreshTrialSession: vi.fn(),
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: { externalUserId: 'wm-1' } }) }))

import Conversations from '../src/pages/Conversations.vue'

describe('Conversations.vue 报表失败不被检索成功抹掉', () => {
  it('大白话：带客户深链进来，报表失败、检索成功，报表失败提示仍在', async () => {
    conversationsReportMock.mockResolvedValue({ ok: false, error: 'DB_READ_FAIL' })
    searchConversationsMock.mockResolvedValue({ ok: true, messages: [{ id: 'm1', from: 'user', text: '你好', at: Date.now() }], hasMore: false })
    const w = mount(Conversations)
    await flushPromises()
    expect(w.text()).toContain('质检报表加载失败')
  })
})
