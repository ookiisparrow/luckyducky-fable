import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { handleMessage, type DispatchCtx } from '../src/functions/cs/kfCallback/dispatch'
import { parseNumberedLines, buildPools, pickLine, fillSlots, scriptPools } from '../src/functions/cs/kfCallback/scriptPool'
import { composeLine, emptyFlow, nextNode, routeFromJev } from '../src/functions/cs/kfCallback/scriptReply'
import { getDb } from '../src/kit'
import SCRIPT_MD from '../src/functions/cs/kfCallback/scriptAssets.generated.json'

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

const ev = (over: Record<string, unknown> = {}) => ({
  model: 'jev-1.13.0',
  urgency: 0.2,
  department: 'sales' as const,
  ...over,
})

describe('话术库打包与取句', () => {
  it('大白话：编号行能抽出来，主节点每库至少 20 句，构建产物里不写 GitHub 地址', () => {
    expect(parseNumberedLines('1. 嗨\n2. 在的\n不是编号').length).toBe(2)
    const pools = scriptPools()
    for (const id of ['greet', 'greetIssue', 'ack', 'restate', 'trySolve', 'answer', 'askMore', 'hesitate']) {
      expect(pools[id]?.length, id).toBeGreaterThanOrEqual(20)
    }
    const blob = JSON.stringify(SCRIPT_MD)
    expect(blob).not.toContain('api.github.com')
    expect(blob).not.toContain('raw.githubusercontent.com')
  })

  it('大白话：用过的句子先跳过；占位能填进去', () => {
    const pools = buildPools({
      'docs/07-犹豫节点.md': '## 话术库（≥20）\n1. 额这个…\n2. 我先问问\n',
    })
    expect(pickLine('hesitate', ['额这个…'], pools, () => 0)).toBe('我先问问')
    expect(fillSlots('您是说【需求】对吧？', { 需求: '能不能便宜' })).toBe('您是说能不能便宜对吧？')
  })
})

describe('闸开话术状态机（只听 Jev 三态）', () => {
  it('大白话：需求不清就问候；有需求用「在的我看看」；超出预期先犹豫', () => {
    expect(routeFromJev(emptyFlow(), ev({ needStatus: 'unclear' })).topic).toBe('greeting')
    expect(routeFromJev(emptyFlow(), ev({ orderStatus: 'pre_order', needStatus: 'resolve' })).topic).toBe(
      'discount'
    )
    expect(nextNode(emptyFlow(), ev({ needStatus: 'unclear' }))).toBe('greet')
    expect(
      nextNode(emptyFlow(), ev({ topic: 'discount', orderStatus: 'pre_order', needStatus: 'resolve' }))
    ).toBe('greetIssue')
    expect(
      nextNode(
        emptyFlow(),
        ev({ topic: 'rush', orderStatus: 'pre_ship', needStatus: 'exception', exceeds: 0.9 })
      )
    ).toBe('hesitate')
    const { line, node } = composeLine(
      emptyFlow(),
      ev({ topic: 'discount', needStatus: 'exception' }),
      '再便宜五十',
      () => 0
    )
    expect(node).toBe('hesitate')
    expect(line.length).toBeGreaterThan(0)
    expect(line).not.toMatch(/菜单|点一下|👇/)
  })

  it('大白话：不扫顾客原文字猜题——原文像砍价，Jev 说需求不清就仍走问候', () => {
    expect(nextNode(emptyFlow(), ev({ needStatus: 'unclear' }), '能便宜点吗')).toBe('greet')
    expect(
      nextNode(emptyFlow(), ev({ needStatus: 'resolve', topic: 'discount', orderStatus: 'pre_order' }), '在吗')
    ).toBe('greetIssue')
  })

  it('大白话：情绪不满先惊讶；要图走拍照；不编政策结论', () => {
    expect(nextNode(emptyFlow(), ev({ emotionStatus: 'upset', needStatus: 'info', topic: 'logistics' }))).toBe(
      'surprise'
    )
    const greeted = { ...emptyFlow(), greeted: true, node: 'ack' as const }
    expect(nextNode(greeted, ev({ needStatus: 'photo_needed', topic: 'packaging' }))).toBe('photo')
    const { line } = composeLine(
      { ...emptyFlow(), greeted: true, node: 'trySolve', topic: 'discount' },
      ev({ topic: 'discount', needStatus: 'resolve', orderStatus: 'pre_order' }),
      '能便宜点吗',
      () => 0
    )
    expect(line).not.toMatch(/满\d|减\d|暗折/)
  })
})

describe('闸开编排发纯文本', () => {
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

  it('大白话：闸开连着聊，第二句还是文字不是气泡；超预期那句会犹豫', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = async (_url: string, init?: any) => {
      const state = init && init.body ? JSON.parse(init.body).state : ''
      const exception = String(state).includes('赠品') || String(state).includes('五十')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'jev-1.13.0',
          answers: {
            urgency: { noul: 0.2 },
            department: { choice: 'sales' },
            orderStatus: { choice: 'pre_order' },
            emotionStatus: { choice: 'calm' },
            needStatus: { choice: exception ? 'exception' : 'resolve' },
            topic: { choice: 'discount' },
            exceeds: { noul: exception ? 0.9 : 0.1 },
          },
        }),
      }
    }
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euS', menuId: '', text: '能便宜点吗' })
    expect(sent[0].msgtype).toBe('text')
    expect(sent[0].text.content).toMatch(/在的|帮您/)
    await handleMessage(ctx, { externalUserId: 'euS', menuId: '', text: '再便宜五十还要赠品' })
    expect(sent[1].msgtype).toBe('text')
    const blob = String(sent[1].text.content)
    expect(blob).not.toContain('想咨询什么')
    expect(sent[1].msgmenu).toBeUndefined()
  })
})
