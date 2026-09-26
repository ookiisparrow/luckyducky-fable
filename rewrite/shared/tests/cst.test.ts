// 北京时间换算：订单号、批次号、心跳日 id、对账日桶都从这里取，字符串逐字锁死。
import { describe, it, expect } from 'vitest'
import { cstIso, dayKeyCST, dayStartMsCST } from '../src/cst'

describe('北京时间换算', () => {
  it('大白话：UTC 16:00 起算北京次日，跨年同理；时分秒数字是北京时间', () => {
    expect(cstIso(Date.parse('2026-01-02T20:07:59.999Z'))).toBe('2026-01-03T04:07:59.999Z')
    expect(dayKeyCST(Date.parse('2026-12-31T15:59:59.999Z'))).toBe('2026-12-31')
    expect(dayKeyCST(Date.parse('2026-12-31T16:00:00.000Z'))).toBe('2027-01-01')
  })

  it('大白话：北京零点的时间戳，换回日历日还是同一天', () => {
    const start = dayStartMsCST('2026-09-26')
    expect(start).toBe(Date.parse('2026-09-25T16:00:00Z'))
    expect(dayKeyCST(start)).toBe('2026-09-26')
    expect(dayKeyCST(start - 1)).toBe('2026-09-25')
    expect(dayStartMsCST('9月1日')).toBeNaN()
  })
})
