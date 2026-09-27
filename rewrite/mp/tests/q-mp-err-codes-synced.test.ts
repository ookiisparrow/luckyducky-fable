// 小程序进不了 @ldrw/shared，建单/激活失败码只能手抄一份。云端改名或改冒号格式时，结算页会悄悄落回
// 「下单没成功，稍后再试」、不再移走买不了的那一行；激活页会把频控/服务繁忙说成「码不对」——而各自的
// 测试用的是写死的码，照样全绿。这里直接读云端源码对一遍，改一边这里就红。
import { describe, it, expect, vi, afterEach } from 'vitest'
import errorsSrc from '../../shared/src/errors.ts?raw'
import ordersSrc from '../../cloud/src/functions/app/actions/orders.ts?raw'
import payFlowSrc from '../lib/payFlow.ts?raw'
import checkoutPageSrc from '../pages/checkout/checkout.ts?raw'
import cloudbasercSrc from '../../../cloudbaserc.json?raw'
import { callApp, CALL_TIMEOUT_MS } from '../utils/cloud'
import { CREATE_ORDER_ERR_COPY } from '../lib/checkout'
import { ERR_REASON } from '../lib/mapLearning'

const ERR_VALUES = new Set([...errorsSrc.matchAll(/^\s*[A-Z_]+:\s*'([A-Z_]+)'/gm)].map((m) => m[1]))
// 动态码（UNKNOWN_ITEM:<id> 这类）在 ErrCode 里登记为前缀模板，小程序按冒号前主码认
const ERR_PREFIXES = new Set([...errorsSrc.matchAll(/`([A-Z_]+):\$\{string\}`/g)].map((m) => m[1]))
// 客户端自己造的码（云调用超时/失败/回包坏），云端本来就没有
const CLIENT_CODES = ['CALL_TIMEOUT', 'CALL_FAIL', 'BAD_RESULT']

// 前缀码还要核建单源码真在拼：登记册只追加不删，光查登记册查不出「云端已不再发」
function cloudHas(code: string): boolean {
  return ERR_VALUES.has(code) || (ERR_PREFIXES.has(code) && ordersSrc.includes('`' + code + ':'))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('手抄的失败码与云端一致', () => {
  it('大白话：读到了云端错误码登记册（读不到就是路径/格式变了，先修这里）', () => {
    expect(ERR_VALUES.has('OUT_OF_STOCK')).toBe(true)
    expect(ERR_PREFIXES.has('UNLISTED_ITEM')).toBe(true)
  })

  it('大白话：客户端自造的码确实是小程序云调用层发的（调用失败 / 回包没有 ok / 等满超时没回）', async () => {
    const run = async (callFunction: (o: Record<string, any>) => void, wait = 0) => {
      vi.useFakeTimers()
      ;(globalThis as any).wx = { cloud: { callFunction } }
      const p = callApp('ping')
      await vi.advanceTimersByTimeAsync(wait)
      return (await p).error
    }
    const got = [
      await run((o) => o.fail({})),
      await run((o) => o.success({ result: null })),
      await run(() => undefined, CALL_TIMEOUT_MS),
    ]
    expect(got).toEqual(['CALL_FAIL', 'BAD_RESULT', 'CALL_TIMEOUT'])
    expect([...got].sort()).toEqual([...CLIENT_CODES].sort())
  })

  it('大白话：结算页认的每个拒单码，云端都还发', () => {
    for (const code of Object.keys(CREATE_ORDER_ERR_COPY)) {
      if (!CLIENT_CODES.includes(code)) expect(cloudHas(code), code).toBe(true)
    }
  })

  it('大白话：付款分诊和结算页单独认的失败码，云端都登记着（改名了这里红，不会悄悄落回「支付没成功」「下单没成功」）', () => {
    const codes = [...(payFlowSrc + checkoutPageSrc).matchAll(/=== '([A-Z_]+)'/g)].map((m) => m[1])
    expect(codes).toEqual(expect.arrayContaining(['ORDER_ALREADY_PAID', 'PRICE_CHANGED']))
    for (const code of codes) expect(ERR_VALUES.has(code), code).toBe(true)
  })

  it('大白话：客户端等回包的时限比 app 函数自己的超时长——短了会把还在跑的写判成失败、诱人重交', () => {
    const app = JSON.parse(cloudbasercSrc).functions.find((f: { name: string }) => f.name === 'app')
    expect(app.timeout).toBeGreaterThan(0)
    expect(CALL_TIMEOUT_MS).toBeGreaterThan(app.timeout * 1000)
  })

  it('大白话：激活页认的每个失败码，云端都还发', () => {
    for (const code of Object.keys(ERR_REASON)) {
      if (!CLIENT_CODES.includes(code)) expect(ERR_VALUES.has(code), code).toBe(true)
    }
  })

  it('大白话：「哪件买不了」的冒号格式没变（结算页按它找出那一行移走）', () => {
    expect(ordersSrc).toContain('`UNLISTED_ITEM:${l.id}`')
    expect(ordersSrc).toContain('`UNKNOWN_ITEM:${l.id}`')
    expect(ordersSrc).toContain('`UNKNOWN_SKU:${l.id}:${l.sku}`')
  })
})
