// 变异清洞（2026-09-01 · 闸门有效性 P2）：kit/scmStock.ts 入参/边界/fg 前缀/主档字段
// 此前大量存活突变落在「无测试站岗」的 fail-closed 校验与探测辅助上。
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import {
  applyStockMoves,
  saveMaterialDoc,
  listMaterialDocs,
  hasAdjustLedgerEntry,
  hasThresholdMaterial,
  recentStockLedger,
  getDb,
} from '../src/kit'
import { COLLECTIONS, ERR } from '@ldrw/shared'

beforeEach(() => control.reset())
afterEach(() => vi.restoreAllMocks())

const mat = (id: string, stock: number, extra: Record<string, unknown> = {}) => ({
  _id: id,
  name: id,
  category: 'accessory',
  uom: 'count',
  stock,
  active: true,
  ...extra,
})

describe('applyStockMoves 入参 fail-closed（杀 BAD_MOVE 校验突变）', () => {
  it('大白话：缺 doc / docType / docId → BAD_MOVE，不写流水不改库存', async () => {
    control.seed('materials', [mat('m1', 10)])
    expect(await applyStockMoves([{ materialId: 'm1', delta: 1 }], null as never)).toEqual({
      ok: false,
      error: ERR.BAD_MOVE,
    })
    expect(await applyStockMoves([{ materialId: 'm1', delta: 1 }], { docType: '' as never, docId: 'd1' })).toEqual({
      ok: false,
      error: ERR.BAD_MOVE,
    })
    expect(
      await applyStockMoves([{ materialId: 'm1', delta: 1 }], { docType: 'adjust', docId: '' })
    ).toEqual({ ok: false, error: ERR.BAD_MOVE })
    expect(control.dump(COLLECTIONS.stockLedger).length).toBe(0)
    expect(control.dump('materials').find((x: any) => x._id === 'm1')?.stock).toBe(10)
  })

  it('大白话：空 moves / 非数组 → BAD_MOVE', async () => {
    expect(await applyStockMoves([], { docType: 'adjust', docId: 'd' })).toEqual({
      ok: false,
      error: ERR.BAD_MOVE,
    })
    expect(await applyStockMoves(null as never, { docType: 'adjust', docId: 'd' })).toEqual({
      ok: false,
      error: ERR.BAD_MOVE,
    })
  })

  it('大白话：料号空/非字符串、delta 非整数或 0 → BAD_MOVE（带 materialId 时回传）', async () => {
    expect(
      await applyStockMoves([{ materialId: '', delta: 1 }], { docType: 'adjust', docId: 'd' })
    ).toEqual({ ok: false, error: ERR.BAD_MOVE })
    expect(
      await applyStockMoves([{ materialId: 1 as never, delta: 1 }], { docType: 'adjust', docId: 'd' })
    ).toEqual({ ok: false, error: ERR.BAD_MOVE })
    expect(
      await applyStockMoves([{ materialId: 'm1', delta: 0 }], { docType: 'adjust', docId: 'd' })
    ).toEqual({ ok: false, error: ERR.BAD_MOVE, materialId: 'm1' })
    expect(
      await applyStockMoves([{ materialId: 'm1', delta: 1.5 }], { docType: 'adjust', docId: 'd' })
    ).toEqual({ ok: false, error: ERR.BAD_MOVE, materialId: 'm1' })
  })
})

describe('applyStockMoves 余额边界与 fg: 前缀', () => {
  it('大白话：扣到恰好 0 合法——next<0 才不足；若改成 next<=0 会误拒清零', async () => {
    control.seed('materials', [mat('m1', 5)])
    const r = await applyStockMoves([{ materialId: 'm1', delta: -5 }], {
      docType: 'adjust',
      docId: 'zero-ok',
      reason: '清零',
    })
    expect(r).toEqual({ ok: true, applied: 1 })
    expect(control.dump('materials').find((x: any) => x._id === 'm1')?.stock).toBe(0)
  })

  it('大白话：再扣一单位才 INSUFFICIENT', async () => {
    control.seed('materials', [mat('m1', 0)])
    const r = await applyStockMoves([{ materialId: 'm1', delta: -1 }], {
      docType: 'adjust',
      docId: 'neg',
      reason: '超扣',
    })
    expect(r).toEqual({ ok: false, error: ERR.INSUFFICIENT, materialId: 'm1' })
  })

  it('大白话：fg: 成品行只留流水、不动 materials；回滚也不应按料号 CAS（startsWith 非 endsWith）', async () => {
    control.seed('materials', [mat('m1', 1)])
    // 先应用 fg 行，再故意让第二行不足触发回滚——若 isFg 被改成 endsWith('fg:')，会误对 fg:sku 做 CAS → ROLLBACK_FAIL
    const lines: string[] = []
    const orig = console.error
    console.error = (...a: unknown[]) => {
      lines.push(String(a[0]))
    }
    try {
      const r = await applyStockMoves(
        [
          { materialId: 'fg:sku-a', delta: 1 },
          { materialId: 'm1', delta: -9 },
        ],
        { docType: 'ship', docId: 'ship-1' }
      )
      expect(r.ok).toBe(false)
      expect((r as any).error).toBe(ERR.INSUFFICIENT)
      expect(lines.some((l) => l.includes('ROLLBACK_FAIL'))).toBe(false)
      // materials 无 fg:sku-a 档；m1 未被动过（第二行失败前若第一行只留痕则 m1 仍为 1）
      expect(control.dump('materials').find((x: any) => x._id === 'm1')?.stock).toBe(1)
      expect(control.dump('materials').some((x: any) => String(x._id).startsWith('fg:'))).toBe(false)
    } finally {
      console.error = orig
    }
  })

  it('大白话：无主档 → NO_MATERIAL', async () => {
    const r = await applyStockMoves([{ materialId: 'ghost', delta: 1 }], {
      docType: 'adjust',
      docId: 'g',
      reason: 'x',
    })
    expect(r).toEqual({ ok: false, error: ERR.NO_MATERIAL, materialId: 'ghost' })
  })
})

