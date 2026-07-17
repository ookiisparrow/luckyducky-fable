// 「+」快速加购决策（M2 批次C·2026-07-08 用户拍板改真加购；2026-07-13 用户拍板：多规格也直接加购、
// 默认加首个规格，不再跳详情——「+」统一＝加入购物车）：单规格出 payload（sku 空·用商品价）、多规格出
// payload（首个 sku 名 + 首个 sku 价·价刻意与商品价不同值，钉住「价取首规格」不是「价取商品级」）、
// 脏数据出 null。was 门控：划线价是商品级，现价取了规格级后「划线 ≤ 现价不成立」即不透传（防荒谬行）。
import { describe, it, expect } from 'vitest'
import { decideQuickAdd } from '../lib/quickAdd'

const SINGLE = { id: 'p1', name: '小鸭', tag: '单只装', price: 128, was: 258, cover: 'cloud://x/cover.jpg' }
const MULTI = {
  id: 'p2',
  name: '云朵鸭',
  price: 128,
  was: 158,
  cover: 'cloud://x/cover2.jpg',
  skus: [
    { name: '经典黄', price: 118 }, // 首规格价 118 ≠ 商品价 128：区分「价取首规格」与「价取商品级」两种实现
    { name: '云朵白', price: 138 },
  ],
}
// 首规格价高于商品级划线价：was 透传会渲染「划线 ¥158 < 现价 ¥198」的荒谬购物车行，须被门控掉
const MULTI_WAS_BELOW = { id: 'p4', name: '全套鸭', price: 128, was: 158, cover: 'c', skus: [{ name: '豪华全套', price: 198 }] }

describe('decideQuickAdd（首页/购物车推荐位共用的快速加购决策）', () => {
  it('大白话：单规格商品直接出 payload，形状对齐 cart.add 入参（元数字·不混入分），划线价高于现价正常透传', () => {
    expect(decideQuickAdd(SINGLE)).toEqual({ id: 'p1', sku: '', name: '小鸭', tag: '单只装', price: 128, was: 258, cover: 'cloud://x/cover.jpg' })
  })

  it('大白话：多规格默认加首个规格（sku 名=经典黄·价=首规格 118 而非商品价 128·2026-07-13 拍板），was 高于首规格价照常透传', () => {
    expect(decideQuickAdd(MULTI)).toEqual({ id: 'p2', sku: '经典黄', name: '云朵鸭', tag: '', price: 118, was: 158, cover: 'cloud://x/cover2.jpg' })
  })

  it('大白话：首规格价高于商品级划线价 → was 不透传（划线价必须高于现价才有意义，不渲染荒谬行）', () => {
    const d = decideQuickAdd(MULTI_WAS_BELOW)
    expect(d).toMatchObject({ sku: '豪华全套', price: 198 })
    expect(d!.was).toBeUndefined()
  })

  it('大白话：脏数据（缺名/缺价/非对象/null）出 null——调用方温和反馈，不静默', () => {
    expect(decideQuickAdd(null)).toBeNull()
    expect(decideQuickAdd({})).toBeNull()
    expect(decideQuickAdd({ id: 'p3', name: '缺价商品' })).toBeNull()
  })
})
