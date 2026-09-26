// 变异分诊：kit/flow.ts 存活变异的杀手测试（哈希算法走样、退款单号前缀、callFlow 告警行与 fail-soft 边角）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { hash53, refundNoFor, isValidRefundNo, callFlow } from '../src/kit/flow'

let lines: string[] = []
beforeEach(() => {
  control.reset()
  lines = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')))
})
afterEach(() => vi.restoreAllMocks())

describe('hash53 与公开 cyrb53 参考值一致', () => {
  // 参考值来自 cyrb53 作者公布的样例；算法一旦走样，幂等键和退款单号会跟已落库的对不上
  it('a / b / revenge / revenue 四个样例逐一相等', () => {
    expect(parseInt(hash53('a'), 36)).toBe(7929297801672961)
    expect(parseInt(hash53('b'), 36)).toBe(8684336938537663)
    expect(parseInt(hash53('revenge'), 36)).toBe(4051478007546757)
    expect(parseInt(hash53('revenue'), 36)).toBe(8309097637345594)
  })
})

describe('refundNoFor 派生单号的前缀', () => {
  it('含中文的售后单号：前缀只留字母数字，再接 - 和哈希', () => {
    const no = refundNoFor('o1__p1__红色')
    expect(no).toBe('o1p1-' + hash53('o1__p1__红色'))
  })

  it('全是中文、没有可读字符：前缀用 r 兜底', () => {
    expect(refundNoFor('红色')).toBe('r-' + hash53('红色'))
  })

  it('空单号也派生成 r-哈希，不原样回空', () => {
    const no = refundNoFor('')
    expect(no).toBe('r-' + hash53(''))
    expect(isValidRefundNo(no)).toBe(true)
  })

  it('超长单号：可读前缀截到 48 位，整号不超 64', () => {
    const id = 'A'.repeat(70) + '红'
    const no = refundNoFor(id)
    expect(no).toBe('A'.repeat(48) + '-' + hash53(id))
    expect(no.length).toBeLessThanOrEqual(64)
  })
})

describe('isValidRefundNo 只认字符串', () => {
  it('undefined、数字即使转成字符串能过正则，也不合规', () => {
    expect(isValidRefundNo(undefined)).toBe(false)
    expect(isValidRefundNo(12345)).toBe(false)
    expect(isValidRefundNo('12345')).toBe(true)
  })
})

describe('callFlow 调用形状', () => {
  it('经 cloudbase_module 云函数转发，工作流 id 与入参原样放在 data 里', async () => {
    control.setCallFunctionResult({ result: { data: { ok: 1 } } })
    expect(await callFlow('f0', { a: 1 })).toEqual({ ok: 1 })
    expect(control.callFunctionCalls()).toEqual([{ name: 'cloudbase_module', data: { name: 'f0', data: { a: 1 } } }])
  })
})

describe('callFlow 告警行与 fail-soft 边角', () => {
  it('调用抛错：告警行的级别、函数、错误码、上下文逐字固定，错误摘要截到 300 字', async () => {
    control.setCallFunctionImpl(async () => {
      throw new Error('x'.repeat(1000))
    })
    expect(await callFlow('f1', {})).toBeNull()
    expect(lines).toEqual([`[LD_ALERT] sev=money fn=flow code=FLOW_CALL_FAIL ctx={"flowId":"f1","error":"${'x'.repeat(300)}"}`])
  })

  it('有响应无 data：告警行逐字固定', async () => {
    control.setCallFunctionResult({ result: { errMsg: 'denied' } })
    expect(await callFlow('f2', {})).toBeNull()
    expect(lines).toEqual(['[LD_ALERT] sev=money fn=flow code=FLOW_NO_DATA ctx={"flowId":"f2","result":"{\\"errMsg\\":\\"denied\\"}"}'])
  })

  it('响应没有 result 字段 / 响应本身是 null：都回 null，不抛错', async () => {
    control.setCallFunctionResult({})
    expect(await callFlow('f3', {})).toBeNull()
    vi.spyOn(cloud, 'callFunction').mockResolvedValue(null as never)
    expect(await callFlow('f4', {})).toBeNull()
    expect(lines).toHaveLength(2)
  })

  it('响应序列化不了（循环引用）：告警里写 UNSERIALIZABLE，不抛错', async () => {
    const loop: Record<string, unknown> = {}
    loop.self = loop
    vi.spyOn(cloud, 'callFunction').mockResolvedValue({ result: loop } as never)
    expect(await callFlow('f5', {})).toBeNull()
    expect(lines).toEqual(['[LD_ALERT] sev=money fn=flow code=FLOW_NO_DATA ctx={"flowId":"f5","result":"UNSERIALIZABLE"}'])
  })
})
