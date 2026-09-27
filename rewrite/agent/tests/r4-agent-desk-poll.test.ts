// @vitest-environment happy-dom
// #400-21 切会话（或重开同一会话）后，上一次打开时发出的拉消息回包晚到，不得写进当前窗口（消息与游标都不串）。
// #400-31 标签页隐藏时轮询降频（不全停：坐席在别的标签页时，标题角标+提示音仍要靠轮询发现新顾客），
//         切回可见立即补拉一次并恢复原频率。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))
vi.mock('../src/api/client', () => ({ post: postMock, logout: vi.fn(), listKb: vi.fn().mockResolvedValue({ ok: true, list: [] }) }))

import Desk from '../src/Desk.vue'

const MINE = {
  ok: true,
  sessions: [
    { sessionId: 's1', externalUserId: 'wm-000001' },
    { sessionId: 's2', externalUserId: 'wm-000002' },
  ],
}
const threadCalls = (sid?: string) => postMock.mock.calls.filter((c) => c[0] === 'getThread' && (!sid || c[1]?.sessionId === sid))
const calls = (a: string) => postMock.mock.calls.filter((c) => c[0] === a).length

let vis: DocumentVisibilityState = 'visible'
function setVisibility(v: DocumentVisibilityState) {
  vis = v
  document.dispatchEvent(new Event('visibilitychange'))
}

// 中途失败的用例也要卸载，不然它的 visibilitychange 监听留着，把后面「卸载后不复活」那条连带弄红、指错地方
enableAutoUnmount(afterEach)
afterEach(() => {
  vi.useRealTimers()
  vis = 'visible'
})
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis })

describe('#400-21 切会话丢弃旧会话的晚到回包', () => {
  it('大白话：A 的拉消息还在路上时切到 B，A 的回包晚到，不出现在 B 的窗口里，B 的游标也不被 A 带跑', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let hangS1 = false
    let releaseS1: (() => void) | null = null
    postMock.mockReset().mockImplementation((action: string, data?: { sessionId?: string }) => {
      if (action === 'listMyActive') return Promise.resolve(MINE)
      if (action === 'listQueue') return Promise.resolve({ ok: true, items: [] })
      if (action === 'getThread' && data?.sessionId === 's1') {
        if (!hangS1) return Promise.resolve({ ok: true, messages: [], nextCursor: 1 })
        const late = { ok: true, messages: [{ direction: 'in', text: 'A顾客的话', at: 1000, msgid: 'a1' }], nextCursor: 99 }
        return new Promise((r) => (releaseS1 = () => r(late)))
      }
      if (action === 'getThread') return Promise.resolve({ ok: true, messages: [{ direction: 'in', text: 'B顾客的话', at: 2000, msgid: 'b1' }], nextCursor: 5 })
      return Promise.resolve({ ok: true, panels: [] })
    })
    const w = mount(Desk)
    await flushPromises()
    await w.findAll('aside .qitem')[0].trigger('click') // 打开 A
    await flushPromises()

    hangS1 = true
    vi.advanceTimersByTime(3_000) // A 的轮询发出去，卡在路上
    expect(threadCalls('s1').length).toBe(2)
    await w.findAll('aside .qitem')[1].trigger('click') // 切到 B
    await flushPromises()
    expect(w.find('.thread').text()).toContain('B顾客的话')

    releaseS1!() // A 的回包这时才到
    await flushPromises()
    expect(w.find('.thread').text()).not.toContain('A顾客的话')

    vi.advanceTimersByTime(3_000) // B 的下一拍：游标仍是 B 自己的 5，不是 A 的 99
    expect(threadCalls('s2').slice(-1)[0]?.[1]).toEqual({ sessionId: 's2', cursor: 5 })
  })

  it('大白话：A 的轮询还在路上时又点了一下 A（重开），重开的首拉失败、旧回包晚到——不拿旧回包冒充整段记录，下一拍从头拉回完整历史', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const early = { direction: 'in', text: '早先的话', at: 1000, msgid: 'e1' }
    const late = { direction: 'in', text: '后来的话', at: 2000, msgid: 'l1' }
    let phase: 'open' | 'hang' | 'reopenFail' | 'ok' = 'open'
    let releaseOld: (() => void) | null = null
    postMock.mockReset().mockImplementation((action: string) => {
      if (action === 'listMyActive') return Promise.resolve(MINE)
      if (action === 'listQueue') return Promise.resolve({ ok: true, items: [] })
      if (action === 'getThread') {
        if (phase === 'open') return Promise.resolve({ ok: true, messages: [early], nextCursor: 1 })
        if (phase === 'hang') {
          phase = 'reopenFail'
          return new Promise((r) => (releaseOld = () => r({ ok: true, messages: [late], nextCursor: 9 })))
        }
        if (phase === 'reopenFail') return Promise.resolve({ ok: false, error: 'CALL_TIMEOUT' })
        return Promise.resolve({ ok: true, messages: [early, late], nextCursor: 9 })
      }
      return Promise.resolve({ ok: true, panels: [] })
    })
    const w = mount(Desk)
    await flushPromises()
    await w.findAll('aside .qitem')[0].trigger('click') // 打开 A
    await flushPromises()
    expect(w.find('.thread').text()).toContain('早先的话')

    phase = 'hang'
    vi.advanceTimersByTime(3_000) // A 的轮询（游标 1）发出去，卡在路上
    await w.findAll('aside .qitem')[0].trigger('click') // 又点一下 A：清空重拉，这次首拉失败
    await flushPromises()
    expect(w.find('.note').exists()).toBe(true)

    releaseOld!() // 上一次打开发出的回包这时才到
    await flushPromises()
    expect(w.find('.thread').text()).not.toContain('后来的话') // 不拿半截冒充整段
    expect(w.find('.note').exists()).toBe(true) // 失败提示不被旧回包抹掉

    phase = 'ok'
    vi.advanceTimersByTime(3_000)
    await flushPromises()
    expect(threadCalls('s1').slice(-1)[0]?.[1]?.cursor).toBeUndefined() // 从头拉，不是从旧回包的 9 往后
    expect(w.find('.thread').text()).toContain('早先的话')
    expect(w.find('.thread').text()).toContain('后来的话')
  })
})

