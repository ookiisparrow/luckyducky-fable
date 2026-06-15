import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// 根因#13：认证端点防爆破——失败累计达阈值即锁定，杜绝公网口令无限重试。
const KEY = 'test-admin-key-123'
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')

function call(action, key, data = {}, headers = {}) {
  return main({ httpMethod: 'POST', headers, body: JSON.stringify({ action, key, data }) }).then((res) => ({
    status: res.statusCode,
    ...JSON.parse(res.body),
  }))
}

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY) }])
})

describe('adminApi 认证频控（根因#13 防爆破）', () => {
  it('连续 5 次错误口令后锁定：第 6 次即便口令正确也拒（429 TOO_MANY_ATTEMPTS）', async () => {
    const ip = { 'x-forwarded-for': '1.2.3.4' }
    for (let i = 0; i < 5; i++) expect((await call('login', 'wrong-key', {}, ip)).status).toBe(401)
    const locked = await call('login', KEY, {}, ip) // 锁定中：正确口令也被频控挡下
    expect(locked.status).toBe(429)
    expect(locked.error).toBe('TOO_MANY_ATTEMPTS')
  })

  it('成功登录清零计数：4 次错 + 1 次对 → 再错 1 次不立即锁（窗口重置）', async () => {
    const ip = { 'x-forwarded-for': '5.6.7.8' }
    for (let i = 0; i < 4; i++) await call('login', 'nope', {}, ip)
    expect((await call('login', KEY, {}, ip)).status).toBe(200) // 成功，清零
    expect((await call('login', 'nope', {}, ip)).status).toBe(401) // 再错 1 次不该锁
    expect((await call('login', KEY, {}, ip)).status).toBe(200)
  })

  it('频控按 IP 隔离：A 被锁不影响 B', async () => {
    const A = { 'x-forwarded-for': '10.0.0.1' }
    const B = { 'x-forwarded-for': '10.0.0.2' }
    for (let i = 0; i < 5; i++) await call('login', 'wrong', {}, A)
    expect((await call('login', KEY, {}, A)).status).toBe(429) // A 锁
    expect((await call('login', KEY, {}, B)).status).toBe(200) // B 不受影响
  })

  it('非 login action 同受频控：5 次错口令后即便带正确口令也被挡', async () => {
    const ip = { 'x-forwarded-for': '9.9.9.9' }
    for (let i = 0; i < 5; i++) expect((await call('listOrders', 'wrong', {}, ip)).status).toBe(401)
    expect((await call('listOrders', KEY, {}, ip)).status).toBe(429)
  })
})
