import { describe, it, expect } from 'vitest'
import {
  setPurchaseHandoff,
  consumePurchaseHandoff,
  setOutworkHandoff,
  consumeOutworkHandoff,
} from '../../packages/admin/src/store/scmHandoff.js'

// 备货计算器 → 采购/外协开单的一次性预填中转：consume 后必须清空，否则回退到那两页会重复预填旧缺口
// （比如用户手动改了草稿又刷新页面，不该被陈旧的备货缺口覆盖）。
describe('scmHandoff（备货计算器联动开单·一次性消费）', () => {
  it('purchase：set 后 consume 拿到原值，再 consume 一次变 null（不重复预填）', () => {
    const payload = { supplierId: 's1', lines: [{ materialId: 'hook', qty: 5 }] }
    setPurchaseHandoff(payload)
    expect(consumePurchaseHandoff()).toEqual(payload)
    expect(consumePurchaseHandoff()).toBeNull()
  })

  it('outwork：set 后 consume 拿到原值，再 consume 一次变 null', () => {
    const payload = { lines: [{ materialId: 'yarn:yellow:L:raw', qty: 30 }] }
    setOutworkHandoff(payload)
    expect(consumeOutworkHandoff()).toEqual(payload)
    expect(consumeOutworkHandoff()).toBeNull()
  })

  it('未 set 过直接 consume → null（两页正常进入不受影响）', () => {
    expect(consumePurchaseHandoff()).toBeNull()
    expect(consumeOutworkHandoff()).toBeNull()
  })

  it('purchase 与 outwork 互不干扰', () => {
    setPurchaseHandoff({ supplierId: 's1', lines: [] })
    expect(consumeOutworkHandoff()).toBeNull() // outwork 没设过，不该被 purchase 的 set 污染
    expect(consumePurchaseHandoff()).toEqual({ supplierId: 's1', lines: [] })
  })
})
