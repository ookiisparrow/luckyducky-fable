// 模块归因映射行为锁（车队地基批2）：moduleOfAction 的运行时语义——已登记 action 归对模块、
// 未登记回 'unknown' 不抛（防异常路径反噬）。映射与 modules.json 的逐键同步由守卫 module-map-synced 焊死，
// 本测试只锁 helper 行为不重复核对全表。
import { describe, it, expect } from 'vitest'
import { APP_ACTION_MODULE, moduleOfAction } from '@ldrw/shared'

describe('moduleOfAction（异常账本模块归因）', () => {
  it('钱链 action 归 orders、学习链归 learning、身份归 identity', () => {
    expect(moduleOfAction('createOrder')).toBe('orders')
    expect(moduleOfAction('pay')).toBe('orders')
    expect(moduleOfAction('activateCourse')).toBe('learning')
    expect(moduleOfAction('login')).toBe('identity')
  })

  it('未登记 action 回 unknown、不抛（异常兜底路径不可反噬）', () => {
    expect(moduleOfAction('nonexistent')).toBe('unknown')
    expect(moduleOfAction('')).toBe('unknown')
  })

  it('全表 30 项、无空值、模块名全小写', () => {
    const entries = Object.entries(APP_ACTION_MODULE)
    expect(entries.length).toBe(30)
    for (const [, mod] of entries) expect(mod).toMatch(/^[a-z]+$/)
  })
})
