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

  // P0 修复（退款↔履约状态同步·根因：approveRefund/overrideRefund 只改 afterSales 集合自身状态，从不碰
  // orders；旧版 shipOne 唯一放行条件是 cur∈{paid,shipped}+非 feeMismatch，完全不查该单是否已有行被批准/
  // 已退款——已批准退款的单能照发＝钱货两空的资损洞）：shipOne 现场查 afterSales，挡发货并标出命中行。
  it('大白话：该单已有行退款 approved/refunded——挡发货并标出命中行；rejected（未受理）不挡', async () => {
    seedOrder() // o1: paid，行 lineId=p1__红
    control.seed('afterSales', [{ _id: 'as1', orderId: 'o1', lineId: 'p1__红', productId: 'p1', status: 'approved', refundAmount: 178, appliedAt: 1 }])
    const r = await post('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF1' })
    expect(r.error).toBe('REFUND_HOLD')
    expect(r.lines).toEqual(['p1__红'])
    expect(control.dump('orders')[0].status).toBe('paid') // 未被误发

    // refunded（退款回调已跑完）同样挡——更不该照发
    seedOrder({ _id: 'o6', id: 'o6' } as any)
    control.seed('afterSales', [{ _id: 'as6', orderId: 'o6', lineId: 'p1__红', productId: 'p1', status: 'refunded', refundAmount: 178, appliedAt: 1 }])
    expect((await post('shipOrder', { id: 'o6', company: '顺丰', trackingNo: 'SF6' })).error).toBe('REFUND_HOLD')

    // rejected（客服拒绝、未受理、无钱路径）不挡——正常放行
    seedOrder({ _id: 'o7', id: 'o7' } as any)
    control.seed('afterSales', [{ _id: 'as7', orderId: 'o7', lineId: 'p1__红', productId: 'p1', status: 'rejected', appliedAt: 1 }])
    expect((await post('shipOrder', { id: 'o7', company: '顺丰', trackingNo: 'SF7' })).ok).toBe(true)
  })

  it('大白话：批量发货里某单已退款——该单独立失败挡、不拖累其余', async () => {
    seedOrder() // o1
    seedOrder({ _id: 'o3', id: 'o3' } as any) // o3 正常
    control.seed('afterSales', [{ _id: 'as1', orderId: 'o1', lineId: 'p1__红', productId: 'p1', status: 'approved', appliedAt: 1 }])
    const r = await post('shipOrders', {
      company: '顺丰',
      items: [
        { id: 'o1', trackingNo: 'SF1' },
        { id: 'o3', trackingNo: 'SF3' },
      ],
    })
    expect(r.okCount).toBe(1)
    expect(r.results.find((x: any) => x.id === 'o1').error).toBe('REFUND_HOLD')
    expect(control.dump('orders').find((x: any) => x._id === 'o3').status).toBe('shipped')
  })

  it('大白话：listOrders join afterSales——已批准/已退款的单标 refundHold，供前端入口收窄挡（真正裁决仍在 shipOne）', async () => {
    seedOrder() // o1
    seedOrder({ _id: 'o3', id: 'o3' } as any) // o3 无退款
    control.seed('afterSales', [{ _id: 'as1', orderId: 'o1', lineId: 'p1__红', productId: 'p1', status: 'approved', appliedAt: 1 }])
    const r = await post('listOrders', {})
    const o1 = r.list.find((x: any) => x._id === 'o1')
    const o3 = r.list.find((x: any) => x._id === 'o3')
    expect(o1.refundHold).toBe(true)
    expect(o3.refundHold).toBe(false)
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

  it('大白话：退款判据绑本单订单行——买家这门课已进过、但本单此行仍可退时 lineRefundable:true（不误判会拦）；本单此行被撤则 false（P2·根因#8 判据不失真）', async () => {
    control.seed('products', [{ _id: 'p1', id: 'p1', courseId: 'c1' }])
    // 买家经"别单/别码"进过这门课（enteredAt 有值·课程级已进课）
    control.seed('activations', [{ _id: 'act-old', _openid: 'oBUYER', courseId: 'c1', code: 'OLD', enteredAt: 111 }])
    // 本单此行仍可退（refundable:true·enteredQty:0）
    seedOrder({ items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', price: 198, qty: 1, enteredQty: 0, refundable: true }] } as any)
    control.seed('afterSales', [
      { _id: 'o1__p1__红', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', spec: '红', qty: 1, refundAmount: 178, status: 'applied', appliedAt: 2000 },
    ])
    const r1 = await post('getRefundDetail', { id: 'o1__p1__红' })
    expect(r1.ok).toBe(true)
    expect(r1.activation.entered).toBe(true) // 课程级：买家进过这门课（真事实）
    expect(r1.lineRefundable).toBe(true) // 本单此行：仍可退——判据绑单，不因"课程进过"误判会拦

    // 别单 o2·本单此行被撤退货权（refundable:false）→ lineRefundable:false（与 approveRefund ENTERED_NOT_REFUNDABLE 同口径）
    control.seed('orders', [
      { _id: 'o2', id: 'o2', _openid: 'oBUYER', status: 'paid', amount: 178, goods: 198, transactionId: 'wx-t2', createdAt: 1000, items: [{ productId: 'p1', lineId: 'p1__蓝', spec: '蓝', price: 198, qty: 1, enteredQty: 1, refundable: false }] },
    ])
    control.seed('afterSales', [
      { _id: 'o2__p1__蓝', orderId: 'o2', _openid: 'oBUYER', lineId: 'p1__蓝', productId: 'p1', spec: '蓝', qty: 1, refundAmount: 178, status: 'applied', appliedAt: 2000 },
    ])
    expect((await post('getRefundDetail', { id: 'o2__p1__蓝' })).lineRefundable).toBe(false)
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

  // P2 修复（shipOne 退款闸非原子·并发竞态窗口对称可观测）：shipOne 的 heldLines 读与 approveRefund 的
  // 批准写之间没有互斥，理论上仍存在「批准执行期间订单恰好被并发发货」的窄窗口。钱照退（不能因为货发了
  // 就不退），但必须留一条高危信号供人工核实——这里验证该信号真的落地（不只是「加了却没触发」）。
  it('大白话：批准退款执行期间订单被并发发货——钱照退，但留 SHIP_REFUND_RACE 高危告警供人工核实（P2·竞态可观测）', async () => {
    seedOrder() // o1: paid
    seedAS()
    seedFlow()
    // 模拟 shipOne 恰好在 callFlow（触发退款）执行期间把订单改成 shipped——复现「批准前未 shipped、
    // 批准落库后已 shipped」的竞态窗口，而非「本来就是已发货单被退款」的正常场景。
    control.setCallFunctionImpl(async () => {
      await getDb().collection('orders').doc('o1').update({ data: { status: 'shipped' } })
    })
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })
    const r = await post('approveRefund', { id: 'as1' })
    expect(r.ok).toBe(true) // 钱照退，不因竞态阻断
    expect(control.dump('afterSales')[0].status).toBe('approved')
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'SHIP_REFUND_RACE')).toBe(true)
  })

  it('大白话：订单本来就已发货（正常先发货后退款）——不是竞态，不误报 SHIP_REFUND_RACE', async () => {
    seedOrder({ status: 'shipped' } as any)
    seedAS()
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })
    const r = await post('approveRefund', { id: 'as1' })
    expect(r.ok).toBe(true)
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'SHIP_REFUND_RACE')).toBe(false)
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

  // P2 修复（同 approveRefund 侧同款·竞态可观测对称覆盖两个决策入口）
  it('大白话：越规退款执行期间订单被并发发货——钱照退，但留 SHIP_REFUND_RACE 高危告警供人工核实（P2·竞态可观测）', async () => {
    seedOrder() // o1: paid
    const seedFlow2 = () => control.seed('config', [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])
    seedFlow2()
    control.setCallFunctionImpl(async () => {
      await getDb().collection('orders').doc('o1').update({ data: { status: 'shipped' } })
    })
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '客服特批' })
    expect(r.ok).toBe(true) // 钱照退，不因竞态阻断
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'SHIP_REFUND_RACE')).toBe(true)
  })

  it('大白话：行级钱守恒（P1·根因#1）——多行订单里同一行反复越规不能越退成兄弟行的钱；行/单双口径各自封顶取小', async () => {
    // 两行对称订单：amount=goods=100（无折扣），A/B 各价 50、各理论分摊 50。
    const seedTwoLine = (over: Record<string, unknown> = {}) =>
      control.seed('orders', [
        {
          _id: 'o1', id: 'o1', _openid: 'oBUYER', status: 'paid', amount: 100, goods: 100,
          items: [
            { productId: 'pA', lineId: 'pA__x', spec: 'x', name: 'A', price: 50, qty: 1, refundable: true },
            { productId: 'pB', lineId: 'pB__x', spec: 'x', name: 'B', price: 50, qty: 1, refundable: true },
          ],
          ...over,
        },
      ])
    const seedFlow = () => control.seed('config', [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])

    // ①「行级不封顶」旧 bug 回归线：对 A 行调用两次——第一次吃满该行 50 元分摊；第二次即便全单
    // 还有 B 行的 50 元余量未用，A 行自己也必须被行级封顶挡住（NOTHING_LEFT），不能再退第二次 50。
    seedTwoLine()
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r1' } } })
    const first = await post('overrideRefund', { orderId: 'o1', lineId: 'pA__x', reason: '越规1' })
    expect(first.ok).toBe(true)
    const created1 = control.dump('afterSales').find((a: any) => a.overridden)
    expect(created1.refundAmount).toBe(50)
    const second = await post('overrideRefund', { orderId: 'o1', lineId: 'pA__x', reason: '越规2' })
    expect(second.error).toBe('NOTHING_LEFT') // 旧 bug：这里会再退 50，把 B 行的钱吃掉

    // ② 行剩余 < 单剩余时取行剩余：A 行自己已有一笔 applied 40 元占用（该行剩余 50-40=10），
    // 全单已用仅 40（单剩余 60）——refundFen 应取更小的「行剩余 10」，不是「单剩余 60」。
    control.reset(); control.setOpenId('')
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    seedTwoLine()
    control.seed('afterSales', [
      { _id: 'o1__pA__x', orderId: 'o1', _openid: 'oBUYER', lineId: 'pA__x', productId: 'pA', qty: 1, refundAmount: 40, status: 'applied', appliedAt: 2000 },
    ])
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r2' } } })
    const r2 = await post('overrideRefund', { orderId: 'o1', lineId: 'pA__x', reason: '行剩余更小' })
    expect(r2.ok).toBe(true)
    const created2 = control.dump('afterSales').find((a: any) => a.overridden)
    expect(created2.refundAmount).toBe(10) // 行剩余 10 < 单剩余 60，取行剩余

    // ③ 单剩余 < 行剩余时取单剩余：B 行已被（异常/历史数据）多退到 40，全单已用 40（单剩余 60）；
    // A 行自己未用（行剩余 50）——refundFen 应取更小的「单剩余 60」与「行剩余 50」中的小者=50，
    // 换一个更极端场景：B 行已用 60（超其自身理论份额，构造用于验证 min 逻辑），单剩余=40 < 行剩余50。
    control.reset(); control.setOpenId('')
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    seedTwoLine()
    control.seed('afterSales', [
      { _id: 'o1__pB__x', orderId: 'o1', _openid: 'oBUYER', lineId: 'pB__x', productId: 'pB', qty: 1, refundAmount: 60, status: 'refunded', appliedAt: 2000 },
    ])
    seedFlow()
    control.setCallFunctionResult({ result: { data: { status: 'PROCESSING', refund_id: 'r3' } } })
    const r3 = await post('overrideRefund', { orderId: 'o1', lineId: 'pA__x', reason: '单剩余更小' })
    expect(r3.ok).toBe(true)
    const created3 = control.dump('afterSales').find((a: any) => a.overridden)
    expect(created3.refundAmount).toBe(40) // 单剩余 100-60=40 < 行剩余 50，取单剩余
  })

  it('大白话：确定性 _id 幂等（P1·根因#1）——同状态两次独立计算得到相同 asId（N=既有 __ovr 前缀数）', async () => {
    const seedOrder2 = () =>
      control.seed('orders', [
        { _id: 'o1', id: 'o1', _openid: 'oBUYER', status: 'paid', amount: 178, goods: 198, items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', name: '鸭', price: 198, qty: 2, refundable: true }] },
      ])
    const seedFlow = () => control.seed('config', [{ _id: 'pay', mode: 'real', refundFlowId: 'flow-refund' }])
    // 预先垫基础位（P0 复核·跨函数 TOCTOU 修复：首个记录与 applyRefund 共用 orderId__lineId 裸位）+
    // 两条既有 __ovr 前缀单（模拟已越规退过两次·状态不重要，只看 _id 前缀计数）
    const seedPrior = () =>
      control.seed('afterSales', [
        { _id: 'o1__p1__红', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', qty: 1, refundAmount: 1, status: 'rejected' },
        { _id: 'o1__p1__红__ovr0', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', qty: 1, refundAmount: 1, status: 'rejected' },
        { _id: 'o1__p1__红__ovr1', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', qty: 1, refundAmount: 1, status: 'rejected' },
      ])

    // 独立跑两遍完全相同的种子状态，断言算出的新 asId 相同（N=2 → ovr2）——纯函数式确定性，非并发竞速。
    for (let round = 0; round < 2; round++) {
      control.reset(); control.setOpenId('')
      control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
      seedOrder2(); seedPrior(); seedFlow()
      control.setCallFunctionResult({ result: { data: { status: 'PROCESSING' } } })
      const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '第三次越规' })
      expect(r.ok).toBe(true)
      expect(r.id).toBe('o1__p1__红__ovr2') // 两轮相同种子 → 相同确定性 _id
    }
  })

  it('大白话：add 撞键（并发方已写）——读回判定命中即 409 CONCURRENT，不接着触发退款工作流（P1·根因#1/#14）', async () => {
    seedOrder()
    seedFlow()
    // exist 读取时（bareTaken 判定）尚无既有记录，算出 asId=o1__p1__红（基础位，首个记录）；用 beforeAdd
    // 钩子在真正 add() 落库前注入「并发方已抢先写入同一确定性 _id」——精确复现「读时无、写时撞」的真实竞态。
    control.setBeforeAdd(async ({ coll, data }: any) => {
      if (coll === 'afterSales' && data && data._id === 'o1__p1__红') {
        control.seed('afterSales', [
          { _id: data._id, orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', qty: 2, refundAmount: 178, status: 'approved', appliedAt: 2000 },
        ])
      }
    })
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '撞键' })
    control.setBeforeAdd(null as never)
    expect(r.status).toBe(409)
    expect(r.error).toBe('CONCURRENT')
    expect(control.callFunctionCalls().length).toBe(0) // 绝不接着触发真退款
  })

  it('大白话：跨函数 TOCTOU 收口（P0 复核）——并发窗口里客户 applyRefund 抢先落库同一基础位，越规退款判 409 不重复退款', async () => {
    // 复现走查报告的真实竞态：overrideRefund 读 exist 时该行尚无任何售后单（与 applyRefund 同一时刻的
    // 读一样都是空），但在 overrideRefund 真正 add() 之前，客户端 applyRefund 已经抢先在同一 _id
    // （orderId__lineId 基础位·两函数单源共用，见 refunds.ts:59 起注释）写入了它自己的 applied 记录——
    // 这正是「两条路径各自读到空、各自决定写」的 TOCTOU 窗口，用 beforeAdd 钩子在 add() 前一刻注入复现。
    seedOrder()
    seedFlow()
    control.setBeforeAdd(async ({ coll, data }: any) => {
      if (coll === 'afterSales' && data && data._id === 'o1__p1__红') {
        control.seed('afterSales', [
          { _id: 'o1__p1__红', orderId: 'o1', _openid: 'oBUYER', lineId: 'p1__红', productId: 'p1', qty: 2, refundAmount: 178, status: 'applied', appliedAt: 2000 },
        ])
      }
    })
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '越规' })
    control.setBeforeAdd(null as never)
    expect(r.status).toBe(409) // 撞客户那笔的键，不是「越规又另写一份」
    expect(r.error).toBe('CONCURRENT')
    expect(control.callFunctionCalls().length).toBe(0) // 绝不触发第二笔真退款——行A只可能被退一次
    expect(control.dump('afterSales').length).toBe(1) // 全单该行只留客户那一条，无重复记录
  })

  it('大白话：add 真写失败（非撞键）——读回也找不到，回 500 WRITE_FAIL 且不触发退款工作流（P1·根因#14）', async () => {
    seedOrder()
    seedFlow()
    control.setBeforeAdd(async ({ coll }: any) => {
      if (coll === 'afterSales') throw new Error('SIMULATED_WRITE_FAIL')
    })
    const r = await post('overrideRefund', { orderId: 'o1', lineId: 'p1__红', reason: '真写失败' })
    control.setBeforeAdd(null as never)
    expect(r.status).toBe(500)
    expect(r.error).toBe('WRITE_FAIL')
    expect(control.callFunctionCalls().length).toBe(0)
    expect(control.dump('afterSales').length).toBe(0) // 确实没写入
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

describe('售后列表买家身份（黄金：join 订单地址·换皮丢·审退款需识别申请人+联系寄回）', () => {
  it('大白话：listRefunds 每行补 buyerName/buyerPhone（从订单收货地址 join·afterSale 本身无地址）；无对应订单则空、不崩', async () => {
    control.seed('orders', [
      { _id: 'o1', id: 'o1', _openid: 'oBUYER', status: 'paid', createdAt: 1000, items: [], address: { name: '赵四', phone: '13812345678', region: '贵州', detail: 'x' } },
    ])
    control.seed('afterSales', [
      { _id: 'as-a', orderId: 'o1', _openid: 'oBUYER', name: '鸭', qty: 1, refundAmount: 2, status: 'applied', appliedAt: 3000 },
      { _id: 'as-b', orderId: 'ghost', _openid: 'oX', name: '鸭', qty: 1, refundAmount: 2, status: 'applied', appliedAt: 2000 },
    ])
    const r = await post('listRefunds')
    expect(r.ok).toBe(true)
    const a = r.list.find((x: any) => x._id === 'as-a')
    expect(a.buyerName).toBe('赵四') // join 订单地址
    expect(a.buyerPhone).toBe('13812345678') // 全号（前端列表再掩码）
    const b = r.list.find((x: any) => x._id === 'as-b')
    expect(b.buyerName).toBe('') // 无对应订单·空不崩
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
