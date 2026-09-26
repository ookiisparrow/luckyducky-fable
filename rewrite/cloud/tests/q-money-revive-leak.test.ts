// 关单后晚到的支付回调复活时，库存已经抢到手、订单却没翻成 paid：抢到的那份必须还回去，
// 否则每轮微信重推都再抢一份、永久少记库存。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as payCallback } from '../src/functions/callbacks/payCallback'

const payEvent = { out_trade_no: 'o1', trade_state: 'SUCCESS', transaction_id: 'txn-1', amount: { payer_total: 10000, total: 10000 } }
const stock = () => control.dump('inventory')[0].stock

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('orders', [{ _id: 'o1', amount: 100, status: 'closed', closedAt: 100, reserved: [{ productId: 'p1', spec: '', qty: 1 }], createdAt: 1 }])
  control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 5 }])
})

describe('payCallback 复活失败不漏库存', () => {
  it('大白话：复活时重读订单失败——抛错不 ACK，抢到的库存还回去，重推几轮库存都不少', async () => {
    let orderReads = 0
    // 第 1 次读＝初读，第 2 次＝pending→paid 流转里的读，第 3 次＝复活流转里的读
    control.setBeforeGet(async (a: any) => {
      if (a.coll === 'orders' && a.id === 'o1' && ++orderReads % 3 === 0) throw new Error('DB_TIMEOUT')
    })
    for (let i = 0; i < 3; i++) await expect(payCallback(payEvent)).rejects.toThrow()
    expect(stock()).toBe(5)
    expect(control.dump('orders')[0].status).toBe('closed')
  })

  it('大白话：复活的写其实落地了、只是回包报错——单已 paid 占着这份库存，不能还（还了就超卖）', async () => {
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll !== 'orders' || data.status !== 'paid') return
      ;(globalThis as any).__cloudMock.store.orders[0].status = 'paid'
      throw new Error('NETWORK_RESET_AFTER_COMMIT')
    })
    await expect(payCallback(payEvent)).rejects.toThrow()
    expect(control.dump('orders')[0].status).toBe('paid')
    expect(stock()).toBe(4)
  })
})
