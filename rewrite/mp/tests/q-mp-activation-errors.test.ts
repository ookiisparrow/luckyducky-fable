// 激活失败分治：超时/频控/服务端出错都不是「码不对」——码可能是好的，给能重试的提示，不清码。
import { describe, it, expect } from 'vitest'
import { activationView, ACTIVATION_ERR_COPY } from '../lib/mapLearning'

describe('激活：非废码失败不说「码不对」', () => {
  it('大白话：12 秒超时算网络不好，可重试', () => {
    expect(activationView({ ok: false, error: 'CALL_TIMEOUT' })).toEqual({ kind: 'error', courseId: '', reason: 'network' })
  })
  it('大白话：一分钟内试太多次被频控——提示操作太频繁，而不是码不对', () => {
    expect(activationView({ ok: false, error: 'RATE_LIMITED' })).toEqual({ kind: 'error', courseId: '', reason: 'throttled' })
  })
  it('大白话：云端兜底异常 / 激活没写进库——提示服务繁忙稍后再试（重扫会自愈）', () => {
    expect(activationView({ ok: false, error: 'INTERNAL' })).toEqual({ kind: 'error', courseId: '', reason: 'busy' })
    expect(activationView({ ok: false, error: 'NOT_ACTIVATED', courseId: 'c1' })).toEqual({ kind: 'error', courseId: '', reason: 'busy' })
  })
  it('大白话：三种原因各有各的文案，且都不含「码不对」', () => {
    const titles = (['network', 'throttled', 'busy'] as const).map((r) => ACTIVATION_ERR_COPY[r].display)
    expect(new Set(titles).size).toBe(3)
    expect(ACTIVATION_ERR_COPY.network.display).toContain('网络')
    expect(ACTIVATION_ERR_COPY.throttled.display).toContain('频繁')
    expect(ACTIVATION_ERR_COPY.busy.display).toContain('繁忙')
    for (const r of ['network', 'throttled', 'busy'] as const) expect(JSON.stringify(ACTIVATION_ERR_COPY[r])).not.toContain('不对')
  })
  it('大白话：真废码和未知错误仍按「码不对」，不冒充激活', () => {
    expect(activationView({ ok: false, error: 'INVALID_CODE' }).kind).toBe('invalid')
    expect(activationView({ ok: false, error: 'WHATEVER' }).kind).toBe('invalid')
  })
})
