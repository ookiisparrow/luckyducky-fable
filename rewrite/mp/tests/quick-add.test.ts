// 首页「+」快速加购决策（M2 批次C·2026-07-08 用户拍板：旧假占位反馈改真加购）：
// 单规格出 add 且 payload 形状对齐 cart.add 入参、多规格出 navigate、脏数据出 fail。
import { describe, it, expect } from 'vitest'
import { decideQuickAdd } from '../lib/quickAdd'

const SINGLE = { id: 'p1', name: '小鸭', tag: '单只装', price: 128, was: 258, cover: 'cloud://x/cover.jpg' }
const MULTI = {
  id: 'p2',
  name: '云朵鸭',
  price: 128,
  cover: 'cloud://x/cover2.jpg',
  skus: [
    { name: '经典黄', price: 128 },
    { name: '云朵白', price: 138 },
  ],
}

describe('decideQuickAdd（首页快速加购决策）', () => {
  it('大白话：单规格商品直接出 add 决策，payload 形状对齐 cart.add 入参（元数字·不混入分）', () => {
    const d = decideQuickAdd(SINGLE)
    expect(d.kind).toBe('add')
    if (d.kind === 'add') {
      expect(d.payload).toEqual({ id: 'p1', sku: '', name: '小鸭', tag: '单只装', price: 128, was: 258, cover: 'cloud://x/cover.jpg' })
    }
  })

  it('大白话：多规格商品出 navigate 决策带商品 id（无处代选规格·跳详情页选，不新建规格弹层组件）', () => {
    const d = decideQuickAdd(MULTI)
    expect(d).toEqual({ kind: 'navigate', id: 'p2' })
  })

  it('大白话：脏数据（缺名/缺价/非对象/null）出 fail 决策——调用方温和反馈，不静默', () => {
    expect(decideQuickAdd(null)).toEqual({ kind: 'fail' })
    expect(decideQuickAdd({})).toEqual({ kind: 'fail' })
    expect(decideQuickAdd({ id: 'p3', name: '缺价商品' })).toEqual({ kind: 'fail' })
  })
})
