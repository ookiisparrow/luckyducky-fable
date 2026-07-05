// 黄金 orders-money 审批/发货节 + inventory-scm §J（发货核销）（守卫 rw-admin3-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { getDb } from '../src/kit'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const seedOrder = (over: Record<string, unknown> = {}) =>
  control.seed('orders', [
    {
      _id: 'o1',
      id: 'o1',
      _openid: 'oBUYER',
      status: 'paid',
      amount: 178,
      goods: 198,
      transactionId: 'wx-t1',
      createdAt: 1000,
      items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 198, qty: 2, refundable: true }],
      ...over,
    },
  ])

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin', name: '店主' }])
})

describe('发货（黄金：状态闸/金额异常挡/核销流水/合规上传 fail-soft）', () => {
  it('大白话：缺参/无单/坏状态拒；金额异常单挡发货，人工解除后才放行', async () => {
    expect((await post('shipOrder', { id: 'o1' })).error).toBe('BAD_ARGS')
    expect((await post('shipOrder', { id: 'ghost', company: '顺丰', trackingNo: 'SF1' })).error).toBe('NO_ORDER')
    seedOrder({ status: 'pending' })
    expect((await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1' })).error).toContain('BAD_STATUS')

    seedOrder({ _id: 'o2', id: 'o2', feeMismatch: true } as any)
    expect((await post('shipOrder', { id: 'o2', company: '顺丰', trackingNo: 'SF1' })).error).toBe('FEE_MISMATCH_HOLD')
    expect((await post('clearFeeMismatch', { id: 'o2' })).ok).toBe(true)
    expect((await post('shipOrder', { id: 'o2', company: '顺丰', trackingNo: 'SF1' })).ok).toBe(true)
  })

  it('大白话：首次发货翻已发货+写物流快照+逐行落核销流水（只留痕不动账·记操作者）；改单号不重复留痕', async () => {
    seedOrder()
    const r = await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF001' })
    expect(r.ok).toBe(true)
    const o = control.dump('orders')[0]
    expect(o.status).toBe('shipped')
    expect(o.shipping).toEqual({ company: '顺丰', trackingNo: 'SF001' })
    const led = control.dump('stockLedger')
    expect(led.length).toBe(1)
    expect(led[0]._id).toBe('ship:o1:fg:p1__红')
    expect(led[0].delta).toBe(-2)
    expect(led[0].operator).toBe('admin') // 操作者可溯

    await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF002' }) // 改单号
    expect(control.dump('orders')[0].shipping.trackingNo).toBe('SF002')
    expect(control.dump('stockLedger').length).toBe(1) // 不重复留痕
  })

  it('大白话：微信合规上传失败绝不回滚本地发货——留痕告警靠人补录', async () => {
    seedOrder()
    control.setOpenapiFail(true)
    const r = await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1' })
    expect(r.ok).toBe(true) // 本地发货照常
    const o = control.dump('orders')[0]
    expect(o.status).toBe('shipped')
    expect(o.wxShipUploaded).toBe(false)
    expect(o.wxShipError).toBeTruthy()
  })

  it('大白话：批量发货逐单独立——坏单不拖累其余，各自回报；整批共用快递公司', async () => {
    seedOrder()
    seedOrder({ _id: 'oBad', id: 'oBad', status: 'pending' } as any)
    seedOrder({ _id: 'o3', id: 'o3' } as any)
    const r = await post('shipOrders', {
      company: '顺丰',
      items: [
        { id: 'o1', trackingNo: 'SF1' },
        { id: 'oBad', trackingNo: 'SF2' },
        { id: 'o3', trackingNo: 'SF3' },
      ],
    })
    expect(r.okCount).toBe(2)
    expect(r.failCount).toBe(1)
    expect(r.results.find((x: any) => x.id === 'oBad').error).toContain('BAD_STATUS')
    expect(control.dump('orders').find((x: any) => x._id === 'o3').status).toBe('shipped')
  })
})

describe('退款审批（黄金：原子抢占/回滚条件化/进课重算封顶）', () => {
  const seedAS = (over: Record<string, unknown> = {}) =>
    control.seed('afterSales', [
      {
        _id: 'as1',
        orderId: 'o1',
        _openid: 'oBUYER',
        lineId: 'p1__红',
        productId: 'p1',
        spec: '红',
        qty: 2,
        refundAmount: 178,
        status: 'applied',
        appliedAt: 2000,
        ...over,
      },
    ])
  const seedFlow = () => control.seed('config', [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])

  it('大白话：非申请中拒；未配退款流拒；成功原子置已批准并按售后单金额触发打款（分）', async () => {
    seedOrder()
    seedAS({ status: 'refunded' } as any)
    expect((await post('approveRefund', { id: 'as1' })).error).toContain('BAD_STATUS')

    control.reset()
    control.setOpenId('')
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    seedOrder()
    seedAS()
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('REFUND_FLOW_NOT_CONFIGURED')

    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })
    const r = await post('approveRefund', { id: 'as1' })
    expect(r.ok).toBe(true)
    expect(control.dump('afterSales')[0].status).toBe('approved')
    const sent = control.callFunctionCalls()[0]
    expect(sent.data.name).toBe('flow-refund')
    expect(sent.data.data.amount.refund).toBe(17800)
    expect(sent.data.data.out_refund_no).toBe('as1') // 纯 ASCII 短 _id 原样（老单回调兼容不变）
  })

  it('大白话：含中文 spec 的售后单——同意退款发给微信的 out_refund_no 必须 ASCII 合规、非原始中文 _id（案 A 卡单真因·根因#12）', async () => {
    seedOrder()
    // 真实 SKU spec 含中文，售后单 _id=orderId__lineId 带中文；旧写法直接当 out_refund_no → 微信 PARAM_ERROR 拒
    control.seed('afterSales', [
      { _id: 'o1__p1__红', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', spec: '红', qty: 2, refundAmount: 178, status: 'applied', appliedAt: 2000 },
    ])
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING' } } })
    const r = await post('approveRefund', { id: 'o1__p1__红' })
    expect(r.ok).toBe(true)
    const sent = control.callFunctionCalls()[0]
    expect(sent.data.data.out_refund_no).toMatch(/^[0-9a-zA-Z_|*@-]{1,64}$/) // 微信字符集/长度契约
    expect(sent.data.data.out_refund_no).not.toContain('红') // 不再把中文 _id 当单号
    expect(control.dump('afterSales')[0].outRefundNo).toBe(sent.data.data.out_refund_no) // 落库供回调反查
  })

  it('大白话：工作流未受理回滚可重试；但回滚条件化——退款回调已抢先置已退款时绝不打回（防二次退款）', async () => {
    seedOrder()
    seedAS()
    seedFlow()
    control.setCallFunctionResult({ result: {} }) // 未受理
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('REFUND_TRIGGER_FAIL')
    expect(control.dump('afterSales')[0].status).toBe('applied') // 回滚可重试

    // 回调抢先：callFlow 期间售后单被翻 refunded → 回滚不得打回
    control.setCallFunctionImpl(async () => {
      await getDb().collection('afterSales').doc('as1').update({ data: { status: 'refunded' } })
    })
    control.setCallFunctionResult({ result: {} })
    await post('approveRefund', { id: 'as1' })
    expect(control.dump('afterSales')[0].status).toBe('refunded') // 未被打回 applied
  })

  it('大白话：管理员越规退款（refund:manage）——拒后锁死/已进课的行也能主动退，但退款额仍≤实付分摊（决策§26）', async () => {
    const seedFlow = () => control.seed('config', [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })

    // ① 越过「拒后锁死」：客户申请被拒（rejected 占住 orderId__lineId），管理员仍能主动退
    seedOrder()
    control.seed('afterSales', [{ _id: 'o1__p1__红', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', qty: 2, refundAmount: 0, status: 'rejected', appliedAt: 2000 }])
    seedFlow()
    const r1 = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '客服特批' })
    expect(r1.ok).toBe(true)
    const created = control.dump('afterSales').find((a: any) => a.overridden)
    expect(created.status).toBe('approved')
    expect(created.refundAmount).toBe(178) // 该行分摊≤实付 178
    const sent = control.callFunctionCalls()[0]
    expect(sent.data.data.amount.refund).toBe(17800)
    // 越规单 asId=orderId__lineId__ovr<ts> 含中文 spec，发微信的 out_refund_no 也须 ASCII 合规（案 A·根因#12）
    expect(sent.data.data.out_refund_no).toMatch(/^[0-9a-zA-Z_|*@-]{1,64}$/)
    expect(sent.data.data.out_refund_no).not.toContain('红')

    // ② 越过「已进课不可退」：refundable=false 的行管理员也能退
    control.reset(); control.setOpenId('')
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    seedOrder({ items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 198, qty: 2, enteredQty: 2, refundable: false }] } as any)
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING' } } })
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '特批' })).ok).toBe(true)

    // ③ 钱守恒保留：该行已全额退过（used 占满）→ 越规也退不出，NOTHING_LEFT 挡（越资格规则·不越钱红线）
    control.reset(); control.setOpenId('')
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    seedOrder()
    control.seed('afterSales', [{ _id: 'o1__p1__红', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', qty: 2, refundAmount: 178, status: 'refunded', appliedAt: 2000 }])
    seedFlow()
    expect((await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '再退' })).error).toBe('NOTHING_LEFT')
  })

  it('大白话：越规退款须 refund:manage 能力——外包坐席（仅 agent:handle）被拒 FORBIDDEN', async () => {
    control.reset(); control.setOpenId('')
    control.seed('adminConfig', [
      { _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' },
      { _id: 'agent-1', keyHash: sha('outsourced-key'), role: 'outsourced', name: '外包' },
    ])
    const r = await adminApi({
      httpMethod: 'POST',
      headers: { 'x-forwarded-for': '2.2.2.2' },
      body: JSON.stringify({ action: 'overrideRefund', key: 'outsourced-key', data: { orderId: 'o1', lineId: 'p1__红', reason: 'x' } }),
    }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))
    expect(r.status).toBe(403)
    expect(r.error).toBe('FORBIDDEN')
  })

  it('大白话：申请后又进课——全进拒退；部分进按当下剩余件降级金额打款并留降级痕', async () => {
    // 全进：refundable false
    seedOrder({ items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', price: 198, qty: 2, enteredQty: 2, refundable: false }] } as any)
    seedAS()
    seedFlow()
    expect((await post('approveRefund', { id: 'as1' })).error).toBe('ENTERED_NOT_REFUNDABLE')

    // 部分进：申请时 2 件、审批时只剩 1 件可退 → 降级
    control.reset()
    control.setOpenId('')
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    seedOrder({
      amount: 376, // 198×2 − 20
      goods: 396,
      items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', price: 198, qty: 2, enteredQty: 1, refundable: true }],
    } as any)
    seedAS({ qty: 2, refundAmount: 376 } as any)
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING' } } })
    const r = await post('approveRefund', { id: 'as1' })
    expect(r.ok).toBe(true)
    const as = control.dump('afterSales')[0]
    expect(as.qty).toBe(1) // 降级到剩余件
    expect(as.refundAmount).toBeLessThan(376)
    expect(as.requalifiedAt).toBeGreaterThan(0) // 降级留痕
    const sent = control.callFunctionCalls()[0]
    expect(sent.data.data.amount.refund).toBe(Math.round(as.refundAmount * 100)) // 打款额=降级后
  })

  it('大白话：同意是原子抢占——读检查后被并发翻态（回调已退款）时绝不无条件覆盖、不二次触发打款', async () => {
    seedOrder()
    seedAS()
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING' } } })
    // TOCTOU 窗：approveRefund 读到 applied 之后、写 approved 之前，回调把它翻成 refunded
    let flipped = false
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === 'afterSales' && !flipped) {
        flipped = true
        const rows = control.dump('afterSales')
        void rows
        // 直接经桩库把状态翻掉（模拟回调抢先）——注意避免递归：flipped 已置
        await getDb().collection('afterSales').doc('as1').update({ data: { status: 'refunded' } })
      }
    })
    const r = await post('approveRefund', { id: 'as1' })
    control.setBeforeUpdate(null as never)
    expect(r.error).toContain('BAD_STATUS') // 抢占失败如实报，不覆盖
    expect(control.dump('afterSales')[0].status).toBe('refunded') // 未被 clobber
    expect(control.callFunctionCalls().length).toBe(0) // 未触发打款（不二次退款）
  })

  it('大白话：拒绝必填原因且原子化——被同意抢先（钱已进通道）时绝不 clobber 回已拒绝', async () => {
    seedOrder()
    seedAS()
    expect((await post('rejectRefund', { id: 'as1' })).error).toBe('BAD_ARGS') // 无原因
    seedAS({ _id: 'as2', status: 'approved' } as any)
    expect((await post('rejectRefund', { id: 'as2', reason: '超期' })).error).toContain('BAD_STATUS')

    const r = await post('rejectRefund', { id: 'as1', reason: '不符合退货条件' })
    expect(r.ok).toBe(true)
    expect(control.dump('afterSales')[0].rejectReason).toBe('不符合退货条件')
  })
})

describe('列表与计数（黄金：服务端精确·状态筛选）', () => {
  it('大白话：标签计数服务端全量精确不从已加载页推断；状态筛选只回该状态', async () => {
    control.seed(
      'orders',
      Array.from({ length: 12 }, (_, i) => ({
        _id: 'm' + i,
        id: 'm' + i,
        _openid: 'oX',
        status: i < 7 ? 'paid' : 'shipped',
        createdAt: 1000 + i,
        items: [],
      }))
    )
    const c = await post('orderCounts')
    expect(c.counts.paid).toBe(7)
    expect(c.counts.shipped).toBe(5)
    const l = await post('listOrders', { status: 'shipped' })
    expect(l.list.length).toBe(5)
    expect(l.list.every((o: any) => o.status === 'shipped')).toBe(true)
  })
})
