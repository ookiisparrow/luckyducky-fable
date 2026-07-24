// 变异分诊批二（2026-07-24）：kit/ids.ts ensureDoc 确定性幂等建档（设计约束#1）——首轮 10 幸存全在
// 「撞号吞掉重试 / 集合未建兜底 / 读回为准」三段防线上，此前无直接测试站岗。
// 桩能力：add 撞 _id 抛 DUPLICATE_ID；control.markUncreated 逼「集合未建」真机行为；setBeforeAdd 注入真写失败。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { ensureDoc } from '../src/kit/ids'

beforeEach(() => control.reset())

describe('ensureDoc（确定性 _id 幂等建档·读回为准）', () => {
  it('大白话：正常建档——写入的字段原样落库并读回（不是空档）', async () => {
    const got = await ensureDoc('idsA', 'k1', { kind: 'x', n: 7 })
    expect(got).toMatchObject({ _id: 'k1', kind: 'x', n: 7 })
    expect(control.dump('idsA').length).toBe(1)
  })

  it('大白话：撞号（并发方已建）——吞掉不炸、读回真档、绝不产生第二条也绝不覆盖', async () => {
    control.seed('idsA', [{ _id: 'k1', kind: 'earlier', n: 1 }])
    const got = await ensureDoc('idsA', 'k1', { kind: 'late', n: 9 })
    expect(got).toMatchObject({ _id: 'k1', kind: 'earlier', n: 1 }) // 先到者赢·不覆盖
    expect(control.dump('idsA').length).toBe(1)
  })

  it('大白话：集合未建——建一次集合后重试写入成功（少了 createCollection 兜底或重试写必红）', async () => {
    control.markUncreated('idsB')
    const got = await ensureDoc('idsB', 'k2', { kind: 'fresh' })
    expect(got).toMatchObject({ _id: 'k2', kind: 'fresh' })
    expect(control.dump('idsB').length).toBe(1)
  })

  it('大白话：写确实没落（两次 add 都真失败、库里也没有）→ 抛 ENSURE_DOC_FAILED:集合:id，绝不返回假成功', async () => {
    control.setBeforeAdd(({ coll }: { coll: string }) => {
      if (coll === 'idsC') throw new Error('WRITE_DOWN') // 模拟真写故障（非撞号）
    })
    await expect(ensureDoc('idsC', 'k3', { kind: 'x' })).rejects.toThrow('ENSURE_DOC_FAILED:idsC:k3')
  })
})