describe('saveMaterialDoc 主档字段边界', () => {
  it('大白话：建档默认 supplierId=""、threshold=0、active=true；显式 active:false / threshold:0 须保留', async () => {
    expect(
      await saveMaterialDoc({ _id: 'acc:a', name: 'a', category: 'accessory', uom: 'count' })
    ).toBe('ok')
    const a = control.dump('materials').find((x: any) => x._id === 'acc:a')
    expect(a.supplierId).toBe('')
    expect(a.threshold).toBe(0)
    expect(a.active).toBe(true)
    expect(a.stock).toBe(0)

    expect(
      await saveMaterialDoc({
        _id: 'acc:b',
        name: 'b',
        category: 'accessory',
        uom: 'count',
        active: false,
        threshold: 0,
        supplierId: 'sup1',
      })
    ).toBe('ok')
    const b = control.dump('materials').find((x: any) => x._id === 'acc:b')
    expect(b.active).toBe(false)
    expect(b.threshold).toBe(0)
    expect(b.supplierId).toBe('sup1')
  })

  it('大白话：非法 threshold（非整数/负）归一为 0；合法正整数保留', async () => {
    await saveMaterialDoc({
      _id: 'acc:t1',
      name: 't1',
      category: 'accessory',
      uom: 'count',
      threshold: -3,
    })
    expect(control.dump('materials').find((x: any) => x._id === 'acc:t1')?.threshold).toBe(0)
    await saveMaterialDoc({
      _id: 'acc:t2',
      name: 't2',
      category: 'accessory',
      uom: 'count',
      threshold: 1.5 as never,
    })
    expect(control.dump('materials').find((x: any) => x._id === 'acc:t2')?.threshold).toBe(0)
    await saveMaterialDoc({
      _id: 'acc:t3',
      name: 't3',
      category: 'accessory',
      uom: 'count',
      threshold: 7,
    })
    expect(control.dump('materials').find((x: any) => x._id === 'acc:t3')?.threshold).toBe(7)
  })

  it('大白话：改 uom 撞锁 → UOM_LOCKED；更新不碰 stock', async () => {
    control.seed('materials', [mat('acc:u', 42, { uom: 'count' })])
    expect(
      await saveMaterialDoc({ _id: 'acc:u', name: 'u', category: 'accessory', uom: 'gram' })
    ).toBe(ERR.UOM_LOCKED)
    expect(
      await saveMaterialDoc({ _id: 'acc:u', name: 'u2', category: 'accessory', uom: 'count', threshold: 3 })
    ).toBe('ok')
    const row = control.dump('materials').find((x: any) => x._id === 'acc:u')
    expect(row.stock).toBe(42)
    expect(row.name).toBe('u2')
    expect(row.threshold).toBe(3)
  })

  it('大白话：带 spec 写入主档', async () => {
    expect(
      await saveMaterialDoc({
        _id: 'yarn:pink:L:knotted',
        name: 'pink',
        category: 'yarn',
        uom: 'count',
        spec: { color: 'pink', tier: 'L' },
      })
    ).toBe('ok')
    expect(control.dump('materials').find((x: any) => x._id === 'yarn:pink:L:knotted')?.spec).toEqual({
      color: 'pink',
      tier: 'L',
    })
  })
})

describe('探测/列表辅助（杀 length/cap 突变）', () => {
  it('大白话：hasAdjustLedgerEntry 无 adjust 流水为 false、有则为 true', async () => {
    expect(await hasAdjustLedgerEntry()).toBe(false)
    control.seed(COLLECTIONS.stockLedger, [
      { _id: 'adjust:d1:m1', docType: 'adjust', itemKey: 'm1', delta: 1, at: 1 },
    ])
    expect(await hasAdjustLedgerEntry()).toBe(true)
  })

  it('大白话：hasThresholdMaterial 仅认 threshold>0', async () => {
    control.seed('materials', [mat('m0', 1, { threshold: 0 }), mat('m1', 1, { threshold: 5 })])
    expect(await hasThresholdMaterial()).toBe(true)
    control.reset()
    control.seed('materials', [mat('m0', 1, { threshold: 0 })])
    expect(await hasThresholdMaterial()).toBe(false)
  })

  it('大白话：listMaterialDocs 上限 500——要 1000 也只 limit(500)', async () => {
    const db = getDb()
    const collProto = Object.getPrototypeOf(db.collection('__probe__'))
    const limitSpy = vi.spyOn(collProto, 'limit')
    await listMaterialDocs(1000)
    expect(limitSpy).toHaveBeenCalledWith(500)
  })

  it('大白话：recentStockLedger 上限 50；n<=0 归一为 1', async () => {
    const db = getDb()
    const collProto = Object.getPrototypeOf(db.collection('__probe__'))
    const limitSpy = vi.spyOn(collProto, 'limit')
    await recentStockLedger(999)
    expect(limitSpy).toHaveBeenCalledWith(50)
    limitSpy.mockClear()
    await recentStockLedger(0)
    expect(limitSpy).toHaveBeenCalledWith(1)
  })

  it('大白话：listMaterialDocs(3) 真截断', async () => {
    control.seed(
      'materials',
      Array.from({ length: 8 }, (_, i) => mat('m' + i, i))
    )
    const rows = await listMaterialDocs(3)
    expect(rows.length).toBe(3)
  })
})
