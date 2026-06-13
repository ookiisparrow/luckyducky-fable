import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// adminApi 杂项闸门（审核批次B）：分片 seq 连续性、批次 count 校验、看板交易异常。
const KEY = 'test-admin-key-123'
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')

async function call(action, data = {}) {
  const res = await main({ httpMethod: 'POST', body: JSON.stringify({ action, key: KEY, data }) })
  return { status: res.statusCode, ...JSON.parse(res.body) }
}

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY) }])
})

describe('adminApi 杂项闸门', () => {
  it('uploadFinish：seq 不连续（0,2 共 2 片）不再拼出损坏文件', async () => {
    control.seed('uploadChunks', [
      { uploadId: 'u1', seq: 0, b64: 'aGk=', createdAt: Date.now() },
      { uploadId: 'u1', seq: 2, b64: 'aGk=', createdAt: Date.now() },
    ])
    const res = await call('uploadFinish', { uploadId: 'u1', total: 2, ext: 'jpg', pid: 'p1' })
    expect(res.error).toBe('CHUNKS_MISSING')
  })

  it('uploadFinish：seq 正好 0..total-1 才放行拼接', async () => {
    control.seed('uploadChunks', [
      { uploadId: 'u2', seq: 0, b64: 'aGk=', createdAt: Date.now() },
      { uploadId: 'u2', seq: 1, b64: 'aGk=', createdAt: Date.now() },
    ])
    const res = await call('uploadFinish', { uploadId: 'u2', total: 2, ext: 'jpg', pid: 'p1' })
    expect(res.ok).toBe(true)
  })

  it('createBatch：count 漏传/非法一律 BAD_ARGS（不再静默生成 1 个码）', async () => {
    expect((await call('createBatch', { courseId: 'course-duck' })).error).toBe('BAD_ARGS')
    expect((await call('createBatch', { courseId: 'course-duck', count: 'x' })).error).toBe('BAD_ARGS')
  })

  it('getDashboard：交易异常三类（feeMismatch / refundMismatch / 退款卡单超 1h）', async () => {
    control.seed('orders', [
      { _id: 'o1', id: 'o1', status: 'paid', amount: 2, feeMismatch: true, createdAt: Date.now(), items: [] },
      { _id: 'o2', id: 'o2', status: 'paid', amount: 178, createdAt: Date.now(), items: [] },
    ])
    control.seed('afterSales', [
      { _id: 'a1', orderId: 'o2', status: 'approved', approvedAt: Date.now() - 2 * 3600_000, refundAmount: 1 },
      { _id: 'a2', orderId: 'o2', status: 'applied', refundMismatch: true, refundAmount: 2 },
      { _id: 'a3', orderId: 'o2', status: 'approved', approvedAt: Date.now(), refundAmount: 3 }, // 刚触发，不算卡单
    ])
    const res = await call('getDashboard')
    expect(res.ok).toBe(true)
    expect(res.txAlerts.feeMismatch).toEqual(['o1'])
    expect(res.txAlerts.refundMismatch).toEqual(['a2'])
    expect(res.txAlerts.stuckRefunds).toEqual(['a1'])
  })
})
