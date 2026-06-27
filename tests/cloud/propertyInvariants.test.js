import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { toFen, asFen, fenToYuan } from '../../packages/shared/src/money'
import { isValidPriceYuan, MAX_PRICE_YUAN } from '../../packages/shared/src/limits'
import { pageParams } from '../../packages/cloud/src/kit/paging'

// L4 属性测试（验证阶梯·元模式 §A7）：声明「永远该成立的规律」，fast-check 自动生成
// 上万用例去捶——专抓人和 AI 都没想到的边界。锁三条高临界纯函数不变量：
// 钱链（#4）/ 价格安全边界（P1）/ 分页规模边界（#7）。期望（Y）由人用大白话定，见注释。

describe('属性：金额分整数链（病根#4·钱不浮点）', () => {
  // 大白话：任何「整分」金额，先转成元显示、再收回分，必须分毫不差地变回原来的分。
  it('元↔分 round-trip：整分 → 元 → 分 = 原值（无浮点漂移）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (fen) => {
        return toFen(fenToYuan(fen)) === fen
      }),
    )
  })
  // 大白话：前端传来的两位小数元价，转成分后必须是整数（库里永远是整分）。
  it('toFen：任意两位小数元 → 恒为整数分', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (cents) => {
        const yuan = cents / 100
        return Number.isInteger(toFen(yuan)) && toFen(yuan) === cents
      }),
    )
  })
  // 大白话：asFen 是脏数据闸——整数放行、非整数必须当场抛错（不许悄悄入库）。
  it('asFen：整数放行 / 非整数必抛（脏数据早暴露）', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), (n) => {
        if (Number.isInteger(n)) expect(asFen(n)).toBe(n)
        else expect(() => asFen(n)).toThrow(/NOT_INTEGER_FEN/)
      }),
    )
  })
  // 大白话：钱越多，分也越多——转换不能把大小关系搞反。
  it('toFen：单调不减（a≤b → toFen(a)≤toFen(b)）', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: MAX_PRICE_YUAN, noNaN: true }),
        fc.double({ min: 0, max: MAX_PRICE_YUAN, noNaN: true }),
        (a, b) => {
          if (a <= b) return toFen(a) <= toFen(b)
          return toFen(a) >= toFen(b)
        },
      ),
    )
  })
})

describe('属性：价格校验安全边界（P1·负数/无穷/超大永不穿透）', () => {
  // 大白话：负数、0、无穷大、NaN——这些非法价格，永远不许通过校验（曾穿透下单）。
  it('攻击类输入（≤0 / Infinity / NaN）一律拒', () => {
    const attack = fc.oneof(
      fc.constant(0),
      fc.constant(NaN),
      fc.constant(Infinity),
      fc.constant(-Infinity),
      fc.double({ min: -1e12, max: -0.0001, noNaN: true }), // 负数
    )
    fc.assert(fc.property(attack, (v) => isValidPriceYuan(v) === false))
  })
  // 大白话：超过上限的价（>10 万元），一律拒。
  it('超上限价（> MAX_PRICE_YUAN）一律拒', () => {
    fc.assert(
      fc.property(fc.double({ min: MAX_PRICE_YUAN + 0.01, max: 1e12, noNaN: true }), (v) => {
        return isValidPriceYuan(v) === false
      }),
    )
  })
  // 大白话：(0, 上限] 之间的正常价，必须放行。
  it('合法区间 (0, MAX] 一律放行', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: MAX_PRICE_YUAN, noNaN: true }), (v) => {
        return isValidPriceYuan(v) === true
      }),
    )
  })
})

describe('属性：分页规模边界（病根#7·limit 永远被钳住）', () => {
  // 大白话：前端把 limit 传成任何标量（负数/超大/小数/数字串/垃圾串/null/布尔/缺失），每页条数永远落在 [1,200]。
  // limit 经云函数 JSON event 进来，真实只可能是标量；对象/数组/Symbol 不是真实 limit 输入（且 Number(null原型对象/Symbol)
  // 会抛，属不可达输入·非 pageParams 的 bug），不纳入 fuzz。这些标量 Number() 恒不抛，是这条属性真正该覆盖的面。
  const limitInput = fc.oneof(
    fc.integer(),
    fc.double(), // 含 NaN / ±Infinity
    fc.integer().map(String), // 数字串
    fc.string(), // 垃圾串
    fc.constantFrom(null, undefined, true, false, '', '  ', '-5', '1e9', '999999'),
  )
  it('limit ∈ [1,200]：任意标量 limit 输入下都成立', () => {
    fc.assert(
      fc.property(limitInput, (garbage) => {
        const { limit } = pageParams({ limit: garbage })
        return limit >= 1 && limit <= 200
      }),
    )
  })
  // 大白话：空游标（''/null/undefined）一律归一成 null，下游判「首页」口径一致。
  it('cursor：空值（""/null/undefined）归一为 null', () => {
    fc.assert(
      fc.property(fc.constantFrom('', null, undefined), (c) => {
        return pageParams({ cursor: c }).cursor === null
      }),
    )
  })
})
