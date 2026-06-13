import { describe, it, expect } from 'vitest'
import { keepValid } from '@/utils/validate.js'

// 支柱②的核心：把"脏数据撑乱页面"挡在入口。这组用例锁定清洗行为。
describe('keepValid 数据契约清洗', () => {
  const valid = (x) => x && x.id != null

  it('保留有效项、丢弃残缺项', () => {
    const out = keepValid([{ id: 1 }, { id: null }, {}, { id: 2 }], valid, 'test')
    expect(out).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('非数组（undefined/null/对象）一律返回空数组', () => {
    expect(keepValid(undefined, valid, 'test')).toEqual([])
    expect(keepValid(null, valid, 'test')).toEqual([])
    expect(keepValid({ id: 1 }, valid, 'test')).toEqual([])
  })

  it('全部有效时原样保留', () => {
    const arr = [{ id: 1 }, { id: 2 }]
    expect(keepValid(arr, valid, 'test')).toEqual(arr)
  })
})
