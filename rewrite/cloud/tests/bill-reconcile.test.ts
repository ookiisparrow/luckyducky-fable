// 黄金 支付掉单每日自动对账（守卫 rw-bill-reconcile-golden·批B2·病根#14）。
// 北极星＝「微信有款我方无单」不再依赖有人点开 admin 对账页——timer 每日自动拉前一日账单比对，
// 差异高危入账+告警。断言面：① wxOnly 必告警必落账本（#14 不静默）；② 同日重跑指纹去重不重推（#1 幂等）；
// ③ 金额比对走 toFen 分整数（#4）；④ 无账单日/未配凭证 fail-soft 不误报；⑤ 拉取真失败必告警不吞（#14）;
// ⑥ isServerCall fail-closed；⑦ 跨日宽窗不误报；⑧ 出站只经 kit/wxpay fetchTradeBill（#12）。
// 样本真实尺寸（靠人#8）：真 RSA 私钥签名真跑 + 反引号 CSV 走 parseTradeBill 全链。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import cloud, { control } from 'wx-server-sdk'
import { COLLECTIONS, anomalyFingerprint } from '@ldrw/shared'
import { matchBillRows } from '../src/kit'
import { main, runBillReconcile } from '../src/functions/timers/billReconcile'

const db = cloud.database()

// 测试用真 RSA 密钥（wxpaySign 走真 crypto——假串会全链塌 WXPAY_FETCH_FAIL·根因#8「拿到≠用通」）
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

// 固定时钟：now=7/16 12:00 CST → timer 对账「前一日」= 2026-07-15
const NOW = Date.parse('2026-07-16T12:00:00+08:00')
const DATE = '2026-07-15'
const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-recon-key'

// 微信交易账单 CSV（真实形状：表头 + 数据行每字段反引号前缀 + 末两行汇总须跳过——同旧线范式）
const csv = (rows: string[]) =>
  [
    '交易时间,公众账号ID,商户号,微信订单号,商户订单号,交易状态,订单金额,退款金额',
    ...rows,
    '总交易单数,交易总金额,退款总金额',
    `\`${rows.length},\`0.00,\`0.00`,
  ].join('\n')
const CSV_GHOST = csv(['`2026-07-15 10:00:00,`wxapp,`1113881793,`tx-ghost,`ghost,`SUCCESS,`5.00,`0.00'])
const CSV_FLAT = csv([
  '`2026-07-15 10:00:00,`wxapp,`1113881793,`tx-1,`m1,`SUCCESS,`100.00,`0.00',
  '`2026-07-15 11:00:00,`wxapp,`1113881793,`tx-r,`m9,`REFUND,`50.00,`20.00', // 非 SUCCESS·不进比对
])
const CSV_MISMATCH = csv(['`2026-07-15 10:00:00,`wxapp,`1113881793,`tx-2,`m2,`SUCCESS,`9.99,`0.00'])
const CSV_NEXTDAY = csv(['`2026-07-15 23:59:00,`wxapp,`1113881793,`tx-x,`mx,`SUCCESS,`100.00,`0.00'])

// 两段式账单 mock（meta JSON download_url → CSV 正文），形状同 WxFetch
const billFetch =
  (body: string, opts: { queryStatus?: number; queryBody?: string } = {}) =>
  async (url: string) => {
    if (url.includes('/v3/bill/tradebill'))
      return {
        status: opts.queryStatus ?? 200,
        text: async () =>
          opts.queryStatus && opts.queryStatus !== 200
            ? opts.queryBody || 'server error'
            : JSON.stringify({ download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=t' }),
      }
    return { status: 200, text: async () => body }
  }

const seedCreds = () => {
  control.seed(COLLECTIONS.secureConfig, [{ _id: 'wxpay', mchSerial: 'TESTSERIAL123', mchPrivateKey: PRIV }])
  control.seed(COLLECTIONS.config, [{ _id: 'pay', subMchId: '1113881793' }])
}

// 捕获 [LD_ALERT] 结构化行 + 返回值（同 anomaly.test.ts 范式）
async function withAlerts<T>(fn: () => Promise<T>): Promise<{ result: T; alerts: string[] }> {
  const seen: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => {
    seen.push(String(a[0]))
  }
  try {
    const result = await fn()
    return { result, alerts: seen.filter((s) => s.includes('[LD_ALERT]')) }
  } finally {
    console.error = orig
  }
}

// env 卫生（风险④互染）：本机/CI 若设过 WXPAY_MCH_*，「未配凭证」用例会假绿——存删/恢复
const ENV_KEYS = ['WXPAY_MCH_SERIAL', 'WXPAY_MCH_PRIVATE_KEY']
let envSave: Record<string, string | undefined> = {}
let pushes: string[] = []

beforeEach(() => {
  control.reset()
  envSave = {}
  for (const k of ENV_KEYS) {
    envSave[k] = process.env[k]
    delete process.env[k]
  }
  pushes = []
  vi.stubGlobal('fetch', async (url: string) => {
    pushes.push(String(url))
    return { ok: true, status: 200, json: async () => ({ errcode: 0 }), text: async () => '{"errcode":0}' }
  })
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSave[k] === undefined) delete process.env[k]
    else process.env[k] = envSave[k]
  }
  vi.unstubAllGlobals()
})

