// fg 组合键定界符防护（战役3 批D·D1）：isValidScmProductId/isValidScmSpec 单测 + 放行集合反解无错拆
// 表驱动对拍（证明 scmKey.ts 头注的排歧规则数学上成立——首个 __ 恒是分隔符本身）。
import { describe, it, expect } from 'vitest'
import { isValidScmProductId, isValidScmSpec } from '../src/scmKey'

// 与 scmPlanner.ts parseFgKey 同一套「首个 __ 反解」逻辑（本地镜像，不跨包 import cloud 私有函数）：
// 只验证「校验规则 ⇒ 反解无歧义」这条数学关系，不是 parseFgKey 本体的单测（那是 cloud 测试的职责）。
function splitOnFirstDoubleUnderscore(combined: string): { productId: string; spec: string } {
  const i = combined.indexOf('__')
  return i < 0 ? { productId: combined, spec: '' } : { productId: combined.slice(0, i), spec: combined.slice(i + 2) }
}

describe('isValidScmProductId（productId 半边：拒 __、拒尾随 _）', () => {
  it('大白话：不含 __ 且不以 _ 结尾即合法；含 __ 或尾 _ 一律拒；空串拒', () => {
    expect(isValidScmProductId('p')).toBe(true)
    expect(isValidScmProductId('p1')).toBe(true)
    expect(isValidScmProductId('p_q')).toBe(true) // 单下划线、不在尾部——合法
    expect(isValidScmProductId('p_')).toBe(false) // 尾随 _（D1 撞键案例之一）
    expect(isValidScmProductId('p__x')).toBe(false) // 含 __（D1 撞键案例之一·也会让反解拆错）
    expect(isValidScmProductId('')).toBe(false)
  })
})

describe('isValidScmSpec（spec 半边：拒 __，可为空）', () => {
  it('大白话：不含 __ 即合法（含单个前导 _ 合法）；含 __ 拒；空串合法（无 SKU/无 tag 场景）', () => {
    expect(isValidScmSpec('q')).toBe(true)
    expect(isValidScmSpec('_q')).toBe(true) // 单下划线前导——合法（D1 撞键案例之一的另一半）
    expect(isValidScmSpec('a__b')).toBe(false)
    expect(isValidScmSpec('')).toBe(true)
  })
})

describe('放行集合反解无错拆（表驱动对拍·D1 排歧规则证明）', () => {
  it('大白话：任意通过两条校验的 (productId, spec) 对，按首个 __ 反解回去必得原值——不会拆错', () => {
    const cases: Array<[string, string]> = [
      ['p', '_q'], // D1 头号撞键案例的合法半边（另一半 ('p_','q') 已被 isValidScmProductId 拒）
      ['pA', 'red'],
      ['p_q', 'r'], // productId 单下划线不在尾部
      ['p', ''], // spec 空（无 SKU/无 tag）
      ['pA', '_x_y'], // spec 内多个单下划线
      ['a', 'b'],
    ]
    for (const [productId, spec] of cases) {
      expect(isValidScmProductId(productId), `productId=${productId}`).toBe(true)
      expect(isValidScmSpec(spec), `spec=${spec}`).toBe(true)
      const combined = `${productId}__${spec}`
      const back = splitOnFirstDoubleUnderscore(combined)
      expect(back).toEqual({ productId, spec })
    }
  })
})
