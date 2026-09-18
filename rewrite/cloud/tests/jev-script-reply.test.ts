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

const greeted = (node: 'greetIssue' | 'ack' | 'surprise' | 'awkward' | 'severity' = 'greetIssue') => ({
  ...emptyFlow(),
  greeted: true,
  node,
  surprised: node === 'surprise' || node === 'awkward' || node === 'severity',
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

describe('闸开话术状态机（1→4 优先级）', () => {
  it('大白话：没开场先按订单走，愤怒/超预期/严重/我方责任都让路', () => {
    expect(
      nextNode(
        emptyFlow(),
        ev({
          orderStatus: 'unknown',
          emotionStatus: 'angry',
          severity: 'high',
          responsibility: 'merchant',
          needStatus: 'exceeds',
        })
      )
    ).toBe('greet')
    expect(
      nextNode(emptyFlow(), ev({ orderStatus: 'shipped', emotionStatus: 'angry', needStatus: 'logistics' }))
    ).toBe('greetIssue')
    expect(routeFromJev(emptyFlow(), ev({ needStatus: 'greeting' })).topic).toBe('greeting')
    expect(routeFromJev(emptyFlow(), ev({ orderStatus: 'pre_order', needStatus: 'discount' })).topic).toBe(
      'discount'
    )
  })

  it('大白话：开场后才按情绪→严重程度→责任；超出预期仍走犹豫', () => {
    expect(
      nextNode(
        greeted('greetIssue'),
        ev({
          emotionStatus: 'angry',
          severity: 'high',
          responsibility: 'merchant',
          needStatus: 'exceeds',
          orderStatus: 'shipped',
        })
      )
    ).toBe('surprise')
    expect(
      nextNode(
        { ...greeted('surprise'), surprised: true },
        ev({ emotionStatus: 'angry', severity: 'high', needStatus: 'logistics' })
      )
    ).toBe('awkward')
    expect(
      nextNode(
        { ...greeted('awkward'), surprised: true },
        ev({
          emotionStatus: 'angry',
          severity: 'high',
          responsibility: 'merchant',
          needStatus: 'exceeds',
        })
      )
    ).toBe('severity')
    expect(
      nextNode(
        { ...greeted('severity'), surprised: true, severitySaid: true },
        ev({ responsibility: 'merchant', severity: 'high', needStatus: 'exceeds' })
      )
    ).toBe('apology')
    expect(
      nextNode(greeted('greetIssue'), ev({ emotionStatus: 'calm', severity: 'high', needStatus: 'logistics' }))
    ).toBe('severity')
    expect(
      nextNode(greeted('ack'), ev({ emotionStatus: 'calm', responsibility: 'merchant', needStatus: 'missing' }))
    ).toBe('apology')
    expect(
      nextNode(greeted('ack'), ev({ emotionStatus: 'calm', needStatus: 'exceeds', orderStatus: 'pre_order' }))
    ).toBe('hesitate')
    const { line, node } = composeLine(greeted('ack'), ev({ needStatus: 'exceeds' }), '再便宜五十', () => 0)
    expect(node).toBe('hesitate')
    expect(line.length).toBeGreaterThan(0)
    expect(line).not.toMatch(/菜单|点一下|👇/)
  })

  it('大白话：不扫顾客原文字猜题；要图走拍照；不编政策结论', () => {
    expect(nextNode(emptyFlow(), ev({ needStatus: 'greeting' }), '能便宜点吗')).toBe('greet')
    expect(nextNode(emptyFlow(), ev({ needStatus: 'discount', orderStatus: 'pre_order' }), '在吗')).toBe(
      'greetIssue'
    )
    expect(nextNode(greeted('ack'), ev({ needStatus: 'photo_needed', topic: 'packaging' }))).toBe('photo')
    const { line } = composeLine(
      { ...emptyFlow(), greeted: true, node: 'trySolve', topic: 'discount' },
      ev({ needStatus: 'discount', orderStatus: 'pre_order' }),
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
            severity: { choice: 'low' },
            responsibility: { choice: 'n/a' },
            needStatus: { choice: exception ? 'exceeds' : 'discount' },
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
