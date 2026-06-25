import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/orders/refundCallback'

// refundCallback 幂等：applied/approved → refunded 只生效一次；非 SUCCESS 留痕不翻状态；订单留痕。
const NOTIFY = {
  out_refund_no: 'o1__prod-1',
  out_trade_no: 'o1',
  refund_status: 'SUCCESS',
  transaction_id: 'tx-refund-1',
  amount: { refund: 17800, total: 17800 },
}

beforeEach(() => {
  control.reset()
  control.setOpenId('') // 工作流服务端调用无用户上下文（防伪闸放行通道）
  control.seed('afterSales', [
    { _id: 'o1__prod-1', orderId: 'o1', productId: 'prod-1', status: 'approved', refundAmount: 178 },
    { _id: 'o2__yarn', orderId: 'o2', productId: 'yarn', status: 'refunded', refundAmount: 26.44, refundedAt: 111, refundTransactionId: 'tx-old' },
  ])
  control.seed('orders', [
    { _id: 'o1', id: 'o1', status: 'paid', amount: 178 },
    { _id: 'o2', id: 'o2', status: 'paid', amount: 207 },
  ])
})

describe('refundCallback 回调幂等', () => {
  it('SUCCESS：approved → refunded + 交易号 + 订单留痕 refunded.<productId>', async () => {
    const res = await main(NOTIFY)
    expect(res.errcode).toBe(0)
    const as = control.dump('afterSales').find((a) => a._id === 'o1__prod-1')
    expect(as.status).toBe('refunded')
    expect(as.refundTransactionId).toBe('tx-refund-1')
    const o1 = control.dump('orders').find((o) => o._id === 'o1')
    expect(o1.refunded['prod-1']).toBe(178)
  })

  it('幂等：已 refunded 的单收到重复通知不改写', async () => {
    await main({
      ...NOTIFY,
      out_refund_no: 'o2__yarn',
      out_trade_no: 'o2',
      amount: { refund: 2644, total: 20700 },
      transaction_id: 'tx-dup',
    })
    const as = control.dump('afterSales').find((a) => a._id === 'o2__yarn')
    expect(as.refundedAt).toBe(111)
    expect(as.refundTransactionId).toBe('tx-old')
  })

  it('核验 fail-closed：订单号不符 → 留 refundMismatch 痕、不置已退款', async () => {
    await main({ ...NOTIFY, out_trade_no: 'o999' })
    const as = control.dump('afterSales').find((a) => a._id === 'o1__prod-1')
    expect(as.status).toBe('approved')
    expect(as.refundMismatch).toBe(true)
  })

  it('核验 fail-closed：退款金额不符 → 留痕、不置已退款', async () => {
    await main({ ...NOTIFY, amount: { refund: 1, total: 17800 } })
    const as = control.dump('afterSales').find((a) => a._id === 'o1__prod-1')
    expect(as.status).toBe('approved')
    expect(as.refundMismatch).toBe(true)
  })

  it('防伪闸：带用户身份的调用（客户端伪造）一律不改状态', async () => {
    control.setOpenId('attacker-openid')
    const res = await main(NOTIFY)
    expect(res.errcode).toBe(0)
    expect(control.dump('afterSales').find((a) => a._id === 'o1__prod-1').status).toBe('approved')
  })

  it('非 SUCCESS（CLOSED/ABNORMAL）：留 refundStatus 痕、状态不翻', async () => {
    await main({ ...NOTIFY, refund_status: 'ABNORMAL' })
    const as = control.dump('afterSales').find((a) => a._id === 'o1__prod-1')
    expect(as.status).toBe('approved')
    expect(as.refundStatus).toBe('ABNORMAL')
  })

  it('未知售后单 / 缺单号：ACK 不抛', async () => {
    expect((await main({ ...NOTIFY, out_refund_no: 'nope' })).errcode).toBe(0)
    expect((await main({})).errcode).toBe(0)
  })

  it('回补库存：订单未发货(paid) → 退款成功回补该条目库存', async () => {
    control.seed('inventory', [{ _id: 'prod-9__', productId: 'prod-9', spec: '', stock: 5 }])
    control.seed('afterSales', [{ _id: 'o9__prod-9', orderId: 'o9', productId: 'prod-9', spec: '', qty: 2, status: 'approved', refundAmount: 10 }])
    control.seed('orders', [{ _id: 'o9', id: 'o9', status: 'paid', amount: 10 }])
    await main({ out_refund_no: 'o9__prod-9', out_trade_no: 'o9', refund_status: 'SUCCESS', transaction_id: 'tx9', amount: { refund: 1000, total: 1000 } })
    expect(control.dump('inventory').find((i) => i._id === 'prod-9__').stock).toBe(7) // 5+2 回补
  })

  it('不回补库存：订单已发货(shipped) → 退款仍完成，但实物已出库不回补（防幻影库存超卖·审计 P1）', async () => {
    control.seed('inventory', [{ _id: 'prod-8__', productId: 'prod-8', spec: '', stock: 5 }])
    control.seed('afterSales', [{ _id: 'o8__prod-8', orderId: 'o8', productId: 'prod-8', spec: '', qty: 2, status: 'approved', refundAmount: 10 }])
    control.seed('orders', [{ _id: 'o8', id: 'o8', status: 'shipped', amount: 10 }])
    const res = await main({ out_refund_no: 'o8__prod-8', out_trade_no: 'o8', refund_status: 'SUCCESS', transaction_id: 'tx8', amount: { refund: 1000, total: 1000 } })
    expect(res.errcode).toBe(0)
    expect(control.dump('afterSales').find((a) => a._id === 'o8__prod-8').status).toBe('refunded') // 退款正常完成
    expect(control.dump('inventory').find((i) => i._id === 'prod-8__').stock).toBe(5) // 实物已发·不回补
  })
})
