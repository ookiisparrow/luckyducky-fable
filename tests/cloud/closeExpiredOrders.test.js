import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../cloudfunctions/closeExpiredOrders/index.js'

// 超时关单：只关超 15 分钟的 pending；新 pending 和其他状态不动。
beforeEach(() => {
  control.reset()
  control.seed('orders', [
    { _id: 'fresh', id: 'fresh', status: 'pending', createdAt: Date.now() - 5 * 60 * 1000 },
    { _id: 'old', id: 'old', status: 'pending', createdAt: Date.now() - 16 * 60 * 1000 },
    { _id: 'old2', id: 'old2', status: 'pending', createdAt: Date.now() - 60 * 60 * 1000 },
    { _id: 'oldpaid', id: 'oldpaid', status: 'paid', createdAt: Date.now() - 24 * 3600 * 1000 },
  ])
})

describe('closeExpiredOrders 定时关单', () => {
  it('只关超时 pending，返回关单数；其余不动', async () => {
    const res = await main()
    expect(res).toMatchObject({ ok: true, closed: 2 })
    const byId = Object.fromEntries(control.dump('orders').map((o) => [o._id, o]))
    expect(byId.fresh.status).toBe('pending')
    expect(byId.old.status).toBe('closed')
    expect(byId.old.closedAt).toBeGreaterThan(0)
    expect(byId.old2.status).toBe('closed')
    expect(byId.oldpaid.status).toBe('paid')
  })

  it('无超时单：closed=0 不抛', async () => {
    await main() // 第一遍关掉旧单
    expect((await main()).closed).toBe(0)
  })
})
