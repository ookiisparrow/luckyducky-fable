// K4（bug sweep II·P2·钱链审计迹）：kit/scmStock.ts rollback() 原丢弃 casChange 反向结果、紧接
// 无条件删流水——反向若因 INSUFFICIENT/CONTENTION/NO_MATERIAL 失败，库存留错账、唯一能解释差额的
// 流水却被删掉，违反本模块自述「宁不动账勿错账」与病根14「fail-soft 不抹可观测性」。改后：反向失败
// 保留该行 ledger 作审计迹 + 经 kit observe 告警；反向成功才删流水；applyStockMoves 返回语义不变。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { applyStockMoves } from '../src/kit'
import { COLLECTIONS } from '@ldrw/shared'

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

describe('applyStockMoves 回滚审计迹（K4）', () => {
  it('大白话：批内后一行不足触发回滚，前一行的反向恢复本身又失败——不静默删流水，保留该行 + 打 ROLLBACK_FAIL 告警', async () => {
    control.seed('materials', [
      { _id: 'm1', name: 'm1', category: 'accessory', uom: 'count', stock: 10, active: true },
      { _id: 'm2', name: 'm2', category: 'accessory', uom: 'count', stock: 5, active: true },
    ])
    let materialsUpdateCount = 0
    control.setBeforeUpdate(({ coll }: any) => {
      if (coll === COLLECTIONS.materials) {
        materialsUpdateCount++
        // 放行 m1 正向那一次真实成功（count===1）；从第二次起（回滚阶段 m1 反向恢复）恒失手，模拟持续并发争用
        if (materialsUpdateCount > 1) throw new Error('FORCE_REVERSE_FAIL')
      }
    })
    const { result, lines } = await captureAlerts(() =>
      applyStockMoves(
        [
          { materialId: 'm1', delta: -5 }, // 先成功：10→5
          { materialId: 'm2', delta: -100 }, // 库存不够（5-100<0）→ INSUFFICIENT，触发整单回滚
        ],
        { docType: 'adjust', docId: 'adj-rb-1', operator: 'op1', reason: '测试' }
      )
    )
    control.setBeforeUpdate(null as never)

    expect(result.ok).toBe(false)
    expect(result.error).toBe('INSUFFICIENT')

    // m1 反向恢复失败（CONTENTION）——流水行必须保留（唯一能解释「库存已扣但没退」差额的审计迹），不被删掉
    const m1Ledger = control.dump(COLLECTIONS.stockLedger).find((l: any) => l._id === 'adjust:adj-rb-1:m1')
    expect(m1Ledger).toBeTruthy()
    expect(m1Ledger.delta).toBe(-5)
    // m2 自身的 claim 在检测到 INSUFFICIENT 时已撤回（既有行为不变，非本次修复对象）
    expect(control.dump(COLLECTIONS.stockLedger).find((l: any) => l._id === 'adjust:adj-rb-1:m2')).toBeFalsy()

    // 留痕告警（不 throw·fail-soft）
    expect(lines.some((l) => l.includes('ROLLBACK_FAIL') && l.includes('scmStock.rollback'))).toBe(true)
    expect(control.dump(COLLECTIONS.anomalies).some((a: any) => a.code === 'ROLLBACK_FAIL')).toBe(true)
  })

  it('大白话：正常回滚路径不变——反向恢复成功时流水照旧被删、不打告警', async () => {
    control.seed('materials', [
      { _id: 'm1', name: 'm1', category: 'accessory', uom: 'count', stock: 10, active: true },
      { _id: 'm2', name: 'm2', category: 'accessory', uom: 'count', stock: 5, active: true },
    ])
    const { result, lines } = await captureAlerts(() =>
      applyStockMoves(
        [
          { materialId: 'm1', delta: -5 },
          { materialId: 'm2', delta: -100 }, // 触发回滚，本次反向恢复无干扰、正常成功
        ],
        { docType: 'adjust', docId: 'adj-rb-2', operator: 'op1', reason: '测试' }
      )
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBe('INSUFFICIENT')
    // 反向成功——库存真被恢复回 10，流水行照旧被删（既有行为不变）
    expect(control.dump('materials').find((x: any) => x._id === 'm1')?.stock).toBe(10)
    expect(control.dump(COLLECTIONS.stockLedger).find((l: any) => l._id === 'adjust:adj-rb-2:m1')).toBeFalsy()
    expect(lines.some((l) => l.includes('ROLLBACK_FAIL'))).toBe(false)
  })
})
