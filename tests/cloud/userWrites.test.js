import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as login } from '../../packages/cloud/src/functions/user/login'
import { main as updateProfile } from '../../packages/cloud/src/functions/user/updateProfile'

// 账户写入（user 域）：login upsert、updateProfile 白名单+截断（B4b-1）。
beforeEach(() => {
  control.reset()
  control.setOpenId('u1')
})

describe('login（静默 upsert）', () => {
  it('NO_OPENID（无身份无法登录）', async () => {
    control.setOpenId('')
    expect((await login({})).error).toBe('NO_OPENID')
  })

  it('首登建档 isNew，再登取回同一档 isNew=false', async () => {
    const r1 = await login({})
    expect(r1.ok).toBe(true)
    expect(r1.isNew).toBe(true)
    expect(control.dump('users')).toHaveLength(1)
    const r2 = await login({})
    expect(r2.isNew).toBe(false)
    expect(control.dump('users')).toHaveLength(1) // 不重复建档
  })
})

describe('updateProfile（白名单 + 截断 + 归属）', () => {
  beforeEach(() => control.seed('users', [{ _id: 'u', _openid: 'u1', nickname: '旧', bio: '', avatar: '' }]))

  it('NO_OPENID / EMPTY_PATCH', async () => {
    control.setOpenId('')
    expect((await updateProfile({ nickname: 'x' })).error).toBe('NO_OPENID')
    control.setOpenId('u1')
    expect((await updateProfile({ phone: '注入字段' })).error).toBe('EMPTY_PATCH') // 非白名单被忽略
  })

  it('白名单字段落库 + 昵称截断 20', async () => {
    const long = '一'.repeat(40)
    const res = await updateProfile({ nickname: long, bio: ' hi ', avatar: 'cloud://x' })
    expect(res.ok).toBe(true)
    const u = control.dump('users')[0]
    expect(u.nickname).toHaveLength(20)
    expect(u.bio).toBe('hi')
    expect(u.avatar).toBe('cloud://x')
  })

  it('avatar 非 cloud:// 被拒收（防注入任意 URL）', async () => {
    await updateProfile({ avatar: 'https://evil/x.png' })
    expect(control.dump('users')[0].avatar).toBe('') // 未写入
  })
})

// 根因账本 #1 反向自检：用户域首写用确定性 _id=openid，并发首写撞号即幂等、不重复建档。
// 随机 _id 实现下两个并发首写各自 add → 两条档（本组必红）；确定性 _id 后 → 一条。
describe('并发首写幂等（确定性 _id=openid，根因#1）', () => {
  it('login 并发首登 → 只一条用户档', async () => {
    await Promise.all([login({}), login({})])
    expect(control.dump('users')).toHaveLength(1)
  })

  it('updateProfile 并发首次保存 → 只一条用户档', async () => {
    await Promise.all([updateProfile({ nickname: 'A' }), updateProfile({ nickname: 'B' })])
    expect(control.dump('users')).toHaveLength(1)
  })
})
