import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/cs/kfBind'

// 身份桥接·写侧（withOpenId + 频控）：unionid → external_userid → 建映射。
// kfBind 内部走默认 fetch（不注入）→ 桩 globalThis.fetch 按 URL 返回。

let savedFetch
function stubFetch(responder) {
  globalThis.fetch = async (url) => ({ json: async () => responder(url) })
}
const happyResponder = (url) =>
  url.includes('/gettoken')
    ? { access_token: 'TKN', expires_in: 7200 }
    : url.includes('/idconvert')
      ? { errcode: 0, external_userid: 'EXT-9' }
      : { errcode: 0 }

beforeEach(() => {
  control.reset()
  control.setOpenId('openid-Z')
  savedFetch = globalThis.fetch
  process.env.WXKF_CORPID = 'wwc'
  process.env.WXKF_SECRET = 'sec'
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

describe('kfBind 身份桥接写', () => {
  it('有 unionid + 配置齐 → 转换并建映射 ext:<euid>→openid', async () => {
    stubFetch(happyResponder)
    const r = await main({ unionid: 'uni-1' })
    expect(r.ok).toBe(true)
    expect(r.bound).toBe(true)
    const m = control.dump('kfIdentity').find((d) => d._id === 'ext:EXT-9')
    expect(m.openid).toBe('openid-Z')
    expect(m.unionid).toBe('uni-1')
  })

  it('无 unionid → NO_UNIONID（前置未齐·不写）', async () => {
    stubFetch(happyResponder)
    const r = await main({})
    expect(r).toMatchObject({ ok: false, error: 'NO_UNIONID' })
    expect(control.dump('kfIdentity')).toHaveLength(0)
  })

  it('未配置客服密钥 → KF_NOT_CONFIGURED', async () => {
    delete process.env.WXKF_CORPID
    stubFetch(happyResponder)
    const r = await main({ unionid: 'uni-1' })
    expect(r).toMatchObject({ ok: false, error: 'KF_NOT_CONFIGURED' })
  })

  it('转换返空（pending_id/无 48h 会话）→ NO_EXTERNAL_USERID·不写', async () => {
    stubFetch((url) => (url.includes('/gettoken') ? { access_token: 'TKN', expires_in: 7200 } : { errcode: 0, external_userid: '' }))
    const r = await main({ unionid: 'uni-1' })
    expect(r).toMatchObject({ ok: false, error: 'NO_EXTERNAL_USERID' })
    expect(control.dump('kfIdentity')).toHaveLength(0)
  })

  it('无 openid（伪造）→ NO_OPENID（withOpenId fail-closed）', async () => {
    control.setOpenId('')
    stubFetch(happyResponder)
    const r = await main({ unionid: 'uni-1' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('NO_OPENID')
  })
})
