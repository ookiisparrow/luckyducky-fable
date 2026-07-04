// 黄金 cs-agent §四/§五/§六/§七（分流引擎/防吞单/归档/CSAT 编排）（守卫 rw-cs2-golden）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { control } from 'wx-server-sdk'
import {
  firstSeen,
  processKfBatch,
  recognize,
  route,
  parseRate,
  heldStatus,
  enqueueSession,
  handleMessage,
  recordCsat,
  summarizeOrders,
  buildMsgMenu,
  rootMenu,
  type DispatchCtx,
} from '../src/functions/cs/kfCallback/dispatch'
import { archiveInbound, archiveOutbound, payloadText } from '../src/functions/cs/kfCallback/archive'
import { main as kfCallback } from '../src/functions/cs/kfCallback/index'
import { kfSignature, getDb } from '../src/kit'

const db = () => getDb()

const sendCollector = () => {
  const sent: any[] = []
  const ctx: DispatchCtx = {
    db: db(),
    openKfId: 'kf1',
    cfg: { appid: '', thumbMediaId: '' },
    send: async (p: any) => void sent.push(p),
  }
  return { sent, ctx }
}

let fetchBackup: any
beforeEach(() => {
  control.reset()
  control.setOpenId('')
  fetchBackup = (globalThis as any).fetch
})
afterEach(() => {
  ;(globalThis as any).fetch = fetchBackup
  for (const k of ['WXKF_CORPID', 'WXKF_SECRET', 'WXKF_TOKEN', 'WXKF_AESKEY']) delete process.env[k]
})

describe('去重认领与防吞单（黄金 §四）', () => {
  it('大白话：首见认领成功；重来判真重复跳过；基建错绝不当重复（否则永久吞消息）', async () => {
    expect(await firstSeen(db(), 'm1')).toBe('first')
    expect(await firstSeen(db(), 'm1')).toBe('duplicate')
    const brokenDb = {
      collection: () => ({
        add: async () => {
          throw new Error('DB_DOWN')
        },
        doc: () => ({ get: async () => null }),
      }),
    }
    expect(await firstSeen(brokenDb, 'm2')).toBe('error')
  })

  it('大白话：单条失败不拖垮整批——其余照常处理、失败项撤回认领可重试、整批报失败', async () => {
    const handled: string[] = []
    const anyFailed = await processKfBatch(db(), [{ msgid: 'a' }, { msgid: 'boom' }, { msgid: 'c' }], async (m: any) => {
      if (m.msgid === 'boom') throw new Error('X')
      handled.push(m.msgid)
    })
    expect(anyFailed).toBe(true)
    expect(handled).toEqual(['a', 'c'])
    // 失败项认领已撤回 → 重试时仍是 first；成功项保留认领去重
    expect(await firstSeen(db(), 'boom')).toBe('first')
    expect(await firstSeen(db(), 'a')).toBe('duplicate')
  })

  it('大白话：认领基建错不当重复跳过——当条不处理、整批报失败（下次重拉重试，不永久吞消息）', async () => {
    const brokenDb = {
      collection: () => ({
        add: async () => {
          throw new Error('DB_DOWN')
        },
        doc: () => ({ get: async () => null, remove: async () => {} }),
      }),
    }
    const handled: string[] = []
    const anyFailed = await processKfBatch(brokenDb, [{ msgid: 'x1' }], async (m: any) => void handled.push(m.msgid))
    expect(anyFailed).toBe(true) // 基建错＝本批失败·保留旧游标重试
    expect(handled).toEqual([]) // 未认领的消息不处理（防重复副作用）
  })
})

describe('关键词识别与路由（黄金 §五·确定性低幻觉）', () => {
  it('大白话：命中类别与命中词；无法归类返回空；未知 menu_id 兜底回根菜单；评分解析越界为空', () => {
    expect(recognize('我的快递到哪了')).toEqual({ cat: 'logistics', word: '快递' })
    expect(recognize('激活码怎么用')!.cat).toBe('activation')
    expect(recognize('今天天气不错')).toBe(null)
    expect(route('human').type).toBe('transfer')
    expect(route('order:query').type).toBe('order_query')
    expect(route('unknown-no-colon').type).toBe('menu')
    expect(route('logistics:eta').type).toBe('faq') // 含冒号未知 id 走 kb FAQ
    expect(parseRate('rate:5')).toBe(5)
    expect(parseRate('rate:9')).toBe(null)
  })
})

