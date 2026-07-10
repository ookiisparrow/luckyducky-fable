// K3（bug sweep II·P1·钱链可观测）：kit/inventory.ts casIncrement 回补丢失零信号——
// 原返回 void 把「无档/不限量」与「CAS 重试耗尽」折叠成同一句静默 return，restoreStock 的六处调用点
// 全部 await void，限量 SKU 回补丢失永久无人知（方向偏少卖）。改后 casIncrement 返回 boolean，
// restoreStock 收集丢失行经 kit observe 单出口留痕告警——返回语义不变（fail-soft），只加信号。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { restoreStock } from '../src/kit'
import { isDocMissing } from '../src/kit/inventory'
import { COLLECTIONS } from '@ldrw/shared'

function captureAlerts(fn: () => Promise<void>): Promise<string[]> {
  const seen: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => {
    seen.push(String(a[0]))
  }
  return fn()
    .then(() => seen)
    .finally(() => {
      console.error = orig
    })
}

beforeEach(() => {
  control.reset()
})

describe('restoreStock 回补丢失可观测（K3）', () => {
  it('大白话：CAS 恒失手（重试耗尽）——不 throw，且经 notifyAlert 打 GIVEBACK_LOST 留痕（原版：静默吞、无信号）', async () => {
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 5, updatedAt: 1000 }])
    control.setBeforeUpdate(({ coll }: any) => {
      if (coll === COLLECTIONS.inventory) throw new Error('FORCE_CAS_FAIL') // 模拟持续并发争用·CAS 恒不咬
    })
    let threw = false
    const lines = await captureAlerts(async () => {
      try {
        await restoreStock([{ productId: 'p1', spec: '', qty: 2 }])
      } catch {
        threw = true
      }
    })
    control.setBeforeUpdate(null as never)
    expect(threw).toBe(false) // fail-soft：回补丢失不反噬调用方（关单/退款仍需正常收尾）
    expect(lines.some((l) => l.includes('GIVEBACK_LOST') && l.includes('restoreStock'))).toBe(true)
    // 库存确未被改动（CAS 全部落空·符合「重试耗尽」语义，不误报已改）
    expect(control.dump('inventory').find((x: any) => x._id === 'p1__')?.stock).toBe(5)
    // 桥接进 anomalies 账本（notifyAlert 既有行为·控制台可查·不重复推）
    const anomalies = control.dump(COLLECTIONS.anomalies)
    expect(anomalies.some((a: any) => a.code === 'GIVEBACK_LOST')).toBe(true)
  })

  it('大白话：无档路径（真无此 SKU 档案）仍静默 true——不误报回补丢失、不打告警（无档=不限量=合法不处理）', async () => {
    const lines = await captureAlerts(() => restoreStock([{ productId: 'ghost-sku', spec: '', qty: 3 }]))
    expect(lines.some((l) => l.includes('GIVEBACK_LOST'))).toBe(false)
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
  })

  it('大白话：正常回补（CAS 一次成功）——库存真被加回，不打告警', async () => {
    control.seed('inventory', [{ _id: 'p2__', productId: 'p2', spec: '', stock: 10, updatedAt: 1000 }])
    const lines = await captureAlerts(() => restoreStock([{ productId: 'p2', spec: '', qty: 4 }]))
    expect(lines.some((l) => l.includes('GIVEBACK_LOST'))).toBe(false)
    expect(control.dump('inventory').find((x: any) => x._id === 'p2__')?.stock).toBe(14)
  })
})

// K3 复审（bug sweep II round6）：isDocMissing 原判据只精确匹配测试桩自造字面量 'DOCUMENT_NOT_FOUND'，
// 真 sdk 报错文案不是该字面量（实测/社区口径形如「...cannot find document with _id [ID号]...」）——
// 内存桩复现不了真 sdk 文案，只能对纯函数单打，钉住「真机文案子串」与「测试桩字面量」两条判据都要命中。
describe('isDocMissing 判据兼容真 sdk 文案（K3 复审）', () => {
  it('大白话：真 sdk 实测报错文案（非测试桩字面量）也要判定为无档，不能只认桩的字面量', () => {
    const real = new Error('collection.doc.get:fail Error: cannot find document with _id abc123 in database')
    expect(isDocMissing(real)).toBe(true)
  })
  it('大白话：测试桩字面量仍要判定为无档（回归保护）', () => {
    expect(isDocMissing(new Error('DOCUMENT_NOT_FOUND'))).toBe(true)
  })
  it('大白话：真读失败（网络/瞬时故障，非「无档」文案）不能被误判成无档', () => {
    expect(isDocMissing(new Error('NETWORK_TIMEOUT'))).toBe(false)
    expect(isDocMissing(new Error('ECONNRESET'))).toBe(false)
  })
})
