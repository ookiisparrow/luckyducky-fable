// 变异分诊：kit/scmStock.ts 存活变异的杀手测试（入参校验、扣到恰好 0、坏 stock 字段归零、争用/读失败的区分、
// 成品行回滚不碰原料、告警与返回里带料号、主档字段默认值、只读探测的过滤条件）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import {
  applyStockMoves,
  listStockLedger,
  hasAdjustLedgerEntry,
  hasThresholdMaterial,
  saveMaterialDoc,
  listMaterialDocs,
} from '../src/kit/scmStock'

const DOC = { docType: 'adjust' as const, docId: 'd1' }
const mat = (id: string, over: Record<string, unknown> = {}) => ({ _id: id, name: id, category: 'yarn', uom: 'gram', stock: 10, ...over })
const stockOf = (id: string) => control.dump(COLLECTIONS.materials).find((m: any) => m._id === id)?.stock
const anomalies = () => control.dump(COLLECTIONS.anomalies).map((a: any) => ({ kind: a.kind, code: a.code, ctx: a.ctx }))

beforeEach(() => {
  control.reset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('applyStockMoves 入参校验（fail-closed，不动账）', () => {
  it('缺单据号或单据类型、单据为空、空变动、料号为空或不是字符串、变动行为空、delta 为 0 或小数：一律 BAD_MOVE', async () => {
    control.seed(COLLECTIONS.materials, [mat('A')])
    const BAD = { ok: false, error: 'BAD_MOVE' }
    expect(await applyStockMoves([{ materialId: 'A', delta: 1 }], { docType: 'adjust', docId: '' })).toEqual(BAD)
    expect(await applyStockMoves([], DOC)).toEqual(BAD)
    expect(await applyStockMoves([{ materialId: 'A', delta: 1 }], { docId: 'd1' } as any)).toEqual(BAD)
    expect(await applyStockMoves([{ materialId: 'A', delta: 1 }], null as any)).toEqual(BAD)
    expect(await applyStockMoves([{ materialId: '', delta: 1 }], DOC)).toEqual(BAD)
    expect(await applyStockMoves([null as any], DOC)).toEqual(BAD)
    expect(await applyStockMoves([{ materialId: 7 as any, delta: 1 }], DOC)).toEqual(BAD)
    expect(await applyStockMoves([{ materialId: 'A', delta: 0 }], DOC)).toEqual({ ...BAD, materialId: 'A' })
    expect(await applyStockMoves([{ materialId: 'A', delta: 1.5 }], DOC)).toEqual({ ...BAD, materialId: 'A' })
    expect(stockOf('A')).toBe(10)
    expect(control.dump(COLLECTIONS.stockLedger)).toEqual([])
  })
})

describe('applyStockMoves 记账', () => {
  it('恰好扣到 0 允许；流水里没给经办人/原因就落空串', async () => {
    control.seed(COLLECTIONS.materials, [mat('A', { stock: 3 })])
    expect(await applyStockMoves([{ materialId: 'A', delta: -3 }], DOC)).toEqual({ ok: true, applied: 1 })
    expect(stockOf('A')).toBe(0)
    const [row] = control.dump(COLLECTIONS.stockLedger)
    expect(row.operator).toBe('')
    expect(row.reason).toBe('')
  })

  it('主档 stock 字段缺失：先归零再记，结果是 0 + delta', async () => {
    control.seed(COLLECTIONS.materials, [mat('A', { stock: undefined })])
    expect(await applyStockMoves([{ materialId: 'A', delta: 2 }], DOC)).toEqual({ ok: true, applied: 1 })
    expect(stockOf('A')).toBe(2)
  })

  it('成品行 + 缺主档原料行：原料行失败回滚时，成品流水直接撤掉，不去碰原料账、不报回滚失败', async () => {
    const r = await applyStockMoves(
      [
        { materialId: 'fg:p1__', delta: -1 },
        { materialId: 'GHOST', delta: -1 },
      ],
      DOC
    )
    expect(r).toEqual({ ok: false, error: 'NO_MATERIAL', materialId: 'GHOST' })
    expect(control.dump(COLLECTIONS.stockLedger)).toEqual([])
    expect(anomalies()).toEqual([])
  })

  it('回滚时反向恢复失败：ROLLBACK_FAIL 告警带料号、delta、单据', async () => {
    control.seed(COLLECTIONS.materials, [mat('A', { stock: 0 })])
    control.setBeforeAdd(async ({ coll, data }: any) => {
      // 第二行记账前，A 刚加的 5 已被别处用掉 3：回滚要扣回 5 就不够了
      if (coll === COLLECTIONS.stockLedger && data.itemKey === 'GHOST')
        await cloud.database().collection(COLLECTIONS.materials).doc('A').update({ data: { stock: 2 } })
    })
    const r = await applyStockMoves(
      [
        { materialId: 'A', delta: 5 },
        { materialId: 'GHOST', delta: 1 },
      ],
      DOC
    )
    expect(r).toEqual({ ok: false, error: 'NO_MATERIAL', materialId: 'GHOST' })
    expect(anomalies()).toEqual([
      { kind: 'flow-failure', code: 'ROLLBACK_FAIL', ctx: { fn: 'scmStock.rollback', materialId: 'A', delta: '5', docType: 'adjust', docId: 'd1' } },
    ])
  })

  it('流水写失败（不是撞号）：返回里带料号，告警带料号与单据', async () => {
    control.seed(COLLECTIONS.materials, [mat('A')])
    control.setBeforeAdd(async ({ coll }: any) => {
      if (coll === COLLECTIONS.stockLedger) throw new Error('MOCK_ADD_FAIL')
    })
    expect(await applyStockMoves([{ materialId: 'A', delta: 1 }], DOC)).toEqual({ ok: false, error: 'LEDGER_WRITE_FAILED', materialId: 'A' })
    expect(anomalies()).toEqual([
      { kind: 'flow-failure', code: 'LEDGER_WRITE_FAILED', ctx: { fn: 'scmStock.applyStockMoves', materialId: 'A', docType: 'adjust', docId: 'd1' } },
    ])
  })
})

describe('casChange 耗尽：争用与读失败分开', () => {
  it('纯争用（每次条件写都落空）：恰好试 5 次，回 CONTENTION，不报读失败', async () => {
    control.seed(COLLECTIONS.materials, [mat('A')])
    let tries = 0
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === COLLECTIONS.materials) {
        tries++
        throw new Error('write conflict')
      }
    })
    expect(await applyStockMoves([{ materialId: 'A', delta: 1 }], DOC)).toEqual({ ok: false, error: 'CONTENTION', materialId: 'A' })
    expect(tries).toBe(5)
    expect(anomalies()).toEqual([])
  })

  it('读主档一直失败：回 CONTENTION，并告警 READ_FAILED 带料号', async () => {
    control.seed(COLLECTIONS.materials, [mat('A')])
    control.setBeforeGet(async ({ coll, id }: any) => {
      if (coll === COLLECTIONS.materials && id) throw new Error('NETWORK_TIMEOUT')
    })
    expect(await applyStockMoves([{ materialId: 'A', delta: 1 }], DOC)).toEqual({ ok: false, error: 'CONTENTION', materialId: 'A' })
    expect(anomalies()).toEqual([{ kind: 'flow-failure', code: 'READ_FAILED', ctx: { fn: 'scmStock.casChange', materialId: 'A' } }])
  })
})

