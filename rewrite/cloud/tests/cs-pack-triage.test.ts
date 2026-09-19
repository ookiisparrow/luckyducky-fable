import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { handleMessage, type DispatchCtx } from '../src/functions/cs/kfCallback/dispatch'
import {
  PACK_REQUIRED_SCRIPTS,
  advancePackSession,
  buildHandoffPayload,
  canTransition,
  classifyPackIntent,
  emptyPackSession,
  handoffDocId,
  handoffMissingFields,
  loadPackAssets,
  matchTriageRule,
  packScriptLines,
  packSessionId,
  parsePackScript,
  packagingMustNotAskOrderId,
  packagingPhotoAsks,
  packScriptReply,
  pickPackScript,
  resolvePackScriptId,
  resolvePackagingMainScript,
  walkPackStates,
} from '../src/functions/cs/kfCallback/csPack'
import { packagingFirstTouchBubbles } from '../src/functions/cs/kfCallback/csAtomic'
import { composeLine, emptyFlow, looksGreeting } from '../src/functions/cs/kfCallback/scriptReply'
import { flowStateId, sessionEpochId } from '../src/functions/cs/kfCallback/trialRefresh'
import { scriptPools } from '../src/functions/cs/kfCallback/scriptPool'
import { getDb } from '../src/kit'
import { formatRefreshDone } from '@ldrw/shared'
import PACK from '../src/functions/cs/kfCallback/csPackAssets.generated.json'

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

describe('Config Pack 挂载', () => {
  it('大白话：构建打进的包里有话术和规则，没有 GitHub 地址', () => {
    const assets = loadPackAssets()
    expect(assets.pack_id).toBe('lucky-ducky-2026-09-19')
    expect(assets.brief.gate && assets.brief.gate.mode).toBe('jev_total_intake')
    expect(assets.triage_rules.rules.some((r) => r.script === 'aftersale_packaging')).toBe(true)
    const blob = JSON.stringify(PACK)
    expect(blob).not.toContain('api.github.com')
    expect(blob).not.toContain('raw.githubusercontent.com')
    for (const id of PACK_REQUIRED_SCRIPTS) {
      expect(packScriptLines(id).length, id).toBeGreaterThan(0)
      expect(pickPackScript(id, [], () => 0).length, id).toBeGreaterThan(0)
    }
    expect(parsePackScript('# x\n1. 甲\n2. 乙').length).toBe(2)
  })

  it('大白话：Jev 判包装或原文说摔坏，都选到 Pack 包装/要图脚本', () => {
    const smashed = ev({ needStatus: 'packaging', topic: 'packaging', emotionStatus: 'upset' })
    expect(classifyPackIntent(smashed, '包裹被摔坏了')).toEqual({
      intent: 'packaging',
      stage: 'aftersale',
      confidence: 0.9,
    })
    const hit = resolvePackScriptId(smashed, '包裹被摔坏了')
    expect(hit && hit.ruleId).toBe('R30_aftersale_packaging')
    expect(hit && hit.scriptId).toBe('aftersale_packaging')
    expect(resolvePackagingMainScript(smashed, '包裹被摔坏了')).toBe('aftersale_packaging')
    expect(resolvePackagingMainScript(ev({ needStatus: 'greeting' }), '箱子压坏了')).toBe('aftersale_packaging')
    const rule = matchTriageRule({
      intent: 'packaging',
      stage: 'aftersale',
      confidence: 0.9,
    })
    expect(rule && rule.scriptId).toBe('aftersale_packaging')
    expect(rule && rule.requiredSlots).toEqual(['severity_photo_hint'])
    expect(rule && rule.doNotAsk).toEqual(['order_id'])
    expect(packagingMustNotAskOrderId(rule)).toBe(true)
    const pack = loadPackAssets()
    const r30 = pack.triage_rules.rules.find((r) => r.id === 'R30_aftersale_packaging')
    expect(r30 && r30.comment).toMatch(/只要合照，禁止要订单号/)
    expect(r30 && r30.do_not_ask).toEqual(['order_id'])
    const photo = pack.slots_schema.slots.find((s) => s.name === 'severity_photo_hint')
    expect(photo && photo.required_for).toContain('packaging')
    expect(photo && photo.ask_variants_packaging).toEqual(packagingPhotoAsks())
    const order = pack.slots_schema.slots.find((s) => s.name === 'order_id')
    expect(order && order.required_for).not.toContain('packaging')
    expect(order && String(order.note || '')).toMatch(/禁止要订单号/)
  })

  it('大白话：刷新后「包裹被摔坏了」主句要合照，不要订单号，不要惊讶空壳', () => {
    const pools = scriptPools()
    const packMain = packScriptLines('aftersale_packaging')
    expect(packMain).toContain('您拍一张包装和产品放一起的合照发我～')
    const { line, node, topic } = composeLine(
      emptyFlow(),
      ev({ needStatus: 'packaging', emotionStatus: 'upset', orderStatus: 'delivered', topic: 'packaging' }),
      '包裹被摔坏了',
      () => 0
    )
    expect(topic).toBe('packaging')
    expect(node).toBe('photo')
    expect(line).toContain(packMain[0])
    expect(line).toBe(packagingFirstTouchBubbles(() => 0).join('\n'))
    expect(line).toMatch(/合照/)
    expect(line).not.toMatch(/订单号/)
    expect(line).not.toBe('嗯？您慢慢说')
    expect(pools.surprise.includes(line)).toBe(false)
    expect(line).not.toMatch(/【结论】/)

    const thinJev = composeLine(emptyFlow(), ev({ needStatus: 'greeting' }), '包裹被摔坏了', () => 0)
    expect(thinJev.topic).toBe('packaging')
    expect(thinJev.line).toContain(packMain[0])
    expect(thinJev.line).toMatch(/合照/)
    expect(thinJev.line).not.toMatch(/订单号/)
    expect(thinJev.line).not.toBe('嗯？您慢慢说')
  })
})

