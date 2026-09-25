// @vitest-environment happy-dom
// Conversations.vue 质检报表失败有自己的提示位：深链并发检索成功不能把它抹掉（失败≠空态·病根#14）。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { transportErrorText } from '../src/lib/mapSystem'

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

describe('Conversations.vue 失败提示', () => {
  it('大白话：报表与检索都失败——报表说中文带码，检索断网说人话，不甩裸码', async () => {
    conversationsReportMock.mockResolvedValue({ ok: false, error: 'DB_READ_FAIL' })
    searchConversationsMock.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:Failed to fetch' })
    const w = mount(Conversations)
    await flushPromises()
    expect(w.text()).toContain('质检报表加载失败（DB_READ_FAIL）')
    expect(w.text()).toContain(transportErrorText('NETWORK:Failed to fetch'))
    expect(w.text()).not.toContain('NETWORK:')
  })
})

describe('Conversations.vue 读失败点名', () => {
  it('大白话：报表与检索都超时——两处都说清是哪块没加载出来，不是两行一模一样的话', async () => {
    conversationsReportMock.mockResolvedValue({ ok: false, error: 'CALL_TIMEOUT' })
    searchConversationsMock.mockResolvedValue({ ok: false, error: 'CALL_TIMEOUT' })
    const w = mount(Conversations)
    await flushPromises()
    expect(w.text()).toContain('质检报表加载失败：' + transportErrorText('CALL_TIMEOUT'))
    expect(w.text()).toContain('检索失败：' + transportErrorText('CALL_TIMEOUT'))
  })
})
