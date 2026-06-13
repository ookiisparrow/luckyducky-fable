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

// 根因#8「验证样本失真」：原项目最小样本（1×1 测试图）过、真实 200KB 照片必拒——
// 验收方法论要求 E2E 用真实尺寸样本。下面用真实 200KB 图走完整分片链路，断言重组无截断。
describe('真实尺寸分片上传（根因#8 验收方法论：真实样本而非玩具）', () => {
  // fixture：200KB 伪随机字节（非全零、可压不缩水），base64 后必然跨 90,000/片上限＝多片
  function realImageB64(bytes) {
    const buf = Buffer.alloc(bytes)
    for (let i = 0; i < bytes; i++) buf[i] = (i * 37 + 11) & 0xff
    return buf.toString('base64')
  }
  function splitChunks(b64, size = 90_000) {
    const out = []
    for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size))
    return out
  }

  it('真实 200KB 图：多片上传 → 重组字节完整（云存储收到 === 原图大小）', async () => {
    const BYTES = 200 * 1024
    const chunks = splitChunks(realImageB64(BYTES))
    expect(chunks.length).toBeGreaterThan(1) // 确属多片真实尺寸，非 1×1 玩具
    for (let seq = 0; seq < chunks.length; seq++) {
      expect((await call('uploadChunk', { uploadId: 'big', seq, b64: chunks[seq] })).ok).toBe(true)
    }
    const fin = await call('uploadFinish', { uploadId: 'big', total: chunks.length, ext: 'jpg', pid: 'pbig' })
    expect(fin.ok).toBe(true)
    // 关键：分片→重组→base64 解码全程无截断，落库字节数等于原图 200KB
    expect(control.lastUpload().bytes).toBe(BYTES)
  })

  it('uploadChunk 尺寸边界：90,000 放行、90,001 拒 BAD_CHUNK（边界即验，非只验逻辑）', async () => {
    expect((await call('uploadChunk', { uploadId: 'b1', seq: 0, b64: 'a'.repeat(90_000) })).ok).toBe(true)
    expect((await call('uploadChunk', { uploadId: 'b2', seq: 0, b64: 'a'.repeat(90_001) })).error).toBe(
      'BAD_CHUNK',
    )
  })
})
