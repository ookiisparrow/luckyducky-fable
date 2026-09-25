// appendNew：翻页追加按键去重，保持原顺序；只挡与已有项重复的，不管新页内部。
import { describe, it, expect } from 'vitest'
import { appendNew } from '../src/lib/latest'

describe('appendNew', () => {
  it('大白话：默认按 id 去重，已有的不再追加，新项按原顺序接在后面', () => {
    expect(appendNew([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }])).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  })
  it('大白话：可指定按 _id 去重', () => {
    expect(appendNew([{ _id: 1 }], [{ _id: 1 }, { _id: 2 }], (x) => x._id)).toEqual([{ _id: 1 }, { _id: 2 }])
  })
  it('大白话：新页内部重复不在它的职责内，原样保留', () => {
    expect(appendNew([], [{ id: 'x' }, { id: 'x' }])).toHaveLength(2)
  })
})
