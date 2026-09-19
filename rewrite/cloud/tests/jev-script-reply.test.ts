import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { handleMessage, type DispatchCtx } from '../src/functions/cs/kfCallback/dispatch'
import { parseNumberedLines, buildPools, pickLine, fillSlots, scriptPools } from '../src/functions/cs/kfCallback/scriptPool'
import {
  actingOf,
  composeLine,
  emptyFlow,
  loadFlow,
  nextNode,
  persistableFlow,
  routeFromJev,
  wantsHuman,
} from '../src/functions/cs/kfCallback/scriptReply'
import { getDb } from '../src/kit'
import { COLLECTIONS } from '@ldrw/shared'
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

const greeted = (node: 'greetIssue' | 'restate' | 'surprise' | 'awkward' | 'severity' | 'promise' = 'greetIssue') => ({
  ...emptyFlow(),
  greeted: true,
  node,
  surprised: node === 'surprise' || node === 'awkward' || node === 'severity',
  restated: node === 'restate' || node === 'promise',
  promised: node === 'promise',
})

describe('话术库打包与取句', () => {
  it('大白话：编号行能抽出来，主节点每库至少 20 句，构建产物里不写 GitHub 地址', () => {
    expect(parseNumberedLines('1. 嗨\n2. 在的\n不是编号').length).toBe(2)
    const pools = scriptPools()
    for (const id of [
      'greet',
      'greetIssue',
      'ack',
      'restate',
      'trySolve',
      'answer',
      'askMore',
      'hesitate',
      'clarify',
      'humanAskWhat',
      'humanSayDirect',
    ]) {
      expect(pools[id]?.length, id).toBeGreaterThanOrEqual(20)
    }
    const blob = JSON.stringify(SCRIPT_MD)
    expect(blob).not.toContain('api.github.com')
    expect(blob).not.toContain('raw.githubusercontent.com')
    expect(blob).toContain('bot情绪表演')
  })

  it('大白话：用过的句子先跳过；占位能填进去', () => {
    const pools = buildPools({
      'docs/07-犹豫节点.md': '## 话术库（≥20）\n1. 额这个…\n2. 我先问问\n',
    })
    expect(pickLine('hesitate', ['额这个…'], pools, () => 0)).toBe('我先问问')
    expect(fillSlots('您是说【需求】对吧？', { 需求: '能不能便宜' })).toBe('您是说能不能便宜对吧？')
    expect(fillSlots('简单说，【结论】', {})).toBe('')
    expect(fillSlots('最新到【地点】了，预计还要【天数】天到。', {})).toBe('')
    expect(fillSlots('最新到【地点】了，预计还要【天数】天到。', { 地点: '杭州', 天数: '3' })).toBe(
      '最新到杭州了，预计还要3天到。'
    )
  })
})

