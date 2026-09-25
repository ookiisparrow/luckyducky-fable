// 锁住 produceStock / restoreStock 两条 CAS 递增路径的逐分支行为：两者共用同一个递增循环，
// 区别只在「无档」——入成品要建档，回补不建档（无档＝不限量）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { produceStock, restoreStock } from '../src/kit'
import { COLLECTIONS } from '@ldrw/shared'

const inv = (id: string) => control.dump(COLLECTIONS.inventory).find((d: any) => d._id === id)

function failGets(id: string, times: number, msg = 'NETWORK_TIMEOUT') {
  let n = 0
  control.setBeforeGet(({ coll, id: got }: any) => {
    if (coll === COLLECTIONS.inventory && got === id && n++ < times) throw new Error(msg)
  })
  return () => n
}

beforeEach(() => {
  control.reset()
})

describe('produceStock', () => {
  it('非正整数数量或缺 productId 拒 BAD_QTY，不碰库', async () => {
    for (const [pid, qty] of [['p1', 0], ['p1', -1], ['p1', 1.5], ['', 2]] as const) {
      expect(await produceStock(pid, '', qty)).toEqual({ ok: false, error: 'BAD_QTY' })
    }
    expect(control.dump(COLLECTIONS.inventory).length).toBe(0)
  })

  it('无档则建档：stock=qty，带 productId/spec', async () => {
    expect(await produceStock('p1', 'L', 3)).toEqual({ ok: true })
    expect(inv('p1__L')).toMatchObject({ productId: 'p1', spec: 'L', stock: 3 })
  })

  it('有档累加；不限量保持不限量', async () => {
    control.seed(COLLECTIONS.inventory, [
      { _id: 'p1__', productId: 'p1', spec: '', stock: 4, updatedAt: 1 },
      { _id: 'p2__', productId: 'p2', spec: '', stock: null, updatedAt: 1 },
    ])
    expect(await produceStock('p1', '', 3)).toEqual({ ok: true })
    expect(await produceStock('p2', '', 3)).toEqual({ ok: true })
    expect(inv('p1__').stock).toBe(7)
    expect(inv('p2__').stock).toBeNull()
  })

  it('瞬时读失败重试后成功；读失败不当无档去建档', async () => {
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__', productId: 'p1', spec: '', stock: 4, updatedAt: 1 }])
    const gets = failGets('p1__', 2)
    expect(await produceStock('p1', '', 1)).toEqual({ ok: true })
    control.setBeforeGet(null as never)
    expect(gets()).toBe(3)
    expect(inv('p1__').stock).toBe(5)
  })

  it('持续读失败 → CONTENTION，不建档', async () => {
    failGets('p9__', 99)
    expect(await produceStock('p9', '', 1)).toEqual({ ok: false, error: 'CONTENTION' })
    control.setBeforeGet(null as never)
    expect(inv('p9__')).toBeUndefined()
  })

  it('并发双建：本方 add 撞键后下一轮走 CAS 累加到对方建的档上', async () => {
    control.setBeforeAdd(({ coll }: any) => {
      if (coll !== COLLECTIONS.inventory) return
      control.setBeforeAdd(null as never)
      control.seed(COLLECTIONS.inventory, [{ _id: 'p1__', productId: 'p1', spec: '', stock: 10, updatedAt: 1 }])
    })
    expect(await produceStock('p1', '', 2)).toEqual({ ok: true })
    expect(inv('p1__').stock).toBe(12)
  })

  it('CAS 持续落空 → CONTENTION，库存不动', async () => {
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__', productId: 'p1', spec: '', stock: 4, updatedAt: 1 }])
    control.setBeforeUpdate(({ coll }: any) => {
      if (coll === COLLECTIONS.inventory) throw new Error('FORCE_CAS_FAIL')
    })
    expect(await produceStock('p1', '', 1)).toEqual({ ok: false, error: 'CONTENTION' })
    control.setBeforeUpdate(null as never)
    expect(inv('p1__').stock).toBe(4)
  })
})

describe('restoreStock（不建档的递增路径）', () => {
  it('无档不建档、不告警；不限量不动', async () => {
    control.seed(COLLECTIONS.inventory, [{ _id: 'p2__', productId: 'p2', spec: '', stock: null, updatedAt: 1 }])
    await restoreStock([
      { productId: 'ghost', spec: '', qty: 3 },
      { productId: 'p2', spec: '', qty: 3 },
    ])
    expect(inv('ghost__')).toBeUndefined()
    expect(inv('p2__').stock).toBeNull()
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
  })

  it('瞬时读失败重试后回补成功', async () => {
    control.seed(COLLECTIONS.inventory, [{ _id: 'p1__', productId: 'p1', spec: '', stock: 4, updatedAt: 1 }])
    const gets = failGets('p1__', 2)
    await restoreStock([{ productId: 'p1', spec: '', qty: 2 }])
    control.setBeforeGet(null as never)
    expect(gets()).toBe(3)
    expect(inv('p1__').stock).toBe(6)
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
  })
})
