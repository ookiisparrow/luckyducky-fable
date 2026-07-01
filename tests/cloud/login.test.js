import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/user/login'

// 登录 + 客服身份桥接（§P0 链②·守卫 login-kf-identity-bridge 行为侧锁）：有 unionid + 缓存令牌 + idconvert 得
// external_userid → 建 kfIdentity(ext→openid) 映射供客服查订单；best-effort 绝不反噬登录。login 不持密钥（读缓存令牌）。
let savedFetch
function stubFetch(responder) {
  globalThis.fetch = async (url) => ({ json: async () => responder(url) })
}
const idconvertOk = (url) => (url.includes('/idconvert') ? { errcode: 0, external_userid: 'EXT-9' } : { errcode: 0 })

beforeEach(() => {
  control.reset()
  control.setOpenId('openid-Z')
  savedFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

describe('login 客服身份桥接（§P0 链②·best-effort）', () => {
  it('有 unionid + 缓存令牌 + idconvert 得 ext → 建 kfIdentity 映射 + 标 kfBound', async () => {
    control.setUnionId('uni-1')
    control.seed('kfState', [{ _id: 'token', accessToken: 'TKN', expireAt: Date.now() + 3600_000 }])
    stubFetch(idconvertOk)
    const r = await main({})
    expect(r.ok).toBe(true)
    const m = control.dump('kfIdentity').find((d) => d._id === 'ext:EXT-9')
    expect(m.openid).toBe('openid-Z')
    expect(m.unionid).toBe('uni-1')
    const u = control.dump('users').find((d) => d._openid === 'openid-Z')
    expect(u.kfBound).toBe(true)
  })

  it('无 unionid（小程序未绑开放平台）→ 不桥接·登录照常返回用户', async () => {
    control.seed('kfState', [{ _id: 'token', accessToken: 'TKN', expireAt: Date.now() + 3600_000 }])
    stubFetch(idconvertOk)
    const r = await main({})
    expect(r.ok).toBe(true)
    expect(r.user._openid).toBe('openid-Z')
    expect(control.dump('kfIdentity')).toHaveLength(0)
  })

  it('无缓存令牌（kfCallback 近期没活动）→ 跳过桥接·登录不崩', async () => {
    control.setUnionId('uni-1') // token 未 seed → getCachedKfToken 返 '' → 不 idconvert
    stubFetch(idconvertOk)
    const r = await main({})
    expect(r.ok).toBe(true)
    expect(control.dump('kfIdentity')).toHaveLength(0)
  })

  it('已绑过（kfBound）→ 不再 idconvert（幂等·省限频）', async () => {
    control.setUnionId('uni-1')
    control.seed('users', [{ _id: 'openid-Z', _openid: 'openid-Z', kfBound: true }])
    control.seed('kfState', [{ _id: 'token', accessToken: 'TKN', expireAt: Date.now() + 3600_000 }])
    let idconvertCalled = false
    stubFetch((url) => {
      if (url.includes('/idconvert')) idconvertCalled = true
      return idconvertOk(url)
    })
    const r = await main({})
    expect(r.ok).toBe(true)
    expect(idconvertCalled).toBe(false)
    expect(control.dump('kfIdentity')).toHaveLength(0)
  })
})
