// @vitest-environment happy-dom
// Conversations.vue 质检报表失败有自己的提示位：深链并发检索成功不能把它抹掉（失败≠空态·病根#14）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { transportErrorText } from '../src/lib/mapSystem'
import { CS_REFRESH_COPY } from '@ldrw/shared'

const { conversationsReportMock, searchConversationsMock, getTrialRefreshGateMock, refreshTrialSessionMock, listQcSampledMock, sampleQcMock } = vi.hoisted(() => ({
  conversationsReportMock: vi.fn(),
  searchConversationsMock: vi.fn(),
  getTrialRefreshGateMock: vi.fn(),
  refreshTrialSessionMock: vi.fn(),
  listQcSampledMock: vi.fn(),
  sampleQcMock: vi.fn(),
}))
vi.mock('../src/api/cs', () => ({
  conversationsReport: conversationsReportMock,
  searchConversations: searchConversationsMock,
  sampleQc: sampleQcMock,
  saveQcMark: vi.fn(),
  listQcSampled: listQcSampledMock,
  getTrialRefreshGate: getTrialRefreshGateMock,
  refreshTrialSession: refreshTrialSessionMock,
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: { externalUserId: 'wm-1' } }) }))

import Conversations from '../src/pages/Conversations.vue'

beforeEach(() => {
  getTrialRefreshGateMock.mockReset().mockResolvedValue({ ok: true, enabled: false })
  refreshTrialSessionMock.mockReset()
  listQcSampledMock.mockReset().mockResolvedValue({ ok: true, list: [] })
  sampleQcMock.mockReset()
})

function pending<T>() {
  let release: (v: T) => void = () => {}
  const p = new Promise<T>((resolve) => { release = resolve })
  return { p, release: (v: T) => release(v) }
}

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

describe('Conversations.vue 测版刷新入口', () => {
  const refreshBtn = (w: ReturnType<typeof mount>) => w.findAll('button').find((b) => b.text() === CS_REFRESH_COPY.buttonLabel)

  it('大白话：闸没开（正式环境）——看不见「当作新客重新开始」', async () => {
    conversationsReportMock.mockResolvedValue({ ok: true })
    searchConversationsMock.mockResolvedValue({ ok: true, messages: [], hasMore: false })
    const w = mount(Conversations)
    await flushPromises()
    expect(refreshBtn(w)).toBeUndefined()
    expect(w.text()).not.toContain(CS_REFRESH_COPY.adminListHint)
  })

  it('大白话：闸开了——填原因后第一下只武装、第二下才刷新（不弹浏览器确认框），成功说共享文案', async () => {
    getTrialRefreshGateMock.mockResolvedValue({ ok: true, enabled: true })
    refreshTrialSessionMock.mockResolvedValue({ ok: true })
    conversationsReportMock.mockResolvedValue({ ok: true })
    searchConversationsMock.mockResolvedValue({ ok: true, messages: [], hasMore: false })
    const w = mount(Conversations) // 测试环境没有 window.confirm：页面若改回弹确认框，点击会直接抛错
    await flushPromises()
    expect(w.text()).toContain(CS_REFRESH_COPY.adminListHint)
    await w.find(`input[placeholder="${CS_REFRESH_COPY.adminReasonPlaceholder}"]`).setValue('测试回归')
    await refreshBtn(w)!.trigger('click')
    expect(refreshTrialSessionMock).not.toHaveBeenCalled()
    await refreshBtn(w)!.trigger('click')
    await flushPromises()
    expect(refreshTrialSessionMock).toHaveBeenCalledWith({ reason: '测试回归', force: false, externalUserId: 'wm-1' })
    expect(w.text()).toContain(CS_REFRESH_COPY.adminSuccess)
  })
})

describe('Conversations.vue 抽样与在途列表', () => {
  const qcRow = (sessionKey: string, externalUserId: string) => ({ sessionKey, externalUserId, qcSampledAt: 1, qc: null })
  const btn = (w: ReturnType<typeof mount>, label: string) => w.findAll('button').find((b) => b.text() === label)

  it('大白话：进页列表还在路上就随机抽取——后到的旧列表不盖掉刚抽的，加载更多还能接着翻', async () => {
    const late = pending<{ ok: boolean; list: unknown[]; hasMore: boolean; nextCursor: string }>()
    listQcSampledMock.mockResolvedValue({ ok: true, list: [qcRow('s-page2', 'extuser-PAGE02')], hasMore: false, nextCursor: null })
    listQcSampledMock.mockImplementationOnce(() => late.p)
    sampleQcMock.mockResolvedValue({ ok: true, count: 1, sampled: [qcRow('s-new', 'extuser-NEWROW')] })
    conversationsReportMock.mockResolvedValue({ ok: true })
    searchConversationsMock.mockResolvedValue({ ok: true, messages: [], hasMore: false })

    const w = mount(Conversations)
    await flushPromises()
    await btn(w, '随机抽取 10 条')!.trigger('click')
    await flushPromises()

    late.release({ ok: true, list: [qcRow('s-old', 'extuser-OLDROW')], hasMore: true, nextCursor: 'c-next' })
    await flushPromises()

    expect(w.text()).toContain('NEWROW')
    expect(w.text()).not.toContain('OLDROW')
    const more = btn(w, '加载更多')
    expect(more).toBeTruthy()
    await more!.trigger('click')
    await flushPromises()
    expect(listQcSampledMock).toHaveBeenLastCalledWith({ cursor: 'c-next' })
    expect(w.text()).toContain('NEWROW')
    expect(w.text()).toContain('PAGE02')
  })
})
