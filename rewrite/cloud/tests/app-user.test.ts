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
    // 注册时间必须是毫秒数字：后台客户搜索用 dateTime，只认数字；云端日期经回读显示成空白
    expect(typeof docs[0].createdAt).toBe('number')
    expect(docs[0].createdAt).toBeGreaterThan(1_000_000_000_000)
    expect(r.user.createdAt).toBe(docs[0].createdAt)
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

  it('大白话：手机号白名单——合法号归一化纯数字入库；含字母/过短剔除（单字段→EMPTY_PATCH·不覆盖旧值）；空串清空放行', async () => {
    control.setOpenId('oME')
    const r1: any = await call('updateProfile', { phone: '138 0000 0000' }) // 带空格
    expect(r1.ok).toBe(true)
    expect(control.dump('users')[0].phone).toBe('13800000000') // 归一化纯数字（与地址电话规则对齐·≥7 位）
    expect(((await call('updateProfile', { phone: 'abc123' })) as any).error).toBe('EMPTY_PATCH') // 字母被剔·纯数字过短
    expect(((await call('updateProfile', { phone: '12' })) as any).error).toBe('EMPTY_PATCH') // 过短剔除
    expect(((await call('updateProfile', { phone: 'abc' })) as any).error).toBe('EMPTY_PATCH') // 纯非数字归一化为空≠用户清空·剔除不覆盖（契约·别把它当清空）
    expect(control.dump('users')[0].phone).toBe('13800000000') // 非法值（含纯字母）一律不覆盖旧号
    const r2: any = await call('updateProfile', { phone: '' }) // 空串清空放行
    expect(r2.ok).toBe(true)
    expect(control.dump('users')[0].phone).toBe('')
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

describe('deleteAccount（删除资料·抹识别信息·课不可再看·订单依法留）', () => {
  it('大白话：无身份拒；抹掉昵称头像签名电话与客服授权，标删除时间', async () => {
    control.setOpenId('')
    expect(((await call('deleteAccount')) as any).error).toBe('NO_OPENID')

    control.setOpenId('oME')
    await call('updateProfile', { nickname: '小鸭', bio: '钩织', phone: '13800000000', avatar: 'cloud://env.x/a.png' })
    const r: any = await call('deleteAccount')
    expect(r).toEqual({ ok: true, deleted: true })
    const u = control.dump('users')[0]
    expect(u.nickname).toBe('')
    expect(u.avatar).toBe('')
    expect(u.bio).toBe('')
    expect(u.phone).toBe('')
    expect(u.unionid).toBe('')
    expect(u.csDataShare).toEqual({ agreed: false, at: u.deletedAt })
    expect(u.deletedAt).toBeGreaterThan(0)
  })

  it('大白话：删完课单和进度空、旧码不能再抢回、订单行还在', async () => {
    control.setOpenId('oME')
    await call('login')
    control.seed('activations', [
      { _id: 'A1', _openid: 'oME', courseId: 'c1', code: 'K1', enteredAt: 111, createdAt: 1 },
    ])
    control.seed('progress', [{ _id: 'oME:c1', _openid: 'oME', courseId: 'c1', done: { s1: true } }])
    control.seed('qrcodes', [{ _id: 'K1', status: 'activated', courseId: 'c1', activatedBy: 'oME' }])
    control.seed('kfIdentity', [{ _id: 'ext:eu1', openid: 'oME', unionid: 'u1' }])
    control.seed('orders', [{ _id: 'ord1', _openid: 'oME', status: 'paid', amount: 9900 }])

    await call('deleteAccount')

    expect(control.dump('activations')).toEqual([])
    expect(control.dump('progress')).toEqual([])
    expect(control.dump('kfIdentity')).toEqual([])
    expect(control.dump('qrcodes')[0].activatedBy).toBe('deleted:oME')
    expect(control.dump('orders')).toHaveLength(1)
    expect(control.dump('orders')[0]._id).toBe('ord1')

    const mine: any = await call('getMyCourses')
    expect(mine.ok).toBe(true)
    expect(mine.list).toEqual([])

    const again: any = await call('activateCourse', { code: 'K1' })
    expect(again.ok).toBe(false)
    expect(again.error).toBe('CODE_TAKEN')
  })

  it('大白话：再登是空资料；再删一次仍成功（幂等）', async () => {
    control.setOpenId('oME')
    await call('updateProfile', { nickname: '小鸭' })
    await call('deleteAccount')
    const login1: any = await call('login')
    expect(login1.ok).toBe(true)
    expect(login1.isNew).toBe(false)
    expect(login1.user.nickname).toBe('')
    const r2: any = await call('deleteAccount')
    expect(r2).toEqual({ ok: true, deleted: true })
    expect(control.dump('users')).toHaveLength(1)
  })

  it('大白话：删除资料按用户限频——超阈拒', async () => {
    control.setOpenId('oME')
    for (let i = 0; i < 5; i++) await call('deleteAccount')
    const r: any = await call('deleteAccount')
    expect(r).toEqual({ ok: false, error: 'RATE_LIMITED' })
  })

  it('大白话：摘激活/进度/客服桥读失败不再装成已删除——ok:false INTERNAL；真没有仍 deleted:true', async () => {
    control.setOpenId('oME')
    await call('login')
    control.seed('activations', [
      { _id: 'A1', _openid: 'oME', courseId: 'c1', code: 'K1', enteredAt: 111, createdAt: 1 },
    ])
    control.setBeforeGet(({ coll }: any) => {
      if (coll === 'activations') throw new Error('MOCK_DB_FAIL')
    })
    const fail: any = await call('deleteAccount')
    control.setBeforeGet(null as never)
    expect(fail.ok).toBe(false)
    expect(fail.error).toBe('INTERNAL')
    expect(fail.deleted).toBeUndefined()
    expect(control.dump('activations')).toHaveLength(1)
    control.reset()
    control.setOpenId('oME')
    await call('login')
    const empty: any = await call('deleteAccount')
    expect(empty).toEqual({ ok: true, deleted: true })
  })
})
