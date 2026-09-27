// 异常账本的模块归因：app 网关 action 抛了没接住的异常时，账本 ctx.module 按仓根 modules.json 的 appActions 归到模块。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
})

describe('app 网关异常归因模块（modules.json 单源）', () => {
  it.each([
    ['getMyOrders', 'orders'],
    ['login', 'identity'],
    ['getProducts', 'shop'],
  ])('大白话：数据库挂了 %s 抛异常，账本记在 %s 模块下', async (action, mod) => {
    control.setBeforeGet(() => {
      throw new Error('MOCK_DB_DOWN')
    })
    const r: any = await app({ action, data: {} })
    expect(r.error).toBe('INTERNAL')
    const a = control.dump('anomalies').find((x: any) => x.code === 'APP_ACTION_UNCAUGHT')
    expect(a.ctx).toMatchObject({ action, module: mod })
  })
})
