// 黄金 admin-misc §五（用户账户与写入闸门）+ frontend-store §九（守卫 rw-user-catalog-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data })

beforeEach(() => control.reset())

describe('app 网关（fail-closed 分发）', () => {
  it('大白话：未知 action 一律拒，不落任何副作用', async () => {
    control.setOpenId('oME')
    const r: any = await call('hackMe', { x: 1 })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('BAD_ARGS')
  })
})

describe('login（黄金：静默 upsert·unionid 桥接·并发幂等）', () => {
  it('大白话：无身份拒；首登建档标记为新、主键=本人身份且显式写归属', async () => {
    control.setOpenId('')
    expect(((await call('login')) as any).error).toBe('NO_OPENID')

    control.setOpenId('oNEW')
    const r: any = await call('login')
    expect(r.ok).toBe(true)
    expect(r.isNew).toBe(true)
    const docs = control.dump('users')
    expect(docs.length).toBe(1)
    expect(docs[0]._id).toBe('oNEW')
    expect(docs[0]._openid).toBe('oNEW')
  })

  it('大白话：再登取回同一档不重复建档', async () => {
    control.setOpenId('oME')
    await call('login')
    const r2: any = await call('login')
    expect(r2.isNew).toBe(false)
    expect(control.dump('users').length).toBe(1)
  })

  it('大白话：有 unionid 存进用户档（新老用户都补存）；无 unionid 不存且登录照常', async () => {
    control.setOpenId('oME')
    control.setUnionId('uni-1')
    await call('login')
    expect(control.dump('users')[0].unionid).toBe('uni-1')

    control.reset()
    control.setOpenId('oME2')
    const r: any = await call('login')
    expect(r.ok).toBe(true)
    expect(control.dump('users')[0].unionid).toBeUndefined()
  })

  it('大白话：并发首登只建一条用户档（确定性主键幂等）', async () => {
    control.setOpenId('oME')
    await Promise.all(Array.from({ length: 5 }, () => call('login')))
    expect(control.dump('users').length).toBe(1)
  })

  it('大白话：登录按用户限频——超阈拒（防无限刷库）', async () => {
    control.setOpenId('oME')
    for (let i = 0; i < 30; i++) await call('login')
    const r: any = await call('login')
    expect(r).toEqual({ ok: false, error: 'RATE_LIMITED' })
  })
})

describe('updateProfile（黄金：白名单+截断+归属·不信前端）', () => {
  it('大白话：非白名单字段忽略、昵称截断、简介去空白', async () => {
    control.setOpenId('oME')
    const r: any = await call('updateProfile', {
      nickname: '一二三四五六七八九十一二三四五六七八九十超出',
      bio: '  hi  ',
      isAdmin: true,
      hack: 'x',
    })
    expect(r.ok).toBe(true)
    const u = control.dump('users')[0]
    expect(u.nickname.length).toBe(20)
    expect(u.bio).toBe('hi')
    expect(u.isAdmin).toBeUndefined()
    expect(u.hack).toBeUndefined()
  })

  it('大白话：头像非云存储地址拒收（防注入任意 URL）；云存储地址/空串放行', async () => {
    control.setOpenId('oME')
    const r1: any = await call('updateProfile', { avatar: 'https://evil.com/x.png' })
    expect(r1).toEqual({ ok: false, error: 'EMPTY_PATCH' }) // 非法头像被剔，patch 空

    const r2: any = await call('updateProfile', { avatar: 'cloud://env.x/a.png' })
    expect(r2.ok).toBe(true)
    expect(control.dump('users')[0].avatar).toBe('cloud://env.x/a.png')
  })

  it('大白话：空 patch 拒；首次保存即建档（确定性主键）', async () => {
    control.setOpenId('oME')
    expect(((await call('updateProfile', {})) as any).error).toBe('EMPTY_PATCH')
    await call('updateProfile', { nickname: '鸭' })
    const u = control.dump('users')[0]
    expect(u._id).toBe('oME')
    expect(u._openid).toBe('oME')
  })
})