describe('状态机禁跳与交接包', () => {
  it('大白话：不能跳步，失败不能假装结案', () => {
    expect(canTransition('new', 'triage')).toBe(false)
    expect(canTransition('greet', 'collect')).toBe(false)
    expect(canTransition('triage', 'resolve')).toBe(false)
    expect(canTransition('collect', 'resolve')).toBe(false)
    expect(canTransition('act', 'greet')).toBe(false)
    expect(canTransition('act', 'resolve', { fail: true })).toBe(false)
    expect(canTransition('new', 'greet')).toBe(true)
    expect(canTransition('triage', 'collect')).toBe(true)
    expect(walkPackStates('new', 'collect')).toEqual(['new', 'greet', 'triage', 'collect'])
    const failed = advancePackSession(
      emptyPackSession(),
      {
        ruleId: 'x',
        action: 'act',
        scriptId: 'triage',
        intent: 'packaging',
        stage: 'aftersale',
        confidence: 0.9,
        requiredSlots: [],
        doNotAsk: ['order_id'],
      },
      { fail: true }
    )
    expect(failed.state).not.toBe('resolve')
    expect(['human', 'new', 'greet', 'triage', 'collect', 'act'].includes(failed.state)).toBe(true)
  })

  it('大白话：转人工交接包必带意图、槽、摘要、订单绑定、原因、epoch', () => {
    const payload = buildHandoffPayload({
      intent: 'packaging',
      filledSlots: { issue_type: 'packaging' },
      summary: '包裹被摔坏了',
      failReason: 'user_asks_human',
      epoch: 2,
    })
    expect(handoffMissingFields(payload)).toEqual([])
    expect(payload.epoch).toBe(2)
    expect(payload.order_binding).toEqual({})
    expect(handoffDocId('eu1', 2)).toBe('handoff:eu1:2')
  })
})