describe('billReconcile timer（每日自动对账·钱链·病根#14）', () => {
  it('大白话：微信有款我方无单（最危险类）→ 高危入账 + [LD_ALERT] + 汇总推送一次 + 账单已落库', async () => {
    seedCreds()
    control.seed(COLLECTIONS.adminConfig, [{ _id: 'settings', alertWebhook: WEBHOOK }])
    const { result, alerts } = await withAlerts(() =>
      runBillReconcile(db, { now: NOW, fetchImpl: billFetch(CSV_GHOST) })
    )
    expect(result.ok).toBe(true)
    expect((result as any).date).toBe(DATE)
    expect((result as any).wxOnly).toBe(1)
    const rows = control.dump(COLLECTIONS.anomalies)
    const hit = rows.find((r: any) => r.code === 'BILL_WX_ONLY')
    expect(hit).toBeTruthy()
    expect(hit._id).toBe(anomalyFingerprint('invariant-violation', 'BILL_WX_ONLY', 'tx-ghost'))
    expect(hit.severity).toBe('high')
    expect(alerts.some((s) => s.includes('BILL_WX_ONLY'))).toBe(true)
    expect(pushes).toEqual([WEBHOOK]) // run 级 BILL_RECON_DISCREPANCY 恰推一次
    const bills = control.dump(COLLECTIONS.wxBills)
    expect(bills.some((b: any) => b._id === `${DATE}:tx-ghost`)).toBe(true)
  })

  it('大白话：同日重跑→指纹去重 count 累加·零新告警·零重推（幂等黄金·#1）', async () => {
    seedCreds()
    control.seed(COLLECTIONS.adminConfig, [{ _id: 'settings', alertWebhook: WEBHOOK }])
    await withAlerts(() => runBillReconcile(db, { now: NOW, fetchImpl: billFetch(CSV_GHOST) }))
    const afterFirst = control.dump(COLLECTIONS.anomalies).length
    pushes = []
    const { alerts } = await withAlerts(() => runBillReconcile(db, { now: NOW, fetchImpl: billFetch(CSV_GHOST) }))
    const rows = control.dump(COLLECTIONS.anomalies)
    expect(rows.length).toBe(afterFirst) // 条数不变
    expect(rows.find((r: any) => r.code === 'BILL_WX_ONLY').count).toBe(2)
    expect(alerts.length).toBe(0) // 第二轮零新 [LD_ALERT]
    expect(pushes.length).toBe(0) // 新指纹预检=0 → 不重推
  })

  it('大白话：金额不符→ BILL_AMOUNT_MISMATCH 高危入账', async () => {
    seedCreds()
    control.seed('orders', [
      { _id: 'm2', id: 'm2', _openid: 'x', status: 'paid', amount: 50, transactionId: 'tx-2', paidAt: NOW - 86400_000, items: [] },
    ])
    const { result } = await withAlerts(() => runBillReconcile(db, { now: NOW, fetchImpl: billFetch(CSV_MISMATCH) }))
    expect((result as any).amountMismatch).toBe(1)
    const hit = control.dump(COLLECTIONS.anomalies).find((r: any) => r.code === 'BILL_AMOUNT_MISMATCH')
    expect(hit).toBeTruthy()
    expect(hit._id).toBe(anomalyFingerprint('invariant-violation', 'BILL_AMOUNT_MISMATCH', 'tx-2'))
    expect(hit.severity).toBe('high')
  })

  it('大白话：全平→零异常零告警零推送·账单照落·计数 0（REFUND 行不进比对）', async () => {
    seedCreds()
    control.seed(COLLECTIONS.adminConfig, [{ _id: 'settings', alertWebhook: WEBHOOK }])
    control.seed('orders', [
      { _id: 'm1', id: 'm1', _openid: 'x', status: 'paid', amount: 100, transactionId: 'tx-1', paidAt: NOW - 86400_000, items: [] },
    ])
    const { result, alerts } = await withAlerts(() => runBillReconcile(db, { now: NOW, fetchImpl: billFetch(CSV_FLAT) }))
    expect(result.ok).toBe(true)
    expect((result as any).wxOnly).toBe(0)
    expect((result as any).amountMismatch).toBe(0)
    expect((result as any).bills).toBe(2) // 落库含 REFUND 行（缓存全量）·比对只看 SUCCESS
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
    expect(alerts.length).toBe(0)
    expect(pushes.length).toBe(0)
  })

  it('大白话：无账单日（NO_STATEMENT_EXIST）＝正常·skipped 不告警不落库', async () => {
    seedCreds()
    const { result, alerts } = await withAlerts(() =>
      runBillReconcile(db, {
        now: NOW,
        fetchImpl: billFetch('', { queryStatus: 404, queryBody: '{"code":"NO_STATEMENT_EXIST","message":"没有账单"}' }),
      })
    )
    expect(result.ok).toBe(true)
    expect((result as any).skipped).toBe('NO_BILL')
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
    expect(control.dump(COLLECTIONS.wxBills).length).toBe(0)
    expect(alerts.length).toBe(0)
  })

  it('大白话：未配凭证＝功能未启用·skipped + 仅一条 low 面包屑·不告警（可观测但不打扰）', async () => {
    // 刻意不 seed secureConfig/config——env 已在 beforeEach 清空（部署注意：env 兜底是函数进程级·不跨函数）
    const { result, alerts } = await withAlerts(() => runBillReconcile(db, { now: NOW }))
    expect(result.ok).toBe(true)
    expect((result as any).skipped).toBe('NOT_CONFIGURED')
    const rows = control.dump(COLLECTIONS.anomalies)
    expect(rows.length).toBe(1)
    expect(rows[0].code).toBe('BILL_RECON_NOT_CONFIGURED')
    expect(rows[0].severity).toBe('low')
    expect(alerts.length).toBe(0)
    expect(pushes.length).toBe(0)
  })

  it('大白话：拉取真失败（500）→ BILL_FETCH_FAIL 必告警 + 桥接入账·函数不抛（fail-soft·#14 不吞）', async () => {
    seedCreds()
    const { result, alerts } = await withAlerts(() =>
      runBillReconcile(db, { now: NOW, fetchImpl: billFetch('', { queryStatus: 500 }) })
    )
    expect(result.ok).toBe(true) // fail-soft·不抛
    expect((result as any).error).toContain('BILL_QUERY_500')
    expect(alerts.some((s) => s.includes('BILL_FETCH_FAIL'))).toBe(true)
    expect(control.dump(COLLECTIONS.anomalies).some((r: any) => r.code === 'BILL_FETCH_FAIL')).toBe(true)
  })

  it('大白话：跨日边界——我方单次日凌晨落库、账单行属前一日→宽窗匹配不误报 wxOnly', async () => {
    seedCreds()
    control.seed('orders', [
      // paidAt = 7/16 00:10 CST（对账日次日）·账单行 tx-x 属 7/15 → 宽窗 [7/14,7/17) 仍命中
      { _id: 'mx', id: 'mx', _openid: 'x', status: 'paid', amount: 100, transactionId: 'tx-x', paidAt: Date.parse('2026-07-16T00:10:00+08:00'), items: [] },
    ])
    const { result } = await withAlerts(() => runBillReconcile(db, { now: NOW, fetchImpl: billFetch(CSV_NEXTDAY) }))
    expect((result as any).wxOnly).toBe(0)
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
  })

  it('大白话：触 cap 截断→TRUNCATED 告警·跳过 wxOnly 判定（截断假象不当真差异·同 billmatch-approx 纪律）', async () => {
    seedCreds()
    control.seed('orders', [
      { _id: 'a1', id: 'a1', _openid: 'x', status: 'paid', amount: 1, transactionId: 'tx-a1', paidAt: NOW - 86400_000, items: [] },
      { _id: 'a2', id: 'a2', _openid: 'x', status: 'paid', amount: 1, transactionId: 'tx-a2', paidAt: NOW - 86400_000 + 1, items: [] },
    ])
    const { result, alerts } = await withAlerts(() =>
      runBillReconcile(db, { now: NOW, fetchImpl: billFetch(CSV_GHOST), cap: 2 }) // 拉满 cap=2 → 截断
    )
    expect((result as any).truncated).toBe(true)
    expect((result as any).wxOnly).toBe(0) // 比对面不全·wxOnly 不判（防误报）
    expect(alerts.some((s) => s.includes('BILL_RECON_TRUNCATED'))).toBe(true)
    expect(control.dump(COLLECTIONS.anomalies).some((r: any) => r.code === 'BILL_WX_ONLY')).toBe(false)
  })

  it('大白话：客户端调不动（isServerCall fail-closed）·零写库', async () => {
    control.setOpenId('oHACK')
    const r: any = await main()
    expect(r.ok).toBe(false)
    expect(r.error).toBe('SERVER_ONLY')
    expect(control.dump(COLLECTIONS.wxBills).length).toBe(0)
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
  })
})

describe('matchBillRows（纯分类器·金额分整数比对·#4）', () => {
  it('大白话：金额比对走分整数——100 vs 99.99 判不符；0.1+0.2 元 vs 0.3 元不误报（浮点消弭）', () => {
    const r = matchBillRows(
      [
        { id: 'o1', transactionId: 'tx1', amount: 100 },
        { id: 'o2', transactionId: 'tx2', amount: 0.1 + 0.2 }, // 0.30000000000000004·直等会误判
      ],
      [
        { transactionId: 'tx1', outTradeNo: 'o1', orderAmount: 99.99, tradeState: 'SUCCESS' },
        { transactionId: 'tx2', outTradeNo: 'o2', orderAmount: 0.3, tradeState: 'SUCCESS' },
      ] as any
    )
    expect(r.amountMismatch.length).toBe(1)
    expect(r.amountMismatch[0].transactionId).toBe('tx1')
    expect(r.matched).toEqual(['o2']) // 分整数比对下 0.30000000000000004 ≡ 0.3·不误报
    expect(r.wxOnly.length).toBe(0)
  })
})
