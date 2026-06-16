import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import {
  getAccessToken,
  syncMsg,
  sendMsg,
  transferToServicer,
  unionidToExternalUserid,
} from '../../packages/cloud/src/kit/wecom'

// 企业微信客服 API 客户端（access_token DB 缓存 + sync_msg/send_msg/idconvert/转人工）。
// HTTP 形状用注入 fetch 打桩（根因#8：桩证形状，真机证真能用）。

function mkFetch(responder) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null })
    return { json: async () => responder(url) }
  }
  fn.calls = calls
  return fn
}

beforeEach(() => control.reset())

describe('getAccessToken DB 缓存（7200s·类比 throttle）', () => {
  it('首取调 gettoken 并回写缓存；窗口内再取走缓存不重复请求', async () => {
    const f = mkFetch(() => ({ access_token: 'TKN-1', expires_in: 7200 }))
    const cfg = { corpid: 'wwc', secret: 'sec' }
    expect(await getAccessToken(cfg, f)).toBe('TKN-1')
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].url).toContain('/gettoken')
    expect(await getAccessToken(cfg, f)).toBe('TKN-1') // 命中缓存
    expect(f.calls).toHaveLength(1) // 未再请求
    const rec = control.dump('kfState').find((d) => d._id === 'token')
    expect(rec.accessToken).toBe('TKN-1')
    expect(rec.expireAt).toBeGreaterThan(Date.now())
  })

  it('errcode → 抛错（不返回坏 token）', async () => {
    const f = mkFetch(() => ({ errcode: 40013, errmsg: 'invalid corpid' }))
    await expect(getAccessToken({ corpid: 'x', secret: 'y' }, f)).rejects.toThrow('GETTOKEN_FAILED')
  })
})

describe('客服消息 API', () => {
  it('syncMsg：POST sync_msg 带 cursor/token/open_kfid，回 next_cursor/msg_list', async () => {
    const f = mkFetch(() => ({ next_cursor: 'C2', has_more: 0, msg_list: [{ msgid: 'm1' }] }))
    const r = await syncMsg('TKN', { cursor: 'C1', token: 'SYNC', openKfId: 'KF' }, f)
    expect(r.next_cursor).toBe('C2')
    expect(r.msg_list).toHaveLength(1)
    expect(f.calls[0].url).toContain('/kf/sync_msg?access_token=TKN')
    expect(f.calls[0].body).toMatchObject({ cursor: 'C1', token: 'SYNC', open_kfid: 'KF' })
  })

  it('sendMsg：原样 POST send_msg', async () => {
    const f = mkFetch(() => ({ errcode: 0 }))
    await sendMsg('TKN', { touser: 'e1', open_kfid: 'KF', msgtype: 'text', text: { content: 'hi' } }, f)
    expect(f.calls[0].url).toContain('/kf/send_msg')
    expect(f.calls[0].body.msgtype).toBe('text')
  })

  it('transferToServicer：service_state=3 + servicer', async () => {
    const f = mkFetch(() => ({ errcode: 0 }))
    await transferToServicer('TKN', { openKfId: 'KF', externalUserId: 'e1', servicerUserId: 'staff1' }, f)
    expect(f.calls[0].url).toContain('/kf/service_state/trans')
    expect(f.calls[0].body).toMatchObject({ service_state: 3, servicer_userid: 'staff1', external_userid: 'e1' })
  })

  it('unionidToExternalUserid：成功返 external_userid；errcode 返空串', async () => {
    const ok = mkFetch(() => ({ errcode: 0, external_userid: 'EXT-1' }))
    expect(await unionidToExternalUserid('TKN', 'uni1', 'oid1', ok)).toBe('EXT-1')
    expect(ok.calls[0].body).toMatchObject({ unionid: 'uni1', openid: 'oid1' })
    const fail = mkFetch(() => ({ errcode: 60020 }))
    expect(await unionidToExternalUserid('TKN', 'uni1', 'oid1', fail)).toBe('')
  })
})
