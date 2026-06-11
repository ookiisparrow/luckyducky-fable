import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../cloudfunctions/confirmReceive/index.js'

// confirmReceive 闸门：openid + 本人订单 + 仅 shipped→done（防越状态/重复确认）。
beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
  control.seed('orders', [
    { _id: 'o1', id: 'o1', _openid: 'user-A', status: 'shipped' },
    { _id: 'o2', id: 'o2', _openid: 'user-A', status: 'paid' },
  ])
})

describe('confirmReceive 闸门', () => {
  it('NO_OPENID / NO_ID', async () => {
    control.setOpenId('')
    expect((await main({ id: 'o1' })).error).toBe('NO_OPENID')
    control.setOpenId('user-A')
    expect((await main({})).error).toBe('NO_ID')
  })

  it('NOT_FOUND：他人订单', async () => {
    control.setOpenId('user-B')
    expect((await main({ id: 'o1' })).error).toBe('NOT_FOUND')
  })

  it('BAD_STATUS：paid（未发货）不能确认收货', async () => {
    expect((await main({ id: 'o2' })).error).toBe('BAD_STATUS:paid')
  })

  it('shipped → done + doneAt', async () => {
    const res = await main({ id: 'o1' })
    expect(res.ok).toBe(true)
    expect(res.doneAt).toBeGreaterThan(0)
    const o1 = control.dump('orders').find((o) => o._id === 'o1')
    expect(o1.status).toBe('done')
    expect(o1.doneAt).toBeGreaterThan(0)
  })
})
