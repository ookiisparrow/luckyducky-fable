// 坐席台 client 会话失效集中收口（批3 规格·根因#5·对照 admin tests/client.test.ts 同构移植）：
// post 遇无令牌/401 → sessionLostHandler 被调、令牌被清——壳层据此统一登出回登录视图。
// client.ts 是模块级单例风格（不像 admin createClient 那样能注入 endpoint/storage/fetch），
// ENDPOINT 取自 import.meta.env.VITE_AGENT_API：用 vi.stubEnv + vi.resetModules + 动态 import
// 换一份读到新 env 值的全新模块实例（同 rewrite/mp/tests/courses.test.ts 缓存单例测法家风）；
// localStorage/fetch 用内存桩顶替全局（本仓 vitest 'rw' 项目跑 environment:'node'，无浏览器全局）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

class MemoryStorage {
  private m: Record<string, string> = {}
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

beforeEach(() => {
  vi.resetModules()
  storage = new MemoryStorage()
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage
  vi.stubEnv('VITE_AGENT_API', 'https://api.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('会话失效集中导登录（单源·病根#5·对照 admin client 同构移植）', () => {
  it('大白话：post 无令牌直接拒（不发裸请求）且触发一次 sessionLostHandler', async () => {
    const fetchMock = vi.fn()
    ;(globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock
    const { post, onSessionLost } = await import('../src/api/client')
    let fired = 0
    onSessionLost(() => {
      fired++
    })
    const r = await post('listQueue')
    expect(r.error).toBe('SESSION_LOST')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fired).toBe(1)
  })

  it('大白话：post 遇 401 清令牌、统一 SESSION_LOST、触发一次 sessionLostHandler', async () => {
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
      status: 401,
      json: async () => ({ ok: false, error: 'SESSION_EXPIRED' }),
    }))
    const { post, onSessionLost, hasSession } = await import('../src/api/client')
    let fired = 0
    onSessionLost(() => {
      fired++
    })
    storage.setItem('ldrw_agent_token', 'tok-old')
    expect(hasSession()).toBe(true)
    const r = await post('listQueue')
    expect(r.error).toBe('SESSION_LOST')
    expect(hasSession()).toBe(false) // 令牌被清（fail-closed 核心）
    expect(fired).toBe(1) // 集中回调恰触发一次
  })

  it('大白话：未注册回调时无令牌/401 也不炸——回调可选，清令牌与 SESSION_LOST 语义不受影响', async () => {
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
      status: 401,
      json: async () => ({}),
    }))
    const { post, hasSession } = await import('../src/api/client')
    storage.setItem('ldrw_agent_token', 'tok')
    const r = await post('listQueue')
    expect(r.error).toBe('SESSION_LOST')
    expect(hasSession()).toBe(false)
  })

  it('大白话：login/loginByWecomCode 走 raw() 不经 post()，401 也不触发 sessionLostHandler（登录页自己处理错误）', async () => {
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
      status: 401,
      json: async () => ({ ok: false, error: 'BAD_PASSWORD' }),
    }))
    const { login, onSessionLost } = await import('../src/api/client')
    let fired = 0
    onSessionLost(() => {
      fired++
    })
    const r = await login('wrong-password')
    expect(r.ok).toBe(false)
    expect(fired).toBe(0) // login 走 raw()，不经 post() 的 401 分支——不触发集中回调
  })

  it('大白话：200 成功回包不触发 sessionLostHandler（只在会话真失效时触发）', async () => {
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
      status: 200,
      json: async () => ({ ok: true, items: [] }),
    }))
    const { post, onSessionLost } = await import('../src/api/client')
    let fired = 0
    onSessionLost(() => {
      fired++
    })
    storage.setItem('ldrw_agent_token', 'tok')
    const r = await post('listQueue')
    expect(r.ok).toBe(true)
    expect(fired).toBe(0)
  })
})
