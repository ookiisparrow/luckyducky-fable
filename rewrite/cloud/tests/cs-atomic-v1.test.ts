import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { handleMessage, type DispatchCtx } from '../src/functions/cs/kfCallback/dispatch'
import { sendBubbles } from '../src/functions/cs/kfCallback/bubbles'
import {
  PACKAGING_FIRST_TOUCH_ID,
  atomicText,
  listAtomicLib,
  loadAtomicAssets,
  packagingFirstTouchBubbles,
  playSequence,
} from '../src/functions/cs/kfCallback/csAtomic'
import { composeLine, emptyFlow } from '../src/functions/cs/kfCallback/scriptReply'
import { getDb } from '../src/kit'

const PHOTO3 = [
  atomicText('business/packaging/ask_photo_01'),
  atomicText('business/packaging/ask_photo_02'),
  atomicText('business/packaging/ask_photo_03'),
] as const

const firstTouch = (rand: () => number = () => 0) => packagingFirstTouchBubbles(rand)

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
  sent
    .slice(from)
    .filter((p) => p && p.msgtype === 'text')
    .map((p) => String(p.text && p.text.content))

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

describe('atomic-v1 包装首次进线', () => {
  it('大白话：构建打进的原子库有 route/sequence/txt，没有 GitHub 地址', () => {
    const assets = loadAtomicAssets()
    expect(assets.id).toBe('atomic-v1')
    expect(assets.route.emotionAlways).toBe(true)
    expect(assets.route.emotionLibBySignal && assets.route.emotionLibBySignal.surprise).toBe('emotion/surprise')
    expect(assets.sequences[PACKAGING_FIRST_TOUCH_ID]).toBeTruthy()
    expect(listAtomicLib('emotion/surprise').length).toBeGreaterThan(0)
    expect(listAtomicLib('business/packaging')).toEqual(
      expect.arrayContaining(['ask_photo_01', 'ask_photo_02', 'ask_photo_03', 'empathy_01', 'empathy_02', 'empathy_03'])
    )
    const blob = JSON.stringify(assets)
    expect(blob).not.toContain('api.github.com')
    expect(blob).not.toContain('raw.githubusercontent.com')
  })

  it('大白话：sequence 解析出 5 条气泡，内容等于对应 txt，不要订单号', () => {
    const got = playSequence(PACKAGING_FIRST_TOUCH_ID, () => 0)
    const surpriseStem = listAtomicLib('emotion/surprise')[0]
    const surprise = atomicText('emotion/surprise/' + surpriseStem)
    const empathy = atomicText('business/packaging/empathy_01')
    expect(got).toHaveLength(5)
    expect(got).toEqual([surprise, empathy, ...PHOTO3])
    expect(got[0]).toBe(surprise)
    expect(got[1]).toBe(empathy)
    expect(got[2]).toBe(atomicText('business/packaging/ask_photo_01'))
    expect(got[3]).toBe(atomicText('business/packaging/ask_photo_02'))
    expect(got[4]).toBe(atomicText('business/packaging/ask_photo_03'))
    expect(got.join('')).not.toMatch(/订单号/)
    expect(PHOTO3).toEqual([
      '您拍一张包装和产品放一起的合照发我～',
      '外箱破口和产品都入镜拍一张发过来。',
      '包装+内物合照一张，我帮您看产品有没有事。',
    ])
  })

  it('大白话：原样直发，带问号的一句也不切开', async () => {
    const sent: string[] = []
    await sendBubbles(
      async (p: any) => void sent.push(p.text.content),
      (content) => ({ text: { content } }),
      ['嗯？怎么了', '理解理解。'],
      { raw: true, gapEnv: '0' }
    )
    expect(sent).toEqual(['嗯？怎么了', '理解理解。'])
  })

  it('大白话：compose 走 sequence，不再只回三句合照或惊讶空壳', () => {
    const expect5 = firstTouch()
    const { line, node, pieces } = composeLine(
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
    expect(pieces).toEqual(expect5)
    expect(line).toBe(expect5.join('\n'))
    expect(line).not.toMatch(/订单号/)
    expect(pieces).not.toEqual([...PHOTO3])
  })

  it('大白话：闸开说包裹被摔坏了，连发 5 气泡=对应 txt', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevPackaging
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euAtomic1', menuId: '', text: '包裹被摔坏了' })
    const got = texts(sent)
    const surprisePool = listAtomicLib('emotion/surprise').map((s) => atomicText('emotion/surprise/' + s))
    const empathyPool = ['empathy_01', 'empathy_02', 'empathy_03'].map((s) => atomicText('business/packaging/' + s))
    expect(got).toHaveLength(5)
    expect(surprisePool).toContain(got[0])
    expect(empathyPool).toContain(got[1])
    expect(got.slice(2)).toEqual([...PHOTO3])
    expect(got.join('')).not.toMatch(/订单号/)
  })
})
