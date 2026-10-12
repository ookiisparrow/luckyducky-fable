// 看板「待发货」扫描有界：全额退款的单永远停在 paid，逐页翻全部 paid 单会随历史线性变长、撞 30s 超时。
// 锁法：paid 单远超扫描上限时，读订单的次数有上限、标 approx.toShip:true；没触顶时 approx.toShip:false。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '8.8.8.8' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => JSON.parse(r.body))

const ord = (id: string, createdAt: number) => ({
  _id: id, id, _openid: 'oX', status: 'paid', amount: 198, reserved: [], transactionId: 'wx-' + id, createdAt,
  items: [{ lineId: 'p1__', productId: 'p1', spec: '', name: '小鸭', price: 198, qty: 1 }],
})

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})

describe('getDashboard.toShip：扫描有界、触顶如实标', () => {
  it('大白话：3000 张 paid 单——只翻到上限就停，数的是最新那批，标「约」', async () => {
    control.seed('orders', Array.from({ length: 3000 }, (_, i) => ord('o' + i, 1000 + i)))
    let paidReads = 0
    control.setBeforeGet(async ({ coll, filter }: any) => {
      if (coll === 'orders' && filter && filter.status === 'paid') paidReads++
    })
    const d = await post('getDashboard')
    expect(d.ok).toBe(true)
    expect(d.approx.toShip).toBe(true)
    expect(d.toShip).toBe(2000)
    expect(paidReads).toBeLessThanOrEqual(20) // 10 页 × 每页至多两次查询
  })

  it('大白话：没触顶——照数全，「约」标是 false', async () => {
    control.seed('orders', Array.from({ length: 450 }, (_, i) => ord('o' + i, 1000 + i)))
    const d = await post('getDashboard')
    expect(d.toShip).toBe(450)
    expect(d.approx.toShip).toBe(false)
  })
})
