// 集合册/错误码册与旧线逐键 parity（数据契约·并存期铁律；M5 清退旧线时本测试随之退役）。
import { describe, it, expect } from 'vitest'
import { COLLECTIONS } from '../src/collections'
import { ERR } from '../src/errors'
import { CHECKOUT_ADDONS, COUPON, SHIP } from '../src/checkout'
import { MAX_PRICE_YUAN, MAX_QTY, MAX_ORDER_LINES, PAY_WINDOW_MS } from '../src/limits'
import { COLLECTIONS as OLD_COLLECTIONS } from '../../../packages/cloud/src/kit/collections'
import { ERR as OLD_ERR } from '../../../packages/shared/src/errors'
import { CHECKOUT_ADDONS as OLD_ADDONS, COUPON as OLD_COUPON, SHIP as OLD_SHIP } from '../../../packages/shared/src/seed/checkout'
import * as OLD_LIMITS from '../../../packages/shared/src/limits'

describe('与旧线契约逐键 parity', () => {
  it('大白话：37 个集合名一个不多一个不少、逐键逐值一致（同一个生产库，名字是数据契约）', () => {
    expect(COLLECTIONS).toEqual(OLD_COLLECTIONS)
    expect(Object.keys(COLLECTIONS).length).toBe(37)
  })
  it('大白话：错误码册逐键逐值一致（码是前端分支契约，不可改名）', () => {
    expect(ERR).toEqual(OLD_ERR)
  })
  it('大白话：结算常量（搭配购/券/运费）与交易边界（价/量/条数/支付窗）逐值一致（钱的口径不漂移）', () => {
    expect(CHECKOUT_ADDONS).toEqual(OLD_ADDONS)
    expect(COUPON).toBe(OLD_COUPON)
    expect(SHIP).toBe(OLD_SHIP)
    expect(MAX_PRICE_YUAN).toBe(OLD_LIMITS.MAX_PRICE_YUAN)
    expect(MAX_QTY).toBe(OLD_LIMITS.MAX_QTY)
    expect(MAX_ORDER_LINES).toBe(OLD_LIMITS.MAX_ORDER_LINES)
    expect(PAY_WINDOW_MS).toBe(OLD_LIMITS.PAY_WINDOW_MS)
  })
})
