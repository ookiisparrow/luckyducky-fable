// 模块归因映射行为锁（车队地基批2）：moduleOfAction 的运行时语义——已登记 action 归对模块、
// 未登记回 'unknown' 不抛（防异常路径反噬）；映射与仓根 modules.json 逐键一致（云函数进不了 JSON，故设镜像）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_ACTION_MODULE, moduleOfAction } from '@ldrw/shared'

describe('moduleOfAction（异常账本模块归因）', () => {
  it('钱链 action 归 orders、学习链归 learning、身份归 identity', () => {
    expect(moduleOfAction('createOrder')).toBe('orders')
    expect(moduleOfAction('pay')).toBe('orders')
    expect(moduleOfAction('activateCourse')).toBe('learning')
    expect(moduleOfAction('login')).toBe('identity')
    expect(moduleOfAction('deleteAccount')).toBe('identity')
  })

  it('未登记 action 回 unknown、不抛（异常兜底路径不可反噬）', () => {
    expect(moduleOfAction('nonexistent')).toBe('unknown')
    expect(moduleOfAction('')).toBe('unknown')
  })

  it('与 modules.json 各模块 appActions 逐键一致——改正册漏改 moduleMap.ts 即红', () => {
    const reg = JSON.parse(readFileSync(resolve(__dirname, '../../../modules.json'), 'utf8'))
    const want: Record<string, string> = {}
    for (const [mid, m] of Object.entries<any>(reg.modules)) for (const a of m.appActions ?? []) want[a] = mid
    expect({ ...APP_ACTION_MODULE }).toEqual(want)
  })
})
