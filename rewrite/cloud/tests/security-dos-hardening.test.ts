// 收尾硬化批·两处 DoS 加固（用户 2026-07-13 拍板）：
//  #1 adminApi 全局登录锁不再自我 DoS——轮换 IP 的错误口令锁不住持正确口令的真超管（per-IP 硬闸仍在）。
//  #2 createOrder 每 openid 在途未支付单上限——防单账号零成本预留锁死热销 SKU 15min。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { main as app } from '../src/functions/app/index'
import { sha } from '../src/functions/adminApi/lib'

// —— #1 adminApi 全局锁 —— //
const post = (payload: Record<string, unknown>, ip = '1.1.1.1') =>
  adminApi({ httpMethod: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify(payload) }) as Promise<any>
const bodyOf = (r: any) => JSON.parse(r.body)
const seedSuper = (key = 'super-secret-key') =>
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(key), role: 'superadmin', createdAt: 1 }])

describe('#1 全局登录锁不自我 DoS（收尾硬化·用户拍板 A：先验口令再受全局锁约束）', () => {
  beforeEach(() => {
    control.reset()
    control.setOpenId('')
  })

  it('大白话：攻击者用 4 个轮换 IP 各 5 次错误口令打满全局锁后，全新 IP 拿正确口令仍能登进来（旧实现会被全局锁 429）', async () => {
    seedSuper()
    // 4 个不同 IP 各 5 次错误口令 = 全局失败累计 20（达全局阈·锁定）；每个 IP 自身也 per-IP 锁定
    for (const ip of ['2.0.0.1', '2.0.0.2', '2.0.0.3', '2.0.0.4']) {
      for (let i = 0; i < 5; i++) await post({ action: 'login', key: 'wrong-long-key' }, ip)
    }
    // 全新 IP（自身 per-IP 未锁）+ 正确口令：全局虽锁定，但不再预拒——checkKey 通过即放行
    const r = await post({ action: 'login', key: 'super-secret-key' }, '9.9.9.9')
    expect(r.statusCode).toBe(200)
    expect(bodyOf(r).ok).toBe(true)
  })

  it('大白话：per-IP 硬闸原样保留——同一 IP 连错 5 次后，即便口令正确也被 429 挡（合法单源限速不松）', async () => {
    seedSuper()
    for (let i = 0; i < 5; i++) await post({ action: 'login', key: 'wrong-long-key' }, '3.3.3.3')
    const r = await post({ action: 'login', key: 'super-secret-key' }, '3.3.3.3')
    expect(r.statusCode).toBe(429)
    expect(bodyOf(r).error).toBe('TOO_MANY_ATTEMPTS')
  })
})

// —— #2 createOrder 在途未支付单上限 —— //
const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }
const order = (openid: string, over: Record<string, unknown> = {}) =>
  app({ action: 'createOrder', data: { items: [{ id: 'p1', qty: 1 }], address: ADDR, ...over } }) as Promise<any>
const seedPending = (openid: string, n: number, createdAt = Date.now()) =>
  control.seed(
    'orders',
    Array.from({ length: n }, (_, i) => ({
      _id: `pend:${openid}:${i}`,
      id: `pend:${openid}:${i}`,
      _openid: openid,
      status: 'pending',
      amount: 198,
      createdAt,
      items: [{ productId: 'p1', name: 'x', qty: 1 }],
      reserved: [],
    }))
  )

describe('#2 createOrder 在途未支付单上限（收尾硬化·用户拍板 A：每 openid 封顶 5 单）', () => {
  beforeEach(() => {
    control.reset()
    control.setOpenId('oME')
    control.seed('products', [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198, tag: '基础款' }])
    control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay' }]) // real 模式→建 pending 单持库存锁
  })

  it('大白话：已有 5 张在途 pending 单时，第 6 单被 TOO_MANY_PENDING 拒——不建单不扣库存', async () => {
    seedPending('oME', 5)
    const r = await order('oME')
    expect(r.error).toBe('TOO_MANY_PENDING')
    expect(control.dump('orders').length).toBe(5) // 第 6 单没落库
  })

  it('大白话：未到上限（4 张）时正常建 pending 单', async () => {
    seedPending('oME', 4)
    const r = await order('oME')
    expect(r.error).toBeUndefined()
    expect(r.order && r.order.status).toBe('pending')
    expect(control.dump('orders').length).toBe(5)
  })

  it('大白话：上限按 openid 隔离——oME 满 5 单不影响别的用户下单', async () => {
    seedPending('oME', 5)
    control.setOpenId('oOTHER')
    const r = await order('oOTHER')
    expect(r.error).toBeUndefined()
    expect(r.order && r.order.status).toBe('pending')
  })

  it('大白话：已过支付窗的 pending 单不计入上限（超窗单等回补·不再占额度）', async () => {
    seedPending('oME', 5, Date.now() - 20 * 60 * 1000) // 20min 前·超 15min 支付窗
    const r = await order('oME')
    expect(r.error).toBeUndefined() // 过窗单不计数→放行
    expect(r.order && r.order.status).toBe('pending')
  })
})
