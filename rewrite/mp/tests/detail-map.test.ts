// 详情页映射（展示面 fail-closed 同首页·防半空详情/裂图/「¥undefined」·根因#8 展示层半边）
// + SKU 价格联动（黄金 frontend-store §一 SKU 行身份的展示半边）（守卫 rw-mp-detail-golden）。
import { describe, it, expect } from 'vitest'
import { mapDetail, priceForSelection } from '../lib/mapDetail'

const FULL = {
  _id: 'p1',
  id: 'p1',
  name: '小鸭',
  tag: '单只装',
  brief: '新手友好',
  price: 128,
  was: 258,
  cover: 'cloud://x/cover.jpg',
  images: ['cloud://x/1.jpg', '', 'cloud://x/2.jpg'],
  skus: [
    { name: '经典黄', price: 128 },
    { name: '云朵白', price: 138 },
    { name: '脏行无价' },
  ],
  params: [['尺寸', '18cm'], ['坏行'], null],
  detailSections: [{ lead: '缝合要点', body: '藏线收尾' }, { lead: '', body: '' }],
  kit: [{ icon: 'pen-tool', name: '毛线', qty: '3 团' }, { name: '' }],
}

describe('详情映射（fail-closed：脏档回 null·脏行剔除·图册回退）', () => {
  it('大白话：完整档全字段映射；空 images 项/坏参数行/无价 SKU/无名材料行一律剔除；icon 等内部字段不进视图', () => {
    const vm = mapDetail(FULL)!
    expect(vm.gallery).toEqual(['cloud://x/cover.jpg', 'cloud://x/1.jpg', 'cloud://x/2.jpg']) // cover 领衔·空项剔除
    expect(vm.skus).toEqual([
      { name: '经典黄', priceLabel: '¥128' },
      { name: '云朵白', priceLabel: '¥138' },
    ]) // 脏 SKU 剔除
    expect(vm.params).toEqual([{ k: '尺寸', v: '18cm' }]) // 坏行剔除
    expect(vm.sections).toEqual([{ lead: '缝合要点', body: '藏线收尾' }]) // 全空段剔除
    expect(vm.kit).toEqual([{ name: '毛线', qty: '3 团' }]) // 无名剔除·icon 不进视图
    expect(JSON.stringify(vm)).not.toContain('undefined')
  })

  it('大白话：老种子档（无 cover/skus/params）也能开详情——图册空数组落占位、清单区不渲染；缺名/缺价的脏档整档拒（页面落「不存在」态）', () => {
    const seed = mapDetail({ id: 'prod-1', name: '幸运小鸭礼盒', tag: '送礼首选', price: 198, was: 258 })!
    expect(seed.gallery).toEqual([])
    expect(seed.skus).toEqual([])
    expect(seed.priceLabel).toBe('¥198')
    expect(mapDetail({ id: 'x', price: 100 })).toBeNull() // 无名
    expect(mapDetail({ id: 'x', name: 'y', price: 'abc' })).toBeNull() // 价非法
    expect(mapDetail(null)).toBeNull()
  })
})

describe('SKU 价格联动（选中用 SKU 价·未选/无 SKU 用商品价·原样标不算术）', () => {
  it('大白话：切换规格价签跟着换；没有规格的商品恒用商品价', () => {
    const vm = mapDetail(FULL)!
    expect(priceForSelection(vm, 0)).toBe('¥128')
    expect(priceForSelection(vm, 1)).toBe('¥138')
    expect(priceForSelection(vm, -1)).toBe('¥128') // 未选→商品价
    const noSku = mapDetail({ id: 'p2', name: 'x', price: 98 })!
    expect(priceForSelection(noSku, 0)).toBe('¥98')
  })
})
