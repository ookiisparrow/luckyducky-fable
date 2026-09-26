// 钱链映射修正（Issue #387/#388）：回包用 tests/contracts/admin-money.json 的 sample（云端测试对着真 adminApi 锁住），
// 不是手写 fixture——单位写错（元/分）在这里会露馅。
import { describe, it, expect } from 'vitest'
import CONTRACT from '../../../tests/contracts/admin-money.json'
import { mapOverrideOrder, mapDashboard, mapOrderRows } from '../src/lib/mapMoney'
import type { listOrders, getRefundDetail } from '../src/api/money'
import type { AdminDashboard, AdminStatusCounts, AdminOrderDetail, AdminRefundDetail } from '@ldrw/shared'

type Json = Record<string, any>
const S = (name: string): Json => structuredClone((CONTRACT.cases as unknown as Record<string, { sample: Json }>)[name].sample)
const C = '2026070112000003' // 少付 100 元的支付异常单：应付 amount=198 元，实际到账 paidFee=10000 分

describe('越规退款查单的「实付」', () => {
  it('大白话：支付异常单显示微信实际到账（10000 分 → ¥100.00），不是应付的 ¥198.00', () => {
    const vm = mapOverrideOrder(S('listOrders:payment_exception').list, C)!
    expect(vm.amountLabel).toBe('¥100.00')
    expect(vm.goodsLabel).toBe('¥198.00') // 商品价仍是元，不动
  })

  it('大白话：异常单缺实际到账金额时明说「待补录实付」，不拿应付 ¥198.00 冒充实付', () => {
    const list = S('listOrders:payment_exception').list
    delete list[0].paidFee
    expect(mapOverrideOrder(list, C)!.amountLabel).toBe('待补录实付')
  })

  it('大白话：订单列表同一张缺实付的异常单——仍显应付并亮「补录实付」按钮（两处共用一条取实付规则）', () => {
    const list = S('listOrders:payment_exception').list
    expect(mapOrderRows(list)[0].amountLabel).toBe('¥100.00')
    delete list[0].paidFee
    const row = mapOrderRows(list)[0]
    expect(row.amountLabel).toBe('¥198.00')
    expect(row.paidFeeMissing).toBe(true)
  })

  it('大白话：正常单的实付就是应付 amount（元），paidFee 即便存在也不拿来显示', () => {
    const list = S('listOrders').list
    list[0].paidFee = 1
    expect(mapOverrideOrder(list, list[0]._id)!.amountLabel).toBe('¥198.00')
  })
})

describe('看板钱链告警没读全', () => {
  // partial:true 的一面在 p-contract-admin-mappers.test.ts；这里钉另一面，防「恒标没读全」
  it('大白话：告警读全了（partial:false）就不标记', () => {
    expect(mapDashboard(S('getDashboard'))!.alertsPartial).toBe(false)
  })
})

describe('钱链回包有类型（字段名写错编译不过）', () => {
  it('大白话：listOrders / getRefundDetail 成功包里拼错的字段名被 vue-tsc 拦下', () => {
    // 只做类型检查不执行：@ts-expect-error 下一行若不再报错，vue-tsc 会报「未用的 expect-error」
    const check = (o: Awaited<ReturnType<typeof listOrders>>, d: Awaited<ReturnType<typeof getRefundDetail>>) => {
      if (!o.ok || !d.ok) return
      // @ts-expect-error list 拼错
      void o.lsit
      // @ts-expect-error 订单文档字段拼错
      void o.list[0].paidFeee
      // @ts-expect-error lineRefundable 拼错
      void d.lineRefundble
      return [o.list[0].paidFee, o.list[0].refundHold, o.nextCursor, o.hasMore, d.lineRefundable, d.refundableQty, d.activation.entered]
    }
    expect(typeof check).toBe('function')
  })
})

describe('shared 后台类型和云端契约样本对得上', () => {
  it('大白话：契约 JSON 的样本能原样当 shared 类型用——云端改了字段名、JSON 跟着改，vue-tsc 就红', () => {
    // 带 status 字面量的列表类（listOrders/listRefunds）JSON 推断成 string，对不上字面量联合，不在这里锁
    const c = CONTRACT.cases
    const typed: [AdminDashboard, AdminStatusCounts, AdminStatusCounts, AdminOrderDetail, AdminRefundDetail] = [
      c.getDashboard.sample,
      c.orderCounts.sample,
      c.refundCounts.sample,
      c.getOrderDetail.sample,
      c.getRefundDetail.sample,
    ]
    expect(typed).toHaveLength(5)
  })
})
