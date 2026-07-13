// E2E·payCallback 幂等/防伪/复活契约（跨状态转移全链）：单 action 测试已覆盖各分支，这里钉「同一回调被
// 微信重复推送、被伪造、金额不符、关单后晚到叠加库存被买走」四种真实到货形态下，钱状态只按一次真相收敛、
// 绝不重复入账/重复告警/超卖。捕获 [LD_ALERT] 单出口验可观测语义。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as payCallback } from '../src/functions/callbacks/payCallback'

const cb = (e: Record<string, unknown>) => payCallback(e) as Promise<any>

const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed('orders', [
    { _id: 'o1', id: 'o1', _openid: 'oME', status: 'pending', amount: 178, createdAt: Date.now(), reserved: [], ...over },
  ])

// 捕获 [LD_ALERT] 单出口（观测语义验证）：restoreStock/notifyAlert 均经 console.error 打结构化行。
function captureAlerts(fn: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => {
    seen.push(String(a[0]))
  }
  return Promise.resolve(fn())
    .then(() => seen)
    .finally(() => {
      console.error = orig
    })
}

beforeEach(() => {
  control.reset()
  control.setOpenId('')
})

describe('payCallback 幂等/防伪/复活跨状态契约（E2E）', () => {
  it('大白话：同一单号成功回调连推 3 次——只入账一次（paidAt/交易号不改写），不重复告警', async () => {
    seedOrder()
    const alerts = await captureAlerts(async () => {
      await cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-a' })
      await cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-b' })
      await cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-c' })
    })
    const o = control.dump('orders')[0]
    expect(o.status).toBe('paid')
    expect(o.transactionId).toBe('wx-a') // 首次生效·后续幂等不改写
    const firstPaidAt = o.paidAt
    expect(firstPaidAt).toBeGreaterThan(0)
    // 金额相符路径本就不告警；重复推送走幂等 no-op 分支——全程零 [LD_ALERT]（不重复告警/不误报未知单）
    expect(alerts.some((l) => l.includes('[LD_ALERT]'))).toBe(false)
  })

  it('大白话：带用户身份的伪造回调（见 OPENID 即拒）——静默 ACK、不写任何订单字段（FORGED_CALLBACK 路径）', async () => {
    seedOrder()
    control.setOpenId('oFORGER') // 真微信回调无用户上下文·有 OPENID 即伪造
    const ack = await cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-x' })
    expect(ack).toEqual({ errcode: 0, errmsg: 'OK' }) // 静默 ACK·不给探测信号
    const o = control.dump('orders')[0]
    expect(o.status).toBe('pending') // 未翻单
    expect(o.transactionId).toBeUndefined()
    expect(o.paidAt).toBeUndefined()
  })

  it('大白话：金额不符——钱已到账仍翻 paid，但留 feeMismatch 对账痕并告警（静默失败语义不丢）', async () => {
    seedOrder()
    const alerts = await captureAlerts(() =>
      cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 1 }, transaction_id: 'wx-m' })
    )
    const o = control.dump('orders')[0]
    expect(o.status).toBe('paid') // 钱已收·不吞
    expect(o.feeMismatch).toBe(true) // 对账痕
    expect(alerts.some((l) => l.includes('[LD_ALERT]') && l.includes('FEE_MISMATCH'))).toBe(true)
  })

  it('大白话：关单后晚到成功回调 + 库存已被买走——进 refund_required 死信、库存不为负、绝不超卖', async () => {
    seedOrder({ status: 'closed', reserved: [{ productId: 'p9', spec: '', qty: 1 }] })
    control.seed('inventory', [{ _id: 'p9__', productId: 'p9', spec: '', stock: 0 }]) // 已被别人买走·抢不回
    const alerts = await captureAlerts(() =>
      cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-oos' })
    )
    const o = control.dump('orders')[0]
    expect(o.status).toBe('refund_required') // 钱已收无法履约→死信·人工退款
    expect(o.feeReceivedAt).toBeGreaterThan(0)
    expect(o.paidFee).toBe(17800)
    expect(control.dump('inventory')[0].stock).toBe(0) // 不为负·未超卖
    expect(alerts.some((l) => l.includes('[LD_ALERT]') && l.includes('PAID_BUT_OOS'))).toBe(true)
  }, 15_000)

  it('大白话：关单后晚到成功回调 + 库存尚可重抢——复活为 paid、扣回库存，不进死信', async () => {
    seedOrder({ status: 'closed', reserved: [{ productId: 'p1', spec: '', qty: 1 }] })
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 1 }]) // 还有货·可复活
    await cb({ out_trade_no: 'o1', trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-rev' })
    const o = control.dump('orders')[0]
    expect(o.status).toBe('paid')
    expect(o.revivedAt).toBeGreaterThan(0)
    expect(control.dump('inventory')[0].stock).toBe(0) // 重抢扣回
  })
})
