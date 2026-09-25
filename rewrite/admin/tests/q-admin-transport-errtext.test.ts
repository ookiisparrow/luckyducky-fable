// 传输层/鉴权层错误码（client.ts 与网关产出，任何 action 都可能回）在每张错误映射里都说同一句人话：
// 不落成「没成功（CODE）」——超时可能已生效，说成没成功会诱人重试（采购单无单号时每次重试都新建一张）。
import { describe, it, expect } from 'vitest'
import { orderErrorText } from '../src/lib/mapMoney'
import { launchErrorText, stockErrorText } from '../src/lib/mapSystem'
import { scmErrorText } from '../src/lib/mapScm'
import { publishErrorText } from '../src/lib/mapProducts'
import { loadErrors } from '../src/lib/status'

const MAPPERS: Record<string, (c: string) => string> = {
  order: orderErrorText,
  launch: launchErrorText,
  stock: (c) => stockErrorText(c),
  scm: scmErrorText,
  publish: (c) => publishErrorText(c),
  load: (c) => loadErrors([[{ ok: false, error: c }, '采购单']]).replace(/^采购单加载失败：/, ''),
}

describe('传输层错误码公共兜底', () => {
  it.each(['CALL_TIMEOUT', 'AUTH_UNAVAILABLE', 'BAD_JSON_RESPONSE', 'NO_ENDPOINT', 'NETWORK:Failed to fetch'])('大白话：%s 在各映射里是同一句人话，不带码、不说没成功', (code) => {
    const texts = Object.values(MAPPERS).map((f) => f(code))
    for (const t of texts) expect(t).not.toMatch(/没成功|操作失败|[A-Z]{4,}/)
    expect(new Set(texts).size).toBe(1)
  })

  it('大白话：业务码仍走各自的表，不被公共兜底抢走', () => {
    expect(scmErrorText('INSUFFICIENT')).toContain('库存不够扣')
    expect(publishErrorText('NEED_COVER')).toContain('封面')
    expect(orderErrorText('FUTURE_UNKNOWN_CODE')).toBe('操作失败（FUTURE_UNKNOWN_CODE）')
  })
})
