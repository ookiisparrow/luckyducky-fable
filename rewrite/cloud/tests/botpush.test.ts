// 黄金 观测-告警触达 §C：企微群机器人推送（守卫 rw-bot-push-single-seam·根因#13/#12 接缝单点）。
// 「记录 + 高危主动告警」的**告警落地**：此前 notifyAlert 只落 [LD_ALERT] 日志行（靠人去控制台看）；
// 本接缝把告警**代码侧直推**企微群机器人，owner 手机实时收。单一收口 + fail-soft（推送失败不反噬主流程）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { pushBotAlert } from '../src/kit/botpush'
import { notifyAlert } from '../src/kit'
import { COLLECTIONS } from '@ldrw/shared'

const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-1234'

beforeEach(() => control.reset())

describe('pushBotAlert（企微群机器人单接缝·批5）', () => {
  it('大白话：合法 webhook→POST markdown 含来源/代码·errcode≠0 报失败·非法 webhook 直接拒不发', async () => {
    const calls: any[] = []
    const fake = async (url: string, init: any) => {
      calls.push({ url, init })
      return { json: async () => ({ errcode: 0 }) }
    }
    const ok = await pushBotAlert(WEBHOOK, { sev: 'money', fn: 'payCallback', code: 'FEE_MISMATCH', ctx: { orderId: 'A' } }, fake)
    expect(ok.ok).toBe(true)
    expect(calls[0].url).toBe(WEBHOOK)
    expect(calls[0].init.body).toContain('FEE_MISMATCH')
    const bad = await pushBotAlert('http://evil.example.com', { sev: 'money', fn: 'x', code: 'y' }, fake)
    expect(bad.ok).toBe(false) // 非法 webhook 形态·拒发（凭证形态校验·不误发外站）
  })

  it('大白话：网络/推送异常绝不抛错（fail-soft·不反噬主流程）', async () => {
    const boom = async () => {
      throw new Error('net down')
    }
    await expect(pushBotAlert(WEBHOOK, { sev: 'security', fn: 'x', code: 'y' }, boom)).resolves.toMatchObject({ ok: false })
  })
})

describe('notifyAlert→企微推送（按 adminConfig 配置·批5）', () => {
  it('大白话：没配 webhook→只落日志/账本不推、不抛（fail-soft）', async () => {
    await notifyAlert('money', 'pay', 'X', {})
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(1) // 账本仍落（批4 桥不受影响）
  })

  it('大白话：配了 alertWebhook→告警时经唯一接缝推企微一次、到配置的 webhook', async () => {
    control.seed(COLLECTIONS.adminConfig, [{ _id: 'settings', alertWebhook: WEBHOOK }])
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return { json: async () => ({ errcode: 0 }) }
    })
    try {
      await notifyAlert('money', 'payCallback', 'UNKNOWN_ORDER', { id: 'o1' })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(calls).toEqual([WEBHOOK])
  })

  it('大白话：alertEvents[code]=false→该事件关推送（控制台可逐事件静音）', async () => {
    control.seed(COLLECTIONS.adminConfig, [{ _id: 'settings', alertWebhook: WEBHOOK, alertEvents: { MUTED: false } }])
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return { json: async () => ({ errcode: 0 }) }
    })
    try {
      await notifyAlert('money', 'pay', 'MUTED', {})
    } finally {
      vi.unstubAllGlobals()
    }
    expect(calls.length).toBe(0) // 关了·不推
  })
})
