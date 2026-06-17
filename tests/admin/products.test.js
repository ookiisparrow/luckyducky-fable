import { describe, it, expect } from 'vitest'
import { normalizeProduct, stepDone } from '../../packages/admin/src/store/productShape.js'

// ProductList 白屏防御（根因#8·同调试日志 Q 订单白屏）：productsDraft 里缺数组字段的脏商品
// （旧 schema / 半建 / 控制台手改）经 store.load → normalizeProduct 降级安全形状，
// 否则模板 `p.skus.length` / stepDone 的 `p.skus.every` 遇 undefined 抛错→整页白屏。
describe('admin normalizeProduct 脏商品归一化（防 ProductList 白屏）', () => {
  it('缺 skus/images/params/detailSections/kit 的脏商品 → 全补成数组', () => {
    const dirty = { id: 'p1', name: '脏商品' } // 完全没有数组字段
    const n = normalizeProduct(dirty)
    expect(Array.isArray(n.skus)).toBe(true)
    expect(Array.isArray(n.images)).toBe(true)
    expect(Array.isArray(n.params)).toBe(true)
    expect(Array.isArray(n.detailSections)).toBe(true)
    expect(Array.isArray(n.kit)).toBe(true)
  })

  it('数组字段为 null/undefined 也降级为 []（非仅缺键）', () => {
    const n = normalizeProduct({ id: 'p2', skus: null, images: undefined })
    expect(n.skus).toEqual([])
    expect(n.images).toEqual([])
  })

  it('保留已有字段（id/name 不被覆盖），已是数组的原样保留', () => {
    const ok = { id: 'p3', name: '正常', skus: [{ name: 'S', price: '9' }], images: ['a.jpg'] }
    const n = normalizeProduct(ok)
    expect(n.id).toBe('p3')
    expect(n.name).toBe('正常')
    expect(n.skus).toHaveLength(1)
    expect(n.images).toEqual(['a.jpg'])
  })

  it('渲染访问点不抛：脏商品 .skus.length / .images.length / stepDone 都安全', () => {
    const n = normalizeProduct({ id: 'p4' })
    expect(() => n.skus.length + n.images.length).not.toThrow()
    expect(() => stepDone(n, 3)).not.toThrow() // stepDone case3 用 p.skus.length/.every
    expect(stepDone(n, 3)).toBe(false)
  })
})