describe('只读查询', () => {
  it('查流水：不带料号回全部，带料号只回该料', async () => {
    control.seed(COLLECTIONS.stockLedger, [
      { _id: 'l1', itemKey: 'A', docType: 'adjust', at: 1 },
      { _id: 'l2', itemKey: 'B', docType: 'adjust', at: 2 },
    ])
    expect((await listStockLedger()).list.map((x: any) => x._id).sort()).toEqual(['l1', 'l2'])
    expect((await listStockLedger('A')).list.map((x: any) => x._id)).toEqual(['l1'])
  })

  it('期初盘点探测只认 adjust 流水；安全线探测只认 threshold > 0', async () => {
    control.seed(COLLECTIONS.stockLedger, [{ _id: 'l1', itemKey: 'A', docType: 'purchase_in', at: 1 }])
    control.seed(COLLECTIONS.materials, [mat('A', { threshold: 0 })])
    expect(await hasAdjustLedgerEntry()).toBe(false)
    expect(await hasThresholdMaterial()).toBe(false)
    control.seed(COLLECTIONS.stockLedger, [{ _id: 'l2', itemKey: 'A', docType: 'adjust', at: 2 }])
    control.seed(COLLECTIONS.materials, [mat('B', { threshold: 3 })])
    expect(await hasAdjustLedgerEntry()).toBe(true)
    expect(await hasThresholdMaterial()).toBe(true)
  })

  it('列主档按传入条数封顶', async () => {
    control.seed(COLLECTIONS.materials, [mat('A'), mat('B'), mat('C')])
    expect(await listMaterialDocs(2)).toHaveLength(2)
  })
})

describe('saveMaterialDoc 主档字段', () => {
  const base = { _id: 'M', name: 'm', category: 'yarn' as const, uom: 'gram' as const }
  const saved = () => control.dump(COLLECTIONS.materials).find((m: any) => m._id === 'M')

  it('新建：缺省供应商空串、安全线 0、启用；返回 ok', async () => {
    expect(await saveMaterialDoc(base)).toBe('ok')
    expect(saved()).toMatchObject({ supplierId: '', threshold: 0, active: true, stock: 0 })
  })

  it('给了就照存：供应商、安全线、停用、规格快照', async () => {
    await saveMaterialDoc({ ...base, supplierId: 's1', threshold: 5, active: false, spec: { color: '红' } })
    expect(saved()).toMatchObject({ supplierId: 's1', threshold: 5, active: false, spec: { color: '红' } })
  })

  it('安全线是负数或小数：按 0 存', async () => {
    await saveMaterialDoc({ ...base, threshold: -1 })
    expect(saved().threshold).toBe(0)
    await saveMaterialDoc({ ...base, threshold: 1.5 })
    expect(saved().threshold).toBe(0)
  })
})
