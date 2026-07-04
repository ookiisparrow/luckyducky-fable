// 黄金 kit-security §C/§E/§J：fail-closed 身份闸 / 服务端调用判定 / 输入边界（守卫 rw-kit-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { withOpenId, withAdminGate, isServerCall, str } from '../src/kit'

beforeEach(() => control.reset())

describe('withOpenId（fail-closed 身份闸·黄金 C）', () => {
  it('大白话：无可信身份一律拒，handler 一步都不执行', async () => {
    control.setOpenId('')
    let ran = false
    const fn = withOpenId(async () => {
      ran = true
      return { ok: true }
    })
    const r = await fn({})
    expect(r).toEqual({ ok: false, error: 'NO_OPENID' })
    expect(ran).toBe(false)
  })

  it('大白话：有身份 → handler 带着调用者身份与上下文执行', async () => {
    control.setOpenId('oME')
    const fn = withOpenId(async ({ OPENID, event }) => ({ ok: true, who: OPENID, got: event.x }))
    const r = await fn({ x: 7 })
    expect(r).toEqual({ ok: true, who: 'oME', got: 7 })
  })
})

describe('isServerCall（服务端调用判定·黄金 E）', () => {
  it('大白话：无用户身份=可信服务端调用；带身份=客户端，永远伪装不成服务端', () => {
    control.setOpenId('')
    expect(isServerCall()).toBe(true)
    control.setOpenId('oX')
    expect(isServerCall()).toBe(false)
  })
})

describe('withAdminGate（管理闸·黄金 C/E）', () => {
  it('大白话：无身份（CLI/控制台服务端）放行', async () => {
    control.setOpenId('')
    const fn = withAdminGate(async () => ({ ok: true }))
    expect((await fn({})).ok).toBe(true)
  })

  it('大白话：客户端非管理员一律拒——防任意登录用户覆盖生产数据', async () => {
    control.setOpenId('oU')
    control.seed('users', [{ _id: 'oU', _openid: 'oU', isAdmin: false }])
    const fn = withAdminGate(async () => ({ ok: true }))
    const r = await fn({})
    expect(r).toEqual({ ok: false, error: 'ADMIN_ONLY' })
  })

  it('大白话：客户端管理员放行', async () => {
    control.setOpenId('oA')
    control.seed('users', [{ _id: 'oA', _openid: 'oA', isAdmin: true }])
    const fn = withAdminGate(async ({ OPENID }) => ({ ok: true, who: OPENID }))
    expect(await fn({})).toEqual({ ok: true, who: 'oA' })
  })
})

describe('str（输入边界·黄金 J）', () => {
  it('大白话：非字符串归空串、超长截断、正常放行', () => {
    expect(str(123, 5)).toBe('')
    expect(str(null, 5)).toBe('')
    expect(str('abcdefgh', 5)).toBe('abcde')
    expect(str('ok', 5)).toBe('ok')
  })
})
