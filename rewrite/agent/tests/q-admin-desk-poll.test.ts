// @vitest-environment happy-dom
// 坐席台定时轮询的在途闸：上一轮没回来，下一拍不发——慢网下请求不堆积、不重复计费。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))
vi.mock('../src/api/client', () => ({ post: postMock, logout: vi.fn(), listKb: vi.fn().mockResolvedValue({ ok: true, list: [] }) }))

import Desk from '../src/Desk.vue'

afterEach(() => {
  vi.useRealTimers()
})

describe('Desk.vue 轮询在途闸', () => {
  it('大白话：拉消息 / 拉列表卡住时，后面几拍都不再发；回来之后下一拍照常发', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let hang = false
    const gates: Array<() => void> = []
    const maybeHang = <T,>(v: T) => (hang ? new Promise<T>((r) => gates.push(() => r(v))) : Promise.resolve(v))
    postMock.mockReset().mockImplementation((action: string) => {
      if (action === 'listMyActive') return maybeHang({ ok: true, sessions: [{ sessionId: 's1', externalUserId: 'wm-000001' }] })
      if (action === 'listQueue') return maybeHang({ ok: true, items: [] })
      if (action === 'getThread') return maybeHang({ ok: true, messages: [], nextCursor: 0 })
      return Promise.resolve({ ok: true, panels: [] })
    })
    const calls = (a: string) => postMock.mock.calls.filter((c) => c[0] === a).length
    const w = mount(Desk)
    await flushPromises()
    await w.findAll('aside .qitem')[0].trigger('click') // 打开 s1：首拉照常
    await flushPromises()
    expect(calls('getThread')).toBe(1)
    expect(calls('listQueue')).toBe(1)

    hang = true
    vi.advanceTimersByTime(3_000) // 这一拍发出去，卡住
    expect(calls('getThread')).toBe(2)
    vi.advanceTimersByTime(9_000) // 之后 3 拍全跳过；列表 10s 那拍发出去也卡住
    expect(calls('getThread')).toBe(2)
    expect(calls('listQueue')).toBe(2)
    vi.advanceTimersByTime(20_000)
    expect(calls('listQueue')).toBe(2)

    hang = false
    gates.forEach((g) => g())
    await flushPromises()
    vi.advanceTimersByTime(3_000)
    expect(calls('getThread')).toBe(3)
    w.unmount()
  })

  it('大白话：旧会话的拉取卡住时切到新会话，新会话的下一拍照常拉，不被旧请求挡住', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let hangS1 = false
    postMock.mockReset().mockImplementation((action: string, data?: { sessionId?: string }) => {
      if (action === 'listMyActive')
        return Promise.resolve({
          ok: true,
          sessions: [
            { sessionId: 's1', externalUserId: 'wm-000001' },
            { sessionId: 's2', externalUserId: 'wm-000002' },
          ],
        })
      if (action === 'listQueue') return Promise.resolve({ ok: true, items: [] })
      if (action === 'getThread')
        return hangS1 && data?.sessionId === 's1' ? new Promise(() => {}) : Promise.resolve({ ok: true, messages: [], nextCursor: 0 })
      return Promise.resolve({ ok: true, panels: [] })
    })
    const threadCalls = (sid: string) => postMock.mock.calls.filter((c) => c[0] === 'getThread' && c[1]?.sessionId === sid).length
    const w = mount(Desk)
    await flushPromises()
    await w.findAll('aside .qitem')[0].trigger('click')
    await flushPromises()

    hangS1 = true
    vi.advanceTimersByTime(3_000) // s1 这一拍卡住
    expect(threadCalls('s1')).toBe(2)
    await w.findAll('aside .qitem')[1].trigger('click') // 切到 s2：打开时手动首拉一次
    await flushPromises()
    expect(threadCalls('s2')).toBe(1)
    vi.advanceTimersByTime(3_000)
    expect(threadCalls('s2')).toBe(2)
    w.unmount()
  })
})
