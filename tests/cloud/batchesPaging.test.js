import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import {
  listBatches,
  listBatchCodes,
} from '../../packages/cloud/src/functions/admin/adminApi/actions/batches'

// 批次读路径分页全取（债#22）：listBatches/listBatchCodes 原单次 limit(1000) 截断，改 fetchAll
// 按页 skip 取尽。测聚合/过滤正确（fetchAll 集成），>200 多页循环简单（skip+=pageSize、不足页即止）。
const db = cloud.database()
const parse = (res) => JSON.parse(res.body)
beforeEach(() => control.reset())

describe('批次读路径分页全取（债#22）', () => {
  it('listBatches 按 batchId 汇总 total/activated，且不混入别的课', async () => {
    control.seed('qrcodes', [
      { _id: 'c1', courseId: 'course-1', batchId: 'b1', status: 'activated', createdAt: 10 },
      { _id: 'c2', courseId: 'course-1', batchId: 'b1', status: 'unused', createdAt: 10 },
      { _id: 'c3', courseId: 'course-1', batchId: 'b2', status: 'activated', createdAt: 20 },
      { _id: 'c4', courseId: 'course-2', batchId: 'b3', status: 'unused', createdAt: 30 },
    ])
    const r = parse(await listBatches({ db, data: { courseId: 'course-1' } }))
    expect(r.ok).toBe(true)
    expect(r.list.find((b) => b.batchId === 'b1')).toMatchObject({ total: 2, activated: 1 })
    expect(r.list.find((b) => b.batchId === 'b2')).toMatchObject({ total: 1, activated: 1 })
    expect(r.list.find((b) => b.batchId === 'b3')).toBeUndefined() // course-2 不混入
  })

  it('listBatchCodes 返回该批全部码 id', async () => {
    control.seed('qrcodes', [
      { _id: 'c1', batchId: 'b1' },
      { _id: 'c2', batchId: 'b1' },
      { _id: 'c3', batchId: 'b2' },
    ])
    const r = parse(await listBatchCodes({ db, data: { batchId: 'b1' } }))
    expect(r.codes.sort()).toEqual(['c1', 'c2'])
  })
})
