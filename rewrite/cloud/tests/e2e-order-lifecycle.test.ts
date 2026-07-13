// E2E·订单全生命周期（跨函数/跨状态转移的全链契约）：createOrder(real·扣库存) → payCallback SUCCESS →
// shipOrder(admin) → confirmReceive(user)，一条真链跑到底，中间态逐一断言。补的是单 action 级测试之外的
// 「一笔订单从下单到收货，状态/库存/流水/身份闸在每一跳都对得上」跨函数契约。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { main as payCallback } from '../src/functions/callbacks/payCallback'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const cb = (e: Record<string, unknown>) => payCallback(e) as Promise<any>
const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '9.9.9.9' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const ADDR = { name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' }

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  control.seed('products', [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', price: 198, tag: '' }])
  control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 5 }])
  control.seed('config', [{ _id: 'pay', mode: 'real', flowId: 'flow-pay', refundFlowId: 'flow-refund' }])
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin', name: '店主' }])
})

describe('订单全生命周期 E2E（下单→支付→发货→收货·钱与交付跨函数契约）', () => {
  it('大白话：一笔单从下单到收货全链正确——每跳状态/库存/物流快照/核销流水/身份闸都对得上', async () => {
    // ① 下单（real 模式）：云端定价、下单即扣库存、状态 pending、reserved 记账
    const r = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR })
    expect(r.ok).toBe(true)
    const oid = r.order.id
    expect(r.order.status).toBe('pending')
    expect(r.order.amount).toBe(178) // 198 − 20 券·包邮
    expect(r.order.reserved).toEqual([{ productId: 'p1', spec: '', qty: 1 }])
    expect(control.dump('inventory')[0].stock).toBe(4) // 下单即预留扣一件

    // ② 支付回调 SUCCESS（真回调无用户身份·防伪要求 OPENID 空）：pending→paid、留交易号、金额相符无对账痕
    control.setOpenId('')
    const ack = await cb({ out_trade_no: oid, trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-t1' })
    expect(ack).toEqual({ errcode: 0, errmsg: 'OK' })
    let o = control.dump('orders').find((x: any) => x._id === oid)
    expect(o.status).toBe('paid')
    expect(o.transactionId).toBe('wx-t1')
    expect(o.feeMismatch).toBeUndefined()

    // ③ 发货（admin·凭 key）：paid→shipped、写物流快照、逐行落 ship 核销流水一次（只留痕不动账）
    const s = await post('shipOrder', { id: oid, company: '顺丰', trackingNo: 'SF001' })
    expect(s.ok).toBe(true)
    o = control.dump('orders').find((x: any) => x._id === oid)
    expect(o.status).toBe('shipped')
    expect(o.shipping).toEqual({ company: '顺丰', trackingNo: 'SF001' })
    const led = control.dump('stockLedger')
    expect(led.length).toBe(1)
    expect(led[0].delta).toBe(-1) // 发一件
    expect(led[0]._id).toContain('fg:p1__')
    expect(control.dump('inventory')[0].stock).toBe(4) // 发货只留痕不再动账（扣账在下单预留）

    // ④ 确认收货（买家本人）：shipped→done；重复确认按状态机拒
    control.setOpenId('oME')
    const c = await call('confirmReceive', { id: oid })
    expect(c.ok).toBe(true)
    expect(control.dump('orders').find((x: any) => x._id === oid).status).toBe('done')
    expect((await call('confirmReceive', { id: oid })).error).toContain('BAD_STATUS:done')
  })

  it('大白话：链上身份闸不串——他人不能确认我的收货，管理员发货前订单必须已支付', async () => {
    // 下单
    const r = await call('createOrder', { items: [{ id: 'p1', qty: 1 }], address: ADDR })
    const oid = r.order.id
    // 未支付即发货：状态闸拒（paid 才可发）
    control.setOpenId('')
    expect((await post('shipOrder', { id: oid, company: '顺丰', trackingNo: 'SF1' })).error).toContain('BAD_STATUS')
    // 支付到账后可发
    await cb({ out_trade_no: oid, trade_state: 'SUCCESS', amount: { total: 17800 }, transaction_id: 'wx-t1' })
    expect((await post('shipOrder', { id: oid, company: '顺丰', trackingNo: 'SF1' })).ok).toBe(true)
    // 他人确认收货：属主隔离表现为不存在
    control.setOpenId('oOTHER')
    expect((await call('confirmReceive', { id: oid })).error).toBe('NOT_FOUND')
    expect(control.dump('orders').find((x: any) => x._id === oid).status).toBe('shipped') // 未被越权推进
  })
})
