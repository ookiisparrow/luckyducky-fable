import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { handleMessage, kfUserHasRecentOrder, type DispatchCtx } from '../src/functions/cs/kfCallback/dispatch'
import { csTestAssumeRecentOrder } from '../src/functions/cs/kfCallback/trialRefresh'
import { sendBubbles } from '../src/functions/cs/kfCallback/bubbles'
import {
  PACKAGING_FIRST_TOUCH_ID,
  PACKAGING_NO_ORDER_ID,
  PACKAGING_WITH_ORDER_SHORT_ID,
  assemblePackagingBubbles,
  atomicText,
  detectPackagingFacets,
  listAtomicLib,
  loadAtomicAssets,
  packagingFirstTouchBubbles,
  playSequence,
  stitchUtterance,
} from '../src/functions/cs/kfCallback/csAtomic'
import { packScriptReply } from '../src/functions/cs/kfCallback/csPack'
import { composeLine, emptyFlow } from '../src/functions/cs/kfCallback/scriptReply'
import { formatRefreshDone } from '@ldrw/shared'
import { getDb } from '../src/kit'

const PHOTO1 = atomicText('business/packaging/ask_photo_01')
const PHOTO3 = [
  PHOTO1,
  atomicText('business/packaging/ask_photo_02'),
  atomicText('business/packaging/ask_photo_03'),
] as const

const expectedEmotion = () =>
  atomicText('emotion/surprise/' + listAtomicLib('emotion/surprise')[0]) +
  atomicText('emotion/apology/01') +
  atomicText('emotion/try_hard/01')

const surprisePool = () => listAtomicLib('emotion/surprise').map((s) => atomicText('emotion/surprise/' + s))
const apologyPool = () => listAtomicLib('emotion/apology').map((s) => atomicText('emotion/apology/' + s))
const empathyPool = () => ['empathy_01', 'empathy_02', 'empathy_03'].map((s) => atomicText('business/packaging/' + s))
const tryHardPool = () => listAtomicLib('emotion/try_hard').map((s) => atomicText('emotion/try_hard/' + s))

function expectCappedPackaging(got: string[], opts?: { claim?: boolean }) {
  expect(got.length).toBeGreaterThanOrEqual(2)
  expect(got.length).toBeLessThanOrEqual(3)
  expect(surprisePool().some((s) => got[0].includes(s))).toBe(true)
  expect([...apologyPool(), ...empathyPool()].some((s) => got[0].includes(s))).toBe(true)
  expect(tryHardPool().some((s) => got[0].includes(s))).toBe(true)
  expect(got).toContain(PHOTO1)
  expect(got.join('')).not.toMatch(/订单号/)
  if (opts && opts.claim) {
    expect(got).toHaveLength(3)
    expect(listAtomicLib('business/claim').map((s) => atomicText('business/claim/' + s))).toContain(got[2])
  }
}

const ACCEPT = '我的包裹被压烂了'

const withOrderShort = (text = ACCEPT, extra?: { severity?: string; style?: 'short' | 'long' }) =>
  assemblePackagingBubbles({
    text,
    hasRecentOrder: true,
    style: (extra && extra.style) || 'short',
    severity: extra && extra.severity,
    rand: () => 0,
  })

const noOrder = (text = ACCEPT) =>
  assemblePackagingBubbles({ text, hasRecentOrder: false, style: 'short', rand: () => 0 })

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

function seedRecentOrder(euid: string, openid = 'o' + euid) {
  control.seed('kfIdentity', [{ _id: 'ext:' + euid, openid }])
  control.seed('orders', [
    { _id: 'ord-' + euid, id: 'ord-' + euid, _openid: openid, status: 'shipped', createdAt: Date.now() },
  ])
}

const ENV_KEYS = [
  'JEV_CS_ROUTE',
  'TYPESAFE_API_KEY',
  'WX_ENV_VERSION',
  'TCB_ENV_VERSION',
  'TCB_ENV',
  'SCF_NAMESPACE',
  'CS_TRIAL_REFRESH',
  'CS_TEST_ASSUME_ORDER',
  'CS_BUBBLE_GAP_MS',
  'CS_MAX_BUBBLES',
] as const
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