describe('闸开编排吃 Pack', () => {
  const JEV_KEYS = [
    'JEV_CS_ROUTE',
    'TYPESAFE_API_KEY',
    'WX_ENV_VERSION',
    'TCB_ENV_VERSION',
    'CS_TRIAL_REFRESH',
    'CS_BUBBLE_GAP_MS',
    'CS_MAX_BUBBLES',
  ] as const
  let fetchBackup: unknown
  beforeEach(() => {
    control.reset()
    control.setOpenId('')
    fetchBackup = (globalThis as any).fetch
    for (const k of JEV_KEYS) delete process.env[k]
    process.env.CS_BUBBLE_GAP_MS = '0'
  })
  afterEach(() => {
    ;(globalThis as any).fetch = fetchBackup
    for (const k of JEV_KEYS) delete process.env[k]
  })

  it('大白话：闸开说包裹摔坏，回 Pack 要图句，并记下会话状态', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: {
          urgency: { noul: 0.4 },
          department: { choice: 'sales' },
          orderStatus: { choice: 'delivered' },
          emotionStatus: { choice: 'upset' },
          severity: { choice: 'medium' },
          responsibility: { choice: 'logistics' },
          needStatus: { choice: 'packaging' },
          exceeds: { noul: 0.1 },
        },
      }),
    })
    const { sent, ctx } = sendCollector()
    control.seed('kfIdentity', [{ _id: 'ext:euPack', openid: 'oPack' }])
    control.seed('orders', [{ _id: 'ord-euPack', id: 'ord-euPack', _openid: 'oPack', status: 'shipped', createdAt: Date.now() }])
    await handleMessage(ctx, { externalUserId: 'euPack', menuId: '', text: '包裹被摔坏了' })
    expect(sent.length).toBeGreaterThanOrEqual(2)
    expect(sent.length).toBeLessThanOrEqual(3)
    expect(sent.every((p) => p.msgtype === 'text')).toBe(true)
    const packMain = packScriptLines('aftersale_packaging')
    const got = sent.map((p) => String(p.text.content))
    expect(got).toContain(packMain[0])
    const line = got.join('\n')
    expect(line).toMatch(/合照|入镜拍/)
    expect(line).not.toMatch(/订单号/)
    expect(scriptPools().surprise.includes(line)).toBe(false)
    expect(line).not.toBe('嗯？您慢慢说')
    const pack = await db().collection('kfState').doc(packSessionId('euPack')).get()
    expect(pack.data.state).toBe('collect')
    expect(pack.data.intent).toBe('packaging')
    expect(pack.data.lastScript).toBe('aftersale_packaging')
  })

  it('大白话：刷新后再说包裹摔坏，仍要合照、不要订单号', async () => {
    process.env.CS_TRIAL_REFRESH = '1'
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    control.seed('kfState', [
      {
        _id: flowStateId('euRefSmash'),
        node: 'askNext',
        topic: 'logistics',
        greeted: true,
        solved: true,
        used: ['旧句'],
      },
      { _id: sessionEpochId('euRefSmash'), epoch: 0, boundOrderId: 'ord-logic-1' },
    ])
    ;(globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: {
          urgency: { noul: 0.4 },
          department: { choice: 'sales' },
          orderStatus: { choice: 'delivered' },
          emotionStatus: { choice: 'upset' },
          severity: { choice: 'medium' },
          responsibility: { choice: 'logistics' },
          needStatus: { choice: 'packaging' },
          exceeds: { noul: 0.1 },
        },
      }),
    })
    const { sent, ctx } = sendCollector()
    control.seed('kfIdentity', [{ _id: 'ext:euRefSmash', openid: 'oRefSmash' }])
    control.seed('orders', [
      { _id: 'ord-euRefSmash', id: 'ord-euRefSmash', _openid: 'oRefSmash', status: 'shipped', createdAt: Date.now() },
    ])
    await handleMessage(ctx, { externalUserId: 'euRefSmash', menuId: '', text: '刷新' })
    await handleMessage(ctx, { externalUserId: 'euRefSmash', menuId: 'trial:refresh:ok', text: '确认重来' })
    expect(sent[1].text.content).toBe(formatRefreshDone(1))
    const n = sent.length
    await handleMessage(ctx, { externalUserId: 'euRefSmash', menuId: '', text: '包裹被摔坏了' })
    const packMain = packScriptLines('aftersale_packaging')
    const got = sent.slice(n).map((p) => String(p.text.content))
    expect(got).toContain(packMain[0])
    expect(got.length).toBeGreaterThanOrEqual(2)
    expect(got.length).toBeLessThanOrEqual(3)
    const line = got.join('\n')
    expect(line).toMatch(/合照|入镜拍/)
    expect(line).not.toMatch(/订单号/)
    expect(line).not.toBe('嗯？您慢慢说')
  })

  it('大白话：点菜单转人工会写下交接包，带 epoch', async () => {
    control.seed('kfState', [{ _id: 'jevsession:euHandoff', epoch: 3, boundOrderId: '' }])
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euHandoff', menuId: 'human', text: '' })
    expect(sent[0].text.content).toContain('已为你转接')
    const doc = await db().collection('kfState').doc(handoffDocId('euHandoff', 3)).get()
    expect(doc.data.intent).toBeTruthy()
    expect(doc.data.fail_reason).toBe('user_asks_human')
    expect(doc.data.epoch).toBe(3)
    expect(doc.data.filled_slots).toBeTruthy()
    expect(doc.data.summary).toBeTruthy()
    expect(looksGreeting('包裹被摔坏了')).toBe(false)
  })
})