describe('#400-31 标签页隐藏时轮询降频', () => {
  function mockAll(queueItems: () => unknown[]) {
    postMock.mockReset().mockImplementation((action: string) => {
      if (action === 'listMyActive') return Promise.resolve(MINE)
      if (action === 'listQueue') return Promise.resolve({ ok: true, items: queueItems() })
      if (action === 'getThread') return Promise.resolve({ ok: true, messages: [], nextCursor: 0 })
      return Promise.resolve({ ok: true, panels: [] })
    })
  }

  it('大白话：切走后 3s/10s 的拍子都不再发，30s 才拉一次；切回来立刻补拉，之后恢复 3s/10s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    mockAll(() => [])
    const w = mount(Desk)
    await flushPromises()
    await w.findAll('aside .qitem')[0].trigger('click')
    await flushPromises()
    const t0 = threadCalls().length
    const l0 = calls('listQueue')

    setVisibility('hidden')
    vi.advanceTimersByTime(29_000)
    expect(threadCalls().length).toBe(t0)
    expect(calls('listQueue')).toBe(l0)
    vi.advanceTimersByTime(1_000)
    await flushPromises()
    expect(threadCalls().length).toBe(t0 + 1)
    expect(calls('listQueue')).toBe(l0 + 1)

    setVisibility('visible') // 补拉不等下一拍
    await flushPromises()
    expect(threadCalls().length).toBe(t0 + 2)
    expect(calls('listQueue')).toBe(l0 + 2)
    vi.advanceTimersByTime(3_000)
    await flushPromises()
    expect(threadCalls().length).toBe(t0 + 3)
    vi.advanceTimersByTime(7_000)
    expect(calls('listQueue')).toBe(l0 + 3)
  })

  it('大白话：坐席在别的标签页时来了新顾客，降频那一拍照样把标题角标打上', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let items: unknown[] = []
    mockAll(() => items)
    document.title = '坐席台'
    mount(Desk)
    await flushPromises()

    window.dispatchEvent(new Event('blur'))
    setVisibility('hidden')
    items = [{ sessionId: 'q9', externalUserId: 'wm-000009', createdAt: Date.now() }]
    vi.advanceTimersByTime(30_000)
    await flushPromises()
    expect(document.title).toBe('(1) 坐席台')
  })

  it('大白话：页面在后台标签打开（挂载时就隐藏），一开始就按降频走', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    mockAll(() => [])
    vis = 'hidden'
    mount(Desk)
    await flushPromises()
    const l0 = calls('listQueue')
    vi.advanceTimersByTime(29_000)
    expect(calls('listQueue')).toBe(l0)
    vi.advanceTimersByTime(1_000)
    expect(calls('listQueue')).toBe(l0 + 1)
  })

  it('大白话：卸载后再切可见，不会复活轮询', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    mockAll(() => [])
    const w = mount(Desk)
    await flushPromises()
    w.unmount()
    const n = postMock.mock.calls.length
    setVisibility('hidden')
    setVisibility('visible')
    vi.advanceTimersByTime(60_000)
    await flushPromises()
    expect(postMock.mock.calls.length).toBe(n)
  })
})
