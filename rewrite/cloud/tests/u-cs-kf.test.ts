import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { enqueueSession, handleMessage, type DispatchCtx } from '../src/functions/cs/kfCallback/dispatch'
import { applyNode, composeLine, emptyFlow, nextNode } from '../src/functions/cs/kfCallback/scriptReply'
import { JEV_NEED } from '../src/functions/cs/kfCallback/jev'
import { getDb } from '../src/kit'

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
const ev = (over: Record<string, unknown> = {}) => ({ model: 'jev-1.13.0', urgency: 0.2, department: 'sales' as const, ...over })
const jevOk = (need: string) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    model: 'jev-1.13.0',
    answers: { urgency: { noul: 0.2 }, department: { choice: 'sales' }, needStatus: { choice: need } },
  }),
})
// 数 secureConfig/typesafe 的读次数（刷新闸、Jev 闸都读它）
const countTypesafeReads = () => {
  const n = { reads: 0 }
  control.setBeforeGet(({ coll, id }: any) => {
    if (coll === COLLECTIONS.secureConfig && id === 'typesafe') n.reads++
  })
  return n
}

const ENV_KEYS = ['JEV_CS_ROUTE', 'TYPESAFE_API_KEY', 'WX_ENV_VERSION', 'TCB_ENV_VERSION', 'CS_BUBBLE_GAP_MS', 'CS_TRIAL_REFRESH'] as const
let fetchBackup: unknown
beforeEach(() => {
  control.reset()
  control.setOpenId('')
  fetchBackup = (globalThis as any).fetch
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.CS_BUBBLE_GAP_MS = '0'
})
afterEach(() => {
  ;(globalThis as any).fetch = fetchBackup
  for (const k of ENV_KEYS) delete process.env[k]
})

describe('话术状态机不自己升级人工', () => {
  it('大白话：要图轮数再多，状态机也不自己转人工（转人工只认顾客打字要人工）', () => {
    for (const needStatus of JEV_NEED) {
      let s = emptyFlow()
      for (let round = 0; round < 10; round++) {
        const node = nextNode(s, ev({ needStatus }))
        expect(node).not.toBe('human')
        s = applyNode(s, node, s.topic || 'other', 'unknown', 'steady')
      }
    }
  })
})

describe('包装破损回复不向顾客要订单号', () => {
  it('大白话：有单无单、各严重度、各随机数下，包装回复都有气泡且不含「订单号」', () => {
    for (const hasRecentOrder of [true, false])
      for (const severity of ['low', 'medium', 'high', undefined])
        for (const text of ['包裹被摔坏了', '快递运输严重压烂了要理赔', '外箱破损'])
          for (let i = 0; i < 20; i++) {
            const r = composeLine(emptyFlow(), ev({ needStatus: 'packaging', severity }), text, () => i / 20, { hasRecentOrder })
            expect(r.pieces && r.pieces.length).toBeTruthy()
            expect(r.line).not.toMatch(/订单号/)
          }
  })
})

describe('闸开打字转人工的交接包', () => {
  it('大白话：第三次打人工只写一份交接包，内容是转人工那一步的口径', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevOk('greeting')
    control.seed(COLLECTIONS.kfState, [{ _id: 'jevsession:euX7', epoch: 2 }])
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euX7', menuId: '', text: '人工' })
    await handleMessage(ctx, { externalUserId: 'euX7', menuId: '', text: '转人工' })
    const handoffWrites: string[] = []
    control.setBeforeUpdate(({ coll, id }: any) => {
      if (coll === COLLECTIONS.kfState && String(id).startsWith('handoff:')) handoffWrites.push(id)
    })
    await handleMessage(ctx, { externalUserId: 'euX7', menuId: '', text: '找人工' })
    expect(sent[2].text.content).toContain('已为你转接')
    expect(handoffWrites).toEqual(['handoff:euX7:2'])
    const doc = await db().collection(COLLECTIONS.kfState).doc('handoff:euX7:2').get()
    expect(doc.data.fail_reason).toBe('user_asks_human')
    expect(doc.data.summary).toBe('找人工')
    expect(doc.data.intent).toBe('unknown')
  })
})

describe('新会话入队推送在线坐席', () => {
  it('大白话：只推在线且配了企微号的坐席；超管坐席身份 admin 取 auth 账号的企微号', async () => {
    control.seed(COLLECTIONS.agentState, [
      { _id: 'agent:a', status: 'online' },
      { _id: 'admin', status: 'online' },
      { _id: 'agent:b', status: 'offline' },
      { _id: 'agent:c', status: 'online' },
    ])
    control.seed(COLLECTIONS.adminConfig, [
      { _id: 'agent:a', wecomUserId: 'wa' },
      { _id: 'auth', wecomUserId: 'wadmin' },
      { _id: 'agent:b', wecomUserId: 'wb' },
    ])
    control.seed(COLLECTIONS.secureConfig, [{ _id: 'wxkf', agentId: '1000002' }])
    control.seed(COLLECTIONS.kfState, [{ _id: 'token', accessToken: 'tok', expireAt: Date.now() + 3600_000 }])
    const bodies: any[] = []
    ;(globalThis as any).fetch = async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body))
      return { json: async () => ({ errcode: 0 }) }
    }
    expect(await enqueueSession(db(), 'kf1', 'euPush')).toBe('queued')
    expect(bodies.length).toBe(1)
    expect(String(bodies[0].touser).split('|').sort()).toEqual(['wa', 'wadmin'])
  })
})

describe('评分后的补充原因菜单', () => {
  it('大白话：点星后回的原因菜单，文案和顺序固定', async () => {
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euMenu', menuId: 'rate:5', text: '' })
    expect(sent[0].msgmenu).toEqual({
      head_content: '想补充点什么吗？（可选）',
      list: [
        { type: 'click', click: { id: 'csatnote:resolved', content: '问题已解决' } },
        { type: 'click', click: { id: 'csatnote:unresolved', content: '问题没解决' } },
        { type: 'click', click: { id: 'csatnote:slow', content: '回复有点慢' } },
        { type: 'click', click: { id: 'csatnote:attitude', content: '态度很好' } },
        { type: 'click', click: { id: 'csatnote:none', content: '不补充了' } },
      ],
      tail_content: '点一下就好，不补充也没关系～',
    })
  })
})

describe('读闸次数', () => {
  it('大白话：闸开一条自由文本，typesafe 配置只读两次（刷新闸一次、Jev 闸一次）', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevOk('discount')
    const n = countTypesafeReads()
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euRead', menuId: '', text: '能便宜点吗' })
    expect(sent.length).toBeGreaterThan(0)
    expect(n.reads).toBe(2)
  })

  it('大白话：点普通菜单（不是刷新按钮）不去读刷新闸', async () => {
    const n = countTypesafeReads()
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euMenuRead', menuId: 'order:query', text: '' })
    expect(sent[0].text.content).toContain('还没识别到你的小程序账号')
    expect(n.reads).toBe(0)
  })
})
