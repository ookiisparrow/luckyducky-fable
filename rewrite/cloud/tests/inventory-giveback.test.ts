// K3（bug sweep II·P1·钱链可观测）：kit/inventory.ts casIncrement 回补丢失零信号——
// 原返回 void 把「无档/不限量」与「CAS 重试耗尽」折叠成同一句静默 return，restoreStock 的六处调用点
// 全部 await void，限量 SKU 回补丢失永久无人知（方向偏少卖）。改后 casIncrement 返回 boolean，
// restoreStock 收集丢失行经 kit observe 单出口留痕告警——返回语义不变（fail-soft），只加信号。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { restoreStock, reserveStock } from '../src/kit'
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

// 批H（P1·防超卖）：casDecrement 原实现 `.get().catch(() => null)` 把「文档真不存在」（合法不限量）
// 与「网络/DB 瞬时读失败」混为一谈，且第一次 get() 失败就立即 return null——reserveStock 把 null
// 解释为「不限量，跳过预留」，真实读失败被静默放行成超卖口子。改后：真无档才判不限量；其它读失败进
// CAS_RETRY 重试，重试耗尽落回 false（与「库存不足」同一 fail-closed 出口，不再假冒合法不限量）。
describe('reserveStock/casDecrement 瞬时读故障不被误判不限量（批H）', () => {
  it('大白话：SKU 确实有库存档、get() 持续因非「无档」原因失败——不能被当成不限量放行，须 fail-closed 拒单', async () => {
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: 5, updatedAt: 1000 }])
    control.setBeforeGet(({ coll, id }: any) => {
      if (coll === COLLECTIONS.inventory && id === 'p1__') throw new Error('NETWORK_TIMEOUT') // 非「无档」的真读失败
    })
    const r = await reserveStock([{ productId: 'p1', spec: '', qty: 1 }])
    control.setBeforeGet(null as never)
    // 原 bug：get() 一失败即 return null → reserveStock 当作「不限量」放行（ok:true, reserved:[]）——超卖。
    // 修复后：持续读失败重试耗尽 → false（与库存不足同一出口）→ 整单拒绝，绝不当合法不限量放行。
    expect(r.ok).toBe(false)
    expect(r.short).toEqual({ productId: 'p1', spec: '', qty: 1 })
    expect(r.reserved).toEqual([])
    // 库存真未被扣（拒单不改动库存）
    expect(control.dump('inventory').find((x: any) => x._id === 'p1__')?.stock).toBe(5)
  })

  it('大白话：持续读失败重试耗尽——经 notifyAlert 打 RESERVE_READ_FAILED 留痕，供人工对账/排障', async () => {
    control.seed('inventory', [{ _id: 'p2__', productId: 'p2', spec: '', stock: 5, updatedAt: 1000 }])
    control.setBeforeGet(({ coll, id }: any) => {
      if (coll === COLLECTIONS.inventory && id === 'p2__') throw new Error('ECONNRESET')
    })
    const lines = await captureAlerts(async () => {
      await reserveStock([{ productId: 'p2', spec: '', qty: 1 }])
    })
    control.setBeforeGet(null as never)
    expect(lines.some((l) => l.includes('RESERVE_READ_FAILED'))).toBe(true)
  })

  it('大白话：SKU 确实不限量（文档确实不存在，非读失败）——继续正常放行，不拒单、不误报告警', async () => {
    const lines = await captureAlerts(async () => {
      const r = await reserveStock([{ productId: 'ghost-sku', spec: '', qty: 3 }])
      expect(r.ok).toBe(true)
      expect(r.reserved).toEqual([]) // 不限量不计入 reserved
    })
    expect(lines.some((l) => l.includes('RESERVE_READ_FAILED'))).toBe(false)
  })

  it('大白话：正常路径（有档、库存充足、读写都成功）不受影响——照常一次扣减成功', async () => {
    control.seed('inventory', [{ _id: 'p3__', productId: 'p3', spec: '', stock: 5, updatedAt: 1000 }])
    const r = await reserveStock([{ productId: 'p3', spec: '', qty: 2 }])
    expect(r.ok).toBe(true)
    expect(r.reserved).toEqual([{ productId: 'p3', spec: '', qty: 2 }])
    expect(control.dump('inventory').find((x: any) => x._id === 'p3__')?.stock).toBe(3)
  })

  it('大白话：库存真不足（非读失败，正常读到 stock<qty）——照常直接拒单，不多余重试', async () => {
    control.seed('inventory', [{ _id: 'p4__', productId: 'p4', spec: '', stock: 1, updatedAt: 1000 }])
    const r = await reserveStock([{ productId: 'p4', spec: '', qty: 5 }])
    expect(r.ok).toBe(false)
    expect(r.short).toEqual({ productId: 'p4', spec: '', qty: 5 })
    expect(control.dump('inventory').find((x: any) => x._id === 'p4__')?.stock).toBe(1) // 未被改动
  })

  // 批Q（P3·告警误报修复）：第一轮 get() 读失败（记一次尝试失败），后续轮次 get() 全部读成功、
  // 只是 CAS 更新（where+update）持续被别的并发方抢先而耗尽——最终「重试耗尽」的真实原因是最后
  // 几轮的正常并发争抢，不是读失败。原实现 hadReadFailure 整个循环粘滞、只要出现过一次读失败就
  // 会在耗尽时误打 RESERVE_READ_FAILED；修复后只看「决定耗尽的最后一轮」，此场景不应告警。
  it('大白话：首轮读失败+后续轮次读成功但 CAS 更新持续被并发抢占耗尽——不应误报 RESERVE_READ_FAILED（批Q）', async () => {
    control.seed('inventory', [{ _id: 'p5__', productId: 'p5', spec: '', stock: 5, updatedAt: 1000 }])
    let getCalls = 0
    control.setBeforeGet(({ coll, id }: any) => {
      if (coll === COLLECTIONS.inventory && id === 'p5__') {
        getCalls++
        if (getCalls === 1) throw new Error('NETWORK_TIMEOUT') // 仅第一轮读失败，后续轮次读成功
      }
    })
    control.setBeforeUpdate(({ coll }: any) => {
      // 后续每轮 get() 都成功，但 CAS 更新一律被模拟的并发方抢先，导致 5 次重试全部落空
      if (coll === COLLECTIONS.inventory) throw new Error('FORCE_CAS_FAIL')
    })
    const lines = await captureAlerts(async () => {
      const r = await reserveStock([{ productId: 'p5', spec: '', qty: 1 }])
      expect(r.ok).toBe(false) // 重试耗尽仍拒单（fail-closed，不受本 case 影响）
    })
    control.setBeforeGet(null as never)
    control.setBeforeUpdate(null as never)
    // 最终耗尽的真实原因是最后几轮的正常 CAS 并发争抢，不是「持续读失败」——不应打这个告警
    expect(lines.some((l) => l.includes('RESERVE_READ_FAILED'))).toBe(false)
    // 库存真未被扣（全部 CAS 落空）
    expect(control.dump('inventory').find((x: any) => x._id === 'p5__')?.stock).toBe(5)
  })
})
