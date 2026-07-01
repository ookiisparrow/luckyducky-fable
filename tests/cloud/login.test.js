import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/user/login'

// 登录 + 存 unionid（§查订单·守卫 login-kf-identity-bridge 的 login 端）：小程序绑开放平台后有 unionid → 存 users，
// 供 kfCallback 经微信客服 batchget 反查 openid 查订单。login 不调外部 API（不 idconvert·绕 48002）·best-effort 不反噬登录。
beforeEach(() => {
  control.reset()
  control.setOpenId('openid-Z')
})

describe('login 存 unionid（§查订单·平台原生桥接 login 端）', () => {
  it('有 unionid → 存进 users（新用户）', async () => {
    control.setUnionId('uni-1')
    const r = await main({})
    expect(r.ok).toBe(true)
    const u = control.dump('users').find((d) => d._openid === 'openid-Z')
    expect(u.unionid).toBe('uni-1')
  })

  it('无 unionid（未绑开放平台）→ 不存·登录照常返回用户', async () => {
    const r = await main({})
    expect(r.ok).toBe(true)
    expect(r.user._openid).toBe('openid-Z')
    const u = control.dump('users').find((d) => d._openid === 'openid-Z')
    expect(u.unionid == null || u.unionid === '').toBe(true)
  })

  it('老用户 + 有 unionid → 补存 unionid（原档无 unionid 字段）', async () => {
    control.setUnionId('uni-1')
    control.seed('users', [{ _id: 'openid-Z', _openid: 'openid-Z', nickname: 'old' }])
    const r = await main({})
    expect(r.ok).toBe(true)
    expect(r.isNew).toBe(false)
    const u = control.dump('users').find((d) => d._openid === 'openid-Z')
    expect(u.unionid).toBe('uni-1')
  })
})
