// 变异分诊：timers/closeExpiredOrders.ts 存活变异的杀手测试（抢占失败不回补不计数、单单写失败不拖垮整批、告警落账）。
import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { main as closeExpired } from '../src/functions/timers/closeExpiredOrders'

const HOUR = 60 * 60 * 1000
const expiredOrder = (id: string, over: Record<string, unknown> = {}) => ({
  _id: id,
  id,
  status: 'pending',
  createdAt: Date.now() - HOUR,
  reserved: [{ productId: 'p1', spec: '', qty: 1 }],
  ...over,
})

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 0 }])
})

describe('closeExpiredOrders 杀手测试', () => {
  it('关单写之前被并发付款抢先：这单不算关掉、库存不回补', async () => {
    control.seed('orders', [expiredOrder('e1')])
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === 'orders' && data.status === 'closed')
        await cloud.database().collection('orders').doc('e1').update({ data: { status: 'paid' } })
    })
    const r: any = await closeExpired()
    expect(r).toEqual({ ok: true, closed: 0 })
    expect(control.dump('orders')[0].status).toBe('paid')
    expect(control.dump('inventory')[0].stock).toBe(0)
  })

  it('某一单关单写抛错：跳过这单，其余照关，整批不报错', async () => {
    control.seed('orders', [expiredOrder('e1'), expiredOrder('e2')])
    let n = 0
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === 'orders' && data.status === 'closed' && n++ === 0) throw new Error('MOCK_WRITE_FAIL')
    })
    const r: any = await closeExpired()
    expect(r).toEqual({ ok: true, closed: 1 })
    expect(control.dump('inventory')[0].stock).toBe(1)
  })

  it('老单没有 reserved 字段：照常关，不报错', async () => {
    control.seed('orders', [expiredOrder('e1', { reserved: undefined })])
    const r: any = await closeExpired()
    expect(r).toEqual({ ok: true, closed: 1 })
    expect(control.dump('orders')[0].status).toBe('closed')
  })

  it('读待关单失败：告警按钱链级别落进异常账本、带函数名', async () => {
    control.seed('orders', [expiredOrder('e1')])
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'orders' && a.filter) throw new Error('MOCK_READ_FAIL')
    })
    await closeExpired()
    const a = control.dump('anomalies').find((x: any) => x.code === 'EXPIRED_ORDERS_READ_FAIL')
    expect(a.kind).toBe('flow-failure')
    expect(a.ctx).toEqual({ fn: 'closeExpiredOrders' })
  })
})