describe('转人工与队列（黄金 §五）', () => {
  it('大白话：转人工入自建队列并给确认文案；不动平台会话态', async () => {
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: 'human', text: '' })
    const s = control.dump('csSession')[0]
    expect(s._id).toBe('wxkf:kf1:eu1')
    expect(s.status).toBe('pending')
    expect(sent[0].msgtype).toBe('text')
    expect(sent[0].text.content).toContain('已为你转接')
  })

  it('大白话：入队幂等——已在处理中不覆盖坐席认领；已结束旧会话重开进队尾（清旧归属刷新排队时间）', async () => {
    control.seed('csSession', [
      { _id: 'wxkf:kf1:euA', status: 'active', agentId: 'agent-1', externalUserId: 'euA', openKfId: 'kf1', createdAt: 100 },
      { _id: 'wxkf:kf1:euB', status: 'closed', agentId: 'agent-1', externalUserId: 'euB', openKfId: 'kf1', createdAt: 100 },
    ])
    expect(await enqueueSession(db(), 'kf1', 'euA')).toBe('already')
    const a = control.dump('csSession').find((x: any) => x._id === 'wxkf:kf1:euA')
    expect(a.status).toBe('active')
    expect(a.agentId).toBe('agent-1') // 坐席认领不被顾客重置

    expect(await enqueueSession(db(), 'kf1', 'euB')).toBe('queued') // closed 重开
    const b = control.dump('csSession').find((x: any) => x._id === 'wxkf:kf1:euB')
    expect(b.status).toBe('pending')
    expect(b.agentId).toBe(null)
    expect(b.createdAt).toBeGreaterThan(100) // 队尾重排

    expect(await enqueueSession(db(), 'kf1', '')).toBe('failed') // 不造无主会话
  })

  it('大白话：转人工基建错时如实提示重试，绝不发假「已转接」', async () => {
    const { sent } = sendCollector()
    const brokenDb = {
      collection: (n: string) => ({
        add: async () => {
          throw new Error('DB_DOWN')
        },
        doc: () => ({ get: async () => null }),
      }),
    }
    const ctx: DispatchCtx = { db: brokenDb, openKfId: 'kf1', cfg: { appid: '', thumbMediaId: '' }, send: async (p: any) => void sent.push(p) }
    await handleMessage(ctx, { externalUserId: 'euX', menuId: 'human', text: '' })
    expect(sent[0].text.content).toContain('遇到点问题')
  })

  it('大白话：人工接管期间 bot 不抢话；但顾客再点「找人工」不许装死——回当前状态、不重复入队不重置', async () => {
    control.seed('csSession', [
      { _id: 'wxkf:kf1:euA', status: 'active', agentId: 'agent-1', externalUserId: 'euA', openKfId: 'kf1', createdAt: 100 },
    ])
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euA', menuId: '', text: '在吗' })
    expect(sent.length).toBe(0) // 静默（消息归档在 index 侧不受影响）
    await handleMessage(ctx, { externalUserId: 'euA', menuId: 'human', text: '' })
    expect(sent.length).toBe(1)
    expect(sent[0].text.content).toContain('服务中')
    expect(control.dump('csSession')[0].agentId).toBe('agent-1') // 未被重置
    expect(await heldStatus(db(), 'kf1', 'euA')).toBe('active')
  })
})

describe('FAQ 单源 / 卡片降级 / 查订单（黄金 §五）', () => {
  it('大白话：FAQ 答案来自知识库单源；库缺该条兜底回根菜单不写死答案', async () => {
    control.seed('kb', [{ _id: 'logistics:eta', answer: '一般 48 小时内发货', enabled: true }])
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: 'logistics:eta', text: '' })
    expect(sent[0].text.content).toBe('一般 48 小时内发货')
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: 'ghost:key', text: '' })
    expect(sent[1].msgtype).toBe('msgmenu') // 兜底根菜单
  })

  it('大白话：小程序卡片缺封面素材降级发文字（防发送失败）；配齐才发卡片', async () => {
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: 'aftersale:apply', text: '' })
    expect(sent[0].msgtype).toBe('text') // cfg 空 → 降级
    const ctx2: DispatchCtx = { ...ctx, cfg: { appid: 'wx1', thumbMediaId: 'thumb1' } }
    await handleMessage(ctx2, { externalUserId: 'eu1', menuId: 'aftersale:apply', text: '' })
    expect(sent[1].msgtype).toBe('miniprogram')
  })

  it('大白话：查订单——未绑定引导登录；已绑定回最近订单摘要（中文状态+运单号取 shipping 子对象）', async () => {
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euN', menuId: 'order:query', text: '' })
    expect(sent[0].text.content).toContain('登录')

    control.seed('kfIdentity', [{ _id: 'ext:euB', openid: 'oME' }])
    control.seed('orders', [
      { _id: 'o1', id: 'o1', _openid: 'oME', status: 'shipped', createdAt: 2, shipping: { trackingNo: 'SF123' } },
      { _id: 'o2', id: 'o2', _openid: 'oME', status: 'paid', createdAt: 1 },
    ])
    const text = await summarizeOrders(db(), 'oME')
    expect(text).toContain('已发货')
    expect(text).toContain('SF123')
    expect(text).toContain('已支付/待发货')
  })
})

