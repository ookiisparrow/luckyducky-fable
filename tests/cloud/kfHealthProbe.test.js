import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/cs/kfHealthProbe'

// 微信客服活体探针（调试日志 AA 隐患补法·守卫 kf-health-probe-wired 行为锁）：探令牌/API 健康，静默故障经
// notifyAlert 唯一 botpush 接缝推企微告警。桩 fetch：/gettoken + kf/account/list + webhook（qyapi）；追踪 webhook 调用。
let savedFetch, webhookCalls
function stubFetch(responder) {
  webhookCalls = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('/webhook/send')) {
      // 群机器人 webhook（区别于同域的 gettoken/kf-account API·按路径判）
      webhookCalls.push(u)
      return { json: async () => ({ errcode: 0 }) }
    }
    return { json: async () => responder(u) }
  }
}
const healthy = (url) =>
  url.includes('/gettoken')
    ? { access_token: 'TKN', expires_in: 7200 }
    : url.includes('kf/account/list')
      ? { errcode: 0, account_list: [{ open_kfid: 'wk1' }] }
      : { errcode: 0 }

beforeEach(() => {
  control.reset()
  control.setOpenId('') // 无 openid = 服务端/定时调用
  control.seed('adminConfig', [{ _id: 'settings', alertWebhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=K' }])
  savedFetch = globalThis.fetch
  process.env.WXKF_CORPID = 'wwc'
  process.env.WXKF_SECRET = 'sec'
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

describe('kfHealthProbe 微信客服活体探针（调试日志 AA）', () => {
  it('令牌+API 健康 → healthy:true·不告警', async () => {
    stubFetch(healthy)
    const r = await main({})
    expect(r).toMatchObject({ ok: true, healthy: true })
    expect(webhookCalls).toHaveLength(0)
  })

  it('API 报 60020（可信IP丢）→ healthy:false + 推企微告警', async () => {
    stubFetch((url) => (url.includes('/gettoken') ? { access_token: 'TKN', expires_in: 7200 } : { errcode: 60020 }))
    const r = await main({})
    expect(r).toMatchObject({ ok: true, healthy: false, errcode: 60020 })
    expect(webhookCalls.length).toBeGreaterThan(0)
  })

  it('令牌取不到（Secret 失效 40001）→ healthy:false + 告警', async () => {
    stubFetch((url) => (url.includes('/gettoken') ? { errcode: 40001 } : { errcode: 0 }))
    const r = await main({})
    expect(r).toMatchObject({ ok: true, healthy: false, reason: 'TOKEN_FAILED' })
    expect(webhookCalls.length).toBeGreaterThan(0)
  })

  it('未配置密钥 → healthy:false + 告警', async () => {
    delete process.env.WXKF_CORPID
    stubFetch(healthy)
    const r = await main({})
    expect(r).toMatchObject({ ok: true, healthy: false })
    expect(webhookCalls.length).toBeGreaterThan(0)
  })

  it('客户端调用（带 openid·伪造）→ SERVER_ONLY 拒（防刷告警·根因#3）', async () => {
    control.setOpenId('openid-X')
    stubFetch(healthy)
    const r = await main({})
    expect(r).toMatchObject({ ok: false, error: 'SERVER_ONLY' })
    expect(webhookCalls).toHaveLength(0)
  })
})
