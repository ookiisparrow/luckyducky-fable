// 黄金 kit-security §E：回调防伪由框架强制（守卫 rw-kit-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { defineNotifyCallback } from '../src/kit'

const ACK = { errcode: 0, errmsg: 'OK' }

function makeCb(calls: string[]) {
  return defineNotifyCallback<{ outTradeNo?: string }>({
    ack: ACK,
    refId: (e) => e.outTradeNo || '',
    onNotify: async ({ id }) => {
      calls.push(id)
    },
  })
}

beforeEach(() => control.reset())

describe('defineNotifyCallback（回调防伪框架·黄金 E）', () => {
  it('大白话：带用户身份的回调=客户端伪造——不触发业务回调，但仍照常返回 ack（不给探测信号）', async () => {
    control.setOpenId('oFAKE')
    const calls: string[] = []
    const r = await makeCb(calls)({ outTradeNo: 'o1' })
    expect(r).toEqual(ACK)
    expect(calls).toEqual([])
  })

  it('大白话：解析不出单据号（缺引用 id）→ 空操作、返回 ack，不触发业务回调', async () => {
    control.setOpenId('')
    const calls: string[] = []
    const r = await makeCb(calls)({})
    expect(r).toEqual(ACK)
    expect(calls).toEqual([])
  })

  it('大白话：合法服务端回调 → 带解析出的单号触发业务回调，并始终返回 ack', async () => {
    control.setOpenId('')
    const calls: string[] = []
    const r = await makeCb(calls)({ outTradeNo: 'o9' })
    expect(r).toEqual(ACK)
    expect(calls).toEqual(['o9'])
  })
})
