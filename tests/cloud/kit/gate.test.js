import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { withOpenId, isServerCall, ok, err } from '../../../packages/cloud/src/kit'

// kit 闸反向测试（根因账本 #3）：去掉 fail-closed / 防伪会让对应用例变红。
beforeEach(() => control.reset())

describe('kit.withOpenId', () => {
  it('无 openid → NO_OPENID（fail-closed）', async () => {
    control.setOpenId('')
    const fn = withOpenId(async () => ok({ hit: true }))
    expect(await fn({})).toEqual({ ok: false, error: 'NO_OPENID' })
  })

  it('有 openid → 注入 OPENID/db/event 并执行 handler', async () => {
    control.setOpenId('user-X')
    let seen
    const fn = withOpenId(async (ctx) => {
      seen = ctx
      return ok()
    })
    const res = await fn({ a: 1 })
    expect(res.ok).toBe(true)
    expect(seen.OPENID).toBe('user-X')
    expect(seen.event).toEqual({ a: 1 })
    expect(typeof seen.db.collection).toBe('function')
  })
})

describe('kit.isServerCall（回调防伪）', () => {
  it('无 openid（工作流服务端）→ true', () => {
    control.setOpenId('')
    expect(isServerCall()).toBe(true)
  })
  it('有 openid（客户端伪造）→ false', () => {
    control.setOpenId('attacker')
    expect(isServerCall()).toBe(false)
  })
})

describe('kit.ok/err', () => {
  it('ok → { ok:true, ...data }', () => expect(ok({ a: 1 })).toEqual({ ok: true, a: 1 }))
  it('err → { ok:false, error }', () => expect(err('X')).toEqual({ ok: false, error: 'X' }))
})
