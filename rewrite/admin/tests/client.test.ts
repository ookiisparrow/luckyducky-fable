// adminApi v2 客户端行为（钱链入口）：
// 口令用完即弃只存令牌/云端没发令牌不算登成/401 清令牌统一 SESSION_LOST/网络错带原文不吞（调试案 A 教训）。
import { describe, it, expect, beforeEach } from 'vitest'
import { createClient } from '../src/api/client'

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

beforeEach(() => {
  store = {}
})

describe('登录与令牌（fail-closed）', () => {
  it('大白话：登录成功只存会话令牌（口令绝不落存储）；云端没发令牌不算登成', async () => {
    let sentBody = ''
    const c = createClient({
      endpoint: 'https://api.test',
      storage,
      fetchImpl: ((_u: string, init: RequestInit) => {
        sentBody = String(init.body)
        return respond(200, { ok: true, sessionToken: 'tok-abc', operator: '店主' })
      }) as unknown as typeof fetch,
    })
    const r = await c.login('my-secret-password')
    expect(r.ok).toBe(true)
    expect(c.token()).toBe('tok-abc')
    expect(c.who()).toBe('店主') // 登录存操作者名·Shell 显真实身份（换皮硬编码「管理员」）
    expect(sentBody).toContain('my-secret-password') // 只在登录请求里用一次
    await c.logout()
    expect(c.who()).toBe('') // 退出清身份
    expect(JSON.stringify(store)).not.toContain('my-secret-password') // 口令不落存储
    expect(sentBody).not.toContain('my-secret-password') // 登出请求带的是令牌，不是口令
    // 云端没发令牌：不算登成（fail-closed）
    store = {}
    const c2 = createClient({ endpoint: 'https://api.test', storage, fetchImpl: (() => respond(200, { ok: true })) as unknown as typeof fetch })
    const r2 = await c2.login('pw')
    expect(r2.ok).toBe(false)
    expect(c2.hasSession()).toBe(false)
  })

  it('大白话：无令牌调业务直接拒（不发裸请求）；401 清令牌并统一 SESSION_LOST；网络错带原文不吞', async () => {
    const calls: string[] = []
    const c = createClient({
      endpoint: 'https://api.test',
      storage,
      fetchImpl: ((u: string) => {
        calls.push(u)
        return respond(401, { ok: false, error: 'SESSION_EXPIRED' })
      }) as unknown as typeof fetch,
    })
    expect((await c.post('listOrders')).error).toBe('SESSION_LOST') // 无令牌不发请求
    expect(calls).toHaveLength(0)
    storage.set('ldrw_admin_token', 'tok-old')
    const r = await c.post('listOrders')
    expect(r.error).toBe('SESSION_LOST') // 401 统一语义
    expect(c.hasSession()).toBe(false) // 令牌被清
    // 网络错：原文在（调试案 A——吞错拖排障）
    storage.set('ldrw_admin_token', 'tok')
    const c3 = createClient({
      endpoint: 'https://api.test',
      storage,
      fetchImpl: (() => Promise.reject(new Error('ECONNREFUSED api.test'))) as unknown as typeof fetch,
    })
    const r3 = await c3.post('listOrders')
    expect(r3.ok).toBe(false)
    expect(String(r3.error)).toContain('ECONNREFUSED') // 带原文
    // 未配 endpoint：如实拒不假装
    const c4 = createClient({ endpoint: '', storage })
    expect((await c4.login('x')).error).toBe('NO_ENDPOINT')
  })
})

describe('失效令牌只试一次（2026-09-28 真事故：看板并发 5 个请求带失效令牌，一次打开就把本机 IP 锁 5 分钟）', () => {
  it('大白话：令牌还没被云端认过时，并发请求排在第一个后面；第一个 401 → 其余直接判会话失效、不再打云端（只记 1 次失败）', async () => {
    store.ldrw_admin_token = 'stale-token-000000'
    let calls = 0
    const c = createClient({ endpoint: 'https://api.test', storage, fetchImpl: (() => (calls++, respond(401, { ok: false, error: 'BAD_KEY' }))) as unknown as typeof fetch })
    const rs = await Promise.all([c.post('getDashboard'), c.post('refundCounts'), c.post('listInventory'), c.post('listDrafts'), c.post('getInspectStatus')])
    expect(calls).toBe(1)
    expect(rs.every((r) => r.ok === false && r.error === 'SESSION_LOST')).toBe(true)
  })

  it('大白话：令牌有效时照常并发——第一个认过令牌后其余全放行，之后的请求不再排队', async () => {
    store.ldrw_admin_token = 'good-token-000000'
    let calls = 0
    const c = createClient({ endpoint: 'https://api.test', storage, fetchImpl: (() => (calls++, respond(200, { ok: true }))) as unknown as typeof fetch })
    const rs = await Promise.all([c.post('a'), c.post('b'), c.post('c')])
    expect(rs.every((r) => r.ok)).toBe(true)
    expect(calls).toBe(3)
    await c.post('d')
    expect(calls).toBe(4)
  })

  it('大白话：第一个请求断网（没拿到云端答复）不算认过，下一次还是先试一个', async () => {
    store.ldrw_admin_token = 'tok-000000'
    let calls = 0
    const c = createClient({
      endpoint: 'https://api.test',
      storage,
      fetchImpl: (() => (calls++ === 0 ? Promise.reject(new Error('offline')) : respond(401, { ok: false }))) as unknown as typeof fetch,
    })
    expect((await c.post('a')).error).toMatch(/^NETWORK:/)
    const rs = await Promise.all([c.post('b'), c.post('c')])
    expect(calls).toBe(2)
    expect(rs.every((r) => r.error === 'SESSION_LOST')).toBe(true)
  })
})

describe('会话失效集中导登录（单源·病根#5 各页漂移收口 / #14 失败可见）', () => {
  it('大白话：业务调用遇 401 清令牌后触发一次会话失效回调——壳层据此统一导登录，各页不再各写各的', async () => {
    let fired = 0
    const c = createClient({
      endpoint: 'https://api.test',
      storage,
      fetchImpl: (() => respond(401, { ok: false, error: 'SESSION_EXPIRED' })) as unknown as typeof fetch,
    })
    c.onSessionLost(() => {
      fired++
    })
    storage.set('ldrw_admin_token', 'tok')
    const r = await c.post('listOrders')
    expect(r.error).toBe('SESSION_LOST')
    expect(c.hasSession()).toBe(false) // 令牌已清（fail-closed 核心）
    expect(fired).toBe(1) // 集中回调恰触发一次——导登录不再靠每页自觉（治页间漂移·卡死/显合成码）
  })

  it('大白话：未注册回调时 401 也不炸（回调可选·清令牌与 SESSION_LOST 语义不受影响）', async () => {
    const c = createClient({
      endpoint: 'https://api.test',
      storage,
      fetchImpl: (() => respond(401, {})) as unknown as typeof fetch,
    })
    storage.set('ldrw_admin_token', 'tok')
    const r = await c.post('listOrders')
    expect(r.error).toBe('SESSION_LOST')
    expect(c.hasSession()).toBe(false)
  })
})
