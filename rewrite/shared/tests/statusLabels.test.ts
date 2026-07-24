// 变异分诊批（2026-07-24）：statusLabels 首轮变异分 0%（35 幸存全是文案清空/表清空）——
// 展示文案本身是产品措辞可改，但「每个 canonical 状态都有非空标签」与「两处刻意分叉措辞」
// 是行为契约（漏配=页面悄悄显示原始状态码·文件头注明确禁止），故锁集合完整性+分叉点，不逐句锁措辞。
import { describe, it, expect } from 'vitest'
import type { OrderStatus, AfterSaleStatus } from '../src/order'
import type { PurchaseOrderStatus, OutworkOrderStatus } from '../src/scm'
import {
  ORDER_STATUS_LABEL_OPS,
  ORDER_STATUS_LABEL_CUSTOMER,
  AFTERSALE_STATUS_LABEL_OPS,
  AFTERSALE_STATUS_LABEL_CUSTOMER,
  PURCHASE_ORDER_STATUS_LABEL,
  OUTWORK_ORDER_STATUS_LABEL,
} from '../src/statusLabels'

// 键清单手落 + Record<Status,string> 类型焊死：canonical 集合改动时这里编译期红（同源文件头纪律）。
const ORDER_KEYS: OrderStatus[] = ['pending', 'paid', 'shipped', 'done', 'closed', 'refund_required']
const AFTERSALE_KEYS: AfterSaleStatus[] = ['applied', 'approved', 'refunded', 'rejected']
const PURCHASE_KEYS: PurchaseOrderStatus[] = ['draft', 'ordered', 'received', 'cancelled']
const OUTWORK_KEYS: OutworkOrderStatus[] = ['draft', 'issued', 'delivered', 'settled', 'cancelled']

const tables: Array<[string, Record<string, string>, string[]]> = [
  ['ORDER_STATUS_LABEL_OPS', ORDER_STATUS_LABEL_OPS, ORDER_KEYS],
  ['ORDER_STATUS_LABEL_CUSTOMER', ORDER_STATUS_LABEL_CUSTOMER, ORDER_KEYS],
  ['AFTERSALE_STATUS_LABEL_OPS', AFTERSALE_STATUS_LABEL_OPS, AFTERSALE_KEYS],
  ['AFTERSALE_STATUS_LABEL_CUSTOMER', AFTERSALE_STATUS_LABEL_CUSTOMER, AFTERSALE_KEYS],
  ['PURCHASE_ORDER_STATUS_LABEL', PURCHASE_ORDER_STATUS_LABEL, PURCHASE_KEYS],
  ['OUTWORK_ORDER_STATUS_LABEL', OUTWORK_ORDER_STATUS_LABEL, OUTWORK_KEYS],
]

describe('状态标签单源（statusLabels·文案表完整性契约）', () => {
  it('大白话：六张表每个 canonical 状态都有非空中文标签——表被清空/某句被清空都当场红，防页面悄悄显示原始状态码', () => {
    for (const [name, table, keys] of tables) {
      expect(Object.keys(table).sort(), name).toEqual([...keys].sort())
      for (const k of keys) {
        expect(typeof table[k], `${name}.${k}`).toBe('string')
        expect(table[k].length, `${name}.${k} 不得为空串`).toBeGreaterThan(0)
      }
    }
  })

  it('大白话：两处「碰巧长得像但刻意不同」的分叉措辞钉死——shipped 商家视角=已发货/客户视角=待收货；approved 客户端多安抚语', () => {
    expect(ORDER_STATUS_LABEL_OPS.shipped).toBe('已发货')
    expect(ORDER_STATUS_LABEL_CUSTOMER.shipped).toBe('待收货')
    expect(AFTERSALE_STATUS_LABEL_OPS.approved).toBe('退款处理中')
    expect(AFTERSALE_STATUS_LABEL_CUSTOMER.approved).toBe('已同意 · 退款处理中')
  })
})
