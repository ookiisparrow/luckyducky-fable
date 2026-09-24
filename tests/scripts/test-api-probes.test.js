import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { authConclusions, concurrentConclusions, isGatewayRejected } from '../../scripts/test-api/lib.mjs'

function src(name) {
  return readFileSync(new URL(`../../scripts/test-api/${name}`, import.meta.url), 'utf8')
}

describe('admin 探针不许把 405 当成鉴权成功', () => {
  it('callFunction 打到 adminApi 的 405 / POST_ONLY 不算被鉴权拒绝', () => {
    const viaCall = {
      ok: true,
      result: { statusCode: 405, body: JSON.stringify({ ok: false, error: 'POST_ONLY' }) },
    }
    expect(isGatewayRejected(viaCall)).toBe(false)
    expect(isGatewayRejected({ ok: true, result: { statusCode: 405, error: 'POST_ONLY' } })).toBe(false)
    expect(isGatewayRejected({ ok: true, result: { statusCode: '405', ok: false, error: 'POST_ONLY' } })).toBe(false)
  })

  it('真正的 401/403，以及用户网关的业务拒绝，仍然算拒绝', () => {
    expect(isGatewayRejected({
      ok: true,
      result: { statusCode: 401, body: JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }) },
    })).toBe(true)
    expect(isGatewayRejected({
      ok: true,
      result: { statusCode: 403, body: JSON.stringify({ ok: false, error: 'FORBIDDEN' }) },
    })).toBe(true)
    expect(isGatewayRejected({ ok: true, result: { ok: false, error: 'NO_OPENID' } })).toBe(true)
    expect(isGatewayRejected({ ok: false, error: 'boom' })).toBe(true)
  })

  it('业务成功不算拒绝', () => {
    expect(isGatewayRejected({ ok: true, result: { ok: true, list: [] } })).toBe(false)
  })

  it('功能/安全脚本不再用 callFunction 打 adminApi', () => {
    for (const name of ['functional.mjs', 'security.mjs']) {
      const text = src(name)
      expect(text).not.toMatch(/FUNCS\.admin/)
      expect(text).not.toMatch(/adminApi/)
      expect(text).not.toMatch(/callFn\(\s*['"]adminApi['"]/)
    }
  })
})

describe('功能报告的用例名和表格跟这次运行走', () => {
  it('公开接口用例名用各自的 action，表格不再填字面省略号', () => {
    const text = src('functional.mjs')
    expect(text).not.toContain('getProducts-公开接口')
    expect(text).not.toContain('| ... |')
  })
})

describe('并发结论用本轮数字', () => {
  it('两档不同的 P95 / 错误样本写出不同结论，且不出现历史常数', () => {
    const slow = [{
      concurrency: 10, tps: 40, errRate: '0.00', errors: 0, errorSample: '',
      s: { n: 10, p95: 800 },
    }]
    const fast = [{
      concurrency: 10, tps: 400, errRate: '0.00', errors: 0, errorSample: '',
      s: { n: 10, p95: 20 },
    }]
    const limited = [{
      concurrency: 50, tps: 12, errRate: '80.00', errors: 8, errorSample: 'EXCEED_RATELIMIT',
      s: { n: 2, p95: 100 },
    }]
    const network = [{
      concurrency: 50, tps: 12, errRate: '80.00', errors: 8, errorSample: 'NETWORK_DOWN',
      s: { n: 2, p95: 100 },
    }]
    const a = concurrentConclusions(slow)
    const b = concurrentConclusions(fast)
    const c = concurrentConclusions(limited)
    const d = concurrentConclusions(network)
    expect(a).not.toBe(b)
    expect(c).not.toBe(d)
    expect(a).toContain('800')
    expect(b).toContain('20')
    expect(b).toContain('400')
    expect(c).toContain('EXCEED_RATELIMIT')
    expect(d).toContain('NETWORK_DOWN')
    for (const text of [a, b, c, d]) {
      expect(text).not.toContain('131')
      expect(text).not.toContain('350')
    }
  })

  it('没有成功样本时不宣称达标', () => {
    const text = concurrentConclusions([{
      concurrency: 200, tps: 0, errRate: '100.00', errors: 5, errorSample: 'TIMEOUT',
      s: { n: 0 },
    }])
    expect(text).toContain('没有成功响应')
    expect(text).toContain('TIMEOUT')
  })

  it('脚本里不再写死历史 P95 / TPS', () => {
    const text = src('concurrent.mjs')
    expect(text).toContain('concurrentConclusions(')
    expect(text).not.toContain('131')
    expect(text).not.toContain('350')
    expect(text).not.toContain('inflight')
  })
})

describe('认证报告结论随本轮成败变', () => {
  const pass = [
    { name: 'app.login 无身份应拒', ok: true },
    { name: '伪造订单未落库（FAKE）', ok: true },
  ]
  const fail = [
    { name: 'app.login 无身份应拒', ok: false, detail: '放行了' },
    { name: '伪造订单未落库（FAKE）', ok: false, detail: '查得 1 条' },
  ]

  it('全过和有失败写出不同句子，失败时不宣称防护成立', () => {
    const okText = authConclusions(pass)
    const badText = authConclusions(fail)
    expect(okText).not.toBe(badText)
    expect(okText).toContain('全部被拒')
    expect(okText).toContain('都通过')
    expect(badText).toContain('没有被拒')
    expect(badText).toContain('没通过')
    expect(badText).not.toContain('有效')
    expect(badText).not.toContain('全部被拒')
    expect(badText).not.toContain('都通过')
  })

  it('脚本收尾不再无条件宣称身份防护和防伪有效', () => {
    const text = src('security-auth.mjs')
    expect(text).toContain('authConclusions(')
    expect(text).not.toContain('身份防护 fail-closed 有效')
    expect(text).not.toContain('防伪机制有效')
  })
})
