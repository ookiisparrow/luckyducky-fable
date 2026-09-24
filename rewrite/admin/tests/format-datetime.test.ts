// 注册时间展示：后台 dateTime 只把毫秒数字画成「年月日 时分」。
// 云端若写成 serverDate，经 JSON 回读是文字时间，Number 不成数，客户搜索的注册时间是空白。
import { describe, it, expect } from 'vitest'
import { dateTime } from '../src/lib/format'

describe('dateTime（注册时间）', () => {
  it('大白话：新注册写成的毫秒数字能显示出来；文字时间和空对象显示成空白', () => {
    const ms = 1_758_518_400_000
    const shown = dateTime(ms)
    expect(shown).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(dateTime(new Date(ms).toISOString())).toBe('')
    expect(dateTime({})).toBe('')
  })
})
