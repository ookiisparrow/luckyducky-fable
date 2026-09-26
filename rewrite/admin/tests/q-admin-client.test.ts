// 后台 client 兜底：请求挂死要有超时、怪回包不抛、登出要吊销服务端令牌。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createClient, CALL_TIMEOUT_MS } from '../src/api/client'
import rcSrc from '../../../cloudbaserc.json?raw'

let store: Record<string, string> = {}
const storage = {
  get: (k: string) => store[k] ?? null,
  set: (k: string, v: string) => {
    store[k] = v
  },
  remove: (k: string) => {
    delete store[k]
  },
}
const respond = (status: number, body: unknown) =>
  Promise.resolve({ status, json: () => Promise.resolve(body) } as unknown as Response)

// 真 fetch 的挂死形态：永不回包，只有 signal 中止时才以 AbortError 拒绝。
const hangingFetch = ((_u: string, init: RequestInit) =>
  new Promise((_res, rej) => {
    init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })) as unknown as typeof fetch

// 回包头到了、包体读一半挂住：json() 只在 signal 中止时才拒绝。
const bodyHangingFetch = ((_u: string, init: RequestInit) =>
  Promise.resolve({
    status: 200,
    json: () =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      }),
  } as unknown as Response)) as unknown as typeof fetch

const adminApiTimeoutMs = () => {
  const fn = (JSON.parse(rcSrc).functions as Array<{ name: string; timeout: number }>).find((f) => f.name === 'adminApi')
  return Number(fn?.timeout) * 1000
}

beforeEach(() => {
  store = { ldrw_admin_token: 'tok', ldrw_admin_who: '店主' }
})
afterEach(() => {
  vi.useRealTimers()
})

describe('请求超时', () => {
  it('大白话：服务器一直不回，到点就回 CALL_TIMEOUT，按钮不会一直转圈', async () => {
    vi.useFakeTimers()
    const c = createClient({ endpoint: 'https://api.test', storage, fetchImpl: hangingFetch })
    const p = c.post('shipOrder', { id: 'o1' })
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS)
    const out = await Promise.race([p, Promise.resolve('PENDING')])
    expect(out).toMatchObject({ ok: false, error: 'CALL_TIMEOUT' })
    expect(storage.get('ldrw_admin_token')).toBe('tok') // 超时不是会话失效，不清令牌
  })

  it('大白话：回包头到了但包体一直读不完，到点也回 CALL_TIMEOUT（不是「回包读不懂」）', async () => {
    vi.useFakeTimers()
    const c = createClient({ endpoint: 'https://api.test', storage, fetchImpl: bodyHangingFetch })
    const p = c.post('shipOrder', { id: 'o1' })
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS)
    const out = await Promise.race([p, Promise.resolve('PENDING')])
    expect(out).toMatchObject({ ok: false, error: 'CALL_TIMEOUT' })
  })

  it('大白话：超时要长过 cloudbaserc.json 里 adminApi 自己的超时——慢但在跑的写操作不能被前端先判成失败', () => {
    expect(adminApiTimeoutMs()).toBeGreaterThan(0)
    expect(CALL_TIMEOUT_MS).toBeGreaterThan(adminApiTimeoutMs())
  })

  it('大白话：正常回包后计时器被清掉，不留悬空定时器', async () => {
    vi.useFakeTimers()
    const c = createClient({ endpoint: 'https://api.test', storage, fetchImpl: (() => respond(200, { ok: true })) as unknown as typeof fetch })
    expect((await c.post('listOrders')).ok).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('怪回包不抛', () => {
  it.each([[null], [[]], [5], ['x']])('大白话：回包是 %j 时回 BAD_JSON_RESPONSE，不抛异常', async (body) => {
    const c = createClient({ endpoint: 'https://api.test', storage, fetchImpl: (() => respond(200, body)) as unknown as typeof fetch })
    await expect(c.post('getOrderDetail', { id: 'o1' })).resolves.toMatchObject({ ok: false, error: 'BAD_JSON_RESPONSE' })
  })
})

describe('登出吊销服务端令牌', () => {
  it('大白话：登出拿当前令牌调服务端 logout，本地令牌和身份都清掉', async () => {
    const sent: Array<Record<string, unknown>> = []
    const c = createClient({
      endpoint: 'https://api.test',
      storage,
      fetchImpl: ((_u: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)))
        return respond(200, { ok: true })
      }) as unknown as typeof fetch,
    })
    await c.logout()
    expect(sent).toEqual([{ action: 'logout', key: 'tok', data: {} }])
    expect(c.hasSession()).toBe(false)
    expect(c.who()).toBe('')
  })

  it('大白话：清令牌不用等服务端回话——网络挂死时人已经登出，不卡在「退出中」', async () => {
    vi.useFakeTimers()
    const c = createClient({ endpoint: 'https://api.test', storage, fetchImpl: hangingFetch })
    const p = c.logout()
    expect(c.hasSession()).toBe(false)
    expect(c.who()).toBe('')
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS)
    await expect(p).resolves.toBeUndefined() // 超时后安静结束，不抛给调用方
  })

  it('大白话：服务端吊销失败也照样清本地令牌', async () => {
    const c = createClient({
      endpoint: 'https://api.test',
      storage,
      fetchImpl: (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
    })
    await c.logout()
    expect(c.hasSession()).toBe(false)
  })

  it('大白话：本来就没令牌时登出不发请求', async () => {
    store = {}
    const fetchImpl = vi.fn()
    const c = createClient({ endpoint: 'https://api.test', storage, fetchImpl: fetchImpl as unknown as typeof fetch })
    await c.logout()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