describe('闸开话术状态机（mermaid + 1→4 + 表演）', () => {
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
    ).toBe('hesitate')
    expect(
      nextNode(greeted('greetIssue'), ev({ emotionStatus: 'calm', severity: 'high', needStatus: 'logistics' }))
    ).toBe('severity')
    expect(
      nextNode(greeted('restate'), ev({ emotionStatus: 'calm', needStatus: 'exceeds', orderStatus: 'pre_order' }))
    ).toBe('hesitate')
    const { line, node, acting } = composeLine(
      greeted('restate'),
      ev({ needStatus: 'exceeds' }),
      '再便宜五十',
      () => 0
    )
    expect(node).toBe('hesitate')
    expect(acting).toBe('hesitate')
    expect(line.length).toBeGreaterThan(0)
    expect(line).not.toMatch(/菜单|点一下|👇/)
  })

  it('大白话：顾客激动客服不跟着激动；只有我方失职才道歉表演', () => {
    const angry = routeFromJev(emptyFlow(), ev({ emotionStatus: 'angry', responsibility: 'logistics' }))
    expect(actingOf(angry, 'restate')).toBe('empathy')
    expect(actingOf(angry, 'restate')).not.toBe('surprise')
    const merchant = routeFromJev(emptyFlow(), ev({ emotionStatus: 'angry', responsibility: 'merchant' }))
    expect(actingOf(merchant, 'restate')).toBe('apology')
    expect(actingOf(merchant, 'greetIssue')).toBe('reassure')
    const calm = routeFromJev(emptyFlow(), ev({ emotionStatus: 'calm', responsibility: 'n/a' }))
    expect(actingOf(calm, 'restate')).toBe('steady')
    const confused = routeFromJev(emptyFlow(), ev({ emotionStatus: 'confused' }))
    expect(actingOf(confused, 'askMore')).toBe('clarify')
    const { acting } = composeLine(greeted('greetIssue'), ev({ emotionStatus: 'calm', needStatus: 'discount' }), '能便宜点吗', () => 0)
    expect(acting).toBeTruthy()
  })

  it('大白话：不扫顾客原文字猜题；要图走拍照；不编政策结论', () => {
    expect(nextNode(emptyFlow(), ev({ needStatus: 'greeting' }), '能便宜点吗')).toBe('greet')
    expect(nextNode(emptyFlow(), ev({ needStatus: 'discount', orderStatus: 'pre_order' }), '在吗')).toBe(
      'greetIssue'
    )
    expect(nextNode(greeted('greetIssue'), ev({ needStatus: 'photo_needed', topic: 'packaging' }))).toBe('photo')
    const { line } = composeLine(
      { ...emptyFlow(), greeted: true, restated: true, promised: true, node: 'promise', topic: 'discount' },
      ev({ needStatus: 'discount', orderStatus: 'pre_order' }),
      '能便宜点吗',
      () => 0
    )
    expect(line).not.toMatch(/满\d|减\d|暗折/)
  })

  it('大白话：写回会话不能把编号塞进数据，否则第二句写不上', () => {
    const dirty = loadFlow({
      _id: 'jevflow:euX',
      node: 'greetIssue',
      greeted: true,
      used: ['在的在的，我帮您看看哈。'],
    })
    expect(dirty).not.toHaveProperty('_id')
    const payload = persistableFlow(dirty)
    expect(payload).not.toHaveProperty('_id')
    expect(payload.node).toBe('greetIssue')
    expect(payload.greeted).toBe(true)
  })

  it('大白话：包装破损要图，不拿默认【结论】装成已经查完', () => {
    const { line, node, topic } = composeLine(
      { ...greeted('restate'), promised: true, restated: true, node: 'promise', topic: 'other' },
      ev({ needStatus: 'packaging', orderStatus: 'delivered' }),
      '我的包裹压坏了',
      () => 0
    )
    expect(topic).toBe('packaging')
    expect(node).toBe('photo')
    expect(line).toMatch(/拍|照|图/)
    expect(line).not.toMatch(/简单说，|我查到了|结论是|我先帮您确认一下，确认后回您/)
  })

  it('大白话：物流没查到地点天数就不报节点，也不填转运中/几天', () => {
    const late = {
      ...emptyFlow(),
      greeted: true,
      restated: true,
      promised: true,
      solved: true,
      topic: 'other' as const,
      node: 'askNext' as const,
    }
    const { line, node, topic } = composeLine(
      late,
      ev({ needStatus: 'logistics', orderStatus: 'shipped' }),
      '快递到哪了？',
      () => 0
    )
    expect(topic).toBe('logistics')
    expect(node).not.toBe('answer')
    expect(line).not.toMatch(/转运中|预计还要几/)
    expect(line).not.toMatch(/简单说，|我查到了|结论是/)
  })

  it('大白话：卡在「还想问啥」时打人工要走阶梯，打物流要拉回专题，不能反复问还有事吗', () => {
    const stuck = {
      ...emptyFlow(),
      greeted: true,
      restated: true,
      promised: true,
      solved: true,
      topic: 'other' as const,
      node: 'askNext' as const,
    }
    const human = composeLine(stuck, ev({ needStatus: 'greeting' }), '人工', () => 0)
    expect(human.node).toBe('humanAsk')
    expect(scriptPools().humanAskWhat).toContain(human.line)

    const pack = composeLine(stuck, ev({ needStatus: 'packaging', orderStatus: 'delivered' }), '包裹压坏了', () => 0)
    expect(pack.node).toBe('photo')
    expect(pack.line).toMatch(/拍|照|图/)

    const logi = composeLine(stuck, ev({ needStatus: 'logistics', orderStatus: 'shipped' }), '快递到哪了？', () => 0)
    expect(logi.node).not.toBe('askNext')
    expect(logi.node).not.toBe('answer')
    expect(logi.line).not.toMatch(/还想问|还有问题|另外还|转运中|预计还要几/)
  })
})

