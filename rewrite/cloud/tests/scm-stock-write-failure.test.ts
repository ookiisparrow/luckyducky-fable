// 批AA：kit/scmStock.ts 两个独立发现。
//
// 任务1（P1）：applyStockMoves 的 ledger.add() 裸 catch 原来把「确定性 _id 真撞号（已应用过，合法幂等
// 跳过）」与「其它任何原因导致 add() 失败（网络瞬断/限流/配额超限/字段非法……）」混为一谈——后者本行
// 既没写流水也没 CAS 改库存，却被当「已应用过」静默跳过，applied 悄悄比 moves.length 小、无信号、无告警。
// 改为跟随 kit/ids.ts ensureDoc 的读回判据：读到该 _id＝真撞号（跳过合法不告警）；读不到＝真失败
// （notifyAlert + 回滚已应用行 + 整单按此行失败收尾，返回 LEDGER_WRITE_FAILED）。
//
// 任务2（P2）：saveMaterialDoc 新建物料分支的 add() 原来没有任何异常处理，是模块内「确定性 _id + 无
// 异常处理」的孤例——现跟 scmAssembly.ts runAssembly（try/catch → 409 DUPLICATE）同口径，识别「并发
// 首建同一物料」并返回 'DUPLICATE'（scmMaterials.ts saveMaterial 路由层随之映射成 409）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { applyStockMoves, saveMaterialDoc } from '../src/kit'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { COLLECTIONS } from '@ldrw/shared'

const SUPER = 'super-secret-key'
const post = (action: string, key: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

function captureAlerts(fn: () => Promise<any>): Promise<{ result: any; lines: string[] }> {
  const seen: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => {
    seen.push(String(a[0]))
  }
  return fn()
    .then((result) => ({ result, lines: seen }))
    .finally(() => {
      console.error = orig
    })
}

beforeEach(() => {
  control.reset()
})

describe('applyStockMoves ledger.add() 失败区分（P1）', () => {
  it('大白话：真撞号（流水已存在）——照旧幂等跳过，不告警，返回 ok', async () => {
    control.seed('materials', [{ _id: 'm1', name: 'm1', category: 'accessory', uom: 'count', stock: 10, active: true }])
    // 预置该行流水，模拟「已被重放/并发方写过」——ledger.add() 会真撞 _id
    control.seed(COLLECTIONS.stockLedger, [{ _id: 'adjust:dup-1:m1', itemKey: 'm1', delta: -5, docType: 'adjust', docId: 'dup-1', at: Date.now() }])
    const { result, lines } = await captureAlerts(() => applyStockMoves([{ materialId: 'm1', delta: -5 }], { docType: 'adjust', docId: 'dup-1', operator: 'op1', reason: '测试' }))
    expect(result).toEqual({ ok: true, applied: 0 }) // 幂等跳过：本次不重复应用
    expect(lines.some((l) => l.includes('LEDGER_WRITE_FAILED'))).toBe(false)
    // 库存未被二次扣减（幂等）
    expect(control.dump('materials').find((x: any) => x._id === 'm1')?.stock).toBe(10)
  })

  it('大白话：add() 因其它原因失败（非撞号，流水确实没写进去）——不当「已应用过」静默跳过，须告警 + 回滚 + 返回 LEDGER_WRITE_FAILED', async () => {
    control.seed('materials', [
      { _id: 'm1', name: 'm1', category: 'accessory', uom: 'count', stock: 10, active: true },
      { _id: 'm2', name: 'm2', category: 'accessory', uom: 'count', stock: 10, active: true },
    ])
    control.setBeforeAdd(({ coll }: any) => {
      if (coll === COLLECTIONS.stockLedger) throw new Error('MOCK_TRANSIENT_WRITE_FAIL') // 非撞号的其它失败
    })
    const { result, lines } = await captureAlerts(() =>
      applyStockMoves(
        [
          { materialId: 'm1', delta: -3 },
          { materialId: 'm2', delta: -4 },
        ],
        { docType: 'adjust', docId: 'fail-1', operator: 'op1', reason: '测试' }
      )
    )
    control.setBeforeAdd(null as never)

    expect(result.ok).toBe(false)
    expect((result as any).error).toBe('LEDGER_WRITE_FAILED')
    // 真失败：既没写流水，也没有 CAS 改库存——库存必须回到起始值（回滚/未曾应用）
    expect(control.dump('materials').find((x: any) => x._id === 'm1')?.stock).toBe(10)
    expect(control.dump('materials').find((x: any) => x._id === 'm2')?.stock).toBe(10)
    expect(control.dump(COLLECTIONS.stockLedger).length).toBe(0)
    // 必须留痕告警——不再零信号
    expect(lines.some((l) => l.includes('LEDGER_WRITE_FAILED') && l.includes('scmStock.applyStockMoves'))).toBe(true)
    expect(control.dump(COLLECTIONS.anomalies).some((a: any) => a.code === 'LEDGER_WRITE_FAILED')).toBe(true)
  })
})

describe('saveMaterialDoc 并发首建撞号（P2）', () => {
  it('大白话：新建物料时 add() 撞确定性 _id（并发首建）——不裸抛异常，返回 DUPLICATE', async () => {
    control.setBeforeAdd(({ coll }: any) => {
      if (coll === COLLECTIONS.materials) throw new Error('DUPLICATE_ID')
    })
    const r = await saveMaterialDoc({ _id: 'acc:test-dup', name: 'x', category: 'accessory', uom: 'count' })
    control.setBeforeAdd(null as never)
    expect(r).toBe('DUPLICATE')
  })

  it('大白话：saveMaterial 路由层把 DUPLICATE 映射成 409（同 runAssembly 口径），不会误报 200 成功', async () => {
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])
    control.setBeforeAdd(({ coll }: any) => {
      if (coll === COLLECTIONS.materials) throw new Error('DUPLICATE_ID')
    })
    const r = await post('saveMaterial', SUPER, { name: 'x', category: 'accessory', uom: 'count', slug: 'race-slug' })
    control.setBeforeAdd(null as never)
    expect(r.status).toBe(409)
    expect(r.error).toBe('DUPLICATE')
  })
})
