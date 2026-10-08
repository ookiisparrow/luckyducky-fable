// 客服诊断日志（2026-09-28 真事故：顾客在正式客服发消息，kfCallback 收到 4 次通知全回 200，却一句不回、会话库不见，
// 日志里一行业务输出都没有，外面分不出停在哪一步）。每次事件留 [kf-diag] 行：用的哪套配置（尾号）、拉消息返回码
// 与条数、每条走的分支、回复返回码——绝不含消息原文、访问令牌、应用密钥。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as kfCallback } from '../src/functions/cs/kfCallback/index'
import { kfSyncEvent } from './helpers/kf-envelope'

const AES = 'c'.repeat(43)
const SECRET_TEXT = '我的私密内容123'
let logs: string[] = []
let fetchBackup: unknown

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  logs = []
  const cap = (...a: unknown[]) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  vi.spyOn(console, 'log').mockImplementation(cap)
  vi.spyOn(console, 'error').mockImplementation(cap)
  fetchBackup = (globalThis as any).fetch
  Object.assign(process.env, { WXKF_TOKEN: 'cbtok', WXKF_AESKEY: AES, WXKF_CORPID: 'corp-9876', WXKF_SECRET: 'app-secret-zzz' })
})
afterEach(() => {
  vi.restoreAllMocks()
  ;(globalThis as any).fetch = fetchBackup
  for (const k of ['WXKF_TOKEN', 'WXKF_AESKEY', 'WXKF_CORPID', 'WXKF_SECRET']) delete process.env[k]
})

function mockWecom(sync: Record<string, unknown>) {
  ;(globalThis as any).fetch = async (url: string, init?: any) => ({
    json: async () => {
      const u = String(url)
      const body = init?.body ? JSON.parse(init.body) : {}
      if (u.includes('gettoken')) return { access_token: 'ACCESS-TOKEN-XYZ', expires_in: 7200 }
      if (u.includes('sync_msg')) return body.cursor ? { next_cursor: body.cursor, has_more: 0, msg_list: [] } : sync
      if (u.includes('service_state/get')) return { service_state: 1 }
      if (u.includes('send_msg')) return { errcode: 0, msgid: 'out' }
      if (u.includes('batchget')) return { customer_list: [] }
      return {}
    },
  })
}

async function fire(openKfId = 'kf-abcd1234') {
  const r: any = await kfCallback(kfSyncEvent({ token: 'cbtok', aesKey: AES, corpId: 'corp-9876', openKfId }))
  expect(r.statusCode).toBe(200)
}

const diag = () => logs.filter((l) => l.startsWith('[kf-diag]'))

describe('kfCallback 诊断日志', () => {
  it('大白话：一次事件留下「用哪套配置 → 拉到几条 → 每条走哪条路 → 回复结果」，外面一眼看出停在哪', async () => {
    mockWecom({
      errcode: 0,
      next_cursor: 'C1',
      has_more: 0,
      msg_list: [
        { msgid: 'm1', msgtype: 'text', origin: 3, external_userid: 'wmEXT0001', text: { content: SECRET_TEXT }, send_time: 1 },
        { msgid: 'm2', msgtype: 'event', origin: 4, event: { event_type: 'enter_session', external_userid: 'wmEXT0001' }, send_time: 2 },
      ],
    })
    await fire()
    const d = diag().join('\n')
    expect(d).toMatch(/\[kf-diag\] event kf=…1234 corp=…9876/)
    expect(d).toMatch(/\[kf-diag\] sync errcode=0 n=2/)
    expect(d).toMatch(/\[kf-diag\] msg type=text origin=3 .*route=reply/)
    expect(d).toMatch(/\[kf-diag\] msg type=event origin=4 ev=enter_session .*route=welcome/)
    expect(d).toMatch(/\[kf-diag\] send errcode=0/)
    expect(d).toMatch(/\[kf-diag\] batch handled=2 unfinished=0/)
  })

  it('大白话：拉消息被拒（比如用错应用的密钥无权操作这个客服号）——返回码直接写在诊断行里', async () => {
    mockWecom({ errcode: 95011, errmsg: 'no privilege' })
    await fire()
    expect(diag().join('\n')).toMatch(/\[kf-diag\] sync errcode=95011 n=0/)
  })

  it('大白话：诊断日志绝不带消息原文、访问令牌、应用密钥', async () => {
    mockWecom({
      errcode: 0,
      next_cursor: 'C2',
      has_more: 0,
      msg_list: [{ msgid: 'm3', msgtype: 'text', origin: 3, external_userid: 'wmEXT0002', text: { content: SECRET_TEXT }, send_time: 1 }],
    })
    await fire()
    const all = logs.join('\n')
    expect(diag().length).toBeGreaterThan(0)
    for (const secret of [SECRET_TEXT, 'ACCESS-TOKEN-XYZ', 'app-secret-zzz', 'cbtok']) expect(all).not.toContain(secret)
  })
})
