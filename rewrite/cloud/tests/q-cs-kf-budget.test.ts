// 客服批内时间预算：函数超时会在一批 50 条处理到一半时硬杀，而已认领（seen）的消息下次按重复跳过＝吞消息。
// 预算要在每条消息认领前检查：用尽就停，剩下的不认领、游标不推进，下次回调重拉时补处理。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'
import { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as kfCallback } from '../src/functions/cs/kfCallback/index'
import { processKfBatch } from '../src/functions/cs/kfCallback/batch'
import { kfSignature, getDb } from '../src/kit'

const AES = 'b'.repeat(43)
const seenIds = () => control.dump(COLLECTIONS.kfState).map((d: any) => String(d._id)).filter((id) => id.startsWith('seen:'))

let now = 0
let fetchBackup: unknown
beforeEach(() => {
  control.reset()
  control.setOpenId('')
  now = 1_700_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  fetchBackup = (globalThis as any).fetch
  Object.assign(process.env, { WXKF_TOKEN: 'cbtok', WXKF_AESKEY: AES, WXKF_CORPID: 'corp-1', WXKF_SECRET: 'sec' })
})
afterEach(() => {
  vi.restoreAllMocks()
  ;(globalThis as any).fetch = fetchBackup
  for (const k of ['WXKF_TOKEN', 'WXKF_AESKEY', 'WXKF_CORPID', 'WXKF_SECRET']) delete process.env[k]
})

describe('processKfBatch 逐条检查预算', () => {
  it('大白话：处理到一半预算用尽——剩下的不认领、整批报未完成；下次重拉只补处理剩下的', async () => {
    const msgs = [{ msgid: 't1' }, { msgid: 't2' }, { msgid: 't3' }]
    const handled: string[] = []
    const slow = async (m: any) => {
      handled.push(m.msgid)
      now += 10_000
    }
    expect(await processKfBatch(getDb(), msgs, slow, now + 15_000)).toBe(true)
    expect(handled).toEqual(['t1', 't2'])
    expect(seenIds()).toEqual(['seen:t1', 'seen:t2'])

    handled.length = 0
    expect(await processKfBatch(getDb(), msgs, slow, now + 15_000)).toBe(false)
    expect(handled).toEqual(['t3'])
  })
})

// 走真入口：三条消息一批，每发一条回复假装耗时 8s（预算 15s：第三条开始前已超）
async function callback(slowSend: boolean): Promise<string[]> {
  const repliedTo: string[] = []
  ;(globalThis as any).fetch = async (url: string, init?: any) => ({
    json: async () => {
      const u = String(url)
      const body = init?.body ? JSON.parse(init.body) : {}
      if (u.includes('gettoken')) return { access_token: 'T', expires_in: 7200 }
      if (u.includes('sync_msg'))
        return body.cursor
          ? { next_cursor: body.cursor, has_more: 0, msg_list: [] }
          : {
              next_cursor: 'CUR-1',
              has_more: 0,
              msg_list: ['u1', 'u2', 'u3'].map((eu) => ({ msgid: 'm-' + eu, msgtype: 'text', external_userid: eu, text: { content: '你好' }, send_time: 1 })),
            }
      if (u.includes('service_state/get')) return { service_state: 1 }
      if (u.includes('send_msg')) {
        repliedTo.push(body.touser)
        if (slowSend) now += 8_000
        return { errcode: 0, msgid: 'out' }
      }
      if (u.includes('batchget')) return { customer_list: [] }
      return {}
    },
  })
  const key = Buffer.from(AES + '=', 'base64')
  const msgBuf = Buffer.from('<xml><Token>SYNC</Token><OpenKfId>kf-b</OpenKfId></xml>', 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(msgBuf.length, 0)
  let buf = Buffer.concat([crypto.randomBytes(16), len, msgBuf, Buffer.from('corp-1', 'utf8')])
  const pad = 32 - (buf.length % 32 || 32) || 32
  buf = Buffer.concat([buf, Buffer.alloc(pad, pad)])
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]).toString('base64')
  const r: any = await kfCallback({
    httpMethod: 'POST',
    queryStringParameters: { msg_signature: kfSignature('cbtok', '1', '2', enc), timestamp: '1', nonce: '2' },
    body: `<xml><Encrypt><![CDATA[${enc}]]></Encrypt></xml>`,
  })
  expect(r.statusCode).toBe(200)
  return [...new Set(repliedTo)]
}

describe('kfCallback 批内超预算不吞消息', () => {
  it('大白话：这次只来得及回前几位，没轮到的不认领、游标不动；下次回调把剩下的补上再推进游标', async () => {
    const first = await callback(true)
    expect(first.length).toBeGreaterThan(0)
    expect(first.length).toBeLessThan(3)
    const cursorDoc = () => control.dump(COLLECTIONS.kfState).find((d: any) => d._id === 'cursor:kf-b')
    expect(cursorDoc()).toBeUndefined()
    expect(seenIds().sort()).toEqual(first.map((eu) => 'seen:m-' + eu).sort())

    const second = await callback(false)
    expect([...first, ...second].sort()).toEqual(['u1', 'u2', 'u3'])
    expect(cursorDoc()?.cursor).toBe('CUR-1')
  })
})
