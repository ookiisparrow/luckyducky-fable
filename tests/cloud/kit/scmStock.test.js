import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { applyStockMoves, listStockLedger, saveMaterialDoc, listMaterialDocs } from '../../../packages/cloud/src/kit/scmStock'

// 原料账门1 行为锁（SCM-0·守卫 material-stock-single-seam/scm-ledger-idempotent 焊结构·本测试焊行为）：
// 确定性流水幂等（重放不双记账）、CAS 余额不为负、任一行失败全单回滚、fail-closed 入参、主档 uom 锁死。

const seedMats = () =>
  control.seed('materials', [
    { _id: 'stuffing', name: '填充棉', category: 'accessory', uom: 'gram', stock: 100, active: true },
    { _id: 'hook', name: '钩针', category: 'accessory', uom: 'count', stock: 10, active: true },
  ])

beforeEach(() => {
  control.reset()
  seedMats()
})

const stockOf = (id) => control.dump('materials').find((m) => m._id === id)?.stock
const ledger = () => control.dump('stockLedger')

describe('applyStockMoves（门1·唯一入出账口）', () => {
  it('入库：改余额 + 写确定性流水 _id=docType:docId:itemKey', async () => {
    const r = await applyStockMoves([{ materialId: 'stuffing', delta: 50 }], { docType: 'purchase_in', docId: 'po1', operator: 'admin' })
    expect(r).toEqual({ ok: true, applied: 1 })
    expect(stockOf('stuffing')).toBe(150)
    const rows = ledger()
    expect(rows).toHaveLength(1)
    expect(rows[0]._id).toBe('purchase_in:po1:stuffing')
    expect(rows[0].delta).toBe(50)
  })

  it('幂等：同单据重放不双记账（撞确定性 _id＝已应用·跳过）', async () => {
    const doc = { docType: 'purchase_in', docId: 'po1' }
    await applyStockMoves([{ materialId: 'stuffing', delta: 50 }], doc)
    const again = await applyStockMoves([{ materialId: 'stuffing', delta: 50 }], doc)
    expect(again.ok).toBe(true)
    expect(again.applied).toBe(0) // 第二次一行都没再应用
    expect(stockOf('stuffing')).toBe(150) // 不是 200
    expect(ledger()).toHaveLength(1)
  })

  it('fail-closed：非整数/零 delta、空料号、缺单据号一律拒（BAD_MOVE·分毫不动账）', async () => {
    expect((await applyStockMoves([{ materialId: 'stuffing', delta: 1.5 }], { docType: 'adjust', docId: 'a1' })).error).toBe('BAD_MOVE')
    expect((await applyStockMoves([{ materialId: 'stuffing', delta: 0 }], { docType: 'adjust', docId: 'a1' })).error).toBe('BAD_MOVE')
    expect((await applyStockMoves([{ materialId: '', delta: 1 }], { docType: 'adjust', docId: 'a1' })).error).toBe('BAD_MOVE')
    expect((await applyStockMoves([{ materialId: 'stuffing', delta: 1 }], { docType: 'adjust', docId: '' })).error).toBe('BAD_MOVE')
    expect(stockOf('stuffing')).toBe(100)
    expect(ledger()).toHaveLength(0)
  })

  it('余额不为负：扣超 → INSUFFICIENT，流水零残留', async () => {
    const r = await applyStockMoves([{ materialId: 'stuffing', delta: -200 }], { docType: 'outwork_issue', docId: 'ow1' })
    expect(r).toEqual({ ok: false, error: 'INSUFFICIENT', materialId: 'stuffing' })
    expect(stockOf('stuffing')).toBe(100)
    expect(ledger()).toHaveLength(0)
  })

  it('全有或全无：多行中后行失败 → 已应用行回滚（余额复原 + 流水删净）', async () => {
    const r = await applyStockMoves(
      [
        { materialId: 'hook', delta: 5 },
        { materialId: 'stuffing', delta: -999 },
      ],
      { docType: 'adjust', docId: 'a2', reason: '盘点' }
    )
    expect(r.ok).toBe(false)
    expect(r.error).toBe('INSUFFICIENT')
    expect(stockOf('hook')).toBe(10) // 先应用的 +5 已回滚
    expect(ledger()).toHaveLength(0)
  })

  it('主档不存在 → NO_MATERIAL（不静默建档·根因#8）', async () => {
    const r = await applyStockMoves([{ materialId: 'ghost', delta: 1 }], { docType: 'adjust', docId: 'a3' })
    expect(r).toEqual({ ok: false, error: 'NO_MATERIAL', materialId: 'ghost' })
  })

  it('成品行（fg: 前缀）只留痕流水、不碰 materials（成品账在 kit/inventory）', async () => {
    const r = await applyStockMoves([{ materialId: 'fg:p1__default', delta: -2 }], { docType: 'ship', docId: 'order1' })
    expect(r).toEqual({ ok: true, applied: 1 })
    expect(ledger()[0]._id).toBe('ship:order1:fg:p1__default')
    expect(control.dump('materials')).toHaveLength(2) // 主档无新增无变动
  })
})

describe('saveMaterialDoc / listMaterialDocs（主档·同门1 收口）', () => {
  it('建档初始化 stock:0；更新主档字段不碰 stock', async () => {
    expect(await saveMaterialDoc({ _id: 'eyes', name: '玩偶眼睛', category: 'accessory', uom: 'count' })).toBe('ok')
    expect(stockOf('eyes')).toBe(0)
    await applyStockMoves([{ materialId: 'eyes', delta: 20 }], { docType: 'adjust', docId: 'init1', reason: '期初' })
    expect(await saveMaterialDoc({ _id: 'eyes', name: '玩偶眼睛 6mm', category: 'accessory', uom: 'count' })).toBe('ok')
    expect(stockOf('eyes')).toBe(20) // 改名不动账
  })

  it('uom 建档锁死：count 档改 gram → UOM_LOCKED（混账拒·守卫 scm-uom-integer 行为）', async () => {
    expect(await saveMaterialDoc({ _id: 'hook', name: '钩针', category: 'accessory', uom: 'gram' })).toBe('UOM_LOCKED')
  })

  it('listMaterialDocs 返回主档（bounded）', async () => {
    const list = await listMaterialDocs()
    expect(list.map((m) => m._id).sort()).toEqual(['hook', 'stuffing'])
  })
})

describe('listStockLedger（查账·bounded）', () => {
  it('按料号过滤 + limit 封顶 200', async () => {
    await applyStockMoves([{ materialId: 'stuffing', delta: 10 }], { docType: 'adjust', docId: 'x1', reason: 'r' })
    await applyStockMoves([{ materialId: 'hook', delta: 1 }], { docType: 'adjust', docId: 'x2', reason: 'r' })
    expect(await listStockLedger('stuffing')).toHaveLength(1)
    expect(await listStockLedger()).toHaveLength(2)
    expect((await listStockLedger(undefined, 99999)).length).toBeLessThanOrEqual(200)
  })
})