describe('CSAT 编排（黄金 §七）', () => {
  it('大白话：点星记分回原因菜单；越界分 fail-closed 不入库；备注回写最近一条并清标记', async () => {
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: 'rate:4', text: '' })
    expect(control.dump('csat')[0].score).toBe(4)
    expect(sent[0].msgtype).toBe('msgmenu') // 原因菜单

    expect(await recordCsat(db(), { externalUserId: 'eu1', openid: null, score: 9 })).toBe(null)
    expect(control.dump('csat').length).toBe(1) // 越界不入库

    await handleMessage(ctx, { externalUserId: 'eu1', menuId: 'csatnote:slow', text: '' })
    expect(control.dump('csat')[0].note).toBe('回复有点慢')
    expect(sent[1].text.content).toContain('谢谢')
  })

  it('大白话：关单评分标记在时窗内回纯数字才记分；无标记的纯数字不记分照常回根菜单（防随口数字误当评分）', async () => {
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'eu2', menuId: '', text: '5' })
    expect(control.dump('csat').length).toBe(0) // 无标记不记
    expect(sent[0].msgtype).toBe('msgmenu')

    control.seed('kfState', [{ _id: 'csatask:eu2', at: Date.now() }])
    await handleMessage(ctx, { externalUserId: 'eu2', menuId: '', text: ' 5 ' })
    expect(control.dump('csat')[0].score).toBe(5)
    expect(control.dump('kfState').find((x: any) => x._id === 'csatask:eu2')).toBeUndefined() // 标记已消费
  })
})

describe('会话归档（黄金 §六）', () => {
  it('大白话：入站同消息重投只留一档；平台事件不进会话流；出站菜单提取人话文本可检索', async () => {
    const msg = { msgid: 'm9', msgtype: 'text', external_userid: 'eu1', text: { content: '你好' }, send_time: 1700000000 }
    await archiveInbound(db(), msg, 'kf1')
    await archiveInbound(db(), msg, 'kf1') // 重投
    const rows = control.dump('conversations')
    expect(rows.length).toBe(1)
    expect(rows[0].at).toBe(1700000000_000) // 秒→毫秒

    await archiveInbound(db(), { msgid: 'e1', msgtype: 'event', event: {} }, 'kf1') // 事件不归档
    await archiveInbound(db(), { msgtype: 'text', text: { content: 'x' } }, 'kf1') // 无 msgid 不归档
    expect(control.dump('conversations').length).toBe(1)

    await archiveOutbound(db(), buildMsgMenu('eu1', 'kf1', rootMenu()), 'kf1')
    const out = control.dump('conversations').find((r: any) => r.direction === 'out')
    expect(out.text).toContain('想咨询什么')
    expect(payloadText({ msgtype: 'miniprogram', miniprogram: { title: '我的课程' } })).toContain('我的课程')
  })
})

describe('端到端（验签→拉取→分流→归档→游标推进）', () => {
  it('大白话：一条真顾客文本消息走完整链路——回复发出、入站出站都归档、游标落库、消息已认领', async () => {
    const AES = 'b'.repeat(43)
    process.env.WXKF_TOKEN = 'cbtok'
    process.env.WXKF_AESKEY = AES
    process.env.WXKF_CORPID = 'corp-1'
    process.env.WXKF_SECRET = 'sec'
    const sendCalls: any[] = []
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
                msg_list: [
                  { msgid: 'mm1', msgtype: 'text', external_userid: 'euE', text: { content: '快递到哪了' }, send_time: 1700000001 },
                ],
              }
        if (u.includes('service_state/get')) return { service_state: 1 }
        if (u.includes('send_msg')) {
          sendCalls.push(body)
          return { errcode: 0, msgid: 'out-1' }
        }
        if (u.includes('batchget')) return { customer_list: [] }
        return {}
      },
    })
    // 构造加密回调事件
    const key = Buffer.from(AES + '=', 'base64')
    const iv = key.subarray(0, 16)
    const xml = '<xml><Token>SYNC</Token><OpenKfId>kf-e2e</OpenKfId></xml>'
    const msgBuf = Buffer.from(xml, 'utf8')
    const len = Buffer.alloc(4)
    len.writeUInt32BE(msgBuf.length, 0)
    let buf = Buffer.concat([crypto.randomBytes(16), len, msgBuf, Buffer.from('corp-1', 'utf8')])
    const pad = 32 - (buf.length % 32 || 32) || 32
    buf = Buffer.concat([buf, Buffer.alloc(pad, pad)])
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    cipher.setAutoPadding(false)
    const enc = Buffer.concat([cipher.update(buf), cipher.final()]).toString('base64')
    const sig = kfSignature('cbtok', '1', '2', enc)

    const r: any = await kfCallback({
      httpMethod: 'POST',
      queryStringParameters: { msg_signature: sig, timestamp: '1', nonce: '2' },
      body: `<xml><Encrypt><![CDATA[${enc}]]></Encrypt></xml>`,
    })
    expect(r.statusCode).toBe(200)
    expect(sendCalls.length).toBe(1) // 关键词命中 → 高亮菜单发出
    expect(sendCalls[0].msgtype).toBe('msgmenu')
    const conv = control.dump('conversations')
    expect(conv.filter((c: any) => c.direction === 'in').length).toBe(1)
    expect(conv.filter((c: any) => c.direction === 'out').length).toBe(1)
    expect(control.dump('kfState').find((x: any) => x._id === 'cursor:kf-e2e').cursor).toBe('CUR-1') // 游标推进
    expect(control.dump('kfState').find((x: any) => x._id === 'seen:mm1')).toBeTruthy() // 已认领
  })
})
