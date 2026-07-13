// 黄金 admin-misc 看板节 + orders-money 对账节 + inventory-scm §L（守卫 rw-admin4-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})

describe('看板（黄金：精确计数·GMV 聚合恒不近似·钱链异常定向查询）', () => {
  it('大白话：计数走精确统计不受样本截断；GMV 只计已付且恒不标近似；未付/已关不计钱', async () => {
    control.seed(
      'orders',
      Array.from({ length: 250 }, (_, i) => ({
        _id: 'g' + i,
        id: 'g' + i,
        _openid: 'oX',
        status: i < 200 ? 'paid' : i < 230 ? 'pending' : 'closed',
        amount: 100,
        createdAt: 1000 + i,
        items: [],
      }))
    )
    control.seed('users', [{ _id: 'u1', _openid: 'u1' }])
    const r = await post('getDashboard')
    expect(r.ok).toBe(true)
    expect(r.stats.orders).toBe(250) // 精确·超 100 默认截断也不失真
    expect(r.stats.gmv).toBe(200 * 100) // 只计已付
    expect(r.approx.gmv).toBe(false) // 聚合恒不近似
  })

  it('大白话：钱链异常走定向精确查询不从样本过滤——金额不符/退款不符/审批超时卡单三类', async () => {
    control.seed('orders', [
      { _id: 'bad1', id: 'bad1', _openid: 'oX', status: 'paid', feeMismatch: true, amount: 1, createdAt: 1, items: [] },
    ])
    control.seed('afterSales', [
      { _id: 'rm1', orderId: 'o1', status: 'applied', refundMismatch: true, appliedAt: 1 },
      { _id: 'stuck1', orderId: 'o2', status: 'approved', approvedAt: Date.now() - 2 * 3600_000, appliedAt: 1 },
      { _id: 'fresh1', orderId: 'o3', status: 'approved', approvedAt: Date.now(), appliedAt: 1 }, // 刚触发不算
    ])
    const r = await post('getDashboard')
    expect(r.txAlerts.feeMismatch).toEqual(['bad1'])
    expect(r.txAlerts.refundMismatch).toEqual(['rm1'])
    expect(r.txAlerts.stuckRefunds).toEqual(['stuck1'])
  })

  it('大白话：钱链异常「精确不漏」不是空话——超服务端默认 100 条截断也全数带回（P2→修）', async () => {
    // 桩对齐真 sdk：裸 .get() 默认封顶 100 条；三路查询若不显式 .limit(1000) 就会在此处静默截断。
    control.seed(
      'orders',
      Array.from({ length: 120 }, (_, i) => ({ _id: 'fm' + i, id: 'fm' + i, _openid: 'oX', status: 'paid', feeMismatch: true, amount: 1, createdAt: i, items: [] }))
    )
    const r = await post('getDashboard')
    expect(r.txAlerts.feeMismatch.length).toBe(120) // 旧 bug：这里会被裸 .get() 默认截断成 100
  })

  it('大白话：钱链异常查询失败不冒充「零异常」——回 partial:true + 告警（深审 P1·病根#14）', async () => {
    control.seed('orders', [
      { _id: 'bad1', id: 'bad1', _openid: 'oX', status: 'paid', feeMismatch: true, amount: 1, createdAt: 1, items: [] },
    ])
    // 注入 feeMismatch 那路查询失败：旧版 .catch(()=>[]) 会静默返回空、txAlerts 冒充「零异常」被看板当真
    control.setBeforeGet(({ coll, filter }: any) => {
      if (coll === 'orders' && filter && filter.feeMismatch === true) throw new Error('QUERY_FAIL')
    })
    const seen: string[] = []
    const orig = console.error
    console.error = (...a: unknown[]) => {
      seen.push(String(a[0]))
    }
    let r: any
    try {
      r = await post('getDashboard')
    } finally {
      console.error = orig
      control.setBeforeGet(null as never)
    }
    expect(r.txAlerts.partial).toBe(true) // 不冒充零异常·标不可信
    expect(seen.filter((s) => s.includes('[LD_ALERT]') && s.includes('TXALERTS_QUERY_FAIL')).length).toBeGreaterThanOrEqual(1)
  })
})

describe('内部对账（黄金：全量精确·日分桶·截断如实标）', () => {
  it('大白话：累计收入=已付口径全量聚合、净额=收入−退款；按日分桶各日笔数金额正确', async () => {
    const day = 24 * 3600_000
    const d1 = Date.UTC(2026, 6, 1, 4) // 北京 7/1 中午
    control.seed('orders', [
      { _id: 'r1', id: 'r1', _openid: 'x', status: 'paid', amount: 100, paidAt: d1, createdAt: d1, items: [] },
      { _id: 'r2', id: 'r2', _openid: 'x', status: 'done', amount: 50, paidAt: d1 + day, createdAt: d1 + day, items: [] },
      { _id: 'r3', id: 'r3', _openid: 'x', status: 'pending', amount: 999, createdAt: d1, items: [] }, // 未付不计
    ])
    control.seed('afterSales', [
      { _id: 'as1', orderId: 'r1', status: 'refunded', refundAmount: 30, refundedAt: d1 + day, appliedAt: d1 },
    ])
    const r = await post('getReconciliation', {})
    expect(r.ok).toBe(true)
    expect(r.cumulative.income).toBe(150)
    expect(r.cumulative.refund).toBe(30)
    expect(r.cumulative.net).toBe(120)
  })
})

