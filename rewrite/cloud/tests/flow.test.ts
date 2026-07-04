// 工作流接缝可观测性（调试案 A 逼出·守卫 rw-flow-observable）：callFlow 失败必留错误原文——
// 「调用异常」与「有响应无 data」两分支都要能在日志里看到 flowId + 平台报错摘要（[LD_ALERT] 行），
// 否则退款触发失败只剩一句 REFUND_TRIGGER_FAIL、排障只能靠猜（2026-07-04 真单联测的教训）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { callFlow } from '../src/kit/flow'

let errLines: string[] = []
let spy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  control.reset()
  errLines = []
  spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errLines.push(args.map(String).join(' '))
  })
})
afterEach(() => {
  spy.mockRestore()
})

describe('callFlow 失败必留痕（fail-soft 但不无痕）', () => {
  it('大白话：模块调用抛错 → 返 null 且 [LD_ALERT] 行带 flowId 和错误原文摘要', async () => {
    control.setCallFunctionImpl(async () => {
      throw new Error('FUNCTION_NOT_FOUND: cloudbase_module')
    })
    const r = await callFlow('kbgzl_refund_test', { out_trade_no: 'o1' })
    expect(r).toBeNull() // 返回语义不变
    const line = errLines.find((l) => l.includes('[LD_ALERT]') && l.includes('kbgzl_refund_test'))
    expect(line, '告警行须含 flowId').toBeTruthy()
    expect(line).toContain('FUNCTION_NOT_FOUND') // 错误原文在痕里·不吞
  })

  it('大白话：模块有响应但无 data（工作流被拒/未发布/入参不合）→ 返 null 且把响应原样摘要留痕', async () => {
    control.setCallFunctionResult({ result: { code: 'FLOW_NOT_PUBLISHED', message: '工作流未发布' } })
    const r = await callFlow('kbgzl_refund_test', { out_trade_no: 'o1' })
    expect(r).toBeNull()
    const line = errLines.find((l) => l.includes('[LD_ALERT]') && l.includes('kbgzl_refund_test'))
    expect(line).toBeTruthy()
    expect(line).toContain('FLOW_NOT_PUBLISHED') // 平台响应摘要在痕里
  })

  it('大白话：成功路径零告警噪声——有 data 正常返回、不落 [LD_ALERT]', async () => {
    control.setCallFunctionResult({ result: { data: { paySign: 'x', timeStamp: '1' } } })
    const r = await callFlow('sywxzf_pay_test', {})
    expect(r).toEqual({ paySign: 'x', timeStamp: '1' })
    expect(errLines.find((l) => l.includes('[LD_ALERT]'))).toBeFalsy()
  })
})
