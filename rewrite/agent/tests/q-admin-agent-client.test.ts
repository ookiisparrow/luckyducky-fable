// 坐席台 client 兜底：请求挂死要有超时、怪回包不抛、登出要吊销服务端令牌（与后台 client 同口径）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import rcSrc from '../../../cloudbaserc.json?raw'

class MemoryStorage {
  m: Record<string, string> = {}
  getItem(k: string) {
    return this.m[k] ?? null
  }
  setItem(k: string, v: string) {
    this.m[k] = v
  }
  removeItem(k: string) {
    delete this.m[k]
  }
}
let storage: MemoryStorage
const setFetch = (f: unknown) => ((globalThis as unknown as { fetch: unknown }).fetch = f)
const hangingFetch = (_u: string, init: RequestInit) =>
  new Promise((_res, rej) => {
    init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })
// 回包头到了、包体读一半挂住：json() 只在 signal 中止时才拒绝。
const bodyHangingFetch = async (_u: string, init: RequestInit) => ({
  status: 200,
  json: () =>
    new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }),
})

beforeEach(() => {
  vi.resetModules()
  storage = new MemoryStorage()
  storage.setItem('ldrw_agent_token', 'tok')
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage
  vi.stubEnv('VITE_AGENT_API', 'https://api.test')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('坐席台请求超时', () => {
  it('大白话：服务器一直不回，到点回 CALL_TIMEOUT，不清令牌', async () => {
    vi.useFakeTimers()
    setFetch(hangingFetch)
    const { post, CALL_TIMEOUT_MS } = await import('../src/api/client')
    const p = post('getThread', { sessionId: 's1' })
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS)
    const out = await Promise.race([p, Promise.resolve('PENDING')])
    expect(out).toMatchObject({ ok: false, error: 'CALL_TIMEOUT' })
    expect(storage.getItem('ldrw_agent_token')).toBe('tok')
  })

  it('大白话：回包头到了但包体一直读不完，到点也回 CALL_TIMEOUT', async () => {
    vi.useFakeTimers()
    setFetch(bodyHangingFetch)
    const { post, CALL_TIMEOUT_MS } = await import('../src/api/client')
    const p = post('getThread', { sessionId: 's1' })
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS)
    const out = await Promise.race([p, Promise.resolve('PENDING')])
    expect(out).toMatchObject({ ok: false, error: 'CALL_TIMEOUT' })
  })

  it('大白话：超时要长过 cloudbaserc.json 里 adminApi 自己的超时（坐席台也走 adminApi）', async () => {
    const { CALL_TIMEOUT_MS } = await import('../src/api/client')
    const fn = (JSON.parse(rcSrc).functions as Array<{ name: string; timeout: number }>).find((f) => f.name === 'adminApi')
    const fnMs = Number(fn?.timeout) * 1000
    expect(fnMs).toBeGreaterThan(0)
    expect(CALL_TIMEOUT_MS).toBeGreaterThan(fnMs)
  })
})

describe('坐席台怪回包不抛', () => {
  it.each([[null], [[]], [5]])('大白话：回包是 %j 时回 BAD_JSON_RESPONSE', async (body) => {
    setFetch(async () => ({ status: 200, json: async () => body }))
    const { post } = await import('../src/api/client')
    await expect(post('listQueue')).resolves.toMatchObject({ ok: false, error: 'BAD_JSON_RESPONSE' })
  })
})

describe('坐席台登出吊销服务端令牌', () => {
  it('大白话：登出拿当前令牌调服务端 logout，本地令牌立刻清掉；服务端挂死也不卡', async () => {
    vi.useFakeTimers()
    const sent: unknown[] = []
    setFetch((_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)))
      return hangingFetch(_u, init)
    })
    const { logout, hasSession, CALL_TIMEOUT_MS } = await import('../src/api/client')
    const p = logout()
    expect(hasSession()).toBe(false)
    expect(sent).toEqual([{ action: 'logout', key: 'tok', data: {} }])
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS)
    await expect(p).resolves.toBeUndefined()
  })

  it('大白话：没令牌时登出不发请求', async () => {
    storage.removeItem('ldrw_agent_token')
    const f = vi.fn()
    setFetch(f)
    const { logout } = await import('../src/api/client')
    await logout()
    expect(f).not.toHaveBeenCalled()
  })
})
