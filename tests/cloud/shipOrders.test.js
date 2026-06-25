import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { shipOrders } from '../../packages/cloud/src/functions/admin/adminApi/actions/orders'

// 批量发货（P1·上量瓶颈）：多选订单一次发。逐单走与 shipOrder 同一核心 shipOne（状态闸 paid/shipped +
// feeMismatch 挡单 + 条件转移防并发 + 微信 upload_shipping_info 合规上报），一单失败不影响其余、per-order 回报。
// 电子面单取号/打印需快递 API 账号·诚实延后（不在此造）。
const db = cloud.database()
const ctx = (data) => ({ db, cloud, data })
const parse = (res) => JSON.parse(res.body)

beforeEach(() => control.reset())

describe('shipOrders 批量发货（P1）', () => {
  it('逐单各自独立：成功 / feeMismatch 挡 / 坏状态 / 缺单 分别回报', async () => {
    control.seed('orders', [
      { _id: 'o1', _openid: 'b1', status: 'paid', transactionId: 'tx1', amount: 19800 },
      { _id: 'o2', _openid: 'b2', status: 'paid', feeMismatch: true, transactionId: 'tx2', amount: 5000 },
      { _id: 'o3', _openid: 'b3', status: 'pending', transactionId: 'tx3', amount: 3000 },
      // o4 不 seed → NO_ORDER
    ])
    const r = parse(
      await shipOrders(
        ctx({
          company: '顺丰',
          items: [
            { id: 'o1', trackingNo: 'SF1' },
            { id: 'o2', trackingNo: 'SF2' },
            { id: 'o3', trackingNo: 'SF3' },
            { id: 'o4', trackingNo: 'SF4' },
          ],
        })
      )
    )
    expect(r.ok).toBe(true)
    expect(r.okCount).toBe(1)
    expect(r.failCount).toBe(3)
    const byId = Object.fromEntries(r.results.map((x) => [x.id, x]))
    expect(byId.o1.ok).toBe(true)
    expect(byId.o2.error).toBe('FEE_MISMATCH_HOLD')
    expect(byId.o3.error).toBe('BAD_STATUS:pending')
    expect(byId.o4.error).toBe('NO_ORDER')
    // o1 真翻 shipped + 写运单
    const o1 = control.dump('orders').find((d) => d._id === 'o1')
    expect(o1.status).toBe('shipped')
    expect(o1.shipping).toEqual({ company: '顺丰', trackingNo: 'SF1' })
  })

  it('逐单可带自己的快递公司（覆盖整批 company）', async () => {
    control.seed('orders', [{ _id: 'o1', _openid: 'b1', status: 'paid', transactionId: 'tx1', amount: 100 }])
    const r = parse(await shipOrders(ctx({ company: '顺丰', items: [{ id: 'o1', trackingNo: 'T1', company: '中通' }] })))
    expect(r.okCount).toBe(1)
    expect(control.dump('orders').find((d) => d._id === 'o1').shipping.company).toBe('中通')
  })

  it('空 items → BAD_ARGS', async () => {
    const r = parse(await shipOrders(ctx({ items: [] })))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('BAD_ARGS')
  })
})
