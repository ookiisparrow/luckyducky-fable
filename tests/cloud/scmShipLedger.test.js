import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// SCM-D 发货核销流水（守卫 ship-verify-ledger reverseTest·roots #2）：shipOrder **首次** paid→shipped 流转
// 必落 ship 核销流水（fg 行·确定性 _id=ship:<orderId>:fg:<pid>__<spec>·只留痕不动账——成品扣账在下单预留），
// 改单号（shipped→shipped）/重试不双记账；「如实核销」＝实发即订单行数量、流水可查可对。

const KEY = 'ship-key-123'
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const call = (action, data = {}) =>
  main({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action, key: KEY, data }) }).then((r) => ({ status: r.statusCode, ...JSON.parse(r.body) }))
// 指定口令版（operator 溯源用例·多账号）
const call2 = (action, key, data = {}) =>
  main({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action, key, data }) }).then((r) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY) }])
  control.seed('orders', [
    {
      _id: 'o1',
      _openid: 'buyer-1',
      status: 'paid',
      transactionId: 'wxpay-tx-1',
      amount: 19800,
      items: [
        { productId: 'p-duck', spec: 'A', qty: 2 },
        { productId: 'p-cat', spec: '', qty: 1 },
      ],
    },
  ])
})

describe('shipOrder 发货核销流水（SCM-D·守卫 ship-verify-ledger）', () => {
  it('首次发货：逐行落 ship 流水（确定性 _id·delta=-qty·fg 行不动 materials/inventory）', async () => {
    const r = await call('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1' })
    expect(r.ok).toBe(true)
    const rows = control.dump('stockLedger').filter((l) => l.docType === 'ship')
    expect(rows).toHaveLength(2)
    const duck = rows.find((l) => l._id === 'ship:o1:fg:p-duck__A')
    expect(duck.delta).toBe(-2)
    expect(duck.docId).toBe('o1')
    const cat = rows.find((l) => l._id === 'ship:o1:fg:p-cat__')
    expect(cat.delta).toBe(-1)
    expect(control.dump('materials')).toHaveLength(0) // fg 只留痕·不碰原料账
    expect(control.dump('inventory')).toHaveLength(0) // 成品扣账在下单预留·发货不再动
  })

  it('改单号（shipped→shipped）不双记账：流水仍每行一条', async () => {
    await call('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1' })
    const r2 = await call('shipOrder', { id: 'o1', company: '中通', trackingNo: 'ZT2' })
    expect(r2.ok).toBe(true)
    expect(control.dump('stockLedger').filter((l) => l.docType === 'ship')).toHaveLength(2)
  })

  it('批量发货（shipOrders）同样留痕·共用 shipOne 单源', async () => {
    control.seed('orders', [
      { _id: 'o2', _openid: 'buyer-2', status: 'paid', transactionId: 'tx2', items: [{ productId: 'p-duck', spec: 'B', qty: 3 }] },
    ])
    const r = await call('shipOrders', { company: '顺丰', items: [{ id: 'o1', trackingNo: 'SF1' }, { id: 'o2', trackingNo: 'SF2' }] })
    expect(r.okCount).toBe(2)
    const rows = control.dump('stockLedger').filter((l) => l.docType === 'ship')
    expect(rows).toHaveLength(3)
    expect(rows.find((l) => l._id === 'ship:o2:fg:p-duck__B').delta).toBe(-3)
  })

  it('旧单无 items/行残缺：照常发货、不落假流水、不崩', async () => {
    control.seed('orders', [{ _id: 'o3', _openid: 'b', status: 'paid', transactionId: 'tx3' }])
    const r = await call('shipOrder', { id: 'o3', company: '顺丰', trackingNo: 'SF3' })
    expect(r.ok).toBe(true)
    expect(control.dump('orders').find((o) => o._id === 'o3').status).toBe('shipped')
    expect(control.dump('stockLedger').filter((l) => l.docId === 'o3')).toHaveLength(0)
  })

  it('流水 operator＝认证账号身份（深审 P3·B5.4 同款）：多账号发货可溯「谁发的」·不糊成 admin', async () => {
    const K2 = 'packer-key-456'
    control.seed('adminConfig', [{ _id: 'agent:packer', keyHash: sha(K2), role: 'superadmin', name: '打包员' }])
    const r = await call2('shipOrder', K2, { id: 'o1', company: '顺丰', trackingNo: 'SF-P' })
    expect(r.ok).toBe(true)
    const rows = control.dump('stockLedger').filter((l) => l.docType === 'ship')
    expect(rows.length).toBeGreaterThan(0)
    for (const l of rows) expect(l.operator).toBe('agent:packer') // 账号 _id（与 SCM 各线 agentId 口径一致）
  })
})
