// 小程序进不了 @ldrw/shared，建单/激活失败码只能手抄一份。云端改名或改冒号格式时，结算页会悄悄落回
// 「下单没成功，稍后再试」、不再移走买不了的那一行；激活页会把频控/服务繁忙说成「码不对」——而各自的
// 测试用的是写死的码，照样全绿。这里直接读云端源码对一遍，改一边这里就红。
import { describe, it, expect } from 'vitest'
import errorsSrc from '../../shared/src/errors.ts?raw'
import ordersSrc from '../../cloud/src/functions/app/actions/orders.ts?raw'
import cloudCallSrc from '../utils/cloud.ts?raw'
import { CREATE_ORDER_ERR_COPY } from '../lib/checkout'
import { ERR_REASON } from '../lib/mapLearning'

const ERR_VALUES = new Set([...errorsSrc.matchAll(/^\s*[A-Z_]+:\s*'([A-Z_]+)'/gm)].map((m) => m[1]))
// 客户端自己造的码（云调用超时/失败/回包坏），云端本来就没有
const CLIENT_CODES = ['CALL_TIMEOUT', 'CALL_FAIL', 'BAD_RESULT']

function cloudHas(code: string): boolean {
  return ERR_VALUES.has(code) || ordersSrc.includes(`'${code}:'`)
}

describe('手抄的失败码与云端一致', () => {
  it('大白话：读到了云端错误码登记册（读不到就是路径/格式变了，先修这里）', () => {
    expect(ERR_VALUES.has('OUT_OF_STOCK')).toBe(true)
  })

  it('大白话：客户端自造的码确实是小程序云调用层发的', () => {
    for (const c of CLIENT_CODES) expect(cloudCallSrc, c).toContain(`error: '${c}'`)
  })

  it('大白话：结算页认的每个拒单码，云端都还发', () => {
    for (const code of Object.keys(CREATE_ORDER_ERR_COPY)) {
      if (!CLIENT_CODES.includes(code)) expect(cloudHas(code), code).toBe(true)
    }
  })

  it('大白话：激活页认的每个失败码，云端都还发', () => {
    for (const code of Object.keys(ERR_REASON)) {
      if (!CLIENT_CODES.includes(code)) expect(ERR_VALUES.has(code), code).toBe(true)
    }
  })

  it('大白话：「哪件买不了」的冒号格式没变（结算页按它找出那一行移走）', () => {
    expect(ordersSrc).toContain("'UNLISTED_ITEM:' + l.id")
    expect(ordersSrc).toContain("'UNKNOWN_ITEM:' + l.id")
    expect(ordersSrc).toContain("'UNKNOWN_SKU:' + l.id + ':' + l.sku")
  })
})
