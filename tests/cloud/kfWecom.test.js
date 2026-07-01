import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import {
  getAccessToken,
  syncMsg,
  sendMsg,
  transferToServicer,
  unionidToExternalUserid,
  kfCustomerBatchget,
  getServiceState,
  enterSmartAssistant,
  ensureSmartAssistant,
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

  it('kfCustomerBatchget：反查顾客 unionid（§查订单·平台原生）；errcode/无 unionid 返空', async () => {
    const ok = mkFetch(() => ({ errcode: 0, customer_list: [{ external_userid: 'e1', unionid: 'uni-9' }] }))
    expect(await kfCustomerBatchget('TKN', 'e1', ok)).toBe('uni-9')
    expect(ok.calls[0].url).toContain('/kf/customer/batchget')
    expect(ok.calls[0].body).toMatchObject({ external_userid_list: ['e1'] })
    const fail = mkFetch(() => ({ errcode: 48002 }))
    expect(await kfCustomerBatchget('TKN', 'e1', fail)).toBe('')
    const noUnion = mkFetch(() => ({ errcode: 0, customer_list: [{ external_userid: 'e1' }] }))
    expect(await kfCustomerBatchget('TKN', 'e1', noUnion)).toBe('')
  })
})

// 会话状态接缝（防 95018·调试日志 AB·根因#12）：微信客服 send_msg 仅在 service_state ∈ {1 智能助手,3 人工} 可发，
// 新会话默认 0未处理直接发报 95018 静默无回复。迁移到企业微信内后新会话默认态漂移，故回复前主动置态。
describe('会话状态·接入智能助手（防 95018·调试日志 AB）', () => {
  it('getServiceState：POST service_state/get 带 open_kfid+external_userid，回 service_state 数字', async () => {
    const f = mkFetch(() => ({ errcode: 0, service_state: 0 }))
    expect(await getServiceState('TKN', { openKfId: 'KF', externalUserId: 'e1' }, f)).toBe(0)
    expect(f.calls[0].url).toContain('/kf/service_state/get')
    expect(f.calls[0].body).toMatchObject({ open_kfid: 'KF', external_userid: 'e1' })
  })

  it('getServiceState：errcode → -1（读取失败·调用方尽力接入）', async () => {
    const f = mkFetch(() => ({ errcode: 95017 }))
    expect(await getServiceState('TKN', { openKfId: 'KF', externalUserId: 'e1' }, f)).toBe(-1)
  })

  it('enterSmartAssistant：trans 到 service_state=1（智能助手·不带 servicer_userid）', async () => {
    const f = mkFetch(() => ({ errcode: 0 }))
    await enterSmartAssistant('TKN', { openKfId: 'KF', externalUserId: 'e1' }, f)
    expect(f.calls[0].url).toContain('/kf/service_state/trans')
    expect(f.calls[0].body).toMatchObject({ service_state: 1, open_kfid: 'KF', external_userid: 'e1' })
    expect(f.calls[0].body.servicer_userid).toBeUndefined() // 转 1 不需 servicer（转 3 才需）
  })

  it('ensureSmartAssistant：state 0（未处理）→ 先 trans 到 1 再放行 proceed（THE BUG·迁移后新会话默认 0）', async () => {
    const f = mkFetch((url) => (url.includes('/service_state/get') ? { errcode: 0, service_state: 0 } : { errcode: 0 }))
    expect(await ensureSmartAssistant('TKN', { openKfId: 'KF', externalUserId: 'e1' }, f)).toBe('proceed')
    const trans = f.calls.find((c) => c.url.includes('/service_state/trans'))
    expect(trans).toBeTruthy() // 置态了才能 send（否则 95018）
    expect(trans.body).toMatchObject({ service_state: 1 })
  })

  it('ensureSmartAssistant：state 1（已智能助手）→ 直接 proceed，不重复 trans', async () => {
    const f = mkFetch((url) => (url.includes('/service_state/get') ? { errcode: 0, service_state: 1 } : { errcode: 0 }))
    expect(await ensureSmartAssistant('TKN', { openKfId: 'KF', externalUserId: 'e1' }, f)).toBe('proceed')
    expect(f.calls.some((c) => c.url.includes('/service_state/trans'))).toBe(false)
  })

  it('ensureSmartAssistant：state 3（人工接待）→ skip，bot 不抢话（不 trans）', async () => {
    const f = mkFetch((url) => (url.includes('/service_state/get') ? { errcode: 0, service_state: 3 } : { errcode: 0 }))
    expect(await ensureSmartAssistant('TKN', { openKfId: 'KF', externalUserId: 'e1' }, f)).toBe('skip')
    expect(f.calls.some((c) => c.url.includes('/service_state/trans'))).toBe(false)
  })

  it('ensureSmartAssistant：state 2（排队）→ skip（让人工接待池处理·不抢话）', async () => {
    const f = mkFetch((url) => (url.includes('/service_state/get') ? { errcode: 0, service_state: 2 } : { errcode: 0 }))
    expect(await ensureSmartAssistant('TKN', { openKfId: 'KF', externalUserId: 'e1' }, f)).toBe('skip')
    expect(f.calls.some((c) => c.url.includes('/service_state/trans'))).toBe(false)
  })
})
