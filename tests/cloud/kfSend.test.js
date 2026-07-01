import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/cs/kfSend'

// 客服主动发消息（§P0 ④ 验证 · 承面C sendAgentMessage 雏形）：服务端专用闸（isServerCall）+ send_msg 发出。
// 守卫 kf-send-server-gated 的行为侧锁（越权发送面须服务端专用·根因#3）。走默认 fetch → 桩 globalThis.fetch。
let savedFetch
function stubFetch(responder) {
  globalThis.fetch = async (url) => ({ json: async () => responder(url) })
}
const happy = (url) => (url.includes('/gettoken') ? { access_token: 'TKN', expires_in: 7200 } : { errcode: 0, msgid: 'M-1' })

beforeEach(() => {
  control.reset()
  control.setOpenId('') // 无 openid = 服务端/CLI 调用（isServerCall true）
  savedFetch = globalThis.fetch
  process.env.WXKF_CORPID = 'wwc'
  process.env.WXKF_SECRET = 'sec'
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

describe('kfSend 客服主动发消息（服务端专用·§P0 ④）', () => {
  it('服务端调用 + 参数齐 → send_msg 发出·errcode 0', async () => {
    stubFetch(happy)
    const r = await main({ externalUserId: 'EXT-9', openKfId: 'KF-1', text: '你好' })
    expect(r.ok).toBe(true)
    expect(r.sent).toBe(true)
    expect(r.errcode).toBe(0)
    expect(r.msgid).toBe('M-1')
  })

  it('客户端调用（带 openid·伪造）→ SERVER_ONLY 拒（越权发送面 fail-closed·根因#3）', async () => {
    control.setOpenId('openid-X')
    stubFetch(happy)
    const r = await main({ externalUserId: 'EXT-9', openKfId: 'KF-1', text: '你好' })
    expect(r).toMatchObject({ ok: false, error: 'SERVER_ONLY' })
  })

  it('缺参（无 text/openKfId）→ BAD_ARGS', async () => {
    stubFetch(happy)
    const r = await main({ externalUserId: 'EXT-9' })
    expect(r).toMatchObject({ ok: false, error: 'BAD_ARGS' })
  })

  it('未配置客服密钥 → KF_NOT_CONFIGURED', async () => {
    delete process.env.WXKF_CORPID
    stubFetch(happy)
    const r = await main({ externalUserId: 'EXT-9', openKfId: 'KF-1', text: '你好' })
    expect(r).toMatchObject({ ok: false, error: 'KF_NOT_CONFIGURED' })
  })
})
