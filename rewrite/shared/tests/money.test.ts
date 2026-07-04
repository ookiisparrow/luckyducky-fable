// 新线金额契约——黄金基准 rewrite/golden/kit-security.md §I 逐条钉死（守卫 rw-contracts-golden）。
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { toFen, asFen, fenToYuan, refundShareFen, type Fen } from '../src/money'

describe('金额分整数（黄金 I 节）', () => {
  it('大白话：整分金额经「分→元→分」往返恒回原值（无浮点漂移）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), (fen) => {
        expect(toFen(fenToYuan(asFen(fen)))).toBe(fen)
      })
    )
  })

  it('大白话：两位小数元价转分恒为整数分（库里永远整分）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (cents) => {
        const yuan = cents / 100 // 任意两位小数元价
        expect(Number.isInteger(toFen(yuan))).toBe(true)
        expect(toFen(yuan)).toBe(cents)
      })
    )
  })

  it('大白话：asFen 是脏数据闸——整数放行、非整数当场抛错，绝不悄悄入库', () => {
    expect(asFen(19800)).toBe(19800)
    expect(() => asFen(19800.5)).toThrow()
    expect(() => asFen(0.1 + 0.2)).toThrow()
  })

  it('大白话：金额转换单调不减（钱越多分越多，不把大小关系搞反）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 0, max: 10_000_000 }), (a, b) => {
        if (a <= b) expect(toFen(fenToYuan(asFen(a))) <= toFen(fenToYuan(asFen(b)))).toBe(true)
      })
    )
  })
})

describe('售后分摊单源（黄金 orders-money·分摊按占比封顶）', () => {
  const fen = (n: number): Fen => asFen(n)
  it('大白话：单品订单退额=全额实付；多品按行金额占比分摊', () => {
    expect(refundShareFen(fen(17800), fen(17800), fen(17800), fen(0))).toBe(17800)
    // 实付 100，商品总值 200，本行值 100 → 分摊 50
    expect(refundShareFen(fen(10000), fen(20000), fen(10000), fen(0))).toBe(5000)
  })
  it('大白话：同单累计退款封顶实付——已占额度扣完就不能再退', () => {
    expect(refundShareFen(fen(10000), fen(20000), fen(10000), fen(8000))).toBe(2000)
    expect(refundShareFen(fen(10000), fen(20000), fen(10000), fen(10000))).toBe(0)
  })
  it('大白话：商品总值为 0 时分摊为 0（不除零）', () => {
    expect(refundShareFen(fen(10000), fen(0), fen(0), fen(0))).toBe(0)
  })
})
