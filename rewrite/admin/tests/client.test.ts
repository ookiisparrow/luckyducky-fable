// adminApi v2 客户端行为（守卫 rw-admin-ui-in-gates 焊在位·钱链入口）：
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
        return respond(200, { ok: true, sessionToken: 'tok-abc' })
      }) as unknown as typeof fetch,
    })
    const r = await c.login('my-secret-password')
    expect(r.ok).toBe(true)
    expect(c.token()).toBe('tok-abc')
    expect(JSON.stringify(store)).not.toContain('my-secret-password') // 口令不落存储
    expect(sentBody).toContain('my-secret-password') // 只在登录请求里用一次
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
