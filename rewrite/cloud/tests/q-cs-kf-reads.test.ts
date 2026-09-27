// kfCallback 每条消息的 DB 读放大：wxkf 配置每事件只读一次，kfIdentity 每条消息只读一次。
// 行为（回复、入站/出站归档带 openid、未绑定时桥接写入）与读次数一起锁住。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as kfCallback } from '../src/functions/cs/kfCallback/index'
import { kfSignature, getDb } from '../src/kit'
import { kfUserHasRecentOrder } from '../src/functions/cs/kfCallback/customer'

const AES = 'b'.repeat(43)
const ENV_KEYS = ['WXKF_CORPID', 'WXKF_SECRET', 'WXKF_TOKEN', 'WXKF_AESKEY', 'JEV_CS_ROUTE', 'TYPESAFE_API_KEY', 'WX_ENV_VERSION', 'TCB_ENV_VERSION']

let fetchBackup: unknown
beforeEach(() => {
  control.reset()
  control.setOpenId('')
  fetchBackup = (globalThis as any).fetch
  process.env.WXKF_TOKEN = 'cbtok'
  process.env.WXKF_AESKEY = AES
  process.env.WXKF_CORPID = 'corp-1'
  process.env.WXKF_SECRET = 'sec'
})
afterEach(() => {
  ;(globalThis as any).fetch = fetchBackup
  for (const k of ENV_KEYS) delete process.env[k]
})

function countReads() {
  const n = { wxkf: 0, kfIdentity: 0 }
  control.setBeforeGet(({ coll, id }: any) => {
    if (coll === COLLECTIONS.secureConfig && id === 'wxkf') n.wxkf++
    if (coll === COLLECTIONS.kfIdentity) n.kfIdentity++
  })
  return n
}

// text 为字符串＝自由打字；为对象＝原样作 text 字段（如菜单回传 { menu_id }）
async function postText(euid: string, text: string | object, unionid = '', urls: string[] = []): Promise<any[]> {
  const sendCalls: any[] = []
  ;(globalThis as any).fetch = async (url: string, init?: any) => ({
    json: async () => {
      const u = String(url)
      urls.push(u)
      const body = init?.body ? JSON.parse(init.body) : {}
      if (u.includes('gettoken')) return { access_token: 'T', expires_in: 7200 }
      if (u.includes('sync_msg'))
        return body.cursor
          ? { next_cursor: body.cursor, has_more: 0, msg_list: [] }
          : {
              next_cursor: 'CUR-R',
              has_more: 0,
              msg_list: [
                {
                  msgid: 'mr-' + euid,
                  msgtype: 'text',
                  external_userid: euid,
                  text: typeof text === 'string' ? { content: text } : text,
                  send_time: 1700000001,
                },
              ],
            }
      if (u.includes('service_state/get')) return { service_state: 1 }
      if (u.includes('send_msg')) {
        sendCalls.push(body)
        return { errcode: 0, msgid: 'out-r' }
      }
      if (u.includes('batchget')) return { customer_list: unionid ? [{ external_userid: euid, unionid }] : [] }
      return {}
    },
  })
  const key = Buffer.from(AES + '=', 'base64')
  const msgBuf = Buffer.from('<xml><Token>SYNC</Token><OpenKfId>kf-r</OpenKfId></xml>', 'utf8')
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
  return sendCalls
}

describe('kfCallback 读放大', () => {
  it('大白话：已绑定顾客发一条自由文本——wxkf 配置只读 1 次、kfIdentity 只读 1 次，回复与两向归档照旧带 openid', async () => {
    control.seed(COLLECTIONS.kfIdentity, [{ _id: 'ext:euR', openid: 'oR' }])
    const n = countReads()
    const urls: string[] = []
    const sent = await postText('euR', '快递到哪了', 'un-R', urls)
    expect(sent.map((p) => p.msgtype)).toEqual(['msgmenu'])
    // 已有映射不再反查：batchget 不调、映射文档不被覆写
    expect(urls.some((u) => u.includes('batchget'))).toBe(false)
    expect(control.dump(COLLECTIONS.kfIdentity).find((x: any) => x._id === 'ext:euR')).toEqual({ _id: 'ext:euR', openid: 'oR' })
    const conv = control.dump(COLLECTIONS.conversations)
    expect(conv.find((c: any) => c.direction === 'in').openid).toBe('oR')
    expect(conv.find((c: any) => c.direction === 'out').openid).toBe('oR')
    expect(n.wxkf).toBe(1)
    expect(n.kfIdentity).toBe(1)
  })

  it('大白话：未绑定顾客——kfIdentity 只读 1 次，归档 openid 为空，回复后照旧反查建映射', async () => {
    control.seed('users', [{ _id: 'u1', _openid: 'oNew', unionid: 'un-1' }])
    const n = countReads()
    const sent = await postText('euN', '快递到哪了', 'un-1')
    expect(sent.length).toBe(1)
    const conv = control.dump(COLLECTIONS.conversations)
    expect(conv.every((c: any) => c.openid === '')).toBe(true)
    expect(control.dump(COLLECTIONS.kfIdentity).find((x: any) => x._id === 'ext:euN').openid).toBe('oNew')
    expect(n.kfIdentity).toBe(1)
  })

  it('大白话：已绑定顾客点「查订单」菜单——分流查单沿用本条已读的身份，kfIdentity 仍只读 1 次', async () => {
    control.seed(COLLECTIONS.kfIdentity, [{ _id: 'ext:euQ', openid: 'oQ' }])
    control.seed(COLLECTIONS.orders, [{ _id: 'o1', id: 'LD1', _openid: 'oQ', status: 'paid', createdAt: 1 }])
    const n = countReads()
    const sent = await postText('euQ', { content: '查订单', menu_id: 'order:query' })
    expect(sent.length).toBe(1)
    expect(sent[0].text.content).toContain('LD1')
    expect(n.kfIdentity).toBe(1)
  })

  it('大白话：已绑定顾客点评分菜单——评分记上 openid，kfIdentity 仍只读 1 次', async () => {
    control.seed(COLLECTIONS.kfIdentity, [{ _id: 'ext:euC', openid: 'oC' }])
    const n = countReads()
    await postText('euC', { content: '5分', menu_id: 'rate:5' })
    expect(control.dump(COLLECTIONS.csat).map((c: any) => c.openid)).toEqual(['oC'])
    expect(n.kfIdentity).toBe(1)
  })

  it('大白话：Jev 闸下判「有无近单」——调用方给了已读身份就不再读 kfIdentity，给空串＝已知未绑定', async () => {
    control.seed(COLLECTIONS.kfIdentity, [{ _id: 'ext:euJ', openid: 'oJ' }])
    control.seed(COLLECTIONS.orders, [{ _id: 'o2', _openid: 'oJ', status: 'paid', createdAt: 1 }])
    const n = countReads()
    expect(await kfUserHasRecentOrder(getDb(), 'euJ', 'oJ')).toBe(true)
    expect(await kfUserHasRecentOrder(getDb(), 'euJ', '')).toBe(false)
    expect(n.kfIdentity).toBe(0)
    expect(await kfUserHasRecentOrder(getDb(), 'euJ')).toBe(true)
    expect(n.kfIdentity).toBe(1)
  })
})
