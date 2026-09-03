// callApp 咽喉：超时 / 迟到回包 / 坏形状 / 同步抛 —— 全仓页面都靠这根管子，不能只靠页面间接绿。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callApp } from '../utils/cloud'

type CfOpts = {
  success: (res: { result: unknown }) => void
  fail: () => void
}

let lastOpts: CfOpts | null = null
let throwSync = false

beforeEach(() => {
  lastOpts = null
  throwSync = false
  vi.useFakeTimers()
  ;(globalThis as unknown as { wx: unknown }).wx = {
    cloud: {
      callFunction: (opts: CfOpts) => {
        if (throwSync) throw new Error('cloud missing')
        lastOpts = opts
      },
    },
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('callApp（超时 / 形状 / 同步抛）', () => {
  it('大白话：12 秒没回包 → CALL_TIMEOUT；之后迟到的 success 不再二次兑现', async () => {
    const p = callApp('ping')
    await vi.advanceTimersByTimeAsync(12_000)
    await expect(p).resolves.toEqual({ ok: false, error: 'CALL_TIMEOUT' })
    lastOpts!.success({ result: { ok: true } })
    await expect(p).resolves.toEqual({ ok: false, error: 'CALL_TIMEOUT' })
  })

  it('大白话：回包不是带 ok 的对象 → BAD_RESULT', async () => {
    const p = callApp('ping')
    lastOpts!.success({ result: 'oops' })
    await expect(p).resolves.toEqual({ ok: false, error: 'BAD_RESULT' })
  })

  it('大白话：wx.cloud.callFunction 同步抛（未 init）→ CALL_FAIL，不变成未处理 rejection', async () => {
    throwSync = true
    await expect(callApp('ping')).resolves.toEqual({ ok: false, error: 'CALL_FAIL' })
  })

  it('大白话：fail 回调 → CALL_FAIL', async () => {
    const p = callApp('ping')
    lastOpts!.fail()
    await expect(p).resolves.toEqual({ ok: false, error: 'CALL_FAIL' })
  })
})
