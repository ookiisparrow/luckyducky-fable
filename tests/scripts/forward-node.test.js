import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const SRC = readFileSync(join(ROOT, 'console-assets/forward-node.js'), 'utf8')
const MD = readFileSync(join(ROOT, 'console-assets/01-支付退款工作流.md'), 'utf8')

function loadScript(js) {
  const calls = []
  let rejectNext = null
  const cloudbase = {
    SYMBOL_CURRENT_ENV: 'SYMBOL_CURRENT_ENV',
    init: (opts) => ({
      _opts: opts,
      callFunction: async (arg) => {
        if (rejectNext) {
          const err = rejectNext
          rejectNext = null
          throw err
        }
        calls.push(arg)
        return { result: {} }
      },
    }),
  }
  const exports = {}
  const require = (name) => {
    if (name === '@cloudbase/node-sdk') return cloudbase
    throw new Error('unexpected require ' + name)
  }
  const fn = new Function('require', 'exports', 'module', js)
  fn(require, exports, { exports })
  return {
    main: exports.main,
    calls,
    failNext(err) {
      rejectNext = err
    },
  }
}

function uncommentRefundCopy(src) {
  const start = src.indexOf('// ===== refundnotify')
  if (start < 0) throw new Error('refundnotify copy missing')
  const lines = src
    .slice(start)
    .split('\n')
    .filter((l) => l.startsWith('// ') && !l.startsWith('// =====') && !l.startsWith('// （'))
    .map((l) => l.slice(3))
  return lines.join('\n')
}

function fences(md) {
  return [...md.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1].trim())
}

describe('forward-node paynotify：merge + alias + FunctionName', () => {
  it('把 OUTER out_trade_no 与 resource camelCase 合成 snake_case，三键齐写 payCallback', async () => {
    const { main, calls } = loadScript(SRC)
    const ack = await main({
      wepayTrigger: {
        output: {
          out_trade_no: 'o-outer',
          resource: { tradeState: 'SUCCESS', transactionId: 'txn-1' },
        },
      },
    })
    expect(ack).toEqual({ errcode: 0, errmsg: 'OK' })
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('payCallback')
    expect(calls[0].functionName).toBe('payCallback')
    expect(calls[0].FunctionName).toBe('payCallback')
    expect(calls[0].data.out_trade_no).toBe('o-outer')
    expect(calls[0].data.trade_state).toBe('SUCCESS')
    expect(calls[0].data.transaction_id).toBe('txn-1')
  })

  it('resource 只有 camelCase 单号时 alias 成 snake_case', async () => {
    const { main, calls } = loadScript(SRC)
    await main({
      wepayTrigger: {
        output: { resource: { outTradeNo: 'o-camel', tradeState: 'SUCCESS' } },
      },
    })
    expect(calls[0].data.out_trade_no).toBe('o-camel')
    expect(calls[0].data.trade_state).toBe('SUCCESS')
  })

  it('resource 没有单号时保住 OUTER out_trade_no / out_refund_no', async () => {
    const { main, calls } = loadScript(SRC)
    await main({
      wepayTrigger: {
        output: {
          out_trade_no: 'o-only-outer',
          out_refund_no: 'r-only-outer',
          resource: { trade_state: 'SUCCESS' },
        },
      },
    })
    expect(calls[0].data.out_trade_no).toBe('o-only-outer')
    expect(calls[0].data.out_refund_no).toBe('r-only-outer')
    expect(calls[0].data.trade_state).toBe('SUCCESS')
  })

  it('callFunction 失败必须抛出，不得装 ACK', async () => {
    const harness = loadScript(SRC)
    harness.failNext(new Error('FunctionName parameter could not be found'))
    await expect(harness.main({ wepayTrigger: { output: { resource: {} } } })).rejects.toThrow(/FunctionName/)
    expect(harness.calls).toHaveLength(0)
  })
})

describe('forward-node refundnotify 注释副本：同形只换函数名', () => {
  it('三键齐写 refundCallback，同样 merge+alias', async () => {
    const { main, calls } = loadScript(uncommentRefundCopy(SRC))
    await main({
      wepayTrigger: {
        output: {
          out_refund_no: 'r-outer',
          resource: { transactionId: 'txn-r' },
        },
      },
    })
    expect(calls[0].name).toBe('refundCallback')
    expect(calls[0].functionName).toBe('refundCallback')
    expect(calls[0].FunctionName).toBe('refundCallback')
    expect(calls[0].data.out_refund_no).toBe('r-outer')
    expect(calls[0].data.transaction_id).toBe('txn-r')
  })
})

describe('01-支付退款工作流.md 抄本与 forward-node.js 同文', () => {
  it('两个 js 围栏分别等于 pay 活段与 refund 去注释段', () => {
    const [payFence, refundFence] = fences(MD)
    expect(payFence).toBeTruthy()
    expect(refundFence).toBeTruthy()
    const live = SRC.slice(SRC.indexOf('const cloudbase = require')).split('\n// ===== refundnotify')[0].trim()
    expect(payFence).toBe(live)
    expect(refundFence).toBe(uncommentRefundCopy(SRC).trim())
  })
})