describe('外部逐笔对账（黄金：四类差异·未拉账单日不误报）', () => {
  it('大白话：按交易号勾对——已平/外部有我方无（最危险）/我方有外部无/金额不符；未拉账单的日期不误报', async () => {
    const day1 = '2026-07-01'
    control.seed('orders', [
      { _id: 'm1', id: 'm1', _openid: 'x', status: 'paid', amount: 100, transactionId: 'tx-1', paidAt: Date.parse(day1 + 'T04:00:00Z'), createdAt: 1, items: [] },
      { _id: 'm2', id: 'm2', _openid: 'x', status: 'paid', amount: 50, transactionId: 'tx-2', paidAt: Date.parse(day1 + 'T05:00:00Z'), createdAt: 2, items: [] },
      { _id: 'm3', id: 'm3', _openid: 'x', status: 'paid', amount: 70, transactionId: 'tx-miss', paidAt: Date.parse('2026-07-02T04:00:00Z'), createdAt: 3, items: [] }, // 7/2 账单未拉·不误报
    ])
    control.seed('wxBills', [
      { _id: day1 + ':tx-1', date: day1, transactionId: 'tx-1', orderAmount: 100, outTradeNo: 'm1', tradeState: 'SUCCESS' }, // 已平
      { _id: day1 + ':tx-2', date: day1, transactionId: 'tx-2', orderAmount: 9.99, outTradeNo: 'm2', tradeState: 'SUCCESS' }, // 金额不符
      { _id: day1 + ':tx-ghost', date: day1, transactionId: 'tx-ghost', orderAmount: 5, outTradeNo: 'ghost', tradeState: 'SUCCESS' }, // 外部有我方无
    ])
    const r = await post('getBillMatch', {})
    expect(r.ok).toBe(true)
    expect(r.summary.matched).toBeGreaterThanOrEqual(1)
    expect(r.discrepancies.wxOnly.some((x: any) => x.transactionId === 'tx-ghost')).toBe(true) // 收钱无单·最危险
    expect(r.discrepancies.amountMismatch.some((x: any) => x.transactionId === 'tx-2')).toBe(true)
    const oursOnlyTx = r.discrepancies.oursOnly.map((x: any) => x.transactionId)
    expect(oursOnlyTx).not.toContain('tx-miss') // 未拉账单日不误报
  })
})

describe('库存 action（黄金 §L：有界全取·版本校验写）', () => {
  it('大白话：SKU 超 100 条分页取齐不静默截断；管理端保存走版本校验冲突拒写', async () => {
    control.seed(
      'inventory',
      Array.from({ length: 150 }, (_, i) => ({
        _id: 'p' + i + '__',
        productId: 'p' + i,
        spec: '',
        stock: i,
        updatedAt: 1000,
      }))
    )
    const l = await post('listInventory', {})
    expect(l.ok).toBe(true)
    expect(l.list.length).toBe(150) // 超默认 100 取齐
    expect(l.truncated).toBe(false)

    const stale = await post('saveStock', { productId: 'p1', spec: '', stock: 99, expectedUpdatedAt: 999 })
    expect(stale.status).toBe(409)
    expect(stale.error).toBe('STOCK_CONFLICT')
    expect(control.dump('inventory').find((x: any) => x._id === 'p1__').stock).toBe(1) // 未被覆盖

    const fresh = await post('saveStock', { productId: 'p1', spec: '', stock: 99, expectedUpdatedAt: 1000 })
    expect(fresh.ok).toBe(true)
  })

  it('大白话：分页扫描中某页查询失败——fail-loud 整体报错，绝不当「扫到底」静默返回半截列表（P1→修）', async () => {
    control.seed(
      'inventory',
      Array.from({ length: 150 }, (_, i) => ({ _id: 'q' + i + '__', productId: 'q' + i, spec: '', stock: i, updatedAt: 1000 }))
    )
    // 第二页（skip:100）查询抛错：旧版 .catch(()=>({data:[]})) 会把它当空页处理，rows.length(0) < PAGE(100)
    // 命中「扫到底」判据，静默返回不完整列表且 truncated:false（Dashboard 低库存待办漏报）。
    control.setBeforeGet(async ({ coll, skip }: any) => {
      if (coll === 'inventory' && skip === 100) throw new Error('SIMULATED_PAGE_FAIL')
    })
    const l = await post('listInventory', {})
    control.setBeforeGet(null as never)
    // 唯一调用方 listInventory 的域出口统一 try/catch 兜底 500（adminApi/index.ts）——错误不被吞、不误判到底
    expect(l.status).toBe(500)
    expect(l.error).toBe('SERVER_ERROR')
  })
})