describe('atomic-v1 包装优先级组装', () => {
  it('大白话：构建打进的原子库有门闩/新情绪/理赔，没有 GitHub 地址', () => {
    const assets = loadAtomicAssets()
    expect(assets.id).toBe('atomic-v1')
    expect(assets.route.emotionAlways).toBe(true)
    expect(assets.route.gate && assets.route.gate.recentOrderRequiredForBusiness).toBe(true)
    expect(assets.route.gate && assets.route.gate.noOrderSequence).toBe(PACKAGING_NO_ORDER_ID)
    expect(assets.route.sequences && assets.route.sequences.withOrderShort).toBe(PACKAGING_WITH_ORDER_SHORT_ID)
    expect(assets.route.styleDefault).toBe('short')
    expect(assets.sequences[PACKAGING_WITH_ORDER_SHORT_ID]).toBeTruthy()
    expect(assets.sequences[PACKAGING_NO_ORDER_ID]).toBeTruthy()
    expect(assets.sequences[PACKAGING_FIRST_TOUCH_ID]).toBeTruthy()
    expect(listAtomicLib('emotion/surprise')).toHaveLength(22)
    expect(listAtomicLib('emotion/apology')).toHaveLength(3)
    expect(listAtomicLib('emotion/try_hard')).toHaveLength(3)
    expect(listAtomicLib('business/claim')).toHaveLength(3)
    expect(listAtomicLib('gate/no_order')).toEqual(['clarify_01', 'clarify_02', 'human_01'])
    expect(listAtomicLib('business/packaging')).toHaveLength(18)
    expect(Object.keys(assets.files)).toHaveLength(52)
    expect(atomicText('business/packaging/empathy_01')).toBe('理解，包装成这样确实烦。')
    expect(atomicText('gate/no_order/clarify_01')).toMatch(/没查到您近期的订单/)
    const blob = JSON.stringify(assets)
    expect(blob).not.toContain('api.github.com')
    expect(blob).not.toContain('raw.githubusercontent.com')
  })

  it('大白话：有单短句=情绪综合→合照 ask_photo_01，不要订单号、不要 6 连发', () => {
    const got = withOrderShort()
    expect(got).toEqual([expectedEmotion(), PHOTO1])
    expect(got.length).toBeLessThanOrEqual(3)
    expect(got.join('')).not.toMatch(/订单号/)
    expect(PHOTO1).toBe('您拍一张包装和产品放一起的合照发我～')
    expect(PHOTO3).toEqual([
      '您拍一张包装和产品放一起的合照发我～',
      '外箱破口和产品都入镜拍一张发过来。',
      '包装+内物合照一张，我帮您看产品有没有事。',
    ])
    expect(packagingFirstTouchBubbles(() => 0)).toEqual(got)
  })

  it('大白话：无单只澄清/转人工，不发合照、不理赔', () => {
    const got = noOrder()
    expect(got).toEqual([atomicText('gate/no_order/clarify_01'), atomicText('gate/no_order/human_01')])
    expect(got.join('')).not.toMatch(/合照/)
    expect(got.join('')).not.toMatch(/理赔|索赔/)
    expect(got.some((s) => PHOTO3.includes(s as (typeof PHOTO3)[number]))).toBe(false)
    expect(playSequence(PACKAGING_NO_ORDER_ID, () => 0).join('')).not.toMatch(/合照/)
  })

  it('大白话：物流运输严重才后挂理赔；压烂本身不挂；有理赔仍 ≤3 泡', () => {
    const smashed = withOrderShort(ACCEPT)
    expect(smashed).toEqual([expectedEmotion(), PHOTO1])
    expect(smashed.join('')).not.toMatch(/理赔|索赔/)
    const severe = withOrderShort('物流运输把箱子压烂了', { severity: 'high' })
    expect(severe).toHaveLength(3)
    expect(severe[0]).toBe(expectedEmotion())
    expect(severe[1]).toBe(PHOTO1)
    expect(listAtomicLib('business/claim').map((s) => atomicText('business/claim/' + s))).toContain(severe[2])
    expect(detectPackagingFacets(ACCEPT).logisticsSevere).toBe(false)
    expect(detectPackagingFacets('快递摔坏了').logisticsSevere).toBe(true)
  })

  it('大白话：long 同样 ≤3，同 priority 合成更少长气泡', () => {
    const short = withOrderShort(ACCEPT, { style: 'short' })
    const long = withOrderShort(ACCEPT, { style: 'long' })
    expect(short.length).toBeLessThanOrEqual(3)
    expect(long.length).toBeLessThanOrEqual(3)
    expect(long[0]).toBe(short[0])
    expect(long[1]).toBe(PHOTO3.join(''))
    const severeLong = withOrderShort('物流运输把箱子压烂了', { style: 'long', severity: 'high' })
    expect(severeLong.length).toBeLessThanOrEqual(3)
  })

  it('大白话：CS_MAX_BUBBLES=2 时理赔并进合照条，总泡仍 ≤2', () => {
    process.env.CS_MAX_BUBBLES = '2'
    const severe = withOrderShort('物流运输把箱子压烂了', { severity: 'high' })
    expect(severe).toHaveLength(2)
    expect(severe[0]).toBe(expectedEmotion())
    expect(severe[1]).toContain(PHOTO1)
    expect(severe[1]).toMatch(/理赔|索赔/)
  })

  it('大白话：同会话连续短输入可拼', () => {
    const now = 1_000_000
    expect(stitchUtterance('包裹被', now, '压烂了', now + 200)).toBe('包裹被压烂了')
    expect(stitchUtterance('包裹被', now, '压烂了', now + 9000)).toBe('压烂了')
    expect(stitchUtterance('我的包裹被压烂了真的很生气', now, '还有图', now + 200)).toBe('还有图')
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

  it('大白话：compose 走有单短句序，不再只回三句合照或惊讶空壳', () => {
    const expect6 = withOrderShort()
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
      ACCEPT,
      () => 0
    )
    expect(node).toBe('photo')
    expect(pieces).toEqual(expect6)
    expect(line).toBe(expect6.join('\n'))
    expect(expect6.length).toBeLessThanOrEqual(3)
    expect(line).toContain(PHOTO1)
    expect(line).not.toMatch(/订单号/)
    expect(pieces).not.toEqual([...PHOTO3])
    expect(line).not.toBe(packScriptReply('aftersale_packaging', [], () => 0))
  })

  it('大白话：闸开有单说压烂，连发情绪综合→合照，约 3 泡', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevPackaging
    seedRecentOrder('euAtomic1')
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euAtomic1', menuId: '', text: ACCEPT })
    const got = texts(sent)
    expectCappedPackaging(got)
    expect(got.join('\n')).not.toBe(packScriptReply('aftersale_packaging'))
  })

  it('大白话：闸开无单说压烂，只澄清/转人工，无合照', async () => {
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevPackaging
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euAtomicNone', menuId: '', text: ACCEPT })
    const got = texts(sent)
    const clarifyPool = ['clarify_01', 'clarify_02'].map((s) => atomicText('gate/no_order/' + s))
    expect(got.length).toBeGreaterThanOrEqual(1)
    expect(clarifyPool).toContain(got[0])
    expect(got.join('')).not.toMatch(/合照/)
    expect(got.some((s) => PHOTO3.includes(s as (typeof PHOTO3)[number]))).toBe(false)
  })

  it('大白话：CS_TEST_ASSUME_ORDER 只在测版缺省/1 开，0/false 关，正式硬关', () => {
    process.env.TCB_ENV = 'yaliceshi-unit'
    delete process.env.CS_TEST_ASSUME_ORDER
    expect(csTestAssumeRecentOrder()).toBe(true)
    process.env.CS_TEST_ASSUME_ORDER = '1'
    expect(csTestAssumeRecentOrder()).toBe(true)
    process.env.CS_TEST_ASSUME_ORDER = '0'
    expect(csTestAssumeRecentOrder()).toBe(false)
    process.env.CS_TEST_ASSUME_ORDER = 'false'
    expect(csTestAssumeRecentOrder()).toBe(false)
    delete process.env.TCB_ENV
    delete process.env.CS_TEST_ASSUME_ORDER
    process.env.WX_ENV_VERSION = 'develop'
    expect(csTestAssumeRecentOrder()).toBe(true)
    process.env.WX_ENV_VERSION = 'release'
    process.env.CS_TEST_ASSUME_ORDER = '1'
    process.env.TCB_ENV = 'yaliceshi-unit'
    expect(csTestAssumeRecentOrder()).toBe(false)
    delete process.env.WX_ENV_VERSION
    process.env.TCB_ENV = 'cloudbase-prodlike'
    expect(csTestAssumeRecentOrder()).toBe(false)
    delete process.env.TCB_ENV
    delete process.env.CS_TEST_ASSUME_ORDER
    expect(csTestAssumeRecentOrder()).toBe(false)
  })

  it('大白话：测版假设开时没绑号也当有单；关掉才按真库', async () => {
    process.env.TCB_ENV = 'yaliceshi-unit'
    expect(await kfUserHasRecentOrder(db(), 'euNoBind')).toBe(true)
    process.env.CS_TEST_ASSUME_ORDER = '0'
    expect(await kfUserHasRecentOrder(db(), 'euNoBind')).toBe(false)
    seedRecentOrder('euNoBind', 'oNoBind')
    expect(await kfUserHasRecentOrder(db(), 'euNoBind')).toBe(true)
  })

  it('大白话：测版默认假设有单，没绑号/没单也走短句序，不走无单澄清', async () => {
    process.env.TCB_ENV = 'yaliceshi-unit'
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevPackaging
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euAssumeNone', menuId: '', text: ACCEPT })
    const got = texts(sent)
    expectCappedPackaging(got)
    expect(got.join('')).not.toMatch(/没查到您近期的订单/)
  })

  it('大白话：测版开关 0/false 恢复真查单，无单走澄清', async () => {
    process.env.TCB_ENV = 'yaliceshi-unit'
    process.env.CS_TEST_ASSUME_ORDER = '0'
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevPackaging
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euAssumeOff', menuId: '', text: ACCEPT })
    const got = texts(sent)
    const clarifyPool = ['clarify_01', 'clarify_02'].map((s) => atomicText('gate/no_order/' + s))
    expect(got.length).toBeGreaterThanOrEqual(1)
    expect(clarifyPool).toContain(got[0])
    expect(got.join('')).not.toMatch(/合照/)
    process.env.CS_TEST_ASSUME_ORDER = 'false'
    const second = sendCollector()
    await handleMessage(second.ctx, { externalUserId: 'euAssumeFalse', menuId: '', text: ACCEPT })
    expect(['clarify_01', 'clarify_02'].map((s) => atomicText('gate/no_order/' + s))).toContain(texts(second.sent)[0])
  })

  it('大白话：正式 release / 生产云硬关假设，旗标开了也按真库', async () => {
    process.env.CS_TEST_ASSUME_ORDER = '1'
    process.env.TCB_ENV = 'yaliceshi-unit'
    process.env.WX_ENV_VERSION = 'release'
    expect(await kfUserHasRecentOrder(db(), 'euAssumeRel')).toBe(false)
    delete process.env.WX_ENV_VERSION
    process.env.TCB_ENV = 'cloudbase-prodlike'
    expect(await kfUserHasRecentOrder(db(), 'euAssumeProd')).toBe(false)
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevPackaging
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euAssumeProd', menuId: '', text: ACCEPT })
    expect(texts(sent).join('')).not.toMatch(/合照/)
    expect(['clarify_01', 'clarify_02'].map((s) => atomicText('gate/no_order/' + s))).toContain(texts(sent)[0])
  })

  it('大白话：刷新后再说压烂，有单仍是短句默认序，不抽旧 Pack', async () => {
    process.env.CS_TRIAL_REFRESH = '1'
    process.env.JEV_CS_ROUTE = '1'
    process.env.TYPESAFE_API_KEY = 'test-key'
    ;(globalThis as any).fetch = jevPackaging
    seedRecentOrder('euAtomicRef')
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'euAtomicRef', menuId: '', text: '刷新' })
    await handleMessage(ctx, { externalUserId: 'euAtomicRef', menuId: 'trial:refresh:ok', text: '确认重来' })
    expect(sent[1].text.content).toBe(formatRefreshDone(1))
    const n = sent.length
    await handleMessage(ctx, { externalUserId: 'euAtomicRef', menuId: '', text: ACCEPT })
    const got = texts(sent, n)
    expectCappedPackaging(got)
    expect(got).not.toEqual([...PHOTO3])
  })
})
