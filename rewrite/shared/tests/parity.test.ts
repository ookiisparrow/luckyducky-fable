// 集合册/错误码册与旧线逐键 parity（数据契约·并存期铁律；M5 清退旧线时本测试随之退役）。
import { describe, it, expect } from 'vitest'
import { COLLECTIONS } from '../src/collections'
import { ERR } from '../src/errors'
import { COLLECTIONS as OLD_COLLECTIONS } from '../../../packages/cloud/src/kit/collections'
import { ERR as OLD_ERR } from '../../../packages/shared/src/errors'

describe('与旧线契约逐键 parity', () => {
  it('大白话：37 个集合名一个不多一个不少、逐键逐值一致（同一个生产库，名字是数据契约）', () => {
    expect(COLLECTIONS).toEqual(OLD_COLLECTIONS)
    expect(Object.keys(COLLECTIONS).length).toBe(37)
  })
  it('大白话：错误码册逐键逐值一致（码是前端分支契约，不可改名）', () => {
    expect(ERR).toEqual(OLD_ERR)
  })
})
