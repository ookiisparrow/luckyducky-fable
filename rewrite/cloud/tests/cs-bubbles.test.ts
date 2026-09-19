import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { handleMessage, type DispatchCtx } from '../src/functions/cs/kfCallback/dispatch'
import { bubbleGapMs, parseBubbleGapMs, sendBubbles, splitBubbles } from '../src/functions/cs/kfCallback/bubbles'
import { packScriptLines, packScriptReply } from '../src/functions/cs/kfCallback/csPack'
import { composeLine, emptyFlow } from '../src/functions/cs/kfCallback/scriptReply'
import { formatRefreshDone } from '@ldrw/shared'
import { getDb } from '../src/kit'
import { scriptPools } from '../src/functions/cs/kfCallback/scriptPool'

const PHOTO3 = [
  '您拍一张包装和产品放一起的合照发我～',
  '外箱破口和产品都入镜拍一张发过来。',
  '包装+内物合照一张，我帮您看产品有没有事。',
] as const

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

const texts = (sent: any[], from = 0) =>
  sent.slice(from).filter((p) => p && p.msgtype === 'text').map((p) => String(p.text && p.text.content))

const ENV_KEYS = ['JEV_CS_ROUTE', 'TYPESAFE_API_KEY', 'WX_ENV_VERSION', 'TCB_ENV_VERSION', 'CS_TRIAL_REFRESH', 'CS_BUBBLE_GAP_MS'] as const
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

const jevPackaging = async () => ({
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

describe('切分短句', () => {
  it('大白话：换行和句号切成非空短段，标点跟本段走', () => {
    expect(splitBubbles('')).toEqual([])
    expect(splitBubbles('  \n  ')).toEqual([])
    expect(splitBubbles('在的在的，请说。')).toEqual(['在的在的，请说。'])
    expect(splitBubbles('嗨～在呢，有什么问题呢？')).toEqual(['嗨～', '在呢，有什么问题呢？'])
    expect(splitBubbles('甲。乙！丙？丁～戊')).toEqual(['甲。', '乙！', '丙？', '丁～', '戊'])
    expect(splitBubbles(PHOTO3.join('\n'))).toEqual([...PHOTO3])
    expect(splitBubbles('一句\n\n  二句。  \n三句！')).toEqual(['一句', '二句。', '三句！'])
    expect(splitBubbles('嗯？您慢慢说')).toEqual(['嗯？', '您慢慢说'])
  })

  it('大白话：段间隔默认 300-800，可用环境变量改', () => {
    expect(parseBubbleGapMs(undefined)).toEqual({ min: 300, max: 800 })
    expect(parseBubbleGapMs('')).toEqual({ min: 300, max: 800 })
    expect(parseBubbleGapMs('abc')).toEqual({ min: 300, max: 800 })
    expect(parseBubbleGapMs('0')).toEqual({ min: 0, max: 0 })
    expect(parseBubbleGapMs('500')).toEqual({ min: 500, max: 500 })
    expect(parseBubbleGapMs('300-800')).toEqual({ min: 300, max: 800 })
    expect(parseBubbleGapMs('800-300')).toEqual({ min: 300, max: 800 })
    expect(bubbleGapMs('300-800', () => 0)).toBe(300)
    expect(bubbleGapMs('300-800', () => 0.999)).toBe(800)
    expect(bubbleGapMs('0', () => 0.5)).toBe(0)
  })

  it('大白话：连发按段 send，段间会睡配置的间隔', async () => {
    const sent: string[] = []
    const gaps: number[] = []
    await sendBubbles(
      async (p: any) => void sent.push(p.text.content),
      (content) => ({ msgtype: 'text', text: { content } }),
      PHOTO3.join('\n'),
      { gapEnv: '300-800', rand: () => 0, sleep: async (ms) => void gaps.push(ms) }
    )
    expect(sent).toEqual([...PHOTO3])
    expect(gaps).toEqual([300, 300])
  })
})

describe('包装破损三句合照气泡', () => {
  it('大白话：Pack 包装脚本一次给出三句，不抽一句', () => {
    expect(packScriptLines('aftersale_packaging')).toEqual([...PHOTO3])
    expect(packScriptReply('aftersale_packaging', [], () => 0)).toBe(PHOTO3.join('\n'))
    expect(packScriptReply('aftersale_quality', [], () => 0)).not.toContain('\n')
    const { line, node } = composeLine(
      emptyFlow(),
      {
        model: 'jev-1.13.0',
        urgency: 0.2,
        department: 'sales',
        needStatus: 'packaging',
        emotionStatus: 'upset',
        orderStatus: 'delivered',
        topic: 'packaging',
      },
      '包裹被摔坏了',
      () => 0
    )
    expect(node).toBe('photo')
    expect(line).toBe(PHOTO3.join('\n'))
    expect(line).not.toMatch(/订单号/)
    expect(line).not.toBe('嗯？您慢慢说')
    expect(scriptPools().surprise.includes(line)).toBe(false)
  })

  it('大白话：闸开说包裹被摔坏了，连发三条合照气泡，不粘一条、不要订单号、不要空壳', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevPackaging
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euBub1', menuId: '', text: '包裹被摔坏了' })
    expect(sent).toHaveLength(3)
    expect(sent.every((p) => p.msgtype === 'text')).toBe(true)
    expect(texts(sent)).toEqual([...PHOTO3])
    expect(texts(sent).join('')).not.toMatch(/订单号/)
    expect(texts(sent).some((t) => t === '嗯？您慢慢说' || t === '嗯？')).toBe(false)
  })

  it('大白话：刷新后再说包裹被摔坏了，仍是连续三条合照气泡', async () => {
    process.env.CS_TRIAL_REFRESH = '1'
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevPackaging
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euBubRef', menuId: '', text: '刷新' })
    await handleMessage(ctx, { externalUserId: 'euBubRef', menuId: 'trial:refresh:ok', text: '确认重来' })
    expect(sent[1].text.content).toBe(formatRefreshDone(1))
    const n = sent.length
    expect(n).toBe(2)
    await handleMessage(ctx, { externalUserId: 'euBubRef', menuId: '', text: '包裹被摔坏了' })
    expect(texts(sent, n)).toEqual([...PHOTO3])
    expect(sent.length - n).toBe(3)
  })

  it('大白话：人工梯子短句仍是一条，不切开连发', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: { needStatus: { choice: 'greeting' }, department: { choice: 'sales' } },
      }),
    })
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euBubH', menuId: '', text: '人工' })
    expect(sent).toHaveLength(1)
    expect(scriptPools().humanAskWhat).toContain(sent[0].text.content)
  })
})
