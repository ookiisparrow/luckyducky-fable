// 库存写：预留扣减是原子条件更新（库存够就成，不因别人同时扣了就误判售罄）；管理端改库存永远带条件写，
// 不会把读写之间插进来的预留覆盖掉。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { reserveStock, restoreStock, setStock, getDb } from '../src/kit'

const inv = (id: string) => control.dump(COLLECTIONS.inventory).find((x: any) => x._id === id)
// 每次本方写库存前，先让「别的买家」原子扣走 1 件（交错模拟真并发竞争）
const competitorTakesOneBeforeEachWrite = () => {
  const taken = { n: 0 }
  let inside = false
  control.setBeforeUpdate(async ({ coll }: any) => {
    if (coll !== COLLECTIONS.inventory || inside) return
    inside = true
    const _ = getDb().command
    await getDb().collection(COLLECTIONS.inventory).doc('p1__').update({ data: { stock: _.inc(-1), updatedAt: Date.now() } })
    taken.n++
    inside = false
  })
  return taken
}

beforeEach(() => {
  control.reset()
})

describe('预留扣减：原子条件更新', () => {
  it('大白话：库存充足、别人同时在扣——多笔并发都成，不误报售罄，也不超卖', async () => {
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__', productId: 'p1', spec: '', stock: 100, updatedAt: 1 }])
    const taken = competitorTakesOneBeforeEachWrite()
    const rs = await Promise.all([1, 2, 3].map(() => reserveStock([{ productId: 'p1', spec: '', qty: 2 }])))
    control.setBeforeUpdate(null as never)
    expect(rs.every((r) => r.ok)).toBe(true)
    expect(taken.n).toBeGreaterThan(0)
    expect(inv('p1__').stock).toBe(100 - 3 * 2 - taken.n) // 本方 3×2，其余是竞争方扣走的
  })

  it('大白话：扣的那一刻库存已不够——拒（不扣成负数）', async () => {
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__', productId: 'p1', spec: '', stock: 2, updatedAt: 1 }])
    competitorTakesOneBeforeEachWrite()
    const r = await reserveStock([{ productId: 'p1', spec: '', qty: 2 }])
    control.setBeforeUpdate(null as never)
    expect(r.ok).toBe(false)
    expect(inv('p1__').stock).toBeGreaterThanOrEqual(0)
  })

  it('大白话：不限量/无档照旧不扣不计；回补也是原子加，同时有人扣不丢', async () => {
    control.seed(COLLECTIONS.inventory, [
      { _id: 'pU__', productId: 'pU', spec: '', stock: null, updatedAt: 1 },
      { _id: 'p1__', productId: 'p1', spec: '', stock: 10, updatedAt: 1 },
    ])
    const r = await reserveStock([
      { productId: 'pU', spec: '', qty: 1 },
      { productId: 'ghost', spec: '', qty: 1 },
    ])
    expect(r).toEqual({ ok: true, reserved: [] })
    expect(inv('pU__').stock).toBeNull()
    competitorTakesOneBeforeEachWrite()
    await restoreStock([{ productId: 'p1', spec: '', qty: 3 }])
    control.setBeforeUpdate(null as never)
    expect(inv('p1__').stock).toBe(10 - 1 + 3)
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
  })
})

describe('管理端改库存：一律条件写', () => {
  it('大白话：没带版本号——按当前档做条件写，读写之间有人预留就报冲突，不覆盖', async () => {
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__', productId: 'p1', spec: '', stock: 9, updatedAt: 1000 }])
    competitorTakesOneBeforeEachWrite()
    const r = await setStock('p1', '', 50)
    control.setBeforeUpdate(null as never)
    expect(r).toEqual({ ok: false, conflict: true })
    expect(inv('p1__').stock).toBe(8) // 预留留住了
    expect(await setStock('p1', '', 50)).toEqual({ ok: true }) // 没人插队就照写
    expect(inv('p1__').stock).toBe(50)
  })

  it('大白话：老档没有版本戳（页面传 0）——没被动过就能改；期间被预留盖了戳就冲突', async () => {
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__', productId: 'p1', spec: '', stock: 9 }])
    expect(await setStock('p1', '', 20, undefined, 0)).toEqual({ ok: true })
    expect(inv('p1__').stock).toBe(20)

    control.seed(COLLECTIONS.inventory, [{ _id: 'p2__', productId: 'p2', spec: '', stock: 9 }])
    await reserveStock([{ productId: 'p2', spec: '', qty: 1 }]) // 预留会盖上版本戳
    expect(await setStock('p2', '', 20, undefined, 0)).toEqual({ ok: false, conflict: true })
    expect(inv('p2__').stock).toBe(8)
  })

  it('大白话：老档没有版本戳、页面也没带版本号——读写之间有人预留（盖了戳）就冲突，不覆盖', async () => {
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__', productId: 'p1', spec: '', stock: 9 }])
    competitorTakesOneBeforeEachWrite()
    const r = await setStock('p1', '', 50)
    control.setBeforeUpdate(null as never)
    expect(r).toEqual({ ok: false, conflict: true })
    expect(inv('p1__').stock).toBe(8)
  })

  it('大白话：首次设库存（还没有档）照常建档', async () => {
    expect(await setStock('pNew', '', 5)).toEqual({ ok: true })
    expect(inv('pNew__').stock).toBe(5)
  })
})
