// #400-30：对账按窗读全，不再只取「最新 1000 条」再在内存里筛窗。
// 大白话锁法：窗外（更新的）单堆满 1000 条时，窗内的单照样要算进来、配得上账单；真读不完才标近似。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import cloud, { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { runBillReconcile } from '../src/functions/timers/billReconcile'
import { RECON_WINDOW_MAX } from '../src/kit'

const db = cloud.database()
const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '7.7.7.7' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const DAY = 86400_000
const IN = Date.parse('2026-07-01T12:00:00+08:00') // 窗内（7/1）
const LATER = Date.parse('2026-07-10T12:00:00+08:00') // 窗外、比窗更新
const paid = (id: string, paidAt: number, over: Record<string, unknown> = {}) => ({
  _id: id, id, _openid: 'x', status: 'paid', amount: 1, transactionId: 'tx-' + id, paidAt, createdAt: paidAt, items: [], ...over,
})
const newer = (n: number) => Array.from({ length: n }, (_, i) => paid('n' + i, LATER + i))

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})

describe('getReconciliation：窗内的单不能被更新的单挤掉', () => {
  it('大白话：7/10 之后已有 1000 单，查 7/1 当天——7/1 的 3 单照样算进收入，不标近似', async () => {
    control.seed('orders', [...newer(1000), paid('a', IN, { amount: 10 }), paid('b', IN + 1, { amount: 20 }), paid('c', IN + 2, { amount: 30 })])
    const r = await post('getReconciliation', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.ok).toBe(true)
    expect(r.summary.orders).toBe(3)
    expect(r.summary.income).toBe(60)
    expect(r.approx).toBe(false)
  })

  it('大白话：已退款同理——更新的 1000 笔退款不挤掉窗内那 2 笔', async () => {
    const rf = (id: string, at: number, amt: number) => ({ _id: id, orderId: 'o-' + id, status: 'refunded', refundAmount: amt, refundedAt: at, appliedAt: at })
    control.seed('afterSales', [...Array.from({ length: 1000 }, (_, i) => rf('r' + i, LATER + i, 1)), rf('x', IN, 5), rf('y', IN + 1, 7)])
    const r = await post('getReconciliation', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.summary.refunds).toBe(2)
    expect(r.summary.refund).toBe(12)
    expect(r.approx).toBe(false)
  })

  it('大白话：窗内单数真超过读取上限——标近似给人看，已读的只到上限', async () => {
    control.seed('orders', Array.from({ length: RECON_WINDOW_MAX + 1 }, (_, i) => paid('w' + i, IN + i)))
    const r = await post('getReconciliation', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.approx).toBe(true)
    expect(r.summary.orders).toBe(RECON_WINDOW_MAX)
  }, 20_000)

  it('大白话：窗内恰好等于上限——读全了，不标近似', async () => {
    control.seed('orders', Array.from({ length: RECON_WINDOW_MAX }, (_, i) => paid('w' + i, IN + i)))
    const r = await post('getReconciliation', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.approx).toBe(false)
    expect(r.summary.orders).toBe(RECON_WINDOW_MAX)
  }, 20_000)
})

describe('getBillMatch：老窗口的真单不被误报「微信有我方无」', () => {
  it('大白话：7/10 之后已有 1000 单，核 7/1 的账单——7/1 那单配得上，不进最危险类', async () => {
    control.seed('orders', [...newer(1000), paid('old', IN, { amount: 100 })])
    control.seed('wxBills', [{ _id: '2026-07-01:tx-old', date: '2026-07-01', transactionId: 'tx-old', outTradeNo: 'old', orderAmount: 100, tradeState: 'SUCCESS' }])
    const r = await post('getBillMatch', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.ok).toBe(true)
    expect(r.summary.wxOnly).toBe(0)
    expect(r.summary.matched).toBe(1)
    expect(r.approx).toBe(false)
  })

  it('大白话：账单行同理——之后几天已落 1000 行账单，7/1 的账单行照样进比对', async () => {
    control.seed('orders', [paid('old', IN, { amount: 100 })])
    control.seed('wxBills', [
      ...Array.from({ length: 1000 }, (_, i) => ({ _id: `2026-07-1${i % 5}:t${i}`, date: `2026-07-1${i % 5}`, transactionId: 't' + i, outTradeNo: 'z' + i, orderAmount: 1, tradeState: 'SUCCESS' })),
      { _id: '2026-07-01:tx-old', date: '2026-07-01', transactionId: 'tx-old', outTradeNo: 'old', orderAmount: 100, tradeState: 'SUCCESS' },
    ])
    const r = await post('getBillMatch', { from: '2026-07-01', to: '2026-07-01' })
    expect(r.billDays).toEqual(['2026-07-01'])
    expect(r.summary).toEqual({ matched: 1, wxOnly: 0, oursOnly: 0, amountMismatch: 0 })
    expect(r.approx).toBe(false)
  })
})

describe('billReconcile：日单量过千也照判「微信有我方无」', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const NOW = Date.parse('2026-07-16T12:00:00+08:00')
  const D15 = Date.parse('2026-07-15T00:00:00+08:00')
  const csv = (rows: string[]) =>
    ['交易时间,公众账号ID,商户号,微信订单号,商户订单号,交易状态,订单金额,退款金额', ...rows, '总交易单数,交易总金额,退款总金额', `\`${rows.length},\`0.00,\`0.00`].join('\n')
  const BILL = csv([
    '`2026-07-15 00:00:01,`wxapp,`1113881793,`tx-first,`first,`SUCCESS,`1.00,`0.00', // 当天最早那单：老代码截断时读不到它
    '`2026-07-15 10:00:00,`wxapp,`1113881793,`tx-ghost,`ghost,`SUCCESS,`5.00,`0.00', // 我方没有这单
  ])
  const billFetch = async (url: string) =>
    url.includes('/v3/bill/tradebill')
      ? { status: 200, text: async () => JSON.stringify({ download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=t' }) }
      : { status: 200, text: async () => BILL }

  beforeEach(() => {
    control.seed(COLLECTIONS.secureConfig, [{ _id: 'wxpay', mchSerial: 'S', mchPrivateKey: PRIV }])
    control.seed(COLLECTIONS.config, [{ _id: 'pay', subMchId: '1113881793' }])
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ errcode: 0 }), text: async () => '{"errcode":0}' }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('大白话：宽窗里有 1200 单——全读进来，当天最早那单配得上，幽灵单照样判出来', async () => {
    control.seed('orders', [
      paid('first', D15 + 1000),
      ...Array.from({ length: 1199 }, (_, i) => paid('d' + i, D15 + 3600_000 + i * 60_000)),
    ])
    const r: any = await runBillReconcile(db, { now: NOW, fetchImpl: billFetch })
    expect(r.truncated).toBeUndefined()
    expect(r.wxOnly).toBe(1)
    const wxOnly = control.dump('anomalies').filter((a: any) => a.code === 'BILL_WX_ONLY')
    expect(wxOnly.map((a: any) => a.ctx.outTradeNo)).not.toContain('first')
    expect(wxOnly).toHaveLength(1)
  }, 20_000)

  it('大白话：宽窗外（更早/更晚）的单不进比对面，也不占读取额度', async () => {
    control.seed('orders', [paid('first', D15 + 1000), paid('early', D15 - 2 * DAY), paid('late', D15 + 3 * DAY)])
    const r: any = await runBillReconcile(db, { now: NOW, fetchImpl: billFetch, cap: 1 })
    expect(r.truncated).toBeUndefined() // 窗内只有 1 单，cap=1 读全了
    expect(r.wxOnly).toBe(1)
  })
})
