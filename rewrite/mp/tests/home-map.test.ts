// 黄金 learning-content §九「首页内容公开读·无记录前端回退默认文案」+ 展示面 fail-closed
// （防「¥undefined」类真机事故·根因#8 展示层半边）（守卫 rw-mp-home-golden）。
import { describe, it, expect } from 'vitest'
import { mapHero, mapProducts } from '../lib/mapHome'

describe('首页 hero 映射（黄金 §九：缺档回退默认文案·不空屏不半空）', () => {
  it('大白话：没配置首页内容 → 完整默认文案；配了一半 → 缺的那半回退默认、配的那半用配置', () => {
    const empty = mapHero(null)
    expect(empty.title).toBeTruthy()
    expect(empty.tagline).toBeTruthy()
    const half = mapHero({ hero: { title: '春季上新啦' } })
    expect(half.title).toBe('春季上新啦')
    expect(half.tagline).toBe(empty.tagline) // 缺 tagline 回退默认·不半空
    expect(mapHero({ hero: { title: '', tagline: '' } })).toEqual(empty) // 空串也算缺
  })
})

describe('商品网格映射（展示面 fail-closed：脏行不上首页）', () => {
  it('大白话：正常商品原样标价（元·不做算术）；无名/无价/价格非法的脏行整行剔除，绝不渲染「¥undefined」', () => {
    const vm = mapProducts([
      { id: 'p1', name: '小棉鸭礼盒', tag: '送礼首选', price: 198, was: 258, cover: 'cloud://x/cover.png' },
      { _id: 'p2', name: '单只装', price: 98 }, // 老档 _id 兼容·无 was 无 cover
      { id: 'p3', name: '', price: 100 }, // 无名剔除
      { id: 'p4', name: '坏价格', price: 'abc' }, // 价非法剔除
      { id: 'p5', name: '零价', price: 0 }, // 0 元不上架面
      null, // 脏元素不崩
    ])
    expect(vm.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(vm[0]).toEqual({ id: 'p1', name: '小棉鸭礼盒', tag: '送礼首选', priceLabel: '¥198', wasLabel: '¥258', cover: 'cloud://x/cover.png' })
    expect(vm[1].priceLabel).toBe('¥98')
    expect(vm[1].wasLabel).toBe('') // 无划线价→空串·模板按空隐藏
    expect(JSON.stringify(vm)).not.toContain('undefined')
    expect(mapProducts(undefined)).toEqual([]) // 非数组入参安全
  })
})
