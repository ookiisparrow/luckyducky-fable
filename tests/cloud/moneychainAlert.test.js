import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as payCallback } from '../../packages/cloud/src/functions/orders/payCallback'
import { main as refundCallback } from '../../packages/cloud/src/functions/orders/refundCallback'
import { throttleFail } from '../../packages/cloud/src/kit/throttle'

// 钱链可观测告警标记（债#23 代码侧·根因#13/钱链）。平台自带指标（调用量/错误率/P95）看不见
// 「语义级/静默失败」——回调返 ACK 200 但金额不符 / 收到未知订单成功通知 / 退款与单不符 / 防伪
// 命中 / 爆破锁定。这些须打统一可告警标记 [LD_ALERT] sev=money|security，控制台对该关键字配
// 日志告警 + 企微推送。行为守卫（验行为非验存在）：断言失败路径真吐出标记——接入前必红、接入后绿。
let errs
beforeEach(() => {
  control.reset()
  errs = []
  vi.spyOn(console, 'error').mockImplementation((...a) => errs.push(a.join(' ')))
})
afterEach(() => vi.restoreAllMocks())

const alerted = (sev, fn, code) =>
  errs.some(
    (l) =>
      l.includes('[LD_ALERT]') &&
      l.includes('sev=' + sev) &&
      l.includes('fn=' + fn) &&
      l.includes('code=' + code)
  )

describe('钱链可观测告警标记（债#23 代码侧·根因#13）', () => {
  it('payCallback 金额不符 → sev=money FEE_MISMATCH（静默翻 paid 仍须告警）', async () => {
    control.setOpenId('') // 工作流服务端调用（防伪闸放行）
    control.seed('orders', [
      { _id: 'o1', id: 'o1', status: 'pending', amount: 178, createdAt: Date.now() },
    ])
    await payCallback({
      returnCode: 'SUCCESS',
      resultCode: 'SUCCESS',
      outTradeNo: 'o1',
      totalFee: 1,
      transactionId: 't',
    })
    expect(alerted('money', 'payCallback', 'FEE_MISMATCH')).toBe(true)
  })

  it('payCallback 未知订单号成功通知 → sev=money UNKNOWN_ORDER（收钱无单）', async () => {
    control.setOpenId('')
    await payCallback({
      returnCode: 'SUCCESS',
      resultCode: 'SUCCESS',
      outTradeNo: 'ghost',
      totalFee: 100,
    })
    expect(alerted('money', 'payCallback', 'UNKNOWN_ORDER')).toBe(true)
  })

  it('refundCallback 成功通知与售后单不符 → sev=money MISMATCH（拒置已退款）', async () => {
    control.setOpenId('')
    control.seed('afterSales', [
      { _id: 'a1', orderId: 'ord-x', productId: 'p', refundAmount: 50, status: 'approved' },
    ])
    await refundCallback({
      out_refund_no: 'a1',
      out_trade_no: 'WRONG',
      refund_status: 'SUCCESS',
      amount: { refund: 9999 },
    })
    expect(alerted('money', 'refundCallback', 'MISMATCH')).toBe(true)
  })

  it('throttleFail 触发锁定 → sev=security LOCKOUT（爆破信号·当前无任何信号）', async () => {
    const now = Date.now()
    control.seed('rateLimit', [{ _id: 'rl_ipX', fails: 4, windowStart: now }])
    await throttleFail('ipX', { max: 5, windowMs: 60000, lockMs: 60000 })
    expect(alerted('security', 'throttle', 'LOCKOUT')).toBe(true)
  })

  it('notify 防伪命中（带用户身份的伪造回调）→ sev=security FORGED_CALLBACK', async () => {
    control.setOpenId('attacker') // 客户端伪造：callFunction 必带 OPENID
    control.seed('orders', [{ _id: 'o1', id: 'o1', status: 'pending', amount: 178 }])
    await payCallback({
      returnCode: 'SUCCESS',
      resultCode: 'SUCCESS',
      outTradeNo: 'o1',
      totalFee: 17800,
    })
    expect(alerted('security', 'notify', 'FORGED_CALLBACK')).toBe(true)
  })
})
