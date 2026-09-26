// 对账口径：refund_required / payment_exception 也收了钱，不能被报成「微信有我方无」、也要算进收入；
// 凭证/配置读失败要告警走错误出口，不能当「未配置」静默跳过。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import cloud, { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { main as payCallback } from '../src/functions/callbacks/payCallback'
import { runBillReconcile } from '../src/functions/timers/billReconcile'

const db = cloud.database()
const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))
const alerted = (code: string) => control.dump('anomalies').some((a: any) => a.code === code)

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const NOW = Date.parse('2026-07-16T12:00:00+08:00')
const DATE = '2026-07-15'
const paidAt = NOW - 86400_000
const csv = (rows: string[]) =>
  ['交易时间,公众账号ID,商户号,微信订单号,商户订单号,交易状态,订单金额,退款金额', ...rows, '总交易单数,交易总金额,退款总金额', `\`${rows.length},\`0.00,\`0.00`].join('\n')
const billFetch = (body: string) => async (url: string) =>
  url.includes('/v3/bill/tradebill')
    ? { status: 200, text: async () => JSON.stringify({ download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=t' }) }
    : { status: 200, text: async () => body }
const BILL = csv([
  '`2026-07-15 10:00:00,`wxapp,`1113881793,`tx-rr,`mRR,`SUCCESS,`50.00,`0.00',
  '`2026-07-15 11:00:00,`wxapp,`1113881793,`tx-pe,`mPE,`SUCCESS,`60.00,`0.00',
])
const seedCreds = () => {
  control.seed(COLLECTIONS.secureConfig, [{ _id: 'wxpay', mchSerial: 'TESTSERIAL123', mchPrivateKey: PRIV }])
  control.seed(COLLECTIONS.config, [{ _id: 'pay', subMchId: '1113881793' }])
}
const seedReceived = () =>
  control.seed('orders', [
    { _id: 'mRR', id: 'mRR', _openid: 'x', status: 'refund_required', amount: 50, transactionId: 'tx-rr', paidAt, items: [] },
    { _id: 'mPE', id: 'mPE', _openid: 'x', status: 'payment_exception', amount: 50, paidFee: 6000, transactionId: 'tx-pe', paidAt, items: [] },
  ])

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ errcode: 0 }), text: async () => '{}' }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('已收款的异常单进对账口径', () => {
  it('大白话：每日对账不把待退款/支付异常单报成「微信有我方无」；支付异常单如实报金额不符', async () => {
    seedCreds()
    seedReceived()
    const r: any = await runBillReconcile(db, { now: NOW, fetchImpl: billFetch(BILL) })
    expect(r.wxOnly).toBe(0)
    expect(r.amountMismatch).toBe(1)
    expect(alerted('BILL_WX_ONLY')).toBe(false)
  })

  it('大白话：后台逐笔对账同口径', async () => {
    seedReceived()
    control.seed(COLLECTIONS.wxBills, [
      { _id: `${DATE}:tx-rr`, date: DATE, transactionId: 'tx-rr', outTradeNo: 'mRR', tradeState: 'SUCCESS', orderAmount: 50 },
      { _id: `${DATE}:tx-pe`, date: DATE, transactionId: 'tx-pe', outTradeNo: 'mPE', tradeState: 'SUCCESS', orderAmount: 60 },
    ])
    const r = await post('getBillMatch', { from: DATE, to: DATE })
    expect(r.summary).toEqual({ matched: 1, wxOnly: 0, oursOnly: 0, amountMismatch: 1 })
  })

  it('大白话：内部对账的收入也算上待退款单（它的退款照常扣，口径才一致）', async () => {
    control.seed('orders', [
      { _id: 'mP', id: 'mP', status: 'paid', amount: 100, paidAt, items: [] },
      { _id: 'mRR', id: 'mRR', status: 'refund_required', amount: 50, paidAt, items: [] },
    ])
    const r = await post('getReconciliation', { from: DATE, to: DATE })
    expect(r.cumulative.income).toBe(150)
    expect(r.summary.income).toBe(150)
  })

  it('大白话：支付异常单按实际到账（paidFee 分）计收入，不按订单标价——它的退款也按到账额算', async () => {
    control.seed('orders', [
      { _id: 'mP', id: 'mP', status: 'paid', amount: 100, paidAt, items: [] },
      { _id: 'mPE', id: 'mPE', status: 'payment_exception', amount: 50, paidFee: 6000, paidAt, items: [] },
    ])
    const r = await post('getReconciliation', { from: DATE, to: DATE })
    expect(r.cumulative.income).toBe(160)
    expect(r.summary.income).toBe(160)
    expect(r.daily[0].income).toBe(160)
  })

  it('大白话：关单后晚到的付款、库存已被买走——待退款单也记下收款时间，对账按它归日', async () => {
    control.seed('orders', [{ _id: 'o1', id: 'o1', amount: 100, status: 'closed', reserved: [{ productId: 'p1', spec: '', qty: 1 }], createdAt: 1 }])
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 0 }])
    await payCallback({ out_trade_no: 'o1', trade_state: 'SUCCESS', transaction_id: 't', amount: { total: 10000 } })
    const o = control.dump('orders')[0]
    expect(o.status).toBe('refund_required')
    expect(typeof o.paidAt).toBe('number')
  }, 10_000)
})

describe('凭证/配置读失败≠未配置', () => {
  const failOn = (coll: string) =>
    control.setBeforeGet(async (a: any) => {
      if (a.coll === coll && a.id) throw new Error('MOCK_READ_FAIL')
    })

  it('大白话：商户凭证读失败——告警并报错，不记成「未配置」跳过', async () => {
    seedCreds()
    failOn(COLLECTIONS.secureConfig)
    const r: any = await runBillReconcile(db, { now: NOW, fetchImpl: billFetch(BILL) })
    expect(r.skipped).toBeUndefined()
    expect(r.error).toBe('CREDS_READ_FAIL')
    expect(alerted('BILL_RECON_NOT_CONFIGURED')).toBe(false)
    expect(alerted('BILL_FETCH_FAIL')).toBe(true)
  })

  it('大白话：商户号配置读失败——同样告警报错', async () => {
    seedCreds()
    failOn(COLLECTIONS.config)
    const r: any = await runBillReconcile(db, { now: NOW, fetchImpl: billFetch(BILL) })
    expect(r.error).toBe('CONFIG_READ_FAIL')
    expect(alerted('BILL_RECON_NOT_CONFIGURED')).toBe(false)
  })

  it('大白话：真没配凭证——仍是「未配置」跳过（不打扰）', async () => {
    const r: any = await runBillReconcile(db, { now: NOW, fetchImpl: billFetch(BILL) })
    expect(r.skipped).toBe('NOT_CONFIGURED')
  })
})