describe('闸开打字「人工」三次阶梯', () => {
  it('大白话：只有明确要人工才算；业务句不扫', () => {
    expect(wantsHuman('人工')).toBe(true)
    expect(wantsHuman('转人工')).toBe(true)
    expect(wantsHuman('找人工')).toBe(true)
    expect(wantsHuman('转接人工')).toBe(true)
    expect(wantsHuman('我要人工')).toBe(true)
    expect(wantsHuman('帮我转人工谢谢')).toBe(true)
    expect(wantsHuman('快递到哪了')).toBe(false)
    expect(wantsHuman('你好')).toBe(false)
    expect(wantsHuman('测试')).toBe(false)
    expect(wantsHuman('我的包裹压坏了')).toBe(false)
  })

  it('大白话：同会话 1 问怎么了、2 让直说、3 空句转人工', () => {
    const pools = scriptPools()
    const e = ev({ needStatus: 'greeting' })
    const a = composeLine(emptyFlow(), e, '人工', () => 0)
    expect(a.node).toBe('humanAsk')
    expect(a.line).toBe(pools.humanAskWhat[0])
    expect(a.next.humanAsks).toBe(1)

    const b = composeLine(a.next, e, '转人工', () => 0)
    expect(b.node).toBe('humanAsk2')
    expect(b.line).toBe(pools.humanSayDirect[0])
    expect(b.next.humanAsks).toBe(2)

    const c = composeLine(b.next, e, '找人工', () => 0)
    expect(c.node).toBe('human')
    expect(c.line).toBe('')
    expect(c.next.humanAsks).toBe(3)
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

  const jevOk = (need: string) => async (_url: string, init?: any) => {
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
          needStatus: { choice: exception ? 'exceeds' : need },
          exceeds: { noul: exception ? 0.9 : 0.1 },
        },
      }),
    }
  }

  it('大白话：闸开连着聊，第二句还是文字不是气泡；超预期那句会犹豫', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevOk('discount')
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

  it('大白话：第二句会往下走，不会卡在开场重复播', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevOk('discount')
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euAdv', menuId: '', text: '能便宜点吗' })
    const d1 = await db().collection(COLLECTIONS.kfState).doc('jevflow:euAdv').get()
    expect(d1.data.node).toBe('greetIssue')
    expect(d1.data).toHaveProperty('_id')
    await handleMessage(ctx, { externalUserId: 'euAdv', menuId: '', text: '就想便宜点' })
    const d2 = await db().collection(COLLECTIONS.kfState).doc('jevflow:euAdv').get()
    expect(d2.data.node).not.toBe('greetIssue')
    expect(d2.data.node).toBe('restate')
    expect(sent[1].msgtype).toBe('text')
    expect(String(sent[1].text.content)).not.toBe(String(sent[0].text.content))
    expect(d2.data.acting).toBeTruthy()
  })

  it('大白话：闸开打字人工三次才入队；点菜单找人工仍立刻转', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevOk('greeting')
    const pools = scriptPools()
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euH', menuId: '', text: '人工' })
    expect(sent[0].msgtype).toBe('text')
    expect(sent[0].msgmenu).toBeUndefined()
    expect(pools.humanAskWhat).toContain(sent[0].text.content)
    expect(control.dump('csSession')).toEqual([])
    const d1 = await db().collection(COLLECTIONS.kfState).doc('jevflow:euH').get()
    expect(d1.data.humanAsks).toBe(1)

    await handleMessage(ctx, { externalUserId: 'euH', menuId: '', text: '转人工' })
    expect(pools.humanSayDirect).toContain(sent[1].text.content)
    expect(control.dump('csSession')).toEqual([])

    await handleMessage(ctx, { externalUserId: 'euH', menuId: '', text: '找人工' })
    expect(sent[2].text.content).toContain('已为你转接')
    expect(control.dump('csSession')[0].status).toBe('pending')

    const { sent: menuSent, ctx: menuCtx } = sendCollector()
    await handleMessage(menuCtx, { externalUserId: 'euMenu', menuId: 'human', text: '' })
    expect(menuSent[0].text.content).toContain('已为你转接')
    expect(control.dump('csSession').some((s: any) => s._id === 'wxkf:kf1:euMenu')).toBe(true)
  })

  it('大白话：闸关打字人工仍走旧根菜单，不入队', async () => {
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euOff', menuId: '', text: '人工' })
    expect(sent[0].msgtype).toBe('msgmenu')
    expect(sent[0].msgmenu.head_content).toContain('想咨询什么')
    expect(control.dump('csSession')).toEqual([])
  })
})
