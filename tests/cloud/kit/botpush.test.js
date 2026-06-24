import { describe, it, expect } from 'vitest'
import { pushBotAlert } from '../../../packages/cloud/src/kit/botpush'

// 企微群机器人告警推送（债#23续·根因#13 可观测落地）。
// 守卫 bot-alert-fail-soft 的 reverseTest：核心是 **fail-soft——绝不抛错**（可观测性不反噬主流程）。
// fetch 注入打桩，不打真网络。

const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key-123'

describe('kit.pushBotAlert（企微群机器人推送·fail-soft）', () => {
  it('合法 webhook：POST markdown、errcode=0 → ok:true，载荷含来源/代码', async () => {
    let captured = null
    const fetchImpl = async (url, init) => {
      captured = { url, init }
      return { json: async () => ({ errcode: 0 }) }
    }
    const r = await pushBotAlert(
      WEBHOOK,
      { sev: 'money', fn: 'payCallback', code: 'FEE_MISMATCH', ctx: { id: 'O1', paidFee: 1 } },
      fetchImpl
    )
    expect(r.ok).toBe(true)
    expect(captured.url).toBe(WEBHOOK)
    expect(captured.init.method).toBe('POST')
    const body = JSON.parse(captured.init.body)
    expect(body.msgtype).toBe('markdown')
    expect(body.markdown.content).toContain('FEE_MISMATCH')
    expect(body.markdown.content).toContain('payCallback')
    expect(body.markdown.content).toContain('钱链告警')
  })

  it('非企微 webhook 形态 → 直接拒、不发请求（凭证不乱发）', async () => {
    let called = false
    const fetchImpl = async () => {
      called = true
      return { json: async () => ({}) }
    }
    const r = await pushBotAlert('https://evil.example.com/x', { sev: 'money', fn: 'f', code: 'C' }, fetchImpl)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('BAD_WEBHOOK')
    expect(called).toBe(false)
  })

  it('fetch 抛错 → fail-soft：返回 ok:false、绝不向上抛（不反噬主流程）', async () => {
    const fetchImpl = async () => {
      throw new Error('network down')
    }
    let threw = false
    let r
    try {
      r = await pushBotAlert(WEBHOOK, { sev: 'security', fn: 'f', code: 'C' }, fetchImpl)
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('PUSH_FAIL')
  })

  it('微信返回 errcode 非 0 → ok:false（WX_<code>）', async () => {
    const fetchImpl = async () => ({ json: async () => ({ errcode: 93000, errmsg: 'invalid webhook' }) })
    const r = await pushBotAlert(WEBHOOK, { sev: 'money', fn: 'f', code: 'C' }, fetchImpl)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('WX_93000')
  })
})
