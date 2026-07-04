// 黄金 admin-misc §二（公开目录读）+ productListed（只下发在售）+ learning-content §九（守卫 rw-user-catalog-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string) => app({ action })

beforeEach(() => control.reset())

describe('getProducts（公开只读·停售过滤）', () => {
  it('大白话：按排序升序下发；停售（listed:false）不下发；旧无 listed 字段的商品仍下发（向后兼容免回灌）', async () => {
    control.seed('products', [
      { _id: 'p2', name: 'B', sort: 2 }, // 旧数据无 listed → 可售
      { _id: 'p1', name: 'A', sort: 1, listed: true },
      { _id: 'p3', name: 'C', sort: 3, listed: false }, // 停售 → 不下发
    ])
    const r: any = await call('getProducts')
    expect(r.ok).toBe(true)
    expect(r.list.map((p: { _id: string }) => p._id)).toEqual(['p1', 'p2'])
  })

  it('大白话：空库返回空列表不报错', async () => {
    const r: any = await call('getProducts')
    expect(r.ok).toBe(true)
    expect(r.list).toEqual([])
  })
})

describe('getContent（公开只读·空兜底）', () => {
  it('大白话：无首页记录返回空（前端回退默认文案）；有记录返回该文档', async () => {
    const r1: any = await call('getContent')
    expect(r1.ok).toBe(true)
    expect(r1.home).toBe(null)

    control.seed('content', [{ _id: 'home', heroTitle: '幸运鸭' }])
    const r2: any = await call('getContent')
    expect(r2.home.heroTitle).toBe('幸运鸭')
  })
})
