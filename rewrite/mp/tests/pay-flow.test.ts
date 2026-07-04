// 支付结果映射（黄金 orders-money pay 节的前端半边：0 元直付/已付幂等/收银台五参 fail-closed/
// 关单与未开通如实分诊）（守卫 rw-mp-pay-golden）。
import { describe, it, expect } from 'vitest'
import { mapPayResult } from '../lib/payFlow'

const PAYMENT = { timeStamp: '1719999999', nonceStr: 'n1', package: 'prepay_id=wx123', signType: 'RSA', paySign: 'sig' }

describe('支付结果分诊（fail-closed）', () => {
  it('大白话：0 元单直付成功、并发已付（BAD_STATUS:paid）都判「已付」——不吓用户不重复拉起收银台', () => {
    expect(mapPayResult({ ok: true, paid: true, paidAt: 1 })).toEqual({ kind: 'paid' })
    expect(mapPayResult({ ok: false, error: 'BAD_STATUS:paid' })).toEqual({ kind: 'paid' })
  })

  it('大白话：五参齐全才拉收银台；缺任何一参（半空支付参数=收银台闪退）一律判错不拉起', () => {
    const r = mapPayResult({ ok: true, payment: PAYMENT })
    expect(r.kind).toBe('request')
    if (r.kind === 'request') expect(r.payment).toEqual(PAYMENT)
    for (const missing of ['timeStamp', 'nonceStr', 'package', 'signType', 'paySign']) {
      const broken: Record<string, unknown> = { ...PAYMENT }
      delete broken[missing]
      expect(mapPayResult({ ok: true, payment: broken }).kind, `缺 ${missing}`).toBe('error')
      expect(mapPayResult({ ok: true, payment: { ...PAYMENT, [missing]: '' } }).kind, `空 ${missing}`).toBe('error')
    }
    expect(mapPayResult({ ok: true }).kind).toBe('error') // ok 但无 payment 也不放行
    expect(mapPayResult({ ok: true, payment: { ...PAYMENT, signType: 'FAKE' } }).kind).toBe('error') // 非法签名类型不拉起
  })

  it('大白话：超时关单/支付未开通/通道失败各给对应人话提示；未知错误兜底不裸抛', () => {
    const closed = mapPayResult({ ok: false, error: 'ORDER_CLOSED' })
    expect(closed.kind).toBe('closed')
    expect(mapPayResult({ ok: false, error: 'PAY_NOT_ENABLED' })).toMatchObject({ kind: 'error', message: '支付暂未开通' })
    expect(mapPayResult({ ok: false, error: 'UNIFIED_ORDER_FAIL' }).kind).toBe('error')
    expect(mapPayResult({ ok: false, error: 'WEIRD' }).kind).toBe('error')
    expect(mapPayResult(null).kind).toBe('error') // 脏入参安全
    expect(mapPayResult({ ok: false, error: 'BAD_STATUS:closed' }).kind).toBe('error') // 只有 paid 态判已付·closed 不冒充
  })
})
