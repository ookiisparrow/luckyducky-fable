import { describe, it, expect, beforeEach } from 'vitest'
import { generateKeyPairSync, createVerify } from 'crypto'
import cloud, { control } from 'wx-server-sdk'
import { wxpaySign, parseTradeBill, fetchTradeBill, normalizePem } from '../../packages/cloud/src/kit/wxpay'
import { downloadBill, upsertBills } from '../../packages/cloud/src/functions/admin/adminApi/actions/wxbill'

// S16 外部对账 Batch 2（离线基础）：微信支付 v3 签名器 + 账单 CSV 解析 + 落 wxBills。
// 真账单出站（fetchTradeBill 默认走 https）= 凭证 spike 验·此处只锁离线可测的密码学/解析/幂等/fail-soft。
const db = cloud.database()
const parse = (res) => JSON.parse(res.body)

// 测试用 RSA 密钥对（验签名密码学正确·非字符串形状·根因#8 拿到≠用通）
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString()

// 微信交易账单 CSV 样本：首行表头·数据行每字段反引号前缀·末两行汇总（须跳过）
const SAMPLE_CSV = [
  '交易时间,公众账号ID,商户号,微信订单号,商户订单号,交易状态,订单金额,退款金额',
  '`2026-06-24 10:00:00,`wxapp,`1113881793,`4200001,`o1,`SUCCESS,`100.00,`0.00',
  '`2026-06-24 11:00:00,`wxapp,`1113881793,`4200002,`o2,`REFUND,`50.00,`20.00',
  '总交易单数,交易总金额,退款总金额',
  '`2,`150.00,`20.00',
].join('\n')

beforeEach(() => {
  control.reset()
  process.env.WXPAY_MCH_SERIAL = 'TESTSERIAL123'
  process.env.WXPAY_MCH_PRIVATE_KEY = PRIV
})

describe('wxpaySign — APIv3 RSA-SHA256 签名（密码学正确）', () => {
  it('签名可被对应公钥验证通过 + header 含 mchid/serial/nonce/timestamp', () => {
    const urlPath = '/v3/bill/tradebill?bill_date=2026-06-24&bill_type=ALL'
    const auth = wxpaySign({
      method: 'GET',
      urlPath,
      body: '',
      mchid: '1113881793',
      serial: 'ABC',
      privateKey: PRIV,
      timestamp: '1700000000',
      nonce: 'testnonce',
    })
    expect(auth).toMatch(/^WECHATPAY2-SHA256-RSA2048 /)
    expect(auth).toMatch(/mchid="1113881793"/)
    expect(auth).toMatch(/serial_no="ABC"/)
    expect(auth).toMatch(/nonce_str="testnonce"/)
    expect(auth).toMatch(/timestamp="1700000000"/)
    const sig = auth.match(/signature="([^"]+)"/)[1]
    // 重建被签消息（METHOD\nURL\nTS\nNONCE\nBODY\n）并验签
    const message = `GET\n${urlPath}\n1700000000\ntestnonce\n\n`
    expect(createVerify('RSA-SHA256').update(message).verify(PUB, sig, 'base64')).toBe(true)
  })
})

describe('normalizePem — 还原塌行的 PEM 私钥（修 DECODER unsupported）', () => {
  it('换行被空格塌掉的 PEM → 重建后可正常签名验签', () => {
    const mangled = PRIV.replace(/\n/g, ' ') // 模拟控制台把换行塌成空格（泄露输出实见此形）
    const fixed = normalizePem(mangled)
    expect(fixed).toMatch(/-----BEGIN PRIVATE KEY-----\n/)
    expect(fixed).toMatch(/\n-----END PRIVATE KEY-----/)
    const auth = wxpaySign({ method: 'GET', urlPath: '/x', body: '', mchid: 'm', serial: 's', privateKey: fixed, timestamp: '1', nonce: 'n' })
    const sig = auth.match(/signature="([^"]+)"/)[1]
    expect(createVerify('RSA-SHA256').update('GET\n/x\n1\nn\n\n').verify(PUB, sig, 'base64')).toBe(true)
  })
  it('字面 \\n 塌行也能还原成规范 PEM', () => {
    expect(normalizePem(PRIV.replace(/\n/g, '\\n'))).toMatch(/-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=]/)
  })
})

describe('parseTradeBill — 微信交易账单 CSV 解析', () => {
  it('按表头取列·数据行去反引号·跳汇总行', () => {
    const rows = parseTradeBill(SAMPLE_CSV)
    expect(rows.length).toBe(2)
    expect(rows[0]).toMatchObject({ outTradeNo: 'o1', transactionId: '4200001', orderAmount: 100, refundAmount: 0, tradeState: 'SUCCESS' })
    expect(rows[1]).toMatchObject({ outTradeNo: 'o2', transactionId: '4200002', orderAmount: 50, refundAmount: 20, tradeState: 'REFUND' })
  })
  it('空/异常 CSV 返空数组（不抛）', () => {
    expect(parseTradeBill('')).toEqual([])
    expect(parseTradeBill('仅表头\n')).toEqual([])
  })
})

describe('fetchTradeBill — 注入 mock fetch（两段签名请求）', () => {
  it('先查账单得 download_url·再下载得 CSV·解析出行', async () => {
    const calls = []
    const mockFetch = async (url) => {
      calls.push(url)
      if (url.includes('/v3/bill/tradebill?')) {
        return { status: 200, text: async () => JSON.stringify({ download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=xyz' }) }
      }
      if (url.includes('/v3/billdownload/file')) return { status: 200, text: async () => SAMPLE_CSV }
      return { status: 404, text: async () => '' }
    }
    const r = await fetchTradeBill({ date: '2026-06-24', mchid: 'm', serial: 's', privateKey: PRIV }, mockFetch)
    expect(r.ok).toBe(true)
    expect(r.rows.length).toBe(2)
    expect(calls.length).toBe(2) // 查 + 下载，各一次签名请求
  })
  it('网络/状态异常 fail-soft（ok:false·不抛）', async () => {
    const r = await fetchTradeBill({ date: '2026-06-24', mchid: 'm', serial: 's', privateKey: PRIV }, async () => ({ status: 500, text: async () => 'err' }))
    expect(r.ok).toBe(false)
  })
})

describe('upsertBills — 确定性 _id 幂等落 wxBills', () => {
  it('落库 + 重跑不重复（_id=date:transactionId）', async () => {
    const rows = parseTradeBill(SAMPLE_CSV)
    await upsertBills(db, '2026-06-24', rows)
    let stored = control.dump('wxBills')
    expect(stored.length).toBe(2)
    expect(stored.find((b) => b._id === '2026-06-24:4200001')).toBeTruthy()
    await upsertBills(db, '2026-06-24', rows) // 幂等
    expect(control.dump('wxBills').length).toBe(2)
  })
})

describe('downloadBill action — 缺凭证 fail-soft', () => {
  it('无 env 凭证返 NO_WXPAY_CREDS（不抛·不落库）', async () => {
    delete process.env.WXPAY_MCH_SERIAL
    delete process.env.WXPAY_MCH_PRIVATE_KEY
    control.seed('config', [{ _id: 'pay', subMchId: '1113881793' }])
    const res = parse(await downloadBill({ db, cloud, data: { date: '2026-06-24' }, drafts: {} }))
    expect(res.ok).toBe(false)
    expect(res.error).toBe('NO_WXPAY_CREDS')
    expect(control.dump('wxBills').length).toBe(0)
  })
})
