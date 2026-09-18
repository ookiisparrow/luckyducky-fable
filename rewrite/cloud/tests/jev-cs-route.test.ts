// Jev 挂在企微自由文本分流：映射 / fail-open / 闸关=旧路（正式关键词不变）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { handleMessage, type DispatchCtx } from '../src/functions/cs/kfCallback/dispatch'
import {
  JEV_MODEL,
  JEV_URL,
  jevRequestBody,
  mapJevDepartment,
  parseJevBody,
  askJev,
  loadJevGate,
} from '../src/functions/cs/kfCallback/jev'
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

const JEV_KEYS = ['JEV_CS_ROUTE', 'TYPESAFE_API_KEY', 'WX_ENV_VERSION', 'TCB_ENV_VERSION'] as const
let fetchBackup: unknown

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  fetchBackup = (globalThis as any).fetch
  for (const k of JEV_KEYS) delete process.env[k]
})
afterEach(() => {
  ;(globalThis as any).fetch = fetchBackup
  for (const k of JEV_KEYS) delete process.env[k]
})

const probeBody = {
  model: 'jev-1.13.0',
  answers: {
    urgency: { type: 'noul', noul: 0.98 },
    department: { type: 'choice', choice: 'billing' },
  },
}

describe('Jev 请求体与映射', () => {
  it('大白话：请求钉官方字段——state 是进线原文，问紧急度和科室', () => {
    const body = jevRequestBody('退款怎么还没到账')
    expect(body.model).toBe(JEV_MODEL)
    expect(body.state).toBe('退款怎么还没到账')
    expect(body.questions.urgency.type).toBe('noul')
    expect(body.questions.department.type).toBe('choice')
    expect(Object.keys(body.questions.department.criteria)).toEqual(['billing', 'technical', 'sales'])
    expect(Object.keys(body.questions.topic.criteria)).toEqual([
      'logistics',
      'packaging',
      'missing',
      'course',
      'discount',
      'rush',
      'greeting',
      'other',
    ])
    expect(body.questions.exceeds.type).toBe('noul')
  })

  it('大白话：科室对上现有菜单类；认不出就空，好走旧路', () => {
    expect(mapJevDepartment('billing')).toBe('aftersale')
    expect(mapJevDepartment('technical')).toBe('activation')
    expect(mapJevDepartment('sales')).toBe('tutorial')
    expect(mapJevDepartment('unknown')).toBe(null)
    expect(parseJevBody(probeBody)).toEqual({ model: 'jev-1.13.0', urgency: 0.98, department: 'billing' })
    expect(parseJevBody({ model: 'jev-1.13.0', answers: {} })).toBe(null)
  })
})

describe('闸关 = 旧关键词路', () => {
  it('大白话：正式字面或没开闸——不打 TypeSafe，打「快递」仍弹物流菜单', async () => {
    const calls: string[] = []
    ;(globalThis as any).fetch = async (url: string) => {
      calls.push(String(url))
      throw new Error('jev-must-not-run')
    }
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: '', text: '快递到哪了' })
    expect(calls).toEqual([])
    expect(sent[0].msgtype).toBe('msgmenu')
    expect(sent[0].msgmenu.head_content).toContain('快递')

    process.env.WX_ENV_VERSION = 'release'
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'must-not-use'
    expect(await loadJevGate(db())).toEqual({ on: false, key: '' })
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: '', text: '在吗' })
    expect(calls).toEqual([])
    expect(sent[1].msgmenu.head_content).toContain('想咨询什么')
  })
})

describe('fail-open 与闸开映射', () => {
  it('大白话：Jev 挂了顾客仍走旧路——关键词还在，闲聊仍回根菜单', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = async () => {
      throw new Error('jev-down')
    }
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: '', text: '快递到哪了' })
    expect(sent[0].msgmenu.head_content).toContain('快递')
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: '', text: '在吗' })
    expect(sent[1].msgmenu.head_content).toContain('想咨询什么')
  })

  it('大白话：闸开且 Jev 回了——没关键词发话术纯文本，不弹气泡；打中关键词仍听关键词', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    const seen: { url: string; auth?: string; body?: any }[] = []
    ;(globalThis as any).fetch = async (url: string, init?: any) => {
      seen.push({
        url: String(url),
        auth: init && init.headers && init.headers.Authorization,
        body: init && init.body ? JSON.parse(init.body) : undefined,
      })
      return { ok: true, status: 200, json: async () => probeBody }
    }
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: '', text: '钱的事情问一下' })
    expect(seen[0].url).toBe(JEV_URL)
    expect(seen[0].auth).toBe('Bearer test-key')
    expect(seen[0].body.model).toBe(JEV_MODEL)
    expect(seen[0].body.state).toBe('钱的事情问一下')
    expect(sent[0].msgtype).toBe('text')
    expect(sent[0].text.content).toMatch(/在的|帮您/)

    await handleMessage(ctx, { externalUserId: 'eu1', menuId: '', text: '快递到哪了' })
    expect(sent[1].msgmenu.head_content).toContain('快递') // 关键词优先
  })

  it('大白话：取证日志只记模型号和科室，不带密钥和 Bearer', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => probeBody })
    const lines: string[] = []
    const orig = console.info
    console.info = (...a: unknown[]) => {
      lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
    }
    try {
      const { ctx } = sendCollector()
      await handleMessage(ctx, { externalUserId: 'eu1', menuId: '', text: '钱的事情问一下' })
    } finally {
      console.info = orig
    }
    const blob = lines.join('\n')
    expect(blob).toContain('[kf] jev')
    expect(blob).toContain('jev-1.13.0')
    expect(blob).toContain('billing')
    expect(blob).not.toContain('test-key')
    expect(blob).not.toContain('Bearer')
    expect(blob).not.toContain('TYPESAFE')
  })

  it('大白话：库里的 JEV_CS_ROUTE=1 也能开闸；菜单点选不走 Jev', async () => {
    control.seed('secureConfig', [{ _id: 'typesafe', JEV_CS_ROUTE: '1', apiKey: 'db-key' }])
    const gate = await loadJevGate(db())
    expect(gate.on).toBe(true)
    expect(gate.key).toBe('db-key')
    const calls: string[] = []
    ;(globalThis as any).fetch = async (url: string) => {
      calls.push(String(url))
      return { ok: true, json: async () => probeBody }
    }
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: 'human', text: '' })
    expect(calls).toEqual([])
    expect(sent[0].text.content).toContain('已为你转接')
  })

  it('大白话：askJev 4xx / 缺字段当失败，不把脏答案当分流', async () => {
    const r1 = await askJev('hi', 'k', async () => ({ ok: false, status: 401, json: async () => ({}) }))
    expect(r1).toBe(null)
    const r2 = await askJev('hi', 'k', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ model: 'jev-1.13.0', answers: { urgency: { noul: 0.1 } } }),
    }))
    expect(r2).toBe(null)
  })
})
