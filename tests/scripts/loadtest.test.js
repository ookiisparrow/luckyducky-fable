import { describe, it, expect } from 'vitest'
import { readDoc, readV, updatedCount } from '../../scripts/loadtest.mjs'

// 守卫压测台「读对真库 SDK 返回形状」（根因#8 桩绿≠真证）：
// 内存桩按云函数 wx-server-sdk 形状写，真跑用 node-sdk 直连——两者 get()/update() 返回形状不同，
// 读错字段会让 CAS 测试全部假阴（updated 永远不等于 1 → 误判「丢更新」）。这条 bug 真跑才暴露，
// 此处把两种形状都锁死，防将来手滑改回单形状。
describe('loadtest readDoc：取单 doc（throttle 模式读 hits/hitWindowStart 字段所依）', () => {
  it('node-sdk：.data 数组 → 取 [0]', () => {
    expect(readDoc({ data: [{ hits: 3, hitWindowStart: 9 }] })).toEqual({ hits: 3, hitWindowStart: 9 })
  })
  it('wx-server-sdk：.data 对象 → 原样', () => {
    expect(readDoc({ data: { hits: 3 } })).toEqual({ hits: 3 })
  })
  it('空数组/缺失 → 假值（调用方按「无记录」!rec 走首写）', () => {
    expect(readDoc({ data: [] })).toBeFalsy() // 空数组 → undefined
    expect(readDoc(null)).toBeFalsy() // null → null
  })
})

describe('loadtest readV：get().data 两种形状都读对 v', () => {
  it('node-sdk：.data 是数组 → 读 data[0].v', () => {
    expect(readV({ data: [{ v: 5 }] })).toBe(5)
    expect(readV({ data: [{ v: 0 }] })).toBe(0) // v=0 不能被当 falsy 漏读
  })
  it('wx-server-sdk：.data 是对象 → 读 data.v', () => {
    expect(readV({ data: { v: 7 } })).toBe(7)
    expect(readV({ data: { v: 0 } })).toBe(0)
  })
  it('空 / 缺失 → 0（不崩）', () => {
    expect(readV({ data: [] })).toBe(0)
    expect(readV({})).toBe(0)
    expect(readV(null)).toBe(0)
  })
})

describe('loadtest updatedCount：update() 两种返回形状都读对', () => {
  it('node-sdk：{ updated }', () => {
    expect(updatedCount({ updated: 1 })).toBe(1)
    expect(updatedCount({ updated: 0 })).toBe(0)
  })
  it('wx-server-sdk：{ stats: { updated } }', () => {
    expect(updatedCount({ stats: { updated: 1 } })).toBe(1)
    expect(updatedCount({ stats: { updated: 0 } })).toBe(0)
  })
  it('空 / 缺失 → 0（条件更新视为未命中、会重试）', () => {
    expect(updatedCount({})).toBe(0)
    expect(updatedCount(null)).toBe(0)
  })
})
