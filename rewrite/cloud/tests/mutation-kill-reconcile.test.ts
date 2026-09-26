// 变异分诊：kit/reconcile.ts 存活变异的杀手测试（金额缺失归 0、凭证/商户号缺哪样都拦、落库跳过无单号行、
// 逐笔比对单靠微信单号或单靠商户单号都能对上）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import cloud, { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { toYuanAmount, pullBillDay, matchBillRows } from '../src/kit/reconcile'

const db = cloud.database()
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const DATE = '2026-07-15'
const CSV = [
  '交易时间,公众账号ID,商户号,微信订单号,商户订单号,交易状态,订单金额,退款金额',
  '`2026-07-15 10:00:00,`wxapp,`1113881793,`tx-1,`m1,`SUCCESS,`100.00,`0.00',
  '`2026-07-15 11:00:00,`wxapp,`1113881793,`,`m0,`SUCCESS,`1.00,`0.00',
  '总交易单数,交易总金额,退款总金额',
  '`2,`101.00,`0.00',
].join('\n')
const billFetch = async (url: string) =>
  url.includes('/v3/bill/tradebill')
    ? { status: 200, text: async () => JSON.stringify({ download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=t' }) }
    : { status: 200, text: async () => CSV }

beforeEach(() => control.reset())
afterEach(() => vi.restoreAllMocks())

describe('toYuanAmount', () => {
  it('缺值、null、对象都当 0，不抛错', () => {
    expect(toYuanAmount(undefined)).toBe(0)
    expect(toYuanAmount(null)).toBe(0)
    expect(toYuanAmount({})).toBe(0)
  })
})

describe('pullBillDay 前置条件', () => {
  it('凭证缺私钥或缺证书序列号：都回 NO_WXPAY_CREDS，不往下拉', async () => {
    const fetchImpl = vi.fn(billFetch)
    control.seed(COLLECTIONS.config, [{ _id: 'pay', subMchId: '1113881793' }])
    control.seed(COLLECTIONS.secureConfig, [{ _id: 'wxpay', mchSerial: 'S1' }])
    expect(await pullBillDay(db, DATE, { fetchImpl })).toEqual({ ok: false, error: 'NO_WXPAY_CREDS' })
    control.reset()
    control.seed(COLLECTIONS.config, [{ _id: 'pay', subMchId: '1113881793' }])
    control.seed(COLLECTIONS.secureConfig, [{ _id: 'wxpay', mchPrivateKey: PRIV }])
    expect(await pullBillDay(db, DATE, { fetchImpl })).toEqual({ ok: false, error: 'NO_WXPAY_CREDS' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('支付配置没建档、或建了档没填商户号：都回 NO_MCHID，不往下拉', async () => {
    const fetchImpl = vi.fn(billFetch)
    control.seed(COLLECTIONS.secureConfig, [{ _id: 'wxpay', mchSerial: 'S1', mchPrivateKey: PRIV }])
    expect(await pullBillDay(db, DATE, { fetchImpl })).toEqual({ ok: false, error: 'NO_MCHID' })
    control.seed(COLLECTIONS.config, [{ _id: 'pay', mode: 'real' }])
    expect(await pullBillDay(db, DATE, { fetchImpl })).toEqual({ ok: false, error: 'NO_MCHID' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('pullBillDay 落库', () => {
  it('先确保账单集合存在；没有微信单号的行不落库也不计数', async () => {
    control.seed(COLLECTIONS.secureConfig, [{ _id: 'wxpay', mchSerial: 'S1', mchPrivateKey: PRIV }])
    control.seed(COLLECTIONS.config, [{ _id: 'pay', subMchId: '1113881793' }])
    const created = vi.spyOn(db, 'createCollection')
    const r: any = await pullBillDay(db, DATE, { fetchImpl: billFetch })
    expect(r.ok).toBe(true)
    expect(r.rows).toHaveLength(2)
    expect(r.count).toBe(1)
    expect(control.dump(COLLECTIONS.wxBills).map((b: any) => b._id)).toEqual([`${DATE}:tx-1`])
    expect(created).toHaveBeenCalledWith(COLLECTIONS.wxBills)
  })
})

describe('matchBillRows 两种对上方式', () => {
  const wx = (over: Record<string, unknown>) => ({ tradeState: 'SUCCESS', orderAmount: 1, ...over })

  it('只有微信单号对得上（商户单号不同）：算对平', () => {
    const r = matchBillRows([{ id: 'A', transactionId: 'T1', amount: 1 }], [wx({ transactionId: 'T1', outTradeNo: 'X' })])
    expect(r).toEqual({ matched: ['A'], wxOnly: [], amountMismatch: [] })
  })

  it('只有商户单号对得上（我方还没记微信单号）：算对平', () => {
    const r = matchBillRows([{ id: 'B', amount: 1 }], [wx({ transactionId: 'T9', outTradeNo: 'B' })])
    expect(r).toEqual({ matched: ['B'], wxOnly: [], amountMismatch: [] })
  })
})
